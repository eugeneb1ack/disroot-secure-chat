import type { ChatInvitation } from "./secure-chat-protocol.ts";
import type { ChatSession } from "./secure-chat-session.ts";
import { startChatPolling } from "./secure-chat-polling.ts";

// One live session per document. Route views never own its lifetime. The browser
// session adapter checkpoints before publication and suspends on pagehide.
let active: ChatSession | undefined;
let stop: (() => void) | undefined;
const matches = (a: ChatInvitation, b: ChatInvitation) => a.room === b.room && a.secret === b.secret && a.founder === b.founder && a.expires === b.expires;

export function currentChatSession(invite?: ChatInvitation | null) {
  if (active?.closed || active && active.invitation.expires <= Date.now()) { active.close(); active = undefined; stop?.(); stop = undefined; }
  if (active && invite && !matches(active.invitation, invite)) throw new Error("Another conversation is open in this tab. End it before opening a different invitation.");
  return active ?? null;
}

export function retainChatSession(session: ChatSession): ChatSession {
  const previous = currentChatSession(session.invitation);
  if (previous) { if (previous !== session) session.detach(); return previous; }
  const close = () => { stop?.(); stop = undefined; active = undefined; return session.close(); };
  const pagehide = () => { stop?.(); stop = undefined; active = undefined; session.detach(); };
  let pollingError: string | undefined;
  const poll = async () => {
    try { await session.poll(); pollingError = undefined; }
    catch (error) { pollingError = error instanceof Error ? error.message : "Connection interrupted."; throw error; }
  };
  active = {
    get view() { return session.view; }, get invitation() { return session.invitation; }, get closed() { return session.closed; }, mirrored: session.mirrored,
    get pollingError() { return pollingError; },
    poll, send: (body, target) => session.send(body, target), react: (target, emoji) => session.react(target, emoji), close,
    // Detaching a route view does not destroy the document's live session.
    detach: () => {},
  };
  const events = typeof window === "undefined" ? undefined : { window, document };
  const halt = startChatPolling(async () => { if (session.closed) { pagehide(); return; } await poll(); }, 2000, events);
  events?.window.addEventListener("pagehide", pagehide);
  stop = () => { halt(); events?.window.removeEventListener("pagehide", pagehide); };
  return active;
}
