import { b64, capability, digest, MlsConversation, randomId, seal, unseal, utf8, type PreparedPacket } from "./secure-chat-mls.ts";
import { loginText, type ChatInvitation, type ChatView, type LoginChallenge, type LoginRequest, type ReadableMessage, type RelaySnapshot, type TransportPublicKey, type MessageInteraction, type MessageReference, type Reaction } from "./secure-chat-protocol.ts";
import { applyMessageEvent, findMessage, reactionFallback, validInteraction, validMessageText, validReference } from "./secure-chat-interactions.ts";

export class ChatApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export type ChatTransport = <T>(action?: Record<string, unknown>, token?: string, after?: number) => Promise<T>;
export const httpTransport: ChatTransport = async <T>(action?: Record<string, unknown>, token?: string, after = 0) => {
  const response = await fetch(`/api/secure-chat${action ? "" : `?after=${after}`}`, {
    method: action ? "POST" : "GET", credentials: "omit", cache: "no-store", redirect: "error",
    headers: { ...(action ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: action ? JSON.stringify(action) : undefined, signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new ChatApiError("The relay is temporarily unreachable.", 503); });
  // Bound the untrusted relay response before parsing or invoking the MLS decoder.
  const reader = response.body?.getReader();
  if (!reader) throw new ChatApiError("Empty relay response.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_500_000) { await reader.cancel(); throw new ChatApiError("Relay response exceeded its limit.", 502); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(buffer));
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
      await mls.readManifest(authenticated.manifest);
      if (invite) { const id = randomId(); client.#pendingId = id; await client.#api({ action: "enqueue", id, sealed: await mls.requestJoin(id) }); }
      else { await mls.create(); client.#lastRefresh = Date.now(); }
      return client;
    } catch (error) { client.close(); throw error; }
  }
  get invitation() { return { ...this.#crypto.invitation }; }
  get closed() { return this.#closed; }
  get view(): ChatView {
    return { ready: this.#crypto.ready, name: this.#crypto.name, expires: this.#crypto.invitation.expires,
      members: this.#crypto.profiles, messages: structuredClone(this.#messages), identity: { ...this.#crypto.identity }, epoch: this.#crypto.epoch, verification: this.#crypto.verification };
  }
  #api<T>(action?: Record<string, unknown>) { return this.#transport<T>(action, this.#token, this.#seq); }
  #check() { if (this.#closed || this.invitation.expires <= Date.now()) { this.close(); throw new Error("This conversation has ended. Its keys have been discarded."); } }
  #serial<T>(work: () => Promise<T>) {
    const result = this.#queue.then(async () => {
      this.#check();
      try { return await work(); }
      catch (error) {
        // Network congestion can recover. Authentication/state-integrity failures cannot.
        if (!(error instanceof ChatApiError) || ![409, 429, 502, 503].includes(error.status)) this.close();
        throw error;
      }
    });
    this.#queue = result.catch(() => {}); return result;
  }
  async #pull() {
    const snapshot = await this.#api<RelaySnapshot>();
    this.#check();
    if (snapshot.expires !== this.invitation.expires || snapshot.manifest !== this.#manifest || !Number.isSafeInteger(snapshot.seq) || snapshot.seq < this.#seq || !Array.isArray(snapshot.events) || snapshot.events.length > 32 || !Array.isArray(snapshot.pending) || snapshot.pending.length > 8) throw new Error("Relay state failed validation.");
    if (!this.#crypto.ready && snapshot.rejected) {
      const reason = await unseal<{ rejected: boolean }>(this.invitation, `rejection:${this.#pendingId}`, snapshot.rejected);
      if (reason.rejected) throw new Error("This nickname or admission request was rejected. Choose another nickname and open the invitation again.");
    }
    if (!this.#crypto.ready && snapshot.welcome) {
      if (!Number.isSafeInteger(snapshot.welcome.seq) || snapshot.welcome.seq > snapshot.seq || snapshot.welcome.seq <= 0) throw new Error("Invalid welcome sequence.");
      await this.#crypto.acceptWelcome(snapshot.welcome.sealed);
      this.#seq = snapshot.welcome.seq; this.#lastRefresh = 0;
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
  async #claim() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.#pull();
      if (this.#seq !== snapshot.seq) continue;
      try {
        const lease = await this.#api<{ id: string; expires: number }>({ action: "claim", seq: this.#seq });
        if (!/^[0-9a-f]{64}$/.test(lease.id) || lease.expires <= Date.now() + 1500 || lease.expires > Date.now() + 20_000) throw new ChatApiError("Write window is too short. Retry.", 409);
        return lease;
      } catch (error) { if (!(error instanceof ChatApiError) || error.status !== 409) throw error; }
    }
    throw new ChatApiError("Another participant is updating the conversation. Retry in a moment.", 409);
  }
  async #publish(id: string, lease: string, packet: PreparedPacket, join?: string) {
    const command = { action: "publish", id, lease, wire: packet.wire, ...(packet.bootstrap ? { bootstrap: packet.bootstrap } : {}), ...(join ? { join, welcome: packet.welcome } : {}) };
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.#api<{ seq: number }>(command);
        if (response.seq !== this.#seq + 1) throw new Error("Write acknowledgement does not match this state.");
        this.#check(); await this.#crypto.confirm(packet.bootstrap); this.#seq = response.seq;
        if (packet.commit) this.#lastRefresh = Date.now();
        return;
      } catch (error) {
        last = error;
        if (error instanceof ChatApiError && error.status < 500) break;
      }
    }
    // No retry may re-encrypt against a potentially used generation. Identical wire only;
    // an unresolved write destroys this session instead of rolling cryptographic state back.
    this.close();
    throw new Error(`The write could not be confirmed. Your keys were discarded to prevent unsafe reuse. ${last instanceof ChatApiError ? last.message : "Open the invitation again."}`);
  }
  poll() { return this.#serial(async () => {
    const snapshot = await this.#pull();
    if (!this.#crypto.ready) return;
    const pending = snapshot.pending[0];
    if (pending) {
      try { await this.#crypto.inspectJoin(pending.id, pending.sealed); }
      catch {
        await this.#api({ action: "reject-join", id: pending.id, sealed: await seal(this.invitation, `rejection:${pending.id}`, { rejected: true }) });
        return;
      }
      const lease = await this.#claim();
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
      const lease = await this.#claim();
      try { await this.#publish(randomId(), lease.id, await this.#crypto.prepareRefresh()); }
      catch (error) { this.close(); throw error; }
    }
  }); }
  async send(body: string, replyTo?: MessageReference) {
    // Ordinary draft errors must not destroy a healthy cryptographic session.
    if (!validMessageText(body)) throw new ChatApiError("Invalid message text.", 409);
    if (replyTo !== undefined && !validReference(replyTo)) throw new ChatApiError("Invalid message interaction.", 409);
    return this.#send(body, replyTo ? { kind: "reply", target: { ...replyTo } } : undefined);
  }
  async react(target: MessageReference, emoji: Reaction | null) {
    const interaction = { kind: "reaction" as const, target, emoji };
    if (!validInteraction(interaction)) throw new ChatApiError("Invalid message interaction.", 409);
    return this.#send(reactionFallback(emoji), structuredClone(interaction));
  }
  #send(body: string, interaction?: MessageInteraction) { return this.#serial(async () => {
    if (!this.#crypto.ready) throw new ChatApiError("Keep this tab open while an online participant connects you.", 409);
    if (interaction && !findMessage(this.#messages, interaction.target)) throw new ChatApiError("The original message is no longer available in this tab.", 409);
    const lease = await this.#claim(), id = randomId();
    // Catch eviction while catching up before any MLS generation is consumed.
    if (interaction && !findMessage(this.#messages, interaction.target)) {
      await this.#api({ action: "release", lease: lease.id });
      throw new ChatApiError("The original message is no longer available in this tab.", 409);
    }
    try {
      const packet = await this.#crypto.prepareText(id, body, interaction);
      await this.#publish(id, lease.id, packet);
      applyMessageEvent(this.#messages, { id, sender: this.#crypto.identity.id, body, interaction }, this.#crypto.identity.nickname, new Date().toISOString());
    } catch (error) { this.close(); throw error; }
  }); }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    const token = this.#token; this.#token = ""; this.#pendingId = ""; this.#manifest = ""; this.#messages = [];
    this.#crypto.close();
    if (token) void this.#transport({ action: "logout" }, token).catch(() => {});
  }
}
