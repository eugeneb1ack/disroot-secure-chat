import { SecureChatClient } from "./secure-chat-client.ts";
import type { ChatInvitation } from "./secure-chat-protocol.ts";
import { ownChatSession, resumeChatSession } from "./secure-chat-session.ts";
import { chatVault, savedChatId, savedInvitation } from "./secure-chat-vault.ts";

export async function holdChatWriter(invite: ChatInvitation): Promise<() => void> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("This browser cannot safely restore chat sessions. Use a browser with Web Locks and site storage enabled.");
  return new Promise((resolve, reject) => {
    void navigator.locks.request(`disroot-chat-writer-${savedChatId(invite)}`, { ifAvailable: true }, lock => {
      if (!lock) { reject(new Error("Your conversation is open in another tab. Wait for that tab to reconnect.")); return; }
      return new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}

// Every owner holds one origin-wide exclusive lock. Never steal a lock or load a
// second MLS writer when an existing owner is sleeping or temporarily unreachable.
export async function browserChatSession(invitation: ChatInvitation | null, credentials?: { nickname: string; name: string }, startFresh = false) {
  const invite = invitation ?? (startFresh ? null : await savedInvitation());
  if (invite) {
    const mirrored = await resumeChatSession(invite);
    if (mirrored) return mirrored;
    const release = await holdChatWriter(invite);
    let client: SecureChatClient | undefined;
    try {
      const { saved, storage } = await chatVault(invite);
      if (saved) client = await SecureChatClient.restore(saved, storage);
      else if (credentials) {
        client = await SecureChatClient.connect(credentials.nickname, credentials.name, invite, location.origin);
        await client.persistWith(storage);
      } else { release(); return null; }
      return ownChatSession(client, release);
    } catch (error) { await client?.close(); release(); throw error; }
  }
  if (!credentials) return null;
  // No invitation is exposed before its first durable checkpoint has completed.
  const client = await SecureChatClient.connect(credentials.nickname, credentials.name, null, location.origin);
  let release: (() => void) | undefined;
  try {
    release = await holdChatWriter(client.invitation);
    const { storage } = await chatVault(client.invitation);
    await client.persistWith(storage);
    return ownChatSession(client, release);
  } catch (error) { await client.close(); release?.(); throw error; }
}
