import { createHash, randomBytes, timingSafeEqual, webcrypto } from "node:crypto";
import { CHAT_TTL, MAX_MEMBERS, PRESENCE_TTL, hexPattern, idPattern, loginText, type LoginRequest, type RelayEvent, type RelaySnapshot } from "./secure-chat-protocol.ts";
import { ChatError } from "./secure-chat-guard.ts";
export { ChatError } from "./secure-chat-guard.ts";
const random = () => randomBytes(32).toString("hex");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function blob(value: unknown, max = 64_000): asserts value is string {
  if (typeof value !== "string" || value.length < 16 || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ChatError("Invalid encrypted packet.");
}
function identifier(value: unknown): asserts value is string { if (typeof value !== "string" || !idPattern.test(value)) throw new ChatError("Invalid identifier."); }
type Session = { id: string; room: string; ready: boolean; expires: number; lastSeen: number; admissionExpires?: number; rejected?: string; sent: number[]; reads: number[]; joined?: string; welcome?: { sealed: string; seq: number } };
type Room = { expires: number; capHash: string; manifest: string; seq: number; events: RelayEvent[]; bytes: number; members: Set<string>; pending: Map<string, { sealed: string; session: string; expires: number }>; lease?: { id: string; holder: string; expires: number; seq: number } };
type Challenge = { text: string; request: Omit<LoginRequest, "capability">; capHash: string; key: string; expires: number; origin: string };

// No persistence adapter. Only ciphertext and short-lived routing state.
export class SecureChatStore {
  rooms = new Map<string, Room>();
  sessions = new Map<string, Session>();
  challenges = new Map<string, Challenge>();
  keyBindings = new Map<string, { room: string; expires: number }>();
  private attempts: number[] = [];
  private verifying = 0;
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  clean() {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      if (room.expires <= now) { this.rooms.delete(id); continue; }
      if (room.lease && room.lease.expires <= now) room.lease = undefined;
      for (const [key, join] of room.pending) if (join.expires <= now) { room.pending.delete(key); this.sessions.delete(join.session); room.members.delete(join.session); }
    }
    for (const [key, session] of this.sessions) {
      if (!session.ready && (session.admissionExpires ?? 0) <= now) {
        const room = this.rooms.get(session.room); room?.members.delete(key);
        if (session.joined) room?.pending.delete(session.joined);
        this.sessions.delete(key);
      } else if (session.expires <= now || !this.rooms.has(session.room)) this.sessions.delete(key);
    }
    for (const [key, challenge] of this.challenges) if (challenge.expires <= now) this.challenges.delete(key);
    for (const [key, binding] of this.keyBindings) if (binding.expires <= now) this.keyBindings.delete(key);
    this.attempts = this.attempts.filter(time => time > now - 60_000);
  }
  private throttle(times: number[], max: number, window = 10_000) {
    const cutoff = this.now() - window;
    while (times.length && times[0] <= cutoff) times.shift();
    if (times.length >= max) throw new ChatError("Too many requests. Retry shortly.", 429);
    times.push(this.now());
  }
  private canAdmit(room: Room) {
    // An unacknowledged Welcome can still establish a surviving participant.
    return [...room.members].some(key => this.sessions.get(key)?.ready);
  }
  private reclaimClosedRooms() {
    if (this.rooms.size < 16) return;
    // Logout revokes the token. With no surviving admitted session, nobody can
    // recover or admit a guest: retaining its ciphertext must not block new chats.
    // lastSeen is deliberately irrelevant; a sleeping browser can still return.
    for (const [id, room] of this.rooms) if (!this.canAdmit(room)) this.rooms.delete(id);
    this.clean();
    for (const [id, challenge] of this.challenges) if (!challenge.request.create && !this.rooms.has(challenge.request.room)) this.challenges.delete(id);
    // Keep revoked key bindings until their original deadline to prevent reuse.
  }
  challenge(input: LoginRequest, origin: string) {
    this.clean(); this.throttle(this.attempts, 120, 60_000);
    if (this.challenges.size >= 64 || this.sessions.size >= 256 || this.keyBindings.size >= 512) throw new ChatError("The relay is at capacity.", 429);
    identifier(input.room);
    if (!Number.isSafeInteger(input.expires) || input.expires <= this.now() || input.expires > this.now() + CHAT_TTL || typeof input.create !== "boolean" || typeof input.capability !== "string" || !hexPattern.test(input.capability)) throw new ChatError("Invalid or expired invitation.", 403);
    const pub = input.publicKey;
    if (!pub || Object.keys(pub).sort().join(",") !== "crv,kty,x,y" || pub.kty !== "EC" || pub.crv !== "P-256" || !/^[A-Za-z0-9_-]{43}$/.test(pub.x) || !/^[A-Za-z0-9_-]{43}$/.test(pub.y)) throw new ChatError("Public transport key required.");
    const key = hash(`${pub.x}.${pub.y}`), capHash = hash(input.capability);
    if (this.keyBindings.has(key)) throw new ChatError("This key already belongs to a conversation.", 409);
    if (input.create) {
      blob(input.manifest, 4096);
      if (this.rooms.has(input.room)) throw new ChatError("Conversation already exists.", 409);
      this.reclaimClosedRooms();
      if (this.rooms.size >= 16) throw new ChatError("The relay is at capacity.", 429);
    } else {
      const room = this.rooms.get(input.room);
      if (!room || room.expires !== input.expires || !equal(room.capHash, capHash)) throw new ChatError("Invitation is unavailable or expired.", 403);
      if (!this.canAdmit(room)) throw new ChatError("No participant can open this conversation anymore. Create a new conversation and share its new link.", 410);
      if (![...room.members].some(key => { const member = this.sessions.get(key); return member?.ready && member.lastSeen > this.now() - PRESENCE_TTL; })) throw new ChatError("No participant is online. Ask your friend to open the original chat tab, then retry.", 409);
      if (room.members.size >= MAX_MEMBERS || room.pending.size >= 8) throw new ChatError("Conversation is at capacity.", 429);
    }
    const request = { room: input.room, expires: input.expires, create: input.create, publicKey: { ...pub }, ...(input.create ? { manifest: input.manifest } : {}) };
    const id = random(), expires = Math.min(this.now() + 60_000, input.expires);
    const text = loginText(id, origin, expires, { ...request, capability: "" }, capHash);
    this.challenges.set(id, { text, request, capHash, key, expires, origin });
    return { id, expires, text };
  }
  async authenticate(id: string, signature: string, origin: string) {
    this.clean();
    const challenge = this.challenges.get(id);
    this.challenges.delete(id); // Consume before async verification, including failed attempts.
    if (!challenge || challenge.origin !== origin || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw new ChatError("Sign-in challenge expired or invalid.", 403);
    if (this.verifying >= 4) throw new ChatError("Verification is busy.", 429);
    this.verifying++;
    try {
      const key = await webcrypto.subtle.importKey("jwk", challenge.request.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      if (!await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(signature, "base64url"), Buffer.from(challenge.text))) throw new ChatError("Signature rejected.", 403);
      this.clean();
      if (challenge.expires <= this.now()) throw new ChatError("Sign-in challenge expired.", 403);
      const { request, capHash } = challenge;
      if (this.keyBindings.has(challenge.key)) throw new ChatError("This key already belongs to a conversation.", 409);
      // Verification yields: recheck global limits before allocating a room.
      if (this.sessions.size >= 256 || this.keyBindings.size >= 512) throw new ChatError("The relay is at capacity.", 429);
      let room = this.rooms.get(request.room);
      if (request.create) {
        if (room) throw new ChatError("Conversation already exists.", 409);
        this.reclaimClosedRooms();
        if (this.rooms.size >= 16) throw new ChatError("The relay is at capacity.", 429);
        room = { expires: request.expires, capHash, manifest: request.manifest!, seq: 0, events: [], bytes: 0, members: new Set(), pending: new Map() };
        this.rooms.set(request.room, room);
      } else if (!room || room.expires !== request.expires || !equal(room.capHash, capHash)) throw new ChatError("Conversation expired.", 403);
      if (!request.create && !this.canAdmit(room)) throw new ChatError("No participant can open this conversation anymore. Create a new conversation and share its new link.", 410);
      if (room.members.size >= MAX_MEMBERS) throw new ChatError("Conversation is at capacity.", 429);
      const token = random(), tokenHash = hash(token), sessionId = randomBytes(16).toString("hex");
      this.sessions.set(tokenHash, { id: sessionId, room: request.room, ready: request.create, expires: request.expires, lastSeen: this.now(), ...(!request.create ? { admissionExpires: Math.min(this.now() + 120_000, request.expires) } : {}), sent: [], reads: [] });
      room.members.add(tokenHash); this.keyBindings.set(challenge.key, { room: request.room, expires: request.expires });
      return { token, id: sessionId, expires: request.expires, manifest: room.manifest };
    } finally { this.verifying--; }
  }
  session(token: string) {
    this.clean();
    const session = this.sessions.get(hash(token));
    if (!session) throw new ChatError("Conversation session expired. Open a fresh invitation.", 401);
    return session;
  }
  snapshot(token: string, after: number): RelaySnapshot {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    this.throttle(session.reads, 60);
    if (!Number.isSafeInteger(after) || after < 0 || after > room.seq) throw new ChatError("Invalid conversation cursor.", 409);
    if (session.ready && !session.welcome && after < (room.events[0]?.seq ?? 1) - 1) throw new ChatError("This tab missed too much state. Rejoin with a fresh key.", 410);
    if (!session.ready && !this.canAdmit(room)) throw new ChatError("No participant can open this conversation anymore. Create a new conversation and share its new link.", 410);
    session.lastSeen = this.now();
    return { expires: room.expires, manifest: room.manifest, seq: room.seq, ready: session.ready,
      presence: [...room.members].flatMap(key => { const member = this.sessions.get(key); return member ? [{ id: member.id, online: member.lastSeen > this.now() - PRESENCE_TTL, ready: member.ready && !member.welcome }] : []; }),
      events: session.ready ? room.events.filter(event => event.seq > after).slice(0, 32) : [],
      pending: session.ready ? [...room.pending].map(([id, value]) => ({ id, sealed: value.sealed })) : [],
      ...(session.welcome ? { welcome: session.welcome } : {}), ...(session.rejected ? { rejected: session.rejected } : {}) };
  }
  enqueue(token: string, id: string, sealed: string) {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    identifier(id); blob(sealed, 16_000);
    if (session.ready || session.joined) throw new ChatError("Join request already submitted.", 409);
    if (room.pending.size >= 8 || room.pending.has(id)) throw new ChatError("Join queue is full.", 429);
    room.pending.set(id, { sealed, session: hash(token), expires: Math.min(this.now() + 120_000, room.expires) });
    session.joined = id;
    return { ok: true };
  }
  claim(token: string, seq: number) {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    this.throttle(session.sent, 20);
    if (!session.ready) throw new ChatError("Wait for an online participant to connect you.", 403);
    if (room.seq !== seq || room.lease) throw new ChatError("Conversation is updating. Retry.", 409);
    const lease = { id: random(), holder: hash(token), expires: Math.min(this.now() + 20_000, room.expires), seq };
    room.lease = lease;
    return { id: lease.id, expires: lease.expires };
  }
  publish(token: string, input: { lease: string; id: string; wire: string; bootstrap?: string; join?: string; welcome?: string }) {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    identifier(input.id); blob(input.wire);
    if (input.bootstrap !== undefined) blob(input.bootstrap, 16_000);
    if (input.welcome !== undefined) blob(input.welcome, 48_000);
    const duplicate = room.events.find(event => event.id === input.id);
    if (duplicate) {
      if (duplicate.sender !== session.id || duplicate.wire !== input.wire || duplicate.bootstrap !== input.bootstrap) throw new ChatError("Message identifier conflict.", 409);
      return { seq: duplicate.seq }; // Identical ciphertext retry after a lost acknowledgement.
    }
    if (!session.ready || !room.lease || room.lease.id !== input.lease || room.lease.holder !== hash(token) || room.lease.seq !== room.seq) throw new ChatError("Write lease expired. Rejoin with a fresh key.", 409);
    const join = input.join === undefined ? undefined : room.pending.get(input.join);
    if ((input.join !== undefined) !== (input.welcome !== undefined) || (input.join !== undefined && !join)) throw new ChatError("Join request expired.", 409);
    const size = input.wire.length + (input.bootstrap?.length ?? 0);
    let removedBytes = 0, removedCount = 0;
    // Reserve a bounded per-room share. Count eviction before admitting a write,
    // so a full global window can still replace its oldest ciphertext.
    while (room.events.length + 1 - removedCount > 256 || room.bytes + size - removedBytes > 1_000_000) {
      const old = room.events[removedCount++];
      if (!old) throw new ChatError("Packet exceeds the conversation budget.", 413);
      removedBytes += old.wire.length + (old.bootstrap?.length ?? 0);
    }
    const total = [...this.rooms.values()].reduce((sum, value) => sum + value.bytes, 0);
    if (total + size - removedBytes > 16_000_000) throw new ChatError("The relay is at capacity.", 429);
    const seq = ++room.seq;
    room.events.push({ seq, id: input.id, sender: session.id, wire: input.wire, ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}), time: this.now() });
    room.events.splice(0, removedCount); room.bytes += size - removedBytes;
    if (join) {
      const target = this.sessions.get(join.session)!;
      target.ready = true; target.admissionExpires = undefined; target.welcome = { sealed: input.welcome!, seq };
      room.pending.delete(input.join!);
    }
    room.lease = undefined;
    return { seq };
  }
  release(token: string, lease: string) {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    if (room.lease?.id === lease && room.lease.holder === hash(token)) room.lease = undefined;
    return { ok: true };
  }
  rejectJoin(token: string, id: string, sealed: string) {
    const session = this.session(token), room = this.rooms.get(session.room)!;
    identifier(id); blob(sealed, 4096);
    if (!session.ready) throw new ChatError("An admitted participant is required.", 403);
    const pending = room.pending.get(id);
    if (pending) {
      const guest = this.sessions.get(pending.session);
      if (guest && !guest.ready) guest.rejected = sealed;
      room.pending.delete(id); room.members.delete(pending.session);
    }
    return { ok: true };
  }
  acknowledge(token: string) { this.session(token).welcome = undefined; return { ok: true }; }
  logout(token: string) {
    const tokenHash = hash(token), session = this.sessions.get(tokenHash);
    if (session) {
      const room = this.rooms.get(session.room);
      if (session.joined) room?.pending.delete(session.joined);
      if (!session.ready) room?.members.delete(tokenHash);
      if (room?.lease?.holder === tokenHash) room.lease = undefined;
      this.sessions.delete(tokenHash);
    }
    return { ok: true };
  }
}
export const secureChatStore = new SecureChatStore();
