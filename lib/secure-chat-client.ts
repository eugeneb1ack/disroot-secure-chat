import { b64, capability, digest, MlsConversation, randomId, seal, unseal, utf8, type PreparedPacket, type MlsCheckpoint } from "./secure-chat-mls.ts";
import { MAX_MEMBERS, PRESENCE_TTL, idPattern, loginText, type ChatInvitation, type ChatView, type LoginChallenge, type LoginRequest, type ReadableMessage, type RelaySnapshot, type RelayPresence, type TransportPublicKey, type MessageInteraction, type MessageReference, type Reaction } from "./secure-chat-protocol.ts";
import { applyMessageEvent, findMessage, reactionFallback, validInteraction, validMessageText, validReference } from "./secure-chat-interactions.ts";

export class ChatApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export type ChatTransport = <T>(action?: Record<string, unknown>, token?: string, after?: number) => Promise<T>;
type PendingPublication = { id: string; lease: string; packet: PreparedPacket; join?: string; message?: { body: string; interaction?: MessageInteraction; time: string } };
export type ChatCheckpoint = { version: 1; mls: MlsCheckpoint; token: string; seq: number; manifest: string; messages: ReadableMessage[]; lastRefresh: number; pendingId: string; publication?: PendingPublication };
export interface ChatPersistence { save(value: ChatCheckpoint): Promise<void>; clear(): Promise<void> }
export const httpTransport: ChatTransport = async <T>(action?: Record<string, unknown>, token?: string, after = 0) => {
  const response = await fetch(`/api/secure-chat${action ? "" : `?after=${after}`}`, {
    method: action ? "POST" : "GET", credentials: "omit", cache: "no-store", redirect: "error",
    headers: { ...(action ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: action ? JSON.stringify(action) : undefined, signal: AbortSignal.timeout(8_000),
  }).catch(() => { throw new ChatApiError("The relay is temporarily unreachable.", 503); });
  // Bound the untrusted relay response before parsing or invoking the MLS decoder.
  const reader = response.body?.getReader();
  if (!reader) throw new ChatApiError("Empty relay response.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_500_000) { await reader.cancel(); throw new ChatApiError("Relay response exceeded its limit.", 502); } chunks.push(value); }
  } catch { throw new ChatApiError("The relay response was interrupted or invalid.", 502); }
  finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new ChatApiError("The relay response was interrupted or invalid.", 502); }
  if (!response.ok) throw new ChatApiError(typeof data.error === "string" ? data.error : "Connection failed.", response.status);
  return data as T;
};

export class SecureChatClient {
  #crypto: MlsConversation;
  #token = "";
  #seq = 0;
  #manifest = "";
  #messages: ReadableMessage[] = [];
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  #transport: ChatTransport;
  #lastRefresh = 0;
  #pendingId = "";
  #presence?: RelayPresence[];
  #presenceAt = 0;
  #polling?: Promise<void>;
  #persistence?: ChatPersistence;
  #publication?: PendingPublication;
  #erasing: Promise<void> = Promise.resolve();
  private constructor(crypto: MlsConversation, transport: ChatTransport) { this.#crypto = crypto; this.#transport = transport; }
  static async connect(nickname: string, name: string, invite: ChatInvitation | null, origin: string, transport: ChatTransport = httpTransport) {
    const mls = await MlsConversation.generate(nickname, invite ?? undefined), client = new SecureChatClient(mls, transport);
    try {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const publicKey: TransportPublicKey = { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! };
      const request: LoginRequest = { room: mls.invitation.room, expires: mls.invitation.expires, capability: await capability(mls.invitation), publicKey, create: !invite, ...(!invite ? { manifest: await mls.manifest(name) } : {}) };
      const challenge = await transport<LoginChallenge>({ action: "challenge", ...request });
      if (!/^[0-9a-f]{64}$/.test(challenge.id) || challenge.expires <= Date.now() || challenge.expires > Date.now() + 60_000 || challenge.text !== loginText(challenge.id, origin, challenge.expires, request, digest(request.capability))) throw new Error("The relay returned a mismatched sign-in challenge.");
      const signature = b64(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, utf8(challenge.text))));
      const authenticated = await transport<{ token: string; id: string; expires: number; manifest: string }>({ action: "authenticate", id: challenge.id, signature });
      if (!/^[0-9a-f]{64}$/.test(authenticated.token) || !/^[0-9a-f]{32}$/.test(authenticated.id) || authenticated.expires !== mls.invitation.expires) throw new Error("Invalid relay session.");
      client.#token = authenticated.token; client.#manifest = authenticated.manifest;
      await mls.bindConnection(authenticated.id);
      await mls.readManifest(authenticated.manifest);
      if (invite) { const id = randomId(); client.#pendingId = id; await client.#api({ action: "enqueue", id, sealed: await mls.requestJoin(id) }); }
      else { await mls.create(); client.#lastRefresh = Date.now(); }
      return client;
    } catch (error) { client.close(); throw error; }
  }
  get invitation() { return { ...this.#crypto.invitation }; }
  async persistWith(storage: ChatPersistence) { this.#persistence = storage; await this.#save(); }
  async #save() {
    this.#check();
    if (this.#persistence) await this.#persistence.save({ version: 1, mls: this.#crypto.checkpoint(), token: this.#token, seq: this.#seq, manifest: this.#manifest,
      messages: structuredClone(this.#messages), lastRefresh: this.#lastRefresh, pendingId: this.#pendingId, publication: structuredClone(this.#publication) });
    this.#check();
  }
  static async restore(saved: ChatCheckpoint, storage: ChatPersistence, transport: ChatTransport = httpTransport) {
    let mls: MlsConversation;
    try {
      if (saved.version !== 1 || !/^[0-9a-f]{64}$/.test(saved.token) || !Number.isSafeInteger(saved.seq) || saved.seq < 0 || !Array.isArray(saved.messages) || saved.messages.length > 256 || !!saved.publication !== !!saved.mls.candidate) throw new Error("Invalid saved conversation.");
      mls = await MlsConversation.restore(saved.mls);
    } catch (error) { await storage.clear(); throw error; }
    const client = new SecureChatClient(mls, transport);
    client.#persistence = storage; client.#token = saved.token; client.#seq = saved.seq; client.#manifest = saved.manifest;
    client.#messages = structuredClone(saved.messages); client.#lastRefresh = saved.lastRefresh; client.#pendingId = saved.pendingId; client.#publication = structuredClone(saved.publication);
    try {
      await client.#crypto.readManifest(saved.manifest);
      await client.#serial(async () => { if (client.#publication) await client.#recoverPublication(); await client.#pull(); });
      return client;
    } catch (error) {
      // A temporary outage must not turn a reload into irreversible logout.
      // Keep the verified local identity and outbox visible while offline.
      // The normal polling loop resumes delivery; never show a new-user form.
      if (error instanceof ChatApiError && [409, 429, 502, 503].includes(error.status)) return client;
      else await client.close();
      throw error;
    }
  }
  get closed() { return this.#closed; }
  get view(): ChatView {
    const fresh = Date.now() - this.#presenceAt < PRESENCE_TTL;
    return { ready: this.#crypto.ready, name: this.#crypto.name, expires: this.#crypto.invitation.expires,
      members: this.#crypto.profiles, messages: structuredClone(this.#messages), identity: structuredClone(this.#crypto.identity), epoch: this.#crypto.epoch, verification: this.#crypto.verification,
      deliveryPending: !!this.#publication, ...(this.#publication?.message && this.#publication.message.interaction?.kind !== "reaction" ? { pendingMessage: { id: this.#publication.id, body: this.#publication.message.body } } : {}),
      ...(this.#presence ? { presence: { members: this.#crypto.profiles.map(member => ({ id: member.id, status: !fresh || !member.connection ? "unknown" as const : this.#presence!.some(value => value.id === member.connection!.id && value.online && value.ready) ? "online" as const : this.#presence!.some(value => value.id === member.connection!.id && value.online && !value.ready) ? "connecting" as const : "offline" as const })), joining: fresh ? this.#presence.filter(value => value.online && !value.ready).length : 0, available: fresh ? this.#presence.filter(value => value.online && value.ready).length : 0 } } : {}) };
  }
  #api<T>(action?: Record<string, unknown>) { return this.#transport<T>(action, this.#token, this.#seq); }
  #check() { if (this.#closed || this.invitation.expires <= Date.now()) { this.close(); throw new Error("This conversation has ended. Its keys have been discarded."); } }
  #serial<T>(work: () => Promise<T>) {
    const result = this.#queue.then(async () => {
      this.#check();
      try { if (this.#publication) await this.#recoverPublication(); const result = await work(); await this.#save(); return result; }
      catch (error) {
        // Network congestion can recover. Authentication/state-integrity failures cannot.
        if (!(error instanceof ChatApiError) || ![409, 429, 502, 503].includes(error.status)) this.close();
        else if (!this.#closed) await this.#save();
        throw error;
      }
    });
    this.#queue = result.catch(() => {}); return result;
  }
  async #pull() {
    const snapshot = await this.#api<RelaySnapshot>();
    this.#check();
    if (snapshot.expires !== this.invitation.expires || snapshot.manifest !== this.#manifest || !Number.isSafeInteger(snapshot.seq) || snapshot.seq < this.#seq || !Array.isArray(snapshot.events) || snapshot.events.length > 32 || !Array.isArray(snapshot.pending) || snapshot.pending.length > 8) throw new Error("Relay state failed validation.");
    if (snapshot.presence !== undefined) {
      if (!Array.isArray(snapshot.presence) || snapshot.presence.length > MAX_MEMBERS || snapshot.presence.some(value => !value || !idPattern.test(value.id) || typeof value.online !== "boolean" || typeof value.ready !== "boolean") || new Set(snapshot.presence.map(value => value.id)).size !== snapshot.presence.length) throw new Error("Invalid participant connection state.");
      this.#presence = structuredClone(snapshot.presence); this.#presenceAt = Date.now();
    }
    if (!this.#crypto.ready && snapshot.rejected) {
      const reason = await unseal<{ rejected: boolean }>(this.invitation, `rejection:${this.#pendingId}`, snapshot.rejected);
      if (reason.rejected) throw new Error("This nickname or admission request was rejected. Choose another nickname and open the invitation again.");
    }
    if (!this.#crypto.ready && snapshot.welcome) {
      if (!Number.isSafeInteger(snapshot.welcome.seq) || snapshot.welcome.seq > snapshot.seq || snapshot.welcome.seq <= 0) throw new Error("Invalid welcome sequence.");
      await this.#crypto.acceptWelcome(snapshot.welcome.sealed);
      this.#seq = snapshot.welcome.seq; this.#lastRefresh = 0;
      // Welcome can be removed from the relay only after its new state is durable.
      await this.#save();
      await this.#api({ action: "acknowledge" });
    } else if (this.#crypto.ready && snapshot.welcome) {
      // Reload may occur after the durable Welcome checkpoint but before ACK.
      if (!Number.isSafeInteger(snapshot.welcome.seq) || snapshot.welcome.seq > this.#seq || snapshot.welcome.seq <= 0) throw new Error("Invalid saved welcome sequence.");
      await this.#api({ action: "acknowledge" });
    }
    if (this.#crypto.ready) for (const event of snapshot.events) {
      if (event.seq <= this.#seq) continue; // Welcome starts at its commit, without historical application keys.
      if (event.seq !== this.#seq + 1 || !/^[0-9a-f]{32}$/.test(event.id)) throw new Error("A conversation event is missing. Rejoin with a fresh key.");
      const message = await this.#crypto.receive(event.id, event.wire, event.bootstrap);
      if (message) {
        const author = this.#crypto.profiles.find(profile => profile.id === message.sender)!;
        applyMessageEvent(this.#messages, message, author.nickname, new Date().toISOString());
      }
      this.#seq = event.seq;
    }
    return snapshot;
  }
  async #claim(wait = true) {
    const deadline = Date.now() + 25_000;
    let conflicts = 0;
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        const snapshot = await this.#pull();
        if (this.#seq !== snapshot.seq) continue;
        const lease = await this.#api<{ id: string; expires: number }>({ action: "claim", seq: this.#seq });
        if (!/^[0-9a-f]{64}$/.test(lease.id) || lease.expires <= Date.now() + 1500 || lease.expires > Date.now() + 20_000) throw new ChatApiError("Write window is too short. Retry.", 409);
        return lease;
      } catch (error) {
        if (!(error instanceof ChatApiError) || ![409, 429].includes(error.status)) throw error;
        // Background key refresh/admission yields immediately to another writer.
        // A user's send waits before encryption, including an abandoned 20s lease.
        if (!wait) return null;
        const jitter = crypto.getRandomValues(new Uint32Array(1))[0] % 200;
        const delay = Math.min(200 * 2 ** Math.min(conflicts++, 4), 1500) + jitter;
        if (Date.now() + delay >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, delay)); this.#check();
      }
    }
    throw new ChatApiError("The conversation is busy. Your message was not sent. Try again shortly.", 409);
  }
  async #publish(id: string, lease: string, packet: PreparedPacket, join?: string, message?: PendingPublication["message"]) {
    this.#publication = { id, lease, packet, join, message };
    // Persist the exact ciphertext AND its candidate state before any wire leaves.
    await this.#save();
    try { return await this.#flushPublication(); }
    catch (error) {
      // A durable candidate is an outbox, not a reason to destroy the identity.
      // The next poll must reconcile exactly this packet before any new operation.
      if (this.#persistence && (error instanceof TypeError || error instanceof ChatApiError && [409, 429, 502, 503].includes(error.status))) throw new ChatApiError("Delivery is awaiting confirmation. The saved message will retry automatically.", 503);
      throw new Error(`The write could not be confirmed. Your keys were discarded to prevent unsafe reuse. ${error instanceof ChatApiError ? error.message : "Open the invitation again."}`);
    }
  }
  async #flushPublication() {
    const { id, lease, packet, join, message } = this.#publication!;
    const command = { action: "publish", id, lease, wire: packet.wire, ...(packet.bootstrap ? { bootstrap: packet.bootstrap } : {}), ...(join ? { join, welcome: packet.welcome } : {}) };
    let last: unknown;
    for (let attempt = 0; attempt < (this.#persistence ? 1 : 3); attempt++) {
      this.#check();
      try {
        const response = await this.#api<{ seq: number }>(command);
        if (response.seq !== this.#seq + 1) throw new Error("Write acknowledgement does not match this state.");
        this.#check(); await this.#crypto.confirm(packet.bootstrap); this.#seq = response.seq;
        if (packet.commit) this.#lastRefresh = Date.now();
        if (message) applyMessageEvent(this.#messages, { id, sender: this.#crypto.identity.id, body: message.body, interaction: message.interaction }, this.#crypto.identity.nickname, message.time);
        this.#publication = undefined;
        await this.#save();
        return;
      } catch (error) {
        last = error;
        if (error instanceof ChatApiError && error.status < 500) break;
      }
    }
    // No retry may re-encrypt against a potentially used generation. Identical wire only;
    // an unresolved write destroys this session instead of rolling cryptographic state back.
    throw last instanceof Error ? last : new Error("The write could not be confirmed.");
  }
  async #recoverPublication() {
    const deadline = Date.now() + 25_000;
    for (;;) {
      try { await this.#flushPublication(); return; }
      catch (error) {
        this.#check();
        if (!(error instanceof ChatApiError) || error.status !== 409) throw error;
        const snapshot = await this.#api<RelaySnapshot>();
        if (snapshot.expires !== this.invitation.expires || snapshot.manifest !== this.#manifest || snapshot.seq !== this.#seq) throw new Error("The interrupted write cannot be reconciled safely. Start a new session.");
        if (Date.now() >= deadline) throw new ChatApiError("The conversation is busy. Try returning shortly.", 409);
        try {
          const lease = await this.#api<{ id: string; expires: number }>({ action: "claim", seq: this.#seq });
          if (!/^[0-9a-f]{64}$/.test(lease.id) || lease.expires <= Date.now() || lease.expires > Date.now() + 20_000) throw new Error("Invalid restored write lease.");
          this.#publication!.lease = lease.id; await this.#save();
        } catch (claimError) {
          if (!(claimError instanceof ChatApiError) || ![409, 429].includes(claimError.status)) throw claimError;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }
  poll() {
    // Multiple views share one poll, including while the owning tab is hidden.
    if (this.#polling) return this.#polling;
    const work = this.#serial(async () => {
    const snapshot = await this.#pull();
    if (!this.#crypto.ready) return;
    const pending = snapshot.pending[0];
    if (pending) {
      try { await this.#crypto.inspectJoin(pending.id, pending.sealed); }
      catch {
        await this.#api({ action: "reject-join", id: pending.id, sealed: await seal(this.invitation, `rejection:${pending.id}`, { rejected: true }) });
        return;
      }
      const lease = await this.#claim(false);
      if (!lease) return;
      // If admission changed while claiming, this request is no longer admissible.
      let packet: PreparedPacket;
      try { packet = await this.#crypto.prepareAdd(pending.id, pending.sealed); }
      catch {
        // No packet escaped this operation. A stale/invalid join does not destroy
        // established sessions. The next poll reads the current admission queue.
        await this.#api({ action: "release", lease: lease.id });
        return;
      }
      await this.#publish(randomId(), lease.id, packet, pending.id);
    } else if (Date.now() - this.#lastRefresh > 5 * 60_000) {
      const lease = await this.#claim(false);
      if (!lease) return;
      await this.#publish(randomId(), lease.id, await this.#crypto.prepareRefresh());
    }
    });
    this.#polling = work.finally(() => { this.#polling = undefined; });
    return this.#polling;
  }
  async send(body: string, replyTo?: MessageReference) {
    if (this.#publication) throw new ChatApiError("Delivery is awaiting confirmation. The saved message will retry automatically.", 409);
    // Ordinary draft errors must not destroy a healthy cryptographic session.
    if (!validMessageText(body)) throw new ChatApiError("Invalid message text.", 409);
    if (replyTo !== undefined && !validReference(replyTo)) throw new ChatApiError("Invalid message interaction.", 409);
    return this.#send(body, replyTo ? { kind: "reply", target: { ...replyTo } } : undefined);
  }
  async react(target: MessageReference, emoji: Reaction | null) {
    if (this.#publication) throw new ChatApiError("Delivery is awaiting confirmation. The saved message will retry automatically.", 409);
    const interaction = { kind: "reaction" as const, target, emoji };
    if (!validInteraction(interaction)) throw new ChatApiError("Invalid message interaction.", 409);
    return this.#send(reactionFallback(emoji), structuredClone(interaction));
  }
  #send(body: string, interaction?: MessageInteraction) { return this.#serial(async () => {
    if (!this.#crypto.ready) throw new ChatApiError("Keep this tab open while an online participant connects you.", 409);
    if (interaction && !findMessage(this.#messages, interaction.target)) throw new ChatApiError("The original message is no longer available in this tab.", 409);
    const lease = await this.#claim(), id = randomId();
    if (!lease) throw new ChatApiError("The conversation is busy. Your message was not sent. Try again shortly.", 409);
    // Catch eviction while catching up before any MLS generation is consumed.
    if (interaction && !findMessage(this.#messages, interaction.target)) {
      await this.#api({ action: "release", lease: lease.id });
      throw new ChatApiError("The original message is no longer available in this tab.", 409);
    }
    const packet = await this.#crypto.prepareText(id, body, interaction);
    await this.#publish(id, lease.id, packet, undefined, { body, interaction, time: new Date().toISOString() });
  }); }
  close() {
    if (this.#closed) return this.#erasing;
    const storage = this.#persistence; this.#persistence = undefined;
    if (storage) this.#erasing = storage.clear().catch(() => {});
    this.#dispose(true);
    return this.#erasing;
  }
  suspend() { if (!this.#closed) this.#dispose(false); }
  #dispose(logout: boolean) {
    this.#closed = true;
    this.#presence = undefined; this.#presenceAt = 0;
    const token = this.#token; this.#token = ""; this.#pendingId = ""; this.#manifest = ""; this.#messages = [];
    this.#crypto.close();
    this.#publication = undefined; this.#persistence = undefined;
    if (logout && token) void this.#transport({ action: "logout" }, token).catch(() => {});
  }
}
