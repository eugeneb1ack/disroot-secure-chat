import assert from "node:assert/strict";
import test from "node:test";
import { SecureChatStore } from "./secure-chat-store.ts";
import { createChatHandlers } from "./secure-chat-handler.ts";
import { ChatApiError, SecureChatClient, httpTransport } from "./secure-chat-client.ts";
import { MlsConversation, SUITE, b64, capability, digest, hex, unhex, randomId, seal, unseal, unb64, utf8, wipe } from "./secure-chat-mls.ts";
import { currentEpochState, authenticatedApplication } from "./secure-chat-mls-adapter.ts";
import { createApplicationMessage, createCommit, createGroup, decodeMlsMessage, defaultCapabilities, defaultKeyPackageEqualityConfig, defaultLifetimeConfig, emptyPskIndex, encodeMlsMessage, generateKeyPackageWithKey, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup } from "ts-mls";
import { invitationLink, parseInvitation } from "./secure-chat-invite.ts";
import { CHAT_TTL, canonical } from "./secure-chat-protocol.ts";
import { guardChatRequest } from "./secure-chat-guard.ts";
const origin = "http://127.0.0.1:3000";
function harness(options = {}) {
  let offset = 0;
  const store = new SecureChatStore(() => Date.now() + offset), handlers = createChatHandlers(store), requests = [];
  const transport = async (action, token, after = 0) => {
    requests.push(structuredClone(action ?? { after }));
    const request = new Request(`${origin}/api/secure-chat?after=${after}`, { method: action ? "POST" : "GET", headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: action ? JSON.stringify(action) : undefined });
    if (options.before) await options.before(action, store);
    const response = await handlers[action ? "POST" : "GET"](request), data = await response.json();
    if (!response.ok) throw new ChatApiError(data.error, response.status);
    return options.after ? options.after(action, data, store) : data;
  };
  return { store, transport, requests, tick: ms => { offset += ms; store.clean(); } };
}
async function pair(t, options) {
  const lab = harness(options), a = await SecureChatClient.connect("Alice", "Friends", null, origin, lab.transport);
  const b = await SecureChatClient.connect("Bob", "ignored", a.invitation, origin, lab.transport);
  t.after(() => { a.close(); b.close(); });
  await a.poll(); await b.poll(); await a.poll();
  return { ...lab, a, b };
}
async function cryptoPair(t) {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation);
  t.after(() => { a.close(); b.close(); });
  await a.create(); const id = randomId(), request = await b.requestJoin(id), packet = await a.prepareAdd(id, request);
  await a.confirm(packet.bootstrap); await b.acceptWelcome(packet.welcome);
  return { a, b, welcome: packet.welcome };
}
async function loginInput(invite, create = false) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, input: { room: invite.room, expires: invite.expires, capability: await capability(invite), create, publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, ...(create ? { manifest: "A".repeat(64) } : {}) } };
}
const signature = async (pair, text) => b64(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, utf8(text))));

