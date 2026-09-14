"use client";

import { useEffect, useRef, useState } from "react";
import { REACTIONS, prettyFingerprint, type ReadableMessage, type Reaction } from "@/lib/secure-chat-protocol";
import { useChatLanguage } from "./chat-language";

export function ChatMessage({ message, original, own, grouped, identity, busy, onReply, onReact }: {
  message: ReadableMessage; original?: ReadableMessage; own: boolean; grouped: boolean; identity: string; busy: boolean;
  onReply: () => void; onReact: (emoji: Reaction | null) => void;
}) {
  const { language, t } = useChatLanguage();
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ownReaction = message.reactions.find(value => value.sender === identity)?.emoji;
  const emojiOnly = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(message.body) && [...message.body].length <= 24;
  useEffect(() => {
    if (!actionsOpen) return;
    actionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    actionsRef.current?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setActionsOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [actionsOpen]);
  const react = (emoji: Reaction) => {
    onReact(ownReaction === emoji ? null : emoji); setActionsOpen(false); triggerRef.current?.focus();
  };
  const jump = () => {
    if (!original) return;
    const target = document.getElementById(`chat-msg-${original.id}`);
    target?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target?.focus({ preventScroll: true });
  };
  return <article id={`chat-msg-${message.id}`} tabIndex={-1} className={`chat-message-row${own ? " is-own" : ""}${grouped ? " is-grouped" : ""}`}>
    <span className="chat-message-avatar" aria-hidden="true">{message.nickname.slice(0, 2).toUpperCase()}</span>
    <div className="chat-message-stack">
      <div className="chat-message">
        <header><strong title={prettyFingerprint(message.sender)}>{message.nickname}</strong>{own && <span className="chat-message-self">{t("you", "вы")}</span>}<span className="chat-message-key-id" title={prettyFingerprint(message.sender)}>{message.sender.slice(-8).toUpperCase()}</span></header>
        {message.replyTo && <button type="button" className="chat-message-quote" disabled={!original} onClick={jump} aria-label={original ? t(`Go to message from ${original.nickname}`, `Перейти к сообщению ${original.nickname}`) : undefined}>
          <strong>{original?.nickname ?? t("Earlier message", "Предыдущее сообщение")}</strong>
          <span>{original?.body ?? t("Not available in this tab", "Недоступно в этой вкладке")}</span>
        </button>}
        <p className={emojiOnly ? "chat-emoji-message" : undefined}>{message.body}</p>
        <footer><time dateTime={message.time}>{new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.time))}</time><span className="chat-message-verified" title={t("Signature checked", "Подпись проверена")} aria-label={t("Signature checked", "Подпись проверена")}>✓</span>
          <button type="button" ref={triggerRef} className="chat-message-action" aria-label={t(`Message actions: ${message.nickname}`, `Действия с сообщением: ${message.nickname}`)} aria-expanded={actionsOpen} aria-controls={`chat-actions-${message.id}`} onClick={() => setActionsOpen(value => !value)}><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
        </footer>
      </div>
      {actionsOpen && <div id={`chat-actions-${message.id}`} className="chat-message-actions" ref={actionsRef} role="group" aria-label={t("Reply or react", "Ответить или поставить реакцию")} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setActionsOpen(false); triggerRef.current?.focus(); } }}>
        <button type="button" className="chat-reply-action" disabled={busy} onClick={() => { setActionsOpen(false); onReply(); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5-6 6 6 6M3 11h10a8 8 0 0 1 8 8" /></svg>{t("Reply", "Ответить")}</button>
        <div className="chat-quick-reactions">{REACTIONS.map(emoji => <button key={emoji} type="button" disabled={busy} aria-pressed={ownReaction === emoji} aria-label={`${ownReaction === emoji ? t("Remove reaction", "Убрать реакцию") : t("React", "Реакция")} ${emoji}`} onClick={() => react(emoji)}>{emoji}</button>)}</div>
      </div>}
      {!!message.reactions.length && <div className="chat-reaction-chips" role="group" aria-label={t("Reactions", "Реакции")}>{REACTIONS.map(emoji => {
        const count = message.reactions.filter(value => value.emoji === emoji).length;
        return count > 0 && <button type="button" key={emoji} disabled={busy} aria-pressed={ownReaction === emoji} aria-label={`${emoji}: ${count}. ${ownReaction === emoji ? t("Remove your reaction", "Убрать свою реакцию") : t("React", "Поставить реакцию")}`} onClick={() => react(emoji)}><span>{emoji}</span><span>{count}</span></button>;
      })}</div>}
    </div>
  </article>;
}
