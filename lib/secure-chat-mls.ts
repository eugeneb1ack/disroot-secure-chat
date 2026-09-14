import {
  createApplicationMessage, createCommit, createGroup, decodeMlsMessage, defaultCapabilities,
  defaultKeyPackageEqualityConfig, defaultLifetimeConfig, emptyPskIndex, encodeMlsMessage,
  generateKeyPackageWithKey, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup,
  processMessage, type ClientConfig, type ClientState, type CiphersuiteImpl, type KeyPackage, type PrivateKeyPackage,
} from "ts-mls";
import { applyProposals } from "ts-mls/clientState.js";
import { toLeafIndex } from "ts-mls/treemath.js";
import { authenticatedApplication, currentEpochState } from "./secure-chat-mls-adapter.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonical, CHAT_TTL, MAX_MEMBERS, MAX_TEXT, nicknamePattern, hexPattern, idPattern, type ChatInvitation, type Profile } from "./secure-chat-protocol.ts";

export const SUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
export const utf8 = (value: string) => new TextEncoder().encode(value);
export const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const digest = (value: string | Uint8Array) => hex(sha256(typeof value === "string" ? utf8(value) : value));
export const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export function unhex(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("Invalid hex encoding.");
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}
export function b64(value: Uint8Array) { return btoa(Array.from(value, byte => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function unb64(value: string, max = 64_000) {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid packet encoding.");
  const result = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  if (b64(result) !== value) throw new Error("Noncanonical packet encoding.");
  return result;
}
export function wipe(value: unknown, seen = new Set<unknown>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Uint8Array) value.fill(0);
  else if (value instanceof Map) for (const entry of value.values()) wipe(entry, seen);
  else for (const entry of Object.values(value)) wipe(entry, seen);
}
const clone = currentEpochState;
function readWire(value: string) {
  const bytes = unb64(value), parsed = decodeMlsMessage(bytes, 0);
  if (!parsed || parsed[1] !== bytes.length || parsed[0].version !== "mls10") throw new Error("Invalid MLS framing.");
  return parsed[0];
}
const context = (invite: ChatInvitation, kind: string, ...data: unknown[]) => canonical(kind, invite.room, invite.expires, invite.founder, ...data);
async function derive(invite: ChatInvitation, purpose: string) {
  const raw = unhex(invite.secret);
  const key = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  raw.fill(0);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(context(invite, "invitation")), info: utf8(purpose) }, key, 256));
}
export async function capability(invite: ChatInvitation) { const raw = await derive(invite, "transport-capability"); const value = hex(raw); raw.fill(0); return value; }
async function bootstrapKey(invite: ChatInvitation) {
  const raw = await derive(invite, "bootstrap-aead");
  try { return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }
  finally { raw.fill(0); }
}
export async function seal(invite: ChatInvitation, kind: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = utf8(JSON.stringify(value));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(context(invite, kind)), tagLength: 128 }, await bootstrapKey(invite), bytes));
    const out = new Uint8Array(12 + ciphertext.length); out.set(iv); out.set(ciphertext, 12); return b64(out);
  } finally { bytes.fill(0); }
}
export async function unseal<T>(invite: ChatInvitation, kind: string, value: string): Promise<T> {
  const bytes = unb64(value);
  if (bytes.length < 28) throw new Error("Invalid encrypted invitation packet.");
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: utf8(context(invite, kind)), tagLength: 128 }, await bootstrapKey(invite), bytes.slice(12)));
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)) as T; }
  finally { plain.fill(0); }
}
const config: ClientConfig = {
  keyRetentionConfig: { retainKeysForGenerations: 0, retainKeysForEpochs: 0, maximumForwardRatchetSteps: 32 },
  lifetimeConfig: defaultLifetimeConfig, keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  paddingConfig: { kind: "padUntilLength", padUntilLength: 1024 },
  authService: { async validateCredential(credential, key) { return credential.credentialType === "basic" && hex(credential.identity) === digest(key); } },
};
type JoinRequest = { id: string; profile: Profile; keyPackage: string; signature: string };
type Admission = { member: string; by: string; signature: string };
type Roster = { profiles: Profile[]; admissions: Admission[] };
type WelcomeBundle = Roster & { id: string; requestHash: string; welcome: string; signer: string; signature: string };
type SignedText = { id: string; sender: string; body: string; epoch: string; signature: string };
type Manifest = { name: string; signature: string };
export type PreparedPacket = { wire: string; bootstrap?: string; welcome?: string; commit: boolean };

