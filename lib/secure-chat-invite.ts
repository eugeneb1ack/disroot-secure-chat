import { CHAT_TTL, hexPattern, idPattern, type ChatInvitation } from "./secure-chat-protocol.ts";
export type { ChatInvitation } from "./secure-chat-protocol.ts";
export function parseInvitation(hash: string, now = Date.now()): ChatInvitation | null {
  if (!hash.startsWith("#secure-chat?") || hash.length > 330) return null;
  const values = new URLSearchParams(hash.slice(13));
  if ([...values].length !== 5 || values.get("v") !== "2") return null;
  const room = values.get("room") ?? "", secret = values.get("key") ?? "", founder = values.get("founder") ?? "";
  const expires = Number(values.get("until"));
  if (!idPattern.test(room) || !hexPattern.test(secret) || !hexPattern.test(founder) || !Number.isSafeInteger(expires) || expires <= now || expires > now + CHAT_TTL) return null;
  return { room, secret, founder, expires };
}
export function invitationLink(origin: string, invitation: ChatInvitation, path: "/" | "/secure-chat" = "/secure-chat") {
  const values = new URLSearchParams({ v: "2", room: invitation.room, key: invitation.secret, founder: invitation.founder, until: String(invitation.expires) });
  return `${origin}${path}#secure-chat?${values}`;
}