test("production clients: creator remains in the same chat after a guest joins", async t => {
  const { a, b } = await pair(t);
  assert.equal(a.view.ready, true); assert.equal(b.view.ready, true);
  assert.equal(a.invitation.room, b.invitation.room); assert.equal(a.view.name, "Friends");
  assert.deepEqual(a.view.members, b.view.members); assert.equal(a.view.verification, b.view.verification);
});
test("production clients: bidirectional Unicode and emoji survive relay serialization", async t => {
  const { a, b } = await pair(t);
  await a.send("Привет / こんにちは / 👩🏽‍💻 🌙"); await b.poll();
  await b.send("Hello, Alice 🙂"); await a.poll();
  assert.deepEqual(a.view.messages.map(m => m.body), b.view.messages.map(m => m.body));
  assert.equal(a.view.messages.length, 2);
});
test("a third client joins through a non-founder and cannot read earlier messages", async t => {
  const { a, b, transport } = await pair(t);
  await a.send("before Charlie"); await b.poll();
  const c = await SecureChatClient.connect("Charlie", "", b.invitation, origin, transport); t.after(() => c.close());
  await b.poll(); await a.poll(); await c.poll(); await a.poll(); await b.poll();
  assert.deepEqual(c.view.messages, []);
  await c.send("all three"); await a.poll(); await b.poll();
  assert.equal(a.view.messages.at(-1).body, "all three"); assert.equal(b.view.messages.at(-1).body, "all three");
});
test("lost publish acknowledgement retries identical wire and appends once", async t => {
  let lose = false;
  const { a, b, requests } = await pair(t, { after(action, data) { if (action?.action === "publish" && lose) { lose = false; throw new TypeError("lost acknowledgement"); } return data; } });
  lose = true; await a.send("one delivery"); await b.poll();
  assert.equal(b.view.messages.length, 1);
  const publishes = requests.filter(value => value.action === "publish");
  assert.deepEqual(publishes.at(-1), publishes.at(-2));
});
test("uncertain writes discard the session instead of reusing MLS generations", async t => {
  let fail = false;
  const { a, requests } = await pair(t, { after(action, data) { if (action?.action === "publish" && fail) throw new TypeError("offline"); return data; } });
  fail = true; await assert.rejects(() => a.send("ambiguous"), /could not be confirmed/);
  assert.equal(a.closed, true); assert.equal(a.view.ready, false); assert.equal(a.invitation.secret, "");
  const writes = requests.filter(value => value.action === "publish").slice(-3);
  assert.equal(new Set(writes.map(value => value.wire)).size, 1);
  await assert.rejects(() => a.send("different plaintext"));
});
test("expired write lease fails closed after encryption", async t => {
  let expire = false;
  const { a, tick } = await pair(t, { before(action, store) { if (expire && action?.action === "publish") for (const room of store.rooms.values()) room.lease = undefined; } });
  void tick; expire = true; await assert.rejects(() => a.send("late packet"), /could not be confirmed/); assert.equal(a.closed, true);
});
test("simultaneous sends serialize without duplicate delivery", async t => {
  const { a, b } = await pair(t);
  const results = await Promise.allSettled([a.send("from Alice"), b.send("from Bob")]);
  for (let i = 0; i < results.length; i++) if (results[i].status === "rejected") await [a, b][i].send(["from Alice", "from Bob"][i]);
  await a.poll(); await b.poll();
  assert.equal(a.closed, false); assert.equal(b.closed, false); assert.equal(a.view.messages.length, 2); assert.equal(b.view.messages.length, 2);
});
test("nickname and cleartext never enter the production relay state or request bodies", async t => {
  const { a, b, store, requests } = await pair(t);
  await a.send("confidential sentence 79026"); await b.poll();
  const dump = JSON.stringify({ rooms: [...store.rooms], sessions: [...store.sessions], challenges: [...store.challenges], requests });
  for (const value of ["Alice", "Bob", "Friends", "confidential sentence 79026", a.invitation.secret, a.view.identity.key]) assert.equal(dump.includes(value.length < 16 ? JSON.stringify(value) : value), false, value);
});
test("the invitation secret is domain-separated from the transport capability", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const cap = await capability(mls.invitation); assert.notEqual(cap, mls.invitation.secret);
  const sealed = await seal(mls.invitation, "test", { secret: "payload" });
  await assert.rejects(() => unseal({ ...mls.invitation, secret: cap }, "test", sealed));
});
test("invitation parser rejects duplicates, downgrade, expired and oversized links", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const link = invitationLink(origin, mls.invitation), hash = new URL(link).hash;
  assert.deepEqual(parseInvitation(hash), mls.invitation);
  assert.equal(new URL(link).search, "");
  for (const invalid of [hash + "&v=2", hash.replace("v=2", "v=1"), hash + "x".repeat(400), hash.replace("room=", "room=zz")]) assert.equal(parseInvitation(invalid), null);
  assert.equal(parseInvitation(hash, mls.invitation.expires), null);
});
test("bootstrap AEAD binds packet purpose and room deadline", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const wire = await seal(mls.invitation, "manifest", { value: 1 });
  await assert.rejects(() => unseal(mls.invitation, "roster", wire));
  await assert.rejects(() => unseal({ ...mls.invitation, expires: mls.invitation.expires + 1 }, "manifest", wire));
});
test("tampered manifest and wrong founder anchor are rejected", async t => {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation); t.after(() => { a.close(); b.close(); });
  const manifest = await a.manifest("Friends");
  const value = await unseal(a.invitation, "manifest", manifest); value.name = "Impostor";
  await assert.rejects(async () => b.readManifest(await seal(a.invitation, "manifest", value)));
  b.invitation.founder = "0".repeat(64);
  await assert.rejects(() => b.readManifest(manifest));
});
test("one-use login challenge rejects replays and concurrent authentication", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const store = new SecureChatStore(), { pair: keys, input } = await loginInput(mls.invitation, true);
  const challenge = store.challenge(input, origin), sig = await signature(keys, challenge.text);
  const outcomes = await Promise.allSettled([store.authenticate(challenge.id, sig, origin), store.authenticate(challenge.id, sig, origin)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(() => store.authenticate(challenge.id, sig, origin));
});
test("invalid signature consumes a challenge and cannot be retried with the correct key", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const store = new SecureChatStore(), { pair: keys, input } = await loginInput(mls.invitation, true);
  const challenge = store.challenge(input, origin);
  await assert.rejects(() => store.authenticate(challenge.id, "A".repeat(86), origin));
  const valid = await signature(keys, challenge.text);
  await assert.rejects(() => store.authenticate(challenge.id, valid, origin));
  assert.equal(store.rooms.size, 0);
});
test("login challenge binds the browser origin", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const store = new SecureChatStore(), { pair: keys, input } = await loginInput(mls.invitation, true);
  const challenge = store.challenge(input, origin);
  const valid = await signature(keys, challenge.text);
  await assert.rejects(() => store.authenticate(challenge.id, valid, "https://evil.example"));
});
test("private transport JWK fields are rejected before importing a key", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const { input } = await loginInput(mls.invitation, true); input.publicKey.d = "private";
  assert.throws(() => new SecureChatStore().challenge(input, origin), /Public transport key required/);
});
test("a transport key cannot create a second conversation", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const store = new SecureChatStore(), { pair: keys, input } = await loginInput(mls.invitation, true);
  const challenge = store.challenge(input, origin); await store.authenticate(challenge.id, await signature(keys, challenge.text), origin);
  assert.throws(() => store.challenge({ ...input, room: randomId() }, origin), /already belongs/);
});
test("concurrent authentication at the binding limit leaves no orphan conversations", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  let offset = 0;
  const store = new SecureChatStore(() => Date.now() + offset);
  const signIn = async create => {
    const { pair: keys, input } = await loginInput(mls.invitation, create);
    const challenge = store.challenge(input, origin);
    return store.authenticate(challenge.id, await signature(keys, challenge.text), origin);
  };
  const founder = await signIn(true);
  // Exercise the public sign-in/logout path: abandoned keys stay bound until
  // the common deadline, while unadmitted member slots are released.
  for (let i = 0; i < 510; i++) {
    if (i % 100 === 0) { offset += 61_000; store.snapshot(founder.token, 0); }
    store.logout((await signIn(false)).token);
  }
  assert.equal(store.keyBindings.size, 511); assert.equal(store.rooms.size, 1);
  const pending = await Promise.all(Array.from({ length: 3 }, async () => {
    const { pair: keys, input } = await loginInput({ ...mls.invitation, room: randomId() }, true);
    const challenge = store.challenge(input, origin);
    return { id: challenge.id, signature: await signature(keys, challenge.text) };
  }));
  const outcomes = await Promise.allSettled(pending.map(value => store.authenticate(value.id, value.signature, origin)));
  assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(store.keyBindings.size, 512); assert.equal(store.sessions.size, 2);
  assert.equal(store.rooms.size, 2);
  assert.ok([...store.rooms.values()].every(room => room.members.size > 0));
});
test("wrong invitation capability and extended deadline cannot join", async t => {
  const { a, store } = await pair(t), { input } = await loginInput(a.invitation);
  assert.throws(() => store.challenge({ ...input, capability: "0".repeat(64) }, origin));
  assert.throws(() => store.challenge({ ...input, expires: input.expires + 1000 }, origin));
});
test("24-hour cleanup removes room, messages, sessions, pending joins and bindings", async t => {
  const { a, b, store, tick } = await pair(t); await a.send("expires"); await b.poll();
  tick(CHAT_TTL + 1);
  for (const map of [store.rooms, store.sessions, store.challenges, store.keyBindings]) assert.equal(map.size, 0);
  await assert.rejects(() => a.poll()); assert.equal(a.closed, true);
});
test("join and key updates do not extend the shared deadline", async t => {
  const { a, b, store } = await pair(t); const expires = a.invitation.expires;
  await b.send("still same deadline"); await a.poll();
  assert.equal(b.view.expires, expires); assert.equal([...store.rooms.values()][0].expires, expires);
});
test("challenge floods are bounded without IP storage", async t => {
  const mls = await MlsConversation.generate("Alice"); t.after(() => mls.close());
  const store = new SecureChatStore(), { input } = await loginInput(mls.invitation, true);
  for (let i = 0; i < 64; i++) store.challenge(input, origin);
  assert.throws(() => store.challenge(input, origin), error => error.status === 429); assert.equal(store.challenges.size, 64);
});
test("cross-site Origin, fetch-site and unconfigured Host are denied", () => {
  const policy = { publicOrigin: "https://chat.example", allowLocal: false };
  for (const headers of [{ Host: "chat.example", Origin: "https://evil.example" }, { Host: "evil.example", Origin: "https://evil.example" }, { Host: "chat.example", Origin: "https://chat.example", "Sec-Fetch-Site": "cross-site" }]) assert.throws(() => guardChatRequest(new Request("https://chat.example/api/secure-chat", { method: "POST", headers }), policy));
});
test("API rejects malformed JSON, oversize body and legacy admin actions", async () => {
  const handlers = createChatHandlers(new SecureChatStore());
  for (const body of ["{", "[]", "x".repeat(96_001), JSON.stringify({ action: "create-room" }), JSON.stringify({ action: "delete-message" })]) {
    const response = await handlers.POST(new Request(`${origin}/api/secure-chat`, { method: "POST", headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json" }, body }));
    assert.ok(response.status >= 400); assert.match(response.headers.get("cache-control"), /no-store/);
  }
});
test("MLS rejects a replayed message and accepts the following generation", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), packet = await a.prepareText(id, "first"); await a.confirm();
  await b.receive(id, packet.wire); await assert.rejects(() => b.receive(id, packet.wire));
  const next = randomId(), second = await a.prepareText(next, "second"); await a.confirm();
  assert.equal((await b.receive(next, second.wire)).body, "second");
});
test("tampered ciphertext fails without consuming the valid generation", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), packet = await a.prepareText(id, "integrity"); await a.confirm();
  const bytes = unb64(packet.wire); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(() => b.receive(id, b64(bytes)));
  assert.equal((await b.receive(id, packet.wire)).body, "integrity");
});
test("message identifier substitution fails even with valid MLS ciphertext", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), packet = await a.prepareText(id, "bound context"); await a.confirm();
  await assert.rejects(() => b.receive(randomId(), packet.wire));
  assert.equal((await b.receive(id, packet.wire)).body, "bound context");
});
test("MLS framing rejects truncated, trailing and noncanonical base64 data", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), packet = await a.prepareText(id, "frame"); await a.confirm();
  const bytes = unb64(packet.wire);
  for (const bad of [b64(bytes.slice(0, -1)), b64(new Uint8Array([...bytes, 0])), packet.wire + "="]) await assert.rejects(() => b.receive(id, bad));
});
test("an invitation holder cannot substitute another participant's signed nickname", async t => {
  const { a } = await cryptoPair(t), c = await MlsConversation.generate("Charlie", a.invitation); t.after(() => c.close());
  const id = randomId(), sealed = await c.requestJoin(id), request = await unseal(a.invitation, `join:${id}`, sealed);
  request.profile.nickname = "Alice";
  await assert.rejects(async () => a.inspectJoin(id, await seal(a.invitation, `join:${id}`, request)));
});
test("case-insensitive nickname collisions cannot enter the verified roster", async t => {
  const { a } = await cryptoPair(t), impostor = await MlsConversation.generate("aLiCe", a.invitation); t.after(() => impostor.close());
  const id = randomId(), sealed = await impostor.requestJoin(id);
  await assert.rejects(() => a.inspectJoin(id, sealed), /nickname/);
});
test("Welcome is one-use and cannot be consumed by a different KeyPackage", async t => {
  const { a, b, welcome } = await cryptoPair(t);
  await assert.rejects(() => b.acceptWelcome(welcome));
  const stranger = await MlsConversation.generate("Charlie", a.invitation); t.after(() => stranger.close());
  await stranger.requestJoin(randomId()); await assert.rejects(() => stranger.acceptWelcome(welcome));
});
test("a pending encrypted packet blocks generation of a second ciphertext", async t => {
  const { a } = await cryptoPair(t); await a.prepareText(randomId(), "pending");
  await assert.rejects(() => a.prepareText(randomId(), "another"), /awaiting acknowledgement/);
  await assert.rejects(() => a.prepareRefresh(), /awaiting acknowledgement/);
});
test("padding equalizes two short application messages", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), one = await a.prepareText(id, "x"); await a.confirm(); await b.receive(id, one.wire);
  const next = randomId(), two = await a.prepareText(next, "a longer message within the first padding bucket"); await a.confirm();
  assert.equal(unb64(one.wire).length, unb64(two.wire).length);
});
test("closing the client clears its active identity state and invitation secret", async t => {
  const { a } = await pair(t); a.close(); assert.equal(a.view.ready, false); assert.equal(a.view.members.length, 0); assert.deepEqual(a.view.messages, []); assert.equal(a.invitation.secret, "");
});

