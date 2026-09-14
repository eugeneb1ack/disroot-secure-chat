import type { ChatCheckpoint, ChatPersistence } from "./secure-chat-client.ts";
import type { ChatInvitation } from "./secure-chat-protocol.ts";
import { CHAT_TTL } from "./secure-chat-protocol.ts";
import { digest, utf8 } from "./secure-chat-mls.ts";

const DB_NAME = "disroot-chat-sessions-v1";
const MAX_BYTES = 4_000_000;
export const savedChatId = (invite: ChatInvitation) => digest(JSON.stringify([invite.room, invite.secret, invite.founder, invite.expires]));
export type VaultRecord = { id: string; expires: number; revision: number; updated: number; key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
const aad = (record: Pick<VaultRecord, "id" | "expires" | "revision">) => utf8(JSON.stringify(["local-session-v1", record.id, record.expires, record.revision]));
const storageError = () => new Error("Browser session storage is unavailable. Allow site storage to keep this conversation after a reload.");

export async function sealCheckpoint(value: ChatCheckpoint, key: CryptoKey, revision: number): Promise<VaultRecord> {
  const expires = value.mls.invitation.expires;
  if (expires <= Date.now() || expires > Date.now() + CHAT_TTL || key.extractable || key.algorithm.name !== "AES-GCM") throw new Error("Invalid local session protection.");
  const record = { id: savedChatId(value.mls.invitation), expires, revision, updated: Date.now(), key, iv: crypto.getRandomValues(new Uint8Array(12)) };
  const plain = utf8(JSON.stringify(value));
  try {
    if (plain.length > MAX_BYTES) throw new Error("Saved conversation exceeds the browser storage limit.");
    return { ...record, ciphertext: await crypto.subtle.encrypt({ name: "AES-GCM", iv: record.iv, additionalData: aad(record) }, key, plain) };
  } finally { plain.fill(0); }
}
export async function openCheckpoint(record: VaultRecord): Promise<ChatCheckpoint> {
  if (!/^[0-9a-f]{64}$/.test(record.id) || record.expires <= Date.now() || record.expires > Date.now() + CHAT_TTL || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.key.extractable || record.key.algorithm.name !== "AES-GCM" || record.iv.byteLength !== 12 || record.ciphertext.byteLength > MAX_BYTES + 16) throw new Error("Invalid or expired saved conversation.");
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: aad(record) }, record.key, record.ciphertext));
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)) as ChatCheckpoint;
    if (value.version !== 1 || savedChatId(value.mls.invitation) !== record.id || value.mls.invitation.expires !== record.expires) throw new Error("Saved conversation does not match this invitation.");
    return value;
  } finally { plain.fill(0); }
}
async function database() {
  if (typeof indexedDB === "undefined") throw storageError();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions", { keyPath: "id" });
    request.onerror = () => reject(storageError()); request.onblocked = () => reject(storageError());
    request.onsuccess = () => resolve(request.result);
  });
}
async function readRecords(): Promise<VaultRecord[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite", { durability: "strict" }), store = tx.objectStore("sessions"), rows: VaultRecord[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      const value = cursor.value as VaultRecord;
      if (value.expires <= Date.now()) cursor.delete(); else rows.push(value);
      cursor.continue();
    };
    tx.oncomplete = () => { db.close(); resolve(rows.sort((a, b) => b.updated - a.updated)); };
    tx.onabort = tx.onerror = () => { db.close(); reject(storageError()); };
  });
}
async function removeRecord(id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite", { durability: "strict" }); tx.objectStore("sessions").delete(id);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = tx.onerror = () => { db.close(); reject(storageError()); };
  });
}
export async function savedInvitation() {
  for (const record of await readRecords()) {
    try { return (await openCheckpoint(record)).mls.invitation; }
    catch { await removeRecord(record.id); }
  }
  return null;
}
// The caller holds the conversation's exclusive Web Lock for this object's lifetime.
export async function chatVault(invite: ChatInvitation): Promise<{ saved?: ChatCheckpoint; storage: ChatPersistence }> {
  const id = savedChatId(invite), rows = await readRecords(), record = rows.find(value => value.id === id);
  if (!record && rows.length >= 16) throw new Error("Too many saved conversations. End an existing session first.");
  let saved: ChatCheckpoint | undefined;
  try { if (record) saved = await openCheckpoint(record); }
  catch { await removeRecord(id); throw new Error("The saved conversation could not be verified. Its local copy was removed."); }
  const key = record?.key ?? await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  let revision = record?.revision ?? 0, closed = false, lastDigest = saved ? digest(JSON.stringify(saved)) : "";
  return { saved, storage: {
    async save(value) {
      if (closed || savedChatId(value.mls.invitation) !== id) throw new Error("Saved session has ended.");
      const fingerprint = digest(JSON.stringify(value)); if (fingerprint === lastDigest) return;
      const sealed = await sealCheckpoint(value, key, revision + 1);
      if (closed) throw new Error("Saved session has ended.");
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("sessions", "readwrite", { durability: "strict" }), store = tx.objectStore("sessions"), request = store.get(id);
        request.onsuccess = () => {
          if (closed || (request.result?.revision ?? 0) !== revision) { tx.abort(); return; }
          store.put(sealed);
        };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = tx.onerror = () => { db.close(); reject(storageError()); };
      });
      revision++; lastDigest = fingerprint;
    },
    async clear() { closed = true; await removeRecord(id); },
  } };
}