// Never persisted or exposed through React state. Calls are serialized by SecureChatClient.
export class MlsConversation {
  #state?: ClientState;
  #candidate?: ClientState;
  #keys?: { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage };
  #signKey: Uint8Array;
  #suite: CiphersuiteImpl;
  #closed = false;
  #joinRequest?: JoinRequest;
  #profiles = new Map<string, Profile>();
  #admissions = new Map<string, Admission>();
  invitation: ChatInvitation;
  identity: Profile;
  name = "Private conversation";
  private constructor(suite: CiphersuiteImpl, signKey: Uint8Array, invitation: ChatInvitation, identity: Profile) {
    this.#suite = suite; this.#signKey = signKey; this.invitation = invitation; this.identity = identity;
  }
  static async generate(nickname: string, invite?: ChatInvitation, now = Date.now()) {
    if (!nicknamePattern.test(nickname)) throw new Error("Choose 3–24 letters, numbers, dots, underscores or hyphens.");
    const suite = await getCiphersuiteImpl(getCiphersuiteFromName(SUITE));
    const pair = await suite.signature.keygen(), key = hex(pair.publicKey);
    const invitation = invite ?? { room: randomId(), secret: hex(crypto.getRandomValues(new Uint8Array(32))), founder: key, expires: now + CHAT_TTL };
    if (!idPattern.test(invitation.room) || !hexPattern.test(invitation.secret) || !hexPattern.test(invitation.founder) || invitation.expires <= now || invitation.expires > now + CHAT_TTL) { wipe(pair); throw new Error("Invalid or expired invitation."); }
    const identity = { id: digest(pair.publicKey), key, nickname, signature: "" };
    const instance = new MlsConversation(suite, pair.signKey.slice(), { ...invitation }, identity);
    identity.signature = await instance.sign("profile", identity.id, identity.key, identity.nickname);
    instance.#profiles.set(identity.id, identity);
    if (key === invitation.founder) instance.#admissions.set(identity.id, { member: identity.id, by: identity.id, signature: await instance.sign("admit", identity, identity.id) });
    instance.#keys = await generateKeyPackageWithKey({ credentialType: "basic", identity: unhex(identity.id) }, defaultCapabilities(), { notBefore: BigInt(Math.floor(now / 1000) - 60), notAfter: BigInt(Math.ceil(invitation.expires / 1000)) }, [], pair, suite);
    // The package may share the signature key. Retain an independent package before wiping temporaries.
    instance.#keys = structuredClone(instance.#keys); wipe(pair);
    return instance;
  }
  get ready() { return !!this.#state && !this.#closed; }
  get epoch() { return String(this.#state?.groupContext.epoch ?? BigInt(0)); }
  get profiles() { return [...this.#profiles.values()].map(value => ({ ...value })); }
  get verification() { return this.#state ? digest(this.#state.groupContext.confirmedTranscriptHash) : ""; }
  private check() { if (this.#closed || Date.now() >= this.invitation.expires) { this.close(); throw new Error("This conversation has expired. Generate a fresh invitation."); } }
  private async sign(kind: string, ...fields: unknown[]) { return b64(await this.#suite.signature.sign(this.#signKey, utf8(context(this.invitation, kind, ...fields)))); }
  private async verify(key: string, signature: string, kind: string, ...fields: unknown[]) {
    if (!hexPattern.test(key) || !await this.#suite.signature.verify(unhex(key), utf8(context(this.invitation, kind, ...fields)), unb64(signature, 100))) throw new Error("Signature verification failed.");
  }
  async manifest(name: string) {
    this.check(); this.name = name.trim() || "Private conversation";
    if (this.name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(this.name)) throw new Error("Choose a chat name of up to 40 visible characters.");
    return seal(this.invitation, "manifest", { name: this.name, signature: await this.sign("manifest", this.name) });
  }
  async readManifest(sealed: string) {
    const value = await unseal<Manifest>(this.invitation, "manifest", sealed);
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(value.name)) throw new Error("Invalid conversation manifest.");
    await this.verify(this.invitation.founder, value.signature, "manifest", value.name); this.name = value.name;
  }
  async create() {
    this.check();
    if (this.identity.key !== this.invitation.founder) throw new Error("Only the pinned founding key can initialize this conversation.");
    const keys = this.#keys!;
    const state = await createGroup(unhex(this.invitation.room), keys.publicPackage, structuredClone(keys.privatePackage), [], this.#suite, config);
    try { this.check(); this.#state = clone(state); } finally { wipe(state); wipe(keys); this.#keys = undefined; }
  }
  async requestJoin(id: string) {
    this.check();
    const keyPackage = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage: this.#keys!.publicPackage }));
    const request = { id, profile: this.identity, keyPackage, signature: await this.sign("join", id, this.identity, keyPackage) };
    this.#joinRequest = request;
    return seal(this.invitation, `join:${id}`, request);
  }
  private async verifyProfile(profile: Profile) {
    if (!profile || !hexPattern.test(profile.id) || !hexPattern.test(profile.key) || !nicknamePattern.test(profile.nickname) || profile.id !== digest(unhex(profile.key))) throw new Error("Invalid participant identity.");
    await this.verify(profile.key, profile.signature, "profile", profile.id, profile.key, profile.nickname);
  }
  private async validateProfiles(profiles: Profile[], state: ClientState, admissions: Admission[]) {
    if (!Array.isArray(profiles) || profiles.length > MAX_MEMBERS) throw new Error("Invalid participant roster.");
    const keys = state.ratchetTree.flatMap(node => node?.nodeType === "leaf" ? [hex(node.leaf.signaturePublicKey)] : []);
    if (profiles.length !== keys.length || new Set(profiles.map(value => value.id)).size !== profiles.length || new Set(profiles.map(value => value.nickname.toLowerCase())).size !== profiles.length) throw new Error("Conflicting participant identities. No messages were displayed.");
    for (const profile of profiles) {
      await this.verifyProfile(profile);
      if (!keys.includes(profile.key)) throw new Error("Participant key does not belong to the MLS group.");
      const previous = this.#profiles.get(profile.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(profile)) throw new Error("A participant identity changed.");
    }
    if (!profiles.some(value => value.id === this.identity.id)) throw new Error("Your key is absent from this conversation.");
    const founder = profiles.find(profile => profile.key === this.invitation.founder);
    if (!founder || !Array.isArray(admissions) || admissions.length !== profiles.length || new Set(admissions.map(value => value.member)).size !== admissions.length) throw new Error("The roster is not anchored to the founding key.");
    const certificates = new Map(admissions.map(value => [value.member, value]));
    for (const profile of profiles) {
      const certificate = certificates.get(profile.id), issuer = profiles.find(value => value.id === certificate?.by);
      if (!certificate || !issuer) throw new Error("Missing admission certificate.");
      await this.verify(issuer.key, certificate.signature, "admit", profile, issuer.id);
      const seen = new Set<string>(); let member = profile.id;
      while (member !== founder.id) {
        if (seen.has(member) || !certificates.has(member)) throw new Error("Admission does not descend from the founding key.");
        seen.add(member); member = certificates.get(member)!.by;
      }
      if (certificates.get(founder.id)?.by !== founder.id) throw new Error("Invalid founding certificate.");
    }
  }
  async inspectJoin(id: string, sealed: string) {
    const request = await unseal<JoinRequest>(this.invitation, `join:${id}`, sealed);
    if (request.id !== id || !idPattern.test(id)) throw new Error("Mismatched join request.");
    await this.verifyProfile(request.profile);
    await this.verify(request.profile.key, request.signature, "join", id, request.profile, request.keyPackage);
    if (this.#profiles.size >= MAX_MEMBERS || this.profiles.some(value => value.id === request.profile.id || value.nickname.toLowerCase() === request.profile.nickname.toLowerCase())) throw new Error("That nickname is already in this conversation. Choose another.");
    const parsed = readWire(request.keyPackage);
    if (parsed.wireformat !== "mls_key_package" || hex(parsed.keyPackage.leafNode.signaturePublicKey) !== request.profile.key || parsed.keyPackage.cipherSuite !== SUITE) throw new Error("Join key mismatch.");
    // Apply only the proposal-validation stage to a disposable copy. It does not
    // encrypt a handshake or consume an outbound generation.
    const probe = clone(this.#state!);
    try {
      const checked = await applyProposals(probe, [{ proposalOrRefType: "proposal", proposal: { proposalType: "add", add: { keyPackage: structuredClone(parsed.keyPackage) } } }], toLeafIndex(probe.privatePath.leafIndex), emptyPskIndex, true, this.#suite);
      wipe(checked);
    } finally { wipe(probe); }
    return { request, keyPackage: parsed.keyPackage };
  }
  private installCandidate(working: ClientState, result: { newState: ClientState; consumed: Uint8Array[] }) {
    if (this.#closed || Date.now() >= this.invitation.expires) { wipe(working); wipe(result.newState); this.check(); }
    result.consumed.forEach(value => value.fill(0));
    this.#candidate = clone(result.newState);
    wipe(working); wipe(result.newState);
  }
  async prepareAdd(id: string, sealed: string): Promise<PreparedPacket> {
    this.check(); if (this.#candidate) throw new Error("A packet is awaiting acknowledgement.");
    const { request, keyPackage } = await this.inspectJoin(id, sealed), working = clone(this.#state!);
    try {
      const result = await createCommit({ state: working, cipherSuite: this.#suite }, { extraProposals: [{ proposalType: "add", add: { keyPackage } }], ratchetTreeExtension: true });
      if (!result.welcome) throw new Error("Missing MLS welcome.");
      const profiles = [...this.profiles, request.profile];
      const admissions = [...this.#admissions.values(), { member: request.profile.id, by: this.identity.id, signature: await this.sign("admit", request.profile, this.identity.id) }];
      await this.validateProfiles(profiles, result.newState, admissions);
      const welcome = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }));
      const requestHash = digest(JSON.stringify(request));
      const signature = await this.sign("welcome", id, requestHash, welcome, profiles, admissions, this.identity.id);
      const packet = { wire: b64(encodeMlsMessage(result.commit)), bootstrap: await seal(this.invitation, "roster", { profiles, admissions }), welcome: await seal(this.invitation, `welcome:${id}`, { id, requestHash, welcome, profiles, admissions, signer: this.identity.id, signature }), commit: true };
      this.installCandidate(working, result); return packet;
    } finally { wipe(working); }
  }
  async acceptWelcome(sealed: string) {
    this.check(); if (this.#state || !this.#keys || !this.#joinRequest) throw new Error("Unexpected MLS welcome.");
    const request = this.#joinRequest;
    const bundle = await unseal<WelcomeBundle>(this.invitation, `welcome:${request.id}`, sealed);
    if (bundle.id !== request.id || bundle.requestHash !== digest(JSON.stringify(request))) throw new Error("Welcome does not match your one-time key package.");
    const wire = readWire(bundle.welcome); if (wire.wireformat !== "mls_welcome") throw new Error("Expected MLS welcome.");
    const state = await joinGroup(wire.welcome, this.#keys.publicPackage, structuredClone(this.#keys.privatePackage), emptyPskIndex, this.#suite, undefined, undefined, config);
    try {
      if (hex(state.groupContext.groupId) !== this.invitation.room) throw new Error("Wrong MLS group.");
      await this.validateProfiles(bundle.profiles, state, bundle.admissions);
      const signer = bundle.profiles.find(profile => profile.id === bundle.signer);
      if (!signer || signer.id === this.identity.id) throw new Error("Invalid welcome signer.");
      await this.verify(signer.key, bundle.signature, "welcome", bundle.id, bundle.requestHash, bundle.welcome, bundle.profiles, bundle.admissions, bundle.signer);
      this.check(); this.#state = clone(state); this.#profiles = new Map(bundle.profiles.map(profile => [profile.id, profile]));
      this.#admissions = new Map(bundle.admissions.map(value => [value.member, value]));
      wipe(this.#keys); this.#keys = undefined; this.#joinRequest = undefined;
    } finally { wipe(state); }
  }
  async prepareRefresh(): Promise<PreparedPacket> {
    this.check(); if (this.#candidate) throw new Error("A packet is awaiting acknowledgement.");
    const working = clone(this.#state!);
    try {
      const result = await createCommit({ state: working, cipherSuite: this.#suite });
      const wire = b64(encodeMlsMessage(result.commit)); this.installCandidate(working, result); return { wire, commit: true };
    } finally { wipe(working); }
  }
  async prepareText(id: string, body: string): Promise<PreparedPacket> {
    this.check(); if (this.#candidate) throw new Error("A packet is awaiting acknowledgement.");
    if (!idPattern.test(id) || typeof body !== "string" || !body.trim() || body.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) throw new Error("Invalid message text.");
    const payload = { id, sender: this.identity.id, body, epoch: this.epoch, signature: await this.sign("text", id, this.identity.id, body, this.epoch) };
    const working = clone(this.#state!), plaintext = utf8(JSON.stringify(payload));
    try {
      const result = await createApplicationMessage(working, plaintext, this.#suite);
      const wire = b64(encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage }));
      this.installCandidate(working, result); return { wire, commit: false };
    } finally { wipe(working); plaintext.fill(0); }
  }
  async confirm(bootstrap?: string) {
    if (!this.#candidate) throw new Error("Missing pending state.");
    if (bootstrap) {
      const { profiles, admissions } = await unseal<Roster>(this.invitation, "roster", bootstrap);
      await this.validateProfiles(profiles, this.#candidate, admissions); this.#profiles = new Map(profiles.map(profile => [profile.id, profile]));
      this.#admissions = new Map(admissions.map(value => [value.member, value]));
    }
    this.check(); wipe(this.#state); this.#state = this.#candidate; this.#candidate = undefined;
  }
  async receive(id: string, value: string, bootstrap?: string): Promise<SignedText | undefined> {
    this.check(); if (this.#candidate) throw new Error("Pending write must be resolved first.");
    const wire = readWire(value);
    if (wire.wireformat !== "mls_private_message" || wire.privateMessage.epoch !== this.#state!.groupContext.epoch) throw new Error("Only current-epoch private MLS messages are accepted.");
    const working = clone(this.#state!);
    try {
      let authenticatedSender = "";
      const result = wire.privateMessage.contentType === "application" ? await (async () => {
        const opened = await authenticatedApplication(working, wire.privateMessage, this.#suite);
        authenticatedSender = hex(opened.senderKey);
        return { ...opened, kind: "applicationMessage" as const };
      })() : await processMessage(wire, working, emptyPskIndex, incoming => {
        // This product supports only member updates and a single member admission.
        if (incoming.kind !== "commit" || incoming.senderLeafIndex === undefined || incoming.proposals.length > 1 || incoming.proposals.some(value => value.proposal.proposalType !== "add")) return "reject";
        return "accept";
      }, this.#suite);
      let message: SignedText | undefined;
      if (result.kind === "applicationMessage") {
        try { message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.message)) as SignedText; }
        finally { result.message.fill(0); }
        const profile = this.#profiles.get(message.sender);
        if (!profile || profile.key !== authenticatedSender || message.epoch !== this.epoch || message.id !== id || typeof message.body !== "string" || !message.body.trim() || message.body.length > MAX_TEXT) throw new Error("Message identity or context mismatch.");
        await this.verify(profile.key, message.signature, "text", id, message.sender, message.body, message.epoch);
        if (bootstrap) throw new Error("Unexpected roster on application message.");
      } else if (result.actionTaken !== "accept") throw new Error("Unsupported MLS operation.");
      const { profiles, admissions } = bootstrap ? await unseal<Roster>(this.invitation, "roster", bootstrap) : { profiles: this.profiles, admissions: [...this.#admissions.values()] };
      await this.validateProfiles(profiles, result.newState, admissions);
      this.installCandidate(working, result); await this.confirm();
      this.#profiles = new Map(profiles.map(profile => [profile.id, profile]));
      this.#admissions = new Map(admissions.map(value => [value.member, value])); return message;
    } finally { wipe(working); }
  }
  close() {
    this.#closed = true; wipe(this.#state); wipe(this.#candidate); wipe(this.#keys); wipe(this.#signKey);
    this.#state = undefined; this.#candidate = undefined; this.#keys = undefined; this.#joinRequest = undefined;
    this.#profiles.clear(); this.#admissions.clear(); this.invitation = { room: "", secret: "", founder: "", expires: 0 };
  }
}