test("bounded parser fuzz: 256 deterministic malformed MLS packets never render text", async t => {
  const { b } = await cryptoPair(t); let seed = 0x5eed;
  for (let sample = 0; sample < 256; sample++) {
    const bytes = new Uint8Array(1 + sample * 3);
    for (let i = 0; i < bytes.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[i] = seed & 255; }
    await assert.rejects(() => b.receive(randomId(), b64(bytes)));
  }
});
test("integrity mutation matrix: 32 ciphertext bit flips are rejected", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), packet = await a.prepareText(id, "mutation target"); await a.confirm();
  const original = unb64(packet.wire);
  for (let i = 1; i <= 32; i++) { const bytes = original.slice(); bytes[bytes.length - i] ^= 1; await assert.rejects(() => b.receive(id, b64(bytes))); }
  assert.equal((await b.receive(id, packet.wire)).body, "mutation target");
});
test("an old relay snapshot cannot roll back a live client's cursor", async t => {
  let replay = false;
  const { a, b } = await pair(t, { after(action, data) { return !action && replay ? { ...data, seq: 0 } : data; } });
  await a.send("advance"); await b.poll(); replay = true;
  await assert.rejects(() => b.poll(), /validation/); assert.equal(b.closed, true);
});
test("a substituted event packet closes the client without rendering unverified text", async t => {
  let tamper = false;
  const { a, b } = await pair(t, { after(action, data) {
    if (!action && tamper && data.events?.length) { const event = data.events.at(-1), bytes = unb64(event.wire); bytes[bytes.length - 1] ^= 1; event.wire = b64(bytes); }
    return data;
  } });
  await a.send("must not render"); tamper = true;
  await assert.rejects(() => b.poll()); assert.equal(b.closed, true); assert.deepEqual(b.view.messages, []);
});
test("unknown bearer token cannot read, claim, publish or enumerate a room", async () => {
  const store = new SecureChatStore();
  for (const operation of [() => store.snapshot("unknown", 0), () => store.claim("unknown", 0), () => store.publish("unknown", { id: randomId(), lease: "", wire: "A".repeat(64) })]) assert.throws(operation, error => error.status === 401);
});
test("cross-conversation packets cannot decrypt even with a reused message id", async t => {
  const { a } = await cryptoPair(t), other = await MlsConversation.generate("Other"); t.after(() => other.close()); await other.create();
  const id = randomId(), packet = await a.prepareText(id, "isolated"); await a.confirm();
  await assert.rejects(() => other.receive(id, packet.wire));
});

// An intentionally adversarial peer built from the pinned MLS primitives. This
// bypasses the production UI and admission policy, so tests exercise receivers.
async function adversarialPeer(invite, nickname = "Mallory") {
  const suite = await getCiphersuiteImpl(getCiphersuiteFromName(SUITE)), pair = await suite.signature.keygen();
  const profile = { id: digest(pair.publicKey), key: hex(pair.publicKey), nickname, signature: "" };
  const sign = async (kind, ...fields) => b64(await suite.signature.sign(pair.signKey, utf8(canonical(kind, invite.room, invite.expires, invite.founder, ...fields))));
  profile.signature = await sign("profile", profile.id, profile.key, profile.nickname);
  const keys = await generateKeyPackageWithKey({ credentialType: "basic", identity: unhex(profile.id) }, defaultCapabilities(), { notBefore: BigInt(Math.floor(Date.now() / 1000) - 60), notAfter: BigInt(Math.ceil(invite.expires / 1000)) }, [], pair, suite);
  const config = { keyRetentionConfig: { retainKeysForGenerations: 0, retainKeysForEpochs: 0, maximumForwardRatchetSteps: 32 }, lifetimeConfig: defaultLifetimeConfig, keyPackageEqualityConfig: defaultKeyPackageEqualityConfig, paddingConfig: { kind: "padUntilLength", padUntilLength: 1024 }, authService: { async validateCredential(c, k) { return c.credentialType === "basic" && hex(c.identity) === digest(k); } } };
  const request = async (id, invalid = false) => {
    const kp = structuredClone(keys.publicPackage); if (invalid) kp.signature[0] ^= 1;
    const keyPackage = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage: kp }));
    return seal(invite, `join:${id}`, { id, profile, keyPackage, signature: await sign("join", id, profile, keyPackage) });
  };
  return { suite, pair, profile, sign, keys, config, request };
}

test("audit regression: an invitation holder's alternate MLS group lacks the pinned founder", async t => {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation);
  t.after(() => { a.close(); b.close(); });
  const eve = await adversarialPeer(a.invitation), id = randomId(), sealed = await b.requestJoin(id);
  const request = await unseal(a.invitation, `join:${id}`, sealed), kp = decodeMlsMessage(unb64(request.keyPackage), 0)[0].keyPackage;
  const group = await createGroup(unhex(a.invitation.room), eve.keys.publicPackage, eve.keys.privatePackage, [], eve.suite, eve.config);
  const result = await createCommit({ state: group, cipherSuite: eve.suite }, { extraProposals: [{ proposalType: "add", add: { keyPackage: kp } }], ratchetTreeExtension: true });
  const welcome = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }));
  const profiles = [eve.profile, request.profile], admissions = [];
  for (const profile of profiles) admissions.push({ member: profile.id, by: eve.profile.id, signature: await eve.sign("admit", profile, eve.profile.id) });
  const requestHash = digest(JSON.stringify(request)), signer = eve.profile.id;
  const signature = await eve.sign("welcome", id, requestHash, welcome, profiles, admissions, signer);
  await assert.rejects(async () => b.acceptWelcome(await seal(a.invitation, `welcome:${id}`, { id, requestHash, welcome, profiles, admissions, signer, signature })), /founding key/);
  assert.equal(b.ready, false); wipe(group); wipe(result.newState); wipe(eve.keys); wipe(eve.pair);
});

test("audit regression: a real founder roster without a valid admission chain is rejected", async t => {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation);
  t.after(() => { a.close(); b.close(); }); await a.create();
  const id = randomId(), packet = await a.prepareAdd(id, await b.requestJoin(id));
  const bundle = await unseal(a.invitation, `welcome:${id}`, packet.welcome);
  bundle.admissions.find(cert => cert.member === b.identity.id).by = b.identity.id;
  await assert.rejects(async () => b.acceptWelcome(await seal(a.invitation, `welcome:${id}`, bundle)), /Signature|Admission/);
  assert.equal(b.ready, false);
});

test("audit regression: an admitted peer cannot rewrap Alice's signed text as its MLS message", async t => {
  const a = await MlsConversation.generate("Alice"); t.after(() => a.close()); await a.create();
  const eve = await adversarialPeer(a.invitation), joinId = randomId();
  const add = await a.prepareAdd(joinId, await eve.request(joinId)); await a.confirm(add.bootstrap);
  const bundle = await unseal(a.invitation, `welcome:${joinId}`, add.welcome);
  const state = await joinGroup(decodeMlsMessage(unb64(bundle.welcome), 0)[0].welcome, eve.keys.publicPackage, eve.keys.privatePackage, emptyPskIndex, eve.suite, undefined, undefined, eve.config);
  const id = randomId(), original = await a.prepareText(id, "Alice authored this"); await a.confirm();
  const decoded = await authenticatedApplication(state, decodeMlsMessage(unb64(original.wire), 0)[0].privateMessage, eve.suite);
  const rewrapped = await createApplicationMessage(decoded.newState, decoded.message, eve.suite);
  const wire = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: rewrapped.privateMessage }));
  await assert.rejects(() => a.receive(id, wire), /identity or context/);
  assert.equal(a.ready, true); wipe(state); wipe(decoded.newState); wipe(rewrapped.newState); wipe(eve.keys); wipe(eve.pair);
});

test("audit regression: a signed request with an invalid inner KeyPackage cannot close incumbents", async t => {
  const { a, b, transport } = await pair(t), invite = { ...a.invitation };
  const eve = await adversarialPeer(invite), id = randomId(), { pair: keys, input } = await loginInput(invite);
  const challenge = await transport({ action: "challenge", ...input });
  const session = await transport({ action: "authenticate", id: challenge.id, signature: await signature(keys, challenge.text) });
  await transport({ action: "enqueue", id, sealed: await eve.request(id, true) }, session.token);
  await a.poll(); await b.poll();
  assert.equal(a.closed, false); assert.equal(b.closed, false);
  const response = await transport(null, session.token);
  assert.equal((await unseal(invite, `rejection:${id}`, response.rejected)).rejected, true);
  await a.send("still available"); await b.poll(); assert.equal(b.view.messages.at(-1).body, "still available");
  wipe(eve.keys); wipe(eve.pair);
});

