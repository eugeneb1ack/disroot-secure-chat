// Shared wire contract. No secrets, browser APIs or third-party dependencies.
export const PROTOCOL = "disroot-mls-v2";
export const CHAT_TTL = 86_400_000;
export const MAX_MEMBERS = 16;
export const MAX_TEXT = 4000;
export const PRESENCE_TTL = 20_000;
export const nicknamePattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{2,23}$/;
export const idPattern = /^[0-9a-f]{32}$/;
export const hexPattern = /^[0-9a-f]{64}$/;
export type ChatInvitation = { room: string; secret: string; founder: string; expires: number };
export type TransportPublicKey = { kty: "EC"; crv: "P-256"; x: string; y: string };
export type LoginRequest = { room: string; expires: number; capability: string; publicKey: TransportPublicKey; create: boolean; manifest?: string };
export type LoginChallenge = { id: string; expires: number; text: string };
export type RelayEvent = { seq: number; id: string; sender: string; wire: string; bootstrap?: string; time: number };
export type PendingJoin = { id: string; sealed: string };
export type RelayPresence = { id: string; online: boolean; ready: boolean };
export type RelaySnapshot = { expires: number; manifest: string; seq: number; events: RelayEvent[]; pending: PendingJoin[]; rejected?: string; welcome?: { sealed: string; seq: number }; ready: boolean; presence?: RelayPresence[] };
export type Profile = { id: string; nickname: string; key: string; signature: string; connection?: { id: string; signature: string } };
export const REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"] as const;
export type Reaction = typeof REACTIONS[number];
export type MessageReference = { id: string; sender: string };
export type MessageInteraction = { kind: "reply"; target: MessageReference } | { kind: "reaction"; target: MessageReference; emoji: Reaction | null };
export type ReadableMessage = { id: string; sender: string; nickname: string; body: string; time: string; replyTo?: MessageReference; reactions: { sender: string; emoji: Reaction }[] };
export type ChatView = { deliveryPending?: boolean; pendingMessage?: { id: string; body: string }; ready: boolean; name: string; expires: number; members: Profile[]; messages: ReadableMessage[]; identity: Profile; epoch: string; verification: string; presence?: { members: { id: string; status: "online" | "offline" | "unknown" | "connecting" }[]; joining: number; available: number } };
export function canonical(...fields: unknown[]) { return JSON.stringify([PROTOCOL, ...fields]); }
export function loginText(id: string, origin: string, expires: number, request: LoginRequest, capabilityHash: string) {
  return canonical("login", id, origin, expires, request.room, request.expires, request.create, request.publicKey.x, request.publicKey.y, capabilityHash, request.manifest ?? "");
}
export function prettyFingerprint(value: string) { return value.toUpperCase().match(/.{1,4}/g)?.join(" ") ?? value; }
