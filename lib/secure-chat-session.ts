import { SecureChatClient, ChatApiError } from "./secure-chat-client.ts";
import { digest, randomId } from "./secure-chat-mls.ts";
import { type ChatInvitation, type ChatView, type MessageReference, type Reaction } from "./secure-chat-protocol.ts";

export interface ChatSession {
  readonly view: ChatView;
  readonly invitation: ChatInvitation;
  readonly closed: boolean;
  readonly mirrored: boolean;
  readonly pollingError?: string;
  poll(): Promise<void>;
  send(body: string, replyTo?: MessageReference): Promise<void>;
  react(target: MessageReference, emoji: Reaction | null): Promise<void>;
  close(): void | Promise<void>;
  detach(): void;
}
// Same-origin UI bridge. The locked owner is the only active MLS writer.
// Private keys and relay tokens never cross this channel; recovery uses the vault.
const sessionName = (invite: ChatInvitation) => `disroot-chat-live-${digest(JSON.stringify([invite.room, invite.secret, invite.founder, invite.expires]))}`;
type Rpc = { id: string; method: "view" | "poll" | "send" | "react" | "close"; body?: string; target?: MessageReference; emoji?: Reaction | null };
type Response = { id: string; view?: ChatView; closed: boolean; error?: string; status?: number };
const validRpc = (value: unknown): value is Rpc => !!value && typeof value === "object" && "id" in value && typeof value.id === "string" && /^[0-9a-f]{32}$/.test(value.id) && "method" in value && ["view", "poll", "send", "react", "close"].includes(String(value.method));

export function ownChatSession(client: SecureChatClient, releaseWriter?: () => void): ChatSession {
  const invite = client.invitation;
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(sessionName(invite)) : undefined;
  let stopped = false, pending = 0;
  const close = () => {
    if (stopped) return;
    stopped = true; channel?.postMessage({ ended: true }); channel?.close();
    // Another writer may claim the session only after its local record is gone.
    return client.close().finally(() => releaseWriter?.());
  };
  if (channel) channel.onmessage = async ({ data }: MessageEvent<unknown>) => {
    if (!validRpc(data) || stopped) return;
    const command = data;
    if (pending >= 8) { channel.postMessage({ id: command.id, closed: false, error: "Too many requests. Retry shortly.", status: 429 }); return; }
    pending++;
    try {
      if (command.method === "close") { close(); return; }
      if (command.method === "poll") await client.poll();
      if (command.method === "send") await client.send(command.body!, command.target);
      if (command.method === "react") await client.react(command.target!, command.emoji!);
      if (!stopped) channel.postMessage({ id: command.id, view: client.view, closed: client.closed });
    } catch (error) {
      if (!stopped) channel.postMessage({ id: command.id, closed: client.closed, error: error instanceof Error ? error.message : "Connection interrupted.", status: error instanceof ChatApiError ? error.status : undefined });
    } finally { pending--; }
  };
  return {
    get view() { return client.view; }, get invitation() { return client.invitation; }, get closed() { return client.closed; }, mirrored: false,
    poll: () => client.poll(), send: (body, target) => client.send(body, target), react: (target, emoji) => client.react(target, emoji), close,
    detach: () => { if (!releaseWriter) { close(); return; } if (!stopped) { stopped = true; channel?.close(); client.suspend(); releaseWriter(); } },
  };
}

export async function resumeChatSession(invite: ChatInvitation): Promise<ChatSession | null> {
  if (typeof BroadcastChannel === "undefined" || invite.expires <= Date.now()) return null;
  const channel = new BroadcastChannel(sessionName(invite));
  let stopped = false, view: ChatView | undefined;
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const detach = () => {
    if (stopped) return;
    stopped = true; view = undefined; channel.close();
    for (const work of pending.values()) { clearTimeout(work.timer); work.reject(new ChatApiError("The original chat tab has closed. Its keys are no longer available.", 409)); }
    pending.clear();
  };
  channel.onmessage = ({ data }: MessageEvent<Response & { ended?: boolean }>) => {
    if (!data || typeof data !== "object") return;
    if (data.ended) { detach(); return; }
    const work = pending.get(data.id);
    if (!work) return;
    pending.delete(data.id); clearTimeout(work.timer);
    if (data.closed) { work.reject(new ChatApiError(data.error ?? "This conversation has ended. Its keys have been discarded.", 409)); detach(); return; }
    if (data.error) { work.reject(new ChatApiError(data.error, data.status ?? 503)); return; }
    if (!data.view || data.view.expires !== invite.expires || !data.view.members?.some(member => member.id === data.view!.identity.id)) { work.reject(new ChatApiError("Connection interrupted.", 503)); return; }
    view = data.view; work.resolve();
  };
  const request = (command: Omit<Rpc, "id">, timeout = 20_000) => new Promise<void>((resolve, reject) => {
    if (stopped || invite.expires <= Date.now()) { detach(); reject(new ChatApiError("This conversation has ended. Its keys have been discarded.", 409)); return; }
    if (pending.size >= 8) { reject(new ChatApiError("Too many requests. Retry shortly.", 429)); return; }
    const id = randomId();
    const timer = setTimeout(() => { pending.delete(id); reject(new ChatApiError(command.method === "send" || command.method === "react" ? "Delivery from the original tab is unconfirmed. Check the conversation before retrying." : "The original tab is not responding. Keep it open to use this session.", 503)); }, timeout);
    pending.set(id, { resolve, reject, timer }); channel.postMessage({ ...command, id });
  });
  try { await request({ method: "view" }, 1500); }
  catch { detach(); return null; }
  return {
    get view() { if (!view) throw new Error("This conversation has ended. Its keys have been discarded."); return structuredClone(view); },
    get invitation() { return { ...invite }; }, get closed() { return stopped; }, mirrored: true,
    poll: () => request({ method: "poll" }), send: (body, target) => request({ method: "send", body, target }), react: (target, emoji) => request({ method: "react", target, emoji }),
    close: () => { if (!stopped) channel.postMessage({ id: randomId(), method: "close" }); detach(); }, detach,
  };
}