test("audit regression: current state drops withheld prior-epoch ciphertext after refresh", async t => {
  const { a, b } = await cryptoPair(t), id = randomId(), old = await a.prepareText(id, "withheld"); await a.confirm();
  const refresh = await a.prepareRefresh(); await a.confirm(); await b.receive(randomId(), refresh.wire);
  await assert.rejects(() => b.receive(id, old.wire), /epoch/);
  const nextId = randomId(), next = await a.prepareText(nextId, "current epoch"); await a.confirm();
  assert.equal((await b.receive(nextId, next.wire)).body, "current epoch");
});

test("audit regression: the state adapter discards retained old epochs without aliasing live secrets", () => {
  const secret = new Uint8Array([1, 2, 3]), source = { current: secret, historicalReceiverData: new Map([[1n, { old: new Uint8Array([4]) }]]), clientConfig: {} };
  const kept = currentEpochState(source); wipe(source);
  assert.equal(kept.historicalReceiverData.size, 0); assert.deepEqual([...kept.current], [1, 2, 3]); assert.deepEqual([...secret], [0, 0, 0]);
});

async function storeLogin(store, invite, create = false) {
  const { pair: keys, input } = await loginInput(invite, create), challenge = store.challenge(input, origin);
  return store.authenticate(challenge.id, await signature(keys, challenge.text), origin);
}

test("audit regression: repeated unadmitted logouts release all member reservations", async t => {
  const a = await MlsConversation.generate("Alice"); t.after(() => a.close());
  const store = new SecureChatStore(); await storeLogin(store, a.invitation, true);
  for (let i = 0; i < 32; i++) { const guest = await storeLogin(store, a.invitation); store.logout(guest.token); }
  const guest = await storeLogin(store, a.invitation);
  assert.equal(store.rooms.get(a.invitation.room).members.size, 2); assert.equal(store.session(guest.token).ready, false);
});

test("audit regression: an abandoned login without enqueue expires after two minutes", async t => {
  const a = await MlsConversation.generate("Alice"); t.after(() => a.close()); let now = Date.now();
  const store = new SecureChatStore(() => now); await storeLogin(store, a.invitation, true);
  const guest = await storeLogin(store, a.invitation); now += 120_001; store.clean();
  assert.equal(store.rooms.get(a.invitation.room).members.size, 1); assert.throws(() => store.session(guest.token), error => error.status === 401);
});

test("audit regression: sixteen full relay windows keep accepting bounded replacement writes", async () => {
  let now = Date.now(); const store = new SecureChatStore(() => now), members = [];
  for (let room = 0; room < 16; room++) {
    const invite = { room: randomId(), secret: "1".repeat(64), founder: "2".repeat(64), expires: now + CHAT_TTL };
    members.push(await storeLogin(store, invite, true));
  }
  for (let round = 0; round < 40; round++) {
    now += 10_001;
    for (const member of members) {
      const snapshot = store.snapshot(member.token, Math.max(0, round - 1));
      const lease = store.claim(member.token, snapshot.seq);
      assert.equal(store.publish(member.token, { lease: lease.id, id: randomId(), wire: "A".repeat(62_500) }).seq, round + 1);
    }
    assert.ok([...store.rooms.values()].reduce((sum, room) => sum + room.bytes, 0) <= 16_000_000);
  }
  assert.equal([...store.rooms.values()].reduce((sum, room) => sum + room.bytes, 0), 16_000_000);
});

test("simultaneous incumbent admission attempts leave all three clients usable", async t => {
  const { a, b, transport } = await pair(t);
  const c = await SecureChatClient.connect("Charlie", "", a.invitation, origin, transport); t.after(() => c.close());
  await Promise.allSettled([a.poll(), b.poll()]);
  for (let i = 0; i < 3; i++) { await a.poll(); await b.poll(); await c.poll(); }
  for (const client of [a, b, c]) { assert.equal(client.closed, false); assert.equal(client.view.members.length, 3); }
  await c.send("race resolved"); await a.poll(); await b.poll(); assert.equal(a.view.messages.at(-1).body, "race resolved");
});

test("closing during asynchronous key refresh cannot resurrect a cryptographic session", async t => {
  const { a } = await cryptoPair(t), pending = a.prepareRefresh(); a.close();
  await assert.rejects(() => pending); assert.equal(a.ready, false); assert.deepEqual(a.profiles, []); assert.equal(a.invitation.secret, "");
  await assert.rejects(() => a.prepareText(randomId(), "closed"));
});

test("sixteen real MLS participants fit the relay packet budgets and exchange text", async t => {
  const lab = harness(), founder = await SecureChatClient.connect("Member00", "Capacity", null, origin, lab.transport), clients = [founder];
  t.after(() => clients.forEach(client => client.close()));
  for (let i = 1; i < 16; i++) {
    const guest = await SecureChatClient.connect(`Member${String(i).padStart(2, "0")}`, "", founder.invitation, origin, lab.transport); clients.push(guest);
    await founder.poll(); await guest.poll(); await founder.poll();
  }
  for (const client of clients) await client.poll();
  await clients.at(-1).send("sixteen participants 🙂");
  for (const client of clients.slice(0, -1)) { await client.poll(); assert.equal(client.view.messages.at(-1).body, "sixteen participants 🙂"); }
  await assert.rejects(() => SecureChatClient.connect("Member17", "", founder.invitation, origin, lab.transport), /capacity/);
});

test("only the configured v3 onion authority is allowed, with exact same-origin POST", () => {
  const onion = `${"a".repeat(56)}.onion`, policy = { publicOrigin: "https://chat.example", onionOrigin: `http://${onion}`, allowLocal: false };
  const request = host => new Request(`http://${host}/api/secure-chat`, { method: "POST", headers: { Host: host, Origin: `http://${host}` } });
  assert.equal(guardChatRequest(request(onion), policy).origin, `http://${onion}`);
  assert.throws(() => guardChatRequest(request(`${"b".repeat(56)}.onion`), policy));
  assert.throws(() => guardChatRequest(request("chat.example"), policy));
  assert.throws(() => guardChatRequest(request(onion), { ...policy, onionOrigin: "http://*.onion" }));
});

