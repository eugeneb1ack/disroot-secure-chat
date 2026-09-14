import { hexPattern, idPattern, MAX_MEMBERS, MAX_TEXT, REACTIONS, type MessageInteraction, type MessageReference, type ReadableMessage } from "./secure-chat-protocol.ts";

export function validMessageText(body: unknown): body is string {
  return typeof body === "string" && !!body.trim() && body.length <= MAX_TEXT && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body);
}
export function validReference(value: unknown): value is MessageReference {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return Object.keys(ref).length === 2 && typeof ref.id === "string" && idPattern.test(ref.id) && typeof ref.sender === "string" && hexPattern.test(ref.sender);
}
export function validInteraction(value: unknown): value is MessageInteraction {
  if (!value || typeof value !== "object") return false;
  const interaction = value as Record<string, unknown>;
  return validReference(interaction.target) && (
    interaction.kind === "reply" && Object.keys(interaction).length === 2 ||
    interaction.kind === "reaction" && Object.keys(interaction).length === 3 && (interaction.emoji === null || REACTIONS.some(emoji => emoji === interaction.emoji))
  );
}
// A fixed-order signature input; never sign object insertion order.
export function interactionFields(value: MessageInteraction) {
  return [value.kind, value.target.id, value.target.sender, value.kind === "reaction" ? value.emoji : null];
}
export function reactionFallback(emoji: string | null) { return emoji === null ? "Removed a reaction." : `Reacted ${emoji}`; }
export function findMessage(messages: ReadableMessage[], target: MessageReference) {
  return messages.find(message => message.id === target.id && message.sender === target.sender);
}
export function applyMessageEvent(messages: ReadableMessage[], event: { id: string; sender: string; body: string; interaction?: MessageInteraction }, nickname: string, time: string) {
  if (event.interaction?.kind === "reaction") {
    const target = findMessage(messages, event.interaction.target);
    // No queue for unknown targets: newcomers do not receive historical content.
    if (!target) return;
    target.reactions = target.reactions.filter(value => value.sender !== event.sender);
    if (event.interaction.emoji !== null && target.reactions.length < MAX_MEMBERS) target.reactions.push({ sender: event.sender, emoji: event.interaction.emoji });
    return;
  }
  if (messages.some(message => message.id === event.id)) return;
  messages.push({ id: event.id, sender: event.sender, body: event.body, nickname, time, reactions: [], ...(event.interaction?.kind === "reply" ? { replyTo: { ...event.interaction.target } } : {}) });
  if (messages.length > 256) messages.shift();
}