// Messenger application events remain opaque to the relay; all metadata is signed.
const messageRef = message => ({ id: message.id, sender: message.sender });
test("encrypted replies bind the exact original author and message", async t => {
  const { a, b, requests } = await pair(t);
  await a.send("Original private sentence"); await b.poll();
  const target = messageRef(b.view.messages[0]);
  await b.send("Reply with 🌙", target); await a.poll();
  assert.deepEqual(a.view.messages[1].replyTo, target);
  assert.equal(a.view.messages[1].body, "Reply with 🌙");
  assert.deepEqual(a.view.messages[1].reactions, []);
  const wire = JSON.stringify(requests.filter(value => value.action === "publish"));
  assert.equal(wire.includes('"reply"'), false); assert.equal(wire.includes("Original private sentence"), false);
});
test("reactions set, replace and remove only the authenticated participant's reaction", async t => {
  const { a, b } = await pair(t); await a.send("React here"); await b.poll();
  const target = messageRef(a.view.messages[0]);
  await b.react(target, "👍"); await a.poll(); await a.react(target, "❤️"); await b.poll();
  assert.equal(a.view.messages.length, 1); assert.equal(a.view.messages[0].reactions.length, 2);
  await b.react(target, "🔥"); await a.poll();
  assert.deepEqual(a.view.messages[0].reactions, [{ sender: a.view.identity.id, emoji: "❤️" }, { sender: b.view.identity.id, emoji: "🔥" }]);
  await b.react(target, null); await a.poll();
  assert.deepEqual(a.view.messages[0].reactions, [{ sender: a.view.identity.id, emoji: "❤️" }]);
});
test("identical reaction operations and a lost acknowledgement are idempotent", async t => {
  let lose = false;
  const { a, b, requests } = await pair(t, { after(action, data) { if (lose && action?.action === "publish") { lose = false; throw new Error("ack lost"); } return data; } });
  await a.send("one reaction"); await b.poll(); const target = messageRef(b.view.messages[0]);
  lose = true; await b.react(target, "🎉"); await a.poll();
  const writes = requests.filter(value => value.action === "publish"); assert.deepEqual(writes.at(-1), writes.at(-2));
  await b.react(target, "🎉"); await a.poll();
  assert.deepEqual(a.view.messages[0].reactions, [{ sender: b.view.identity.id, emoji: "🎉" }]);
});
test("new guests see reply references without receiving the earlier message or its reactions", async t => {
  const { a, b, transport } = await pair(t); await a.send("history must stay private"); await b.poll(); const target = messageRef(a.view.messages[0]);
  const c = await SecureChatClient.connect("Charlie", "", a.invitation, origin, transport); t.after(() => c.close());
  await a.poll(); await b.poll(); await c.poll(); await a.poll(); await b.poll();
  await b.react(target, "👀"); await c.poll(); await a.poll();
  assert.deepEqual(c.view.messages, []);
  await b.send("a later reply", target); await c.poll(); await a.poll();
  assert.equal(c.view.messages.length, 1); assert.deepEqual(c.view.messages[0].replyTo, target);
  assert.equal(JSON.stringify(c.view).includes("history must stay private"), false);
});
test("invalid drafts and forged or unavailable targets do not consume a lease or close the session", async t => {
  const { a, b, requests } = await pair(t); await a.send("valid"); await b.poll(); const target = messageRef(a.view.messages[0]);
  const before = requests.filter(value => value.action === "claim").length;
  await assert.rejects(() => b.send("\u0000"), /Invalid message text/);
  await assert.rejects(() => b.send("x", { ...target, sender: b.view.identity.id }), /original message/);
  await assert.rejects(() => b.react({ ...target, id: randomId() }, "👍"), /original message/);
  await assert.rejects(() => b.react(target, "<img onerror=alert(1)>"), /Invalid message interaction/);
  assert.equal(requests.filter(value => value.action === "claim").length, before);
  assert.equal(b.closed, false); await b.send("still usable"); await a.poll(); assert.equal(a.view.messages.at(-1).body, "still usable");
});
test("message views do not expose mutable internal reply or reaction state", async t => {
  const { a, b } = await pair(t); await a.send("original"); await b.poll(); const target = messageRef(a.view.messages[0]);
  await b.send("reply", target); await a.poll(); await b.react(target, "👍"); await a.poll();
  const view = a.view; view.messages[0].reactions[0].emoji = "🔥"; view.messages[1].replyTo.id = "0".repeat(32);
  assert.equal(a.view.messages[0].reactions[0].emoji, "👍"); assert.deepEqual(a.view.messages[1].replyTo, target);
});
test("reply and reaction metadata never enter relay request fields or stored plaintext", async t => {
  const { a, b, store, requests } = await pair(t); await a.send("sensitive quote 27191"); await b.poll(); const target = messageRef(a.view.messages[0]);
  await b.send("secret reply 71727", target); await a.poll(); await b.react(target, "🔥"); await a.poll();
  const dump = JSON.stringify({ rooms: [...store.rooms], requests });
  for (const value of ["sensitive quote 27191", "secret reply 71727", "🔥", '"interaction"', target.sender]) assert.equal(dump.includes(value), false);
});
test("receiver rejects unsigned, altered and oversized interactions from an admitted peer", async t => {
  const a = await MlsConversation.generate("Alice"); t.after(() => a.close()); await a.create();
  const eve = await adversarialPeer(a.invitation), joinId = randomId();
  const add = await a.prepareAdd(joinId, await eve.request(joinId)); await a.confirm(add.bootstrap);
  const bundle = await unseal(a.invitation, `welcome:${joinId}`, add.welcome);
  const state = await joinGroup(decodeMlsMessage(unb64(bundle.welcome), 0)[0].welcome, eve.keys.publicPackage, eve.keys.privatePackage, emptyPskIndex, eve.suite, undefined, undefined, eve.config);
  t.after(() => { wipe(state); wipe(eve.keys); wipe(eve.pair); });
  const id = randomId(), target = { id: randomId(), sender: a.identity.id };
  const body = "Reacted 👍", interaction = { kind: "reaction", target, emoji: "👍" };
  const payload = { id, sender: eve.profile.id, body, epoch: a.epoch, signature: await eve.sign("text", id, eve.profile.id, body, a.epoch), interaction, interactionSignature: await eve.sign("interaction-v1", id, eve.profile.id, body, a.epoch, "reaction", target.id, target.sender, "👍") };
  const attacks = [
    { ...payload, interactionSignature: undefined },
    { ...payload, interaction: { ...interaction, target: { ...target, sender: eve.profile.id } } },
    { ...payload, interaction: { ...interaction, target: { ...target, id: randomId() } } },
    { ...payload, interaction: { ...interaction, emoji: "🔥" } },
    { ...payload, interaction: { ...interaction, actor: a.identity.id } },
    { ...payload, interaction: { ...interaction, emoji: "👍".repeat(1000) } },
    { ...payload, interaction: undefined },
    { ...payload, interaction: { kind: "reply", target } },
  ];
  for (const attack of attacks) {
    const result = await createApplicationMessage(currentEpochState(state), utf8(JSON.stringify(attack)), eve.suite);
    const wire = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage }));
    await assert.rejects(() => a.receive(id, wire)); wipe(result.newState);
  }
  // Failed extensions did not advance the receiver's generation.
  const valid = await createApplicationMessage(currentEpochState(state), utf8(JSON.stringify(payload)), eve.suite);
  const wire = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: valid.privateMessage }));
  assert.deepEqual((await a.receive(id, wire)).interaction, interaction); wipe(valid.newState);
});
test("interaction projection has bounded history and no queue for missing targets", async () => {
  const { applyMessageEvent } = await import("./secure-chat-interactions.ts");
  const messages = [], sender = "a".repeat(64), target = { id: randomId(), sender };
  for (let i = 0; i < 1000; i++) applyMessageEvent(messages, { id: randomId(), sender, body: "Reacted 👍", interaction: { kind: "reaction", target, emoji: "👍" } }, "Alice", "now");
  assert.deepEqual(messages, []);
  for (let i = 0; i < 300; i++) applyMessageEvent(messages, { id: randomId(), sender, body: "message" }, "Alice", "now");
  assert.equal(messages.length, 256);
});

test("returning through the invitation reuses the live browser identity without a relay login", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a, b, requests } = await pair(t); const owner = ownChatSession(a); t.after(() => owner.detach());
  await a.send("visible in my other tab"); await b.poll();
  const before = requests.filter(value => value.action === "challenge").length;
  const mirror = await resumeChatSession(a.invitation); assert.ok(mirror); t.after(() => mirror.detach());
  assert.equal(mirror.mirrored, true); assert.equal(mirror.view.identity.id, a.view.identity.id);
  assert.equal(mirror.view.messages[0].body, "visible in my other tab");
  await mirror.send("same identity"); await b.poll();
  assert.equal(b.view.messages.at(-1).sender, a.view.identity.id);
  assert.equal(requests.filter(value => value.action === "challenge").length, before);
  assert.equal(b.view.members.length, 2);
});
test("owner and mirrored tabs serialize sends and reactions through one MLS client", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a, b } = await pair(t); const owner = ownChatSession(a); t.after(() => owner.detach());
  const first = await resumeChatSession(a.invitation), second = await resumeChatSession(a.invitation); t.after(() => { first?.detach(); second?.detach(); });
  await Promise.all([owner.send("from original tab"), first.send("from second tab"), second.send("from third tab")]);
  await b.poll(); assert.equal(b.view.messages.length, 3); assert.equal(new Set(b.view.messages.map(m => m.sender)).size, 1);
  await first.poll(); const target = messageRef(first.view.messages[0]); await first.react(target, "👍"); await second.poll();
  assert.deepEqual(second.view.messages[0].reactions, [{ sender: a.view.identity.id, emoji: "👍" }]);
});
test("closing a mirrored view leaves the original session and keys active", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a, b } = await pair(t); const owner = ownChatSession(a); t.after(() => owner.detach());
  const mirror = await resumeChatSession(a.invitation); mirror.detach();
  assert.equal(a.closed, false); await owner.send("original still works"); await b.poll();
  assert.equal(b.view.messages.at(-1).body, "original still works");
});
test("explicit End session in a mirror destroys the owner's keys and closes other views", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a } = await pair(t); const owner = ownChatSession(a); t.after(() => owner.detach());
  const first = await resumeChatSession(a.invitation), second = await resumeChatSession(a.invitation); t.after(() => { first?.detach(); second?.detach(); });
  first.close(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(a.closed, true); assert.equal(second.closed, true); assert.equal(a.invitation.secret, "");
});
test("an altered invitation cannot discover a live browser session", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a } = await pair(t); const owner = ownChatSession(a); t.after(() => owner.detach());
  assert.equal(await resumeChatSession({ ...a.invitation, secret: "0".repeat(64) }), null);
  assert.equal(a.closed, false);
});
test("owner shutdown invalidates mirrored views and cannot be resumed from stale state", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a } = await pair(t); const invite = a.invitation, owner = ownChatSession(a);
  const mirror = await resumeChatSession(invite); t.after(() => mirror.detach());
  owner.detach(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(mirror.closed, true); assert.throws(() => mirror.view, /ended/);
  assert.equal(await resumeChatSession(invite), null);
});

test("presence follows authenticated reads, times out, reconnects and disappears on logout", async t => {
  const { a, b, tick } = await pair(t);
  const state = () => a.view.presence.members.find(member => member.id === b.view.identity.id)?.status;
  assert.equal(state(), "online");
  const peer = b.view.identity.id; tick(20_001); await a.poll(); assert.equal(state(), "offline");
  await b.poll(); await a.poll(); assert.equal(state(), "online");
  b.close(); await new Promise(setImmediate); await a.poll(); assert.equal(a.view.presence.members.find(member => member.id === peer)?.status, "offline");
  assert.equal(a.view.members.length, 2, "disconnect does not change the verified MLS roster");
});
test("presence reveals no nicknames or signing fingerprints to the relay", async t => {
  const { a, b, store } = await pair(t);
  const records = [...store.sessions.keys()].map(key => store.sessions.get(key));
  assert.ok(records.every(value => Number.isSafeInteger(value.lastSeen)));
  const dump = JSON.stringify({ rooms: [...store.rooms], sessions: records });
  for (const value of ["Alice", "Bob", a.view.identity.id, b.view.identity.id]) assert.equal(dump.includes(value), false);
  assert.ok(a.view.members.every(member => member.connection?.signature));
});
test("participant connection bindings cannot be copied from another signing identity", async t => {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation);
  t.after(() => { a.close(); b.close(); });
  await a.bindConnection(randomId()); await a.create();
  b.identity.connection = structuredClone(a.identity.connection);
  const id = randomId();
  const request = await b.requestJoin(id);
  await assert.rejects(() => a.inspectJoin(id, request), /Signature verification/);
});
test("a validly signed duplicate transport binding is rejected before the write lease", async t => {
  const a = await MlsConversation.generate("Alice"), b = await MlsConversation.generate("Bob", a.invitation);
  t.after(() => { a.close(); b.close(); });
  const connection = randomId(); await a.bindConnection(connection); await b.bindConnection(connection); await a.create();
  const id = randomId(), request = await b.requestJoin(id);
  await assert.rejects(() => a.inspectJoin(id, request), /Conflicting transport identities/);
});
test("connection bindings are one-time and client views do not expose mutable profiles", async t => {
  const a = await MlsConversation.generate("Alice"); t.after(() => a.close());
  await a.bindConnection(randomId()); await assert.rejects(() => a.bindConnection(randomId())); await a.create();
  await assert.rejects(() => a.bindConnection(randomId()));
  const { b } = await pair(t), binding = b.view.identity.connection.id;
  const view = b.view; view.identity.connection.id = randomId(); view.members.find(member => member.id === b.view.identity.id).connection.id = randomId();
  assert.equal(b.view.identity.connection.id, binding); assert.equal(b.view.members.find(member => member.id === b.view.identity.id).connection.id, binding);
});
test("old relays without presence do not fabricate participant status", async t => {
  const { a, b } = await pair(t, { after(action, data) { if (!action) delete data.presence; return data; } });
  assert.equal(a.view.presence, undefined); await a.send("compatible relay"); await b.poll(); assert.equal(b.view.messages.at(-1).body, "compatible relay");
});
test("malformed or oversized presence snapshots fail closed before rendering", async t => {
  for (const presence of [Array(17).fill({ id: randomId(), online: true, ready: true }), [{ id: "bad", online: true, ready: true }], [{ id: randomId(), online: "true", ready: true }]]) {
    let attack = false;
    const { a } = await pair(t, { after(action, data) { if (!action && attack) data.presence = presence; return data; } });
    attack = true; await assert.rejects(() => a.poll(), /Invalid participant connection state/); assert.equal(a.closed, true);
  }
});
test("orphaned invitations reject new guests instead of leaving everyone waiting", async t => {
  const lab = harness(), a = await SecureChatClient.connect("Alice", "Lost session", null, origin, lab.transport);
  const invite = a.invitation; a.close();
  await assert.rejects(() => SecureChatClient.connect("Bob", "", invite, origin, lab.transport), /No participant can open/);
  await assert.rejects(() => SecureChatClient.connect("Alice", "", invite, origin, lab.transport), /No participant can open/);
  assert.equal(lab.store.sessions.size, 0);
});
test("a guest waiting when the last admitted participant leaves receives an explicit error", async t => {
  const lab = harness(), a = await SecureChatClient.connect("Alice", "Lost session", null, origin, lab.transport);
  const b = await SecureChatClient.connect("Bob", "", a.invitation, origin, lab.transport); t.after(() => b.close());
  assert.equal(b.view.ready, false); a.close(); await new Promise(setImmediate);
  await assert.rejects(() => b.poll(), /No participant can open/); assert.equal(b.closed, true);
});
test("silent abandoned sessions do not create a misleading new waiting guest", async t => {
  const lab = harness(), a = await SecureChatClient.connect("Alice", "Friends", null, origin, lab.transport); t.after(() => a.close());
  for (const session of lab.store.sessions.values()) session.lastSeen -= 20_001;
  await assert.rejects(() => SecureChatClient.connect("Bob", "", a.invitation, origin, lab.transport), /No participant is online/);
  await a.poll(); const b = await SecureChatClient.connect("Bob", "", a.invitation, origin, lab.transport); t.after(() => b.close());
  await a.poll(); await b.poll(); assert.equal(b.view.ready, true);
});
test("the background session poller admits a guest while its document is hidden", async t => {
  const { startChatPolling } = await import("./secure-chat-polling.ts");
  const lab = harness(), a = await SecureChatClient.connect("Alice", "Background", null, origin, lab.transport);
  const b = await SecureChatClient.connect("Bob", "", a.invitation, origin, lab.transport);
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: true });
  const stop = startChatPolling(() => a.poll(), 15, { window, document }); t.after(() => { stop(); a.close(); b.close(); });
  for (let attempt = 0; attempt < 40 && !b.view.ready; attempt++) { await new Promise(resolve => setTimeout(resolve, 15)); await b.poll(); }
  assert.equal(b.view.ready, true); await b.send("background admission works");
  // An in-flight poll can predate the send. Wait for the background loop to
  // observe delivery instead of treating one coalesced poll as a fresh read.
  for (let attempt = 0; attempt < 80 && !a.view.messages.length; attempt++) await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(a.view.messages.at(-1)?.body, "background admission works");
});
test("poll wakeups do not overlap and teardown removes event listeners", async () => {
  const { startChatPolling } = await import("./secure-chat-polling.ts");
  const window = new EventTarget(), document = new EventTarget();
  let calls = 0, release;
  const stop = startChatPolling(() => { calls++; return new Promise(resolve => { release = resolve; }); }, 60_000, { window, document });
  window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
  assert.equal(calls, 1); stop(); release(); await new Promise(resolve => setTimeout(resolve, 5));
  window.dispatchEvent(new Event("online")); assert.equal(calls, 1);
});
test("SPA view detach and return retain identity, history and admission without a new login", async t => {
  const { ownChatSession } = await import("./secure-chat-session.ts");
  const { retainChatSession, currentChatSession } = await import("./secure-chat-runtime.ts");
  const { a, b, requests } = await pair(t); const session = retainChatSession(ownChatSession(a)); t.after(() => session.close());
  const invite = session.invitation, fingerprint = session.view.identity.id;
  await session.send("keep my live session"); session.detach();
  assert.equal(currentChatSession(invite), session); assert.equal(currentChatSession().view.identity.id, fingerprint);
  assert.equal(currentChatSession().view.messages.at(-1).body, "keep my live session");
  await assert.rejects(async () => currentChatSession({ ...invite, secret: "0".repeat(64) }), /Another conversation/);
  assert.equal(requests.filter(value => value.action === "challenge").length, 2);
  await b.send("return reply"); await session.poll(); assert.equal(session.view.messages.at(-1).body, "return reply");
  session.close(); assert.equal(currentChatSession(), null); assert.equal(a.closed, true);
});

test("invitations preserve the chat document path for same-tab hash navigation", async t => {
  const { a } = await pair(t);
  for (const path of ["/", "/secure-chat"]) {
    const link = new URL(invitationLink(origin, a.invitation, path));
    assert.equal(link.pathname, path); assert.deepEqual(parseInvitation(link.hash), a.invitation);
    assert.equal(link.search, "", "invitation secrets stay in the fragment");
  }
});

test("send waits for another participant's write lease and delivers without manual retry", async t => {
  const tokens = [];
  const { a, b, store, transport, requests } = await pair(t, { after(action, data) { if (action?.action === "authenticate") tokens.push(data.token); return data; } });
  const room = store.rooms.get(a.invitation.room);
  const lease = await transport({ action: "claim", seq: room.seq }, tokens[0]);
  const before = requests.filter(value => value.action === "publish").length;
  const release = setTimeout(() => { void transport({ action: "release", lease: lease.id }, tokens[0]); }, 250);
  t.after(() => clearTimeout(release));
  await b.send("sent after key update"); await a.poll();
  assert.equal(a.view.messages.at(-1)?.body, "sent after key update");
  assert.equal(requests.filter(value => value.action === "publish").length - before, 1, "encrypt and publish only after obtaining the lease");
  assert.equal(a.closed || b.closed, false);
});

test("background admission yields to a held lease without reporting a connection failure", async t => {
  const tokens = [];
  const { a, b, store, transport } = await pair(t, { after(action, data) { if (action?.action === "authenticate") tokens.push(data.token); return data; } });
  const c = await SecureChatClient.connect("Charlie", "", a.invitation, origin, transport); t.after(() => c.close());
  const lease = await transport({ action: "claim", seq: store.rooms.get(a.invitation.room).seq }, tokens[0]);
  await b.poll(); assert.equal(b.closed, false); assert.equal(c.view.ready, false);
  await transport({ action: "release", lease: lease.id }, tokens[0]);
  await b.poll(); await a.poll(); await c.poll(); assert.equal(c.view.ready, true);
});
test("ending the session while waiting for a lease cancels sending before encryption", async t => {
  const tokens = [];
  const { a, b, store, transport, requests } = await pair(t, { after(action, data) { if (action?.action === "authenticate") tokens.push(data.token); return data; } });
  await transport({ action: "claim", seq: store.rooms.get(a.invitation.room).seq }, tokens[0]);
  const before = requests.filter(value => value.action === "publish").length;
  const timer = setTimeout(() => b.close(), 30); t.after(() => clearTimeout(timer));
  await assert.rejects(() => b.send("must never escape"), /ended/);
  assert.equal(requests.filter(value => value.action === "publish").length, before);
});
test("four concurrent writers deliver once each without user retries", async t => {
  const { a, b, transport } = await pair(t), clients = [a, b];
  for (const nickname of ["Charlie", "Diana"]) {
    const guest = await SecureChatClient.connect(nickname, "", a.invitation, origin, transport); t.after(() => guest.close());
    await a.poll(); for (const client of clients.slice(1)) await client.poll(); await guest.poll(); clients.push(guest);
    for (const client of clients) await client.poll();
  }
  await Promise.all(clients.map((client, index) => client.send(`concurrent ${index}`)));
  for (const client of clients) await client.poll();
  for (const client of clients) {
    assert.equal(client.closed, false); assert.equal(client.view.messages.length, 4);
    assert.equal(new Set(client.view.messages.map(message => message.body)).size, 4);
  }
});

// Durable checkpoints use an in-memory sink here; IndexedDB and reload are
// exercised separately in the browser. These tests use the real MLS/client/relay.
function checkpointSink() {
  let saved;
  return { get saved() { return structuredClone(saved); }, storage: {
    async save(value) { saved = structuredClone(value); }, async clear() { saved = undefined; },
  } };
}
test("saved sessions: reload retains nickname, fingerprint, history and the existing relay identity", async t => {
  const { a, b, store, transport } = await pair(t), disk = checkpointSink();
  await a.persistWith(disk.storage); await a.send("Before reload 🙂"); await b.poll();
  const identity = a.view.identity, invite = a.invitation; a.suspend();
  assert.equal(store.sessions.size, 2);
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, transport); t.after(() => resumed.close());
  assert.deepEqual(resumed.view.identity, identity); assert.deepEqual(resumed.invitation, invite);
  assert.equal(resumed.view.messages[0].body, "Before reload 🙂");
  await resumed.send("After reload"); await b.poll(); assert.equal(b.view.messages.at(-1).body, "After reload");
  assert.equal(store.sessions.size, 2);
});
test("saved sessions: both browsers can close and resume the same conversation", async t => {
  const { a, b, transport } = await pair(t), da = checkpointSink(), db = checkpointSink();
  await a.persistWith(da.storage); await b.persistWith(db.storage); a.suspend(); b.suspend();
  const x = await SecureChatClient.restore(da.saved, da.storage, transport), y = await SecureChatClient.restore(db.saved, db.storage, transport);
  t.after(() => { x.close(); y.close(); });
  await x.send("Still the same group"); await y.poll(); assert.equal(y.view.messages.at(-1).body, "Still the same group");
});
test("saved sessions: pending admission survives reload and consumes Welcome safely", async t => {
  const lab = harness(), a = await SecureChatClient.connect("Founder", "Reload", null, origin, lab.transport);
  const b = await SecureChatClient.connect("ReturningGuest", "", a.invitation, origin, lab.transport), disk = checkpointSink();
  t.after(() => { a.close(); b.close(); });
  await b.persistWith(disk.storage); const id = b.view.identity.id; b.suspend(); await a.poll();
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, lab.transport); t.after(() => resumed.close());
  assert.equal(resumed.view.ready, true); assert.equal(resumed.view.identity.id, id);
  await resumed.send("Guest restored"); await a.poll(); assert.equal(a.view.messages.at(-1).body, "Guest restored");
});
test("saved sessions: accepted write interrupted before acknowledgement retries identical ciphertext once", async t => {
  let interrupt = false, paused, accepted;
  const { a, b, transport, requests } = await pair(t, { after(action, response) {
    if (interrupt && action?.action === "publish") { interrupt = false; accepted = structuredClone(action); paused.suspend(); }
    return response;
  } });
  const disk = checkpointSink(); await a.persistWith(disk.storage); paused = a; interrupt = true;
  await assert.rejects(() => a.send("Crash after acceptance")); assert.ok(disk.saved.publication);
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, transport); t.after(() => resumed.close());
  await b.poll(); assert.equal(b.view.messages.filter(value => value.body === "Crash after acceptance").length, 1);
  assert.equal(resumed.view.messages.filter(value => value.body === "Crash after acceptance").length, 1);
  const copies = requests.filter(value => value.action === "publish" && value.id === accepted.id);
  assert.equal(copies.length, 2); assert.equal(copies[0].wire, copies[1].wire); assert.equal(disk.saved.publication, undefined);
  await resumed.send("Next safe generation"); await b.poll(); assert.equal(b.view.messages.at(-1).body, "Next safe generation");
});
test("saved sessions: unsent journal resumes under a fresh lease without re-encryption", async t => {
  const { a, b, transport, tick, requests } = await pair(t), disk = checkpointSink();
  const sink = { ...disk.storage, async save(value) { await disk.storage.save(value); if (value.publication && !a.closed) a.suspend(); } };
  await a.persistWith(sink); await assert.rejects(() => a.send("Journal before network"));
  const packet = disk.saved.publication; assert.ok(packet);
  assert.equal(requests.filter(value => value.action === "publish" && value.id === packet.id).length, 0);
  tick(20_001);
  tick(-20_001); // Expire the abandoned lease, then restore the real-time clock.
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, transport); t.after(() => resumed.close());
  await b.poll(); assert.equal(b.view.messages.at(-1).body, "Journal before network");
  assert.ok(requests.filter(value => value.action === "publish" && value.id === packet.id).every(value => value.wire === packet.packet.wire));
});
test("saved sessions: end session removes the checkpoint and revokes its transport", async t => {
  const { a, store } = await pair(t), disk = checkpointSink(); await a.persistWith(disk.storage);
  const token = disk.saved.token; a.close(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(disk.saved, undefined); assert.throws(() => store.session(token), /expired/);
});
test("saved sessions: storage failure prevents publishing ciphertext", async t => {
  const { a, requests } = await pair(t), disk = checkpointSink();
  await a.persistWith({ ...disk.storage, async save(value) { if (value.publication) throw new Error("Storage unavailable"); await disk.storage.save(value); } });
  const before = requests.filter(value => value.action === "publish").length;
  await assert.rejects(() => a.send("Must stay local"), /Storage unavailable/);
  assert.equal(requests.filter(value => value.action === "publish").length, before); assert.equal(a.closed, true);
});
test("saved sessions: expiry and wrong signing keys cannot restore a checkpoint", async t => {
  const { a, transport } = await pair(t), disk = checkpointSink(); await a.persistWith(disk.storage);
  const forged = disk.saved, expired = disk.saved; expired.mls.invitation.expires = Date.now() - 1;
  await assert.rejects(() => SecureChatClient.restore(expired, disk.storage, transport), /expired/);
  assert.equal(disk.saved, undefined); forged.mls.signKey = b64(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(() => SecureChatClient.restore(forged, disk.storage, transport), /Signature/);
});
test("saved vault: AES-GCM hides text and rejects modified ciphertext, context and key", async t => {
  const { a } = await pair(t), disk = checkpointSink(); await a.persistWith(disk.storage); await a.send("Vault-private-text");
  const { sealCheckpoint, openCheckpoint } = await import("./secure-chat-vault.ts");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const record = await sealCheckpoint(disk.saved, key, 1), second = await sealCheckpoint(disk.saved, key, 2);
  assert.equal(record.key.extractable, false); await assert.rejects(() => crypto.subtle.exportKey("raw", key));
  assert.notDeepEqual(record.iv, second.iv); assert.equal(new TextDecoder().decode(record.ciphertext).includes("Vault-private-text"), false);
  assert.ok(JSON.stringify(await openCheckpoint(record)) === JSON.stringify(disk.saved));
  const broken = structuredClone(record); new Uint8Array(broken.ciphertext)[0] ^= 1;
  await assert.rejects(() => openCheckpoint(broken)); await assert.rejects(() => openCheckpoint({ ...record, revision: 2 }));
  const other = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await assert.rejects(() => openCheckpoint({ ...record, key: other }));
});

test("saved sessions: reload between durable Welcome and its ACK remains ready", async t => {
  const lab = harness(), a = await SecureChatClient.connect("Founder", "Welcome checkpoint", null, origin, lab.transport);
  const b = await SecureChatClient.connect("Guest", "", a.invitation, origin, lab.transport), disk = checkpointSink();
  t.after(() => { a.close(); b.close(); });
  await b.persistWith({ ...disk.storage, async save(value) { await disk.storage.save(value); if (value.mls.state && !b.closed) b.suspend(); } });
  await a.poll(); await assert.rejects(() => b.poll());
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, lab.transport); t.after(() => resumed.close());
  assert.equal(lab.store.session(disk.saved.token).welcome, undefined); assert.equal(resumed.view.ready, true);
  await a.poll(); assert.equal(a.view.presence.members.find(value => value.id === resumed.view.identity.id).status, "online");
});
test("saved sessions: interrupted admission commit restores the existing members and guest", async t => {
  let pause = false, owner;
  const lab = harness({ after(action, data) { if (pause && action?.action === "publish" && action.join) { pause = false; owner.suspend(); } return data; } });
  const a = await SecureChatClient.connect("Founder", "Commit journal", null, origin, lab.transport), disk = checkpointSink(); owner = a;
  await a.persistWith(disk.storage);
  const b = await SecureChatClient.connect("Guest", "", a.invitation, origin, lab.transport); t.after(() => { a.close(); b.close(); });
  pause = true; await assert.rejects(() => a.poll()); assert.ok(disk.saved.publication?.join);
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, lab.transport); t.after(() => resumed.close());
  await b.poll(); await resumed.poll(); assert.equal(resumed.view.members.length, 2);
  await b.send("Admission survived reload"); await resumed.poll(); assert.equal(resumed.view.messages.at(-1).body, "Admission survived reload");
});
test("saved sessions: temporary relay outage keeps the local checkpoint for another attempt", async t => {
  const { a, transport } = await pair(t), disk = checkpointSink(); await a.persistWith(disk.storage); a.suspend();
  const offline = await SecureChatClient.restore(disk.saved, disk.storage, async () => { throw new ChatApiError("Offline", 503); });
  assert.equal(offline.closed, false); assert.equal(offline.view.identity.nickname, "Alice");
  assert.ok(disk.saved); offline.suspend();
  const resumed = await SecureChatClient.restore(disk.saved, disk.storage, transport); t.after(() => resumed.close());
  assert.equal(resumed.view.ready, true);
});
test("saved sessions: expired relay session removes the local checkpoint without recreating a room", async t => {
  const { a, transport, tick, store } = await pair(t), disk = checkpointSink(); await a.persistWith(disk.storage); a.suspend(); tick(CHAT_TTL + 1);
  await assert.rejects(() => SecureChatClient.restore(disk.saved, disk.storage, transport), /expired/);
  assert.equal(disk.saved, undefined); assert.equal(store.rooms.size, 0);
});
test("HTTP transport: interrupted streams and invalid JSON remain recoverable gateway errors", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("Connection interrupted")); } })));
  await assert.rejects(() => httpTransport(), error => error instanceof ChatApiError && error.status === 502);
  globalThis.fetch.mock.mockImplementation(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(() => httpTransport(), error => error instanceof ChatApiError && error.status === 502);
});

test("durable outbox: lost publish ACK preserves the participant and retries once without duplicate text", async t => {
  let offline = false;
  const { a, b, requests } = await pair(t, { after(action, data) { if (offline && action?.action === "publish") throw new ChatApiError("Connection lost", 503); return data; } });
  const disk = checkpointSink(); await a.persistWith(disk.storage); const identity = a.view.identity.id;
  offline = true; await assert.rejects(() => a.send("Saved pending message"));
  assert.equal(a.closed, false); assert.ok(disk.saved?.publication); assert.equal(a.view.deliveryPending, true);
  await assert.rejects(() => a.send("Do not queue duplicate text"), /awaiting confirmation/);
  offline = false; await a.poll(); await b.poll();
  assert.equal(a.view.identity.id, identity); assert.equal(a.view.deliveryPending, false);
  assert.equal(b.view.messages.filter(value => value.body === "Saved pending message").length, 1);
  const wires = requests.filter(value => value.action === "publish").slice(-2);
  assert.equal(wires[0].wire, wires[1].wire); assert.equal(wires[0].id, wires[1].id);
});
test("durable outbox: offline before publication survives reload and preserves unsent ciphertext", async t => {
  let offline = false;
  const { a, b, transport } = await pair(t, { before(action) { if (offline && action?.action === "publish") throw new ChatApiError("Offline", 503); } });
  const disk = checkpointSink(); await a.persistWith(disk.storage); const identity = a.view.identity.id;
  offline = true; await assert.rejects(() => a.send("Pending across reload"));
  assert.equal(a.closed, false); assert.ok(disk.saved); a.suspend(); offline = false;
  const restored = await SecureChatClient.restore(disk.saved, disk.storage, transport); t.after(() => restored.close());
  await b.poll(); assert.equal(restored.view.identity.id, identity); assert.equal(b.view.messages.at(-1).body, "Pending across reload");
});

test("legacy links: root invitations enter the standalone route without losing the secret fragment", async () => {
  const { legacyChatLocation } = await import("./secure-chat-invite.ts");
  const invite = { room: "1".repeat(32), secret: "2".repeat(64), founder: "3".repeat(64), expires: Date.now() + 10000 };
  const legacy = new URL(invitationLink(origin, invite, "/"));
  const destination = new URL(legacyChatLocation(legacy.hash), origin);
  assert.equal(destination.pathname, "/secure-chat"); assert.equal(destination.search, "");
  assert.deepEqual(parseInvitation(destination.hash), invite);
  assert.equal(legacyChatLocation("#secure-chat"), null); assert.equal(legacyChatLocation("#arcade"), null);
});
test("durable outbox: interrupted refresh does not end the participant", async t => {
  let fail = false;
  const { a, b, transport } = await pair(t, { after(action, data) { if (fail && action?.action === "publish") throw new ChatApiError("Offline", 503); return data; } });
  const disk = checkpointSink(); await b.persistWith(disk.storage);
  const saved = disk.saved; saved.lastRefresh = 0; b.suspend();
  const restored = await SecureChatClient.restore(saved, disk.storage, transport); t.after(() => restored.close());
  fail = true; await assert.rejects(() => restored.poll());
  assert.equal(restored.closed, false); assert.ok(disk.saved.publication?.packet.commit);
  fail = false; await restored.poll(); await a.poll();
  await restored.send("Refresh recovered"); await a.poll(); assert.equal(a.view.messages.at(-1).body, "Refresh recovered");
});

test("mirrored tabs do not multiply relay polling or exhaust the owner's read quota", async t => {
  const { ownChatSession, resumeChatSession } = await import("./secure-chat-session.ts");
  const { a, b, requests } = await pair(t);
  const owner = ownChatSession(a); t.after(() => owner.detach());
  const first = await resumeChatSession(a.invitation), second = await resumeChatSession(a.invitation);
  t.after(() => { first?.detach(); second?.detach(); });
  const before = requests.filter(value => value.after !== undefined).length;
  // Mirrors read the owner's already-verified view. Only its background loop
  // should poll the relay, regardless of how many same-browser views are open.
  for (let i = 0; i < 35; i++) { await first.poll(); await second.poll(); }
  assert.equal(requests.filter(value => value.after !== undefined).length, before);
  await b.send("the owner polls once for every view"); await owner.poll();
  await first.poll(); await second.poll();
  assert.equal(first.view.messages.at(-1).body, "the owner polls once for every view");
  assert.deepEqual(first.view.messages, second.view.messages);
  await first.send("sending still works"); await b.poll();
  assert.equal(b.view.messages.at(-1).body, "sending still works");
});
