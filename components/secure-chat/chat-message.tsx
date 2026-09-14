"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { REACTIONS, prettyFingerprint, type ReadableMessage, type Reaction } from "@/lib/secure-chat-protocol";
import { ChatPopover } from "./chat-popover";
import { useChatLanguage } from "./chat-language";

export function ChatMessage({ message, original, own, grouped, identity, busy, onReply, onReact }: {
  message: ReadableMessage; original?: ReadableMessage; own: boolean; grouped: boolean; identity: string; busy: boolean;
  onReply: () => void; onReact: (emoji: Reaction | null) => void;
}) {
  const { language, t } = useChatLanguage();
  const [actionsOpen, setActionsOpen] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [copyStatus, setCopyStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ownReaction = message.reactions.find(value => value.sender === identity)?.emoji;
  const emojiOnly = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(message.body) && [...message.body].length <= 24;
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => {
    const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => { cancel(); window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", cancel); };
  }, []);
  const showActions = () => { setCopyStatus(""); setActionsOpen(true); };
  const startPress = (event: ReactPointerEvent) => {
    cancelPress(); suppressClick.current = false;
    if (!event.isPrimary || event.pointerType === "mouse" || event.target instanceof Element && event.target.closest("button, a")) return;
    const pending = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressClick.current = true; showActions();
    }, 480) };
    press.current = pending;
  };
  const movePress = (event: ReactPointerEvent) => {
    const pending = press.current;
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10) cancelPress();
  };
  const react = (emoji: Reaction) => {
    onReact(ownReaction === emoji ? null : emoji); setActionsOpen(false); triggerRef.current?.focus({ preventScroll: true });
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
      <div className={`chat-message${actionsOpen ? " is-selected" : ""}`}
        onPointerDown={startPress} onPointerMove={movePress} onPointerUp={cancelPress} onPointerCancel={cancelPress}
        onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
        onContextMenu={event => {
          if (event.target instanceof Element && event.target.closest("button, a")) return;
          event.preventDefault(); cancelPress(); showActions();
        }}>
        <header><strong title={prettyFingerprint(message.sender)}>{message.nickname}</strong>{own && <span className="chat-message-self">{t("you", "вы")}</span>}<span className="chat-message-key-id" title={prettyFingerprint(message.sender)}>{message.sender.slice(-8).toUpperCase()}</span></header>
        {message.replyTo && <button type="button" className="chat-message-quote" disabled={!original} onClick={jump} aria-label={original ? t(`Go to message from ${original.nickname}`, `Перейти к сообщению ${original.nickname}`) : undefined}>
          <strong>{original?.nickname ?? t("Earlier message", "Предыдущее сообщение")}</strong>
          <span>{original?.body ?? t("Not available in this tab", "Недоступно в этой вкладке")}</span>
        </button>}
        <p className={emojiOnly ? "chat-emoji-message" : undefined}>{message.body}</p>
        <footer><time dateTime={message.time}>{new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.time))}</time><span className="chat-message-verified" title={t("Signature checked", "Подпись проверена")} aria-label={t("Signature checked", "Подпись проверена")}>✓</span>
          <button type="button" ref={triggerRef} className="chat-message-action" aria-label={t(`Message actions: ${message.nickname}`, `Действия с сообщением: ${message.nickname}`)} aria-haspopup="dialog" aria-expanded={actionsOpen} aria-controls={`chat-actions-${message.id}`} onClick={() => { setCopyStatus(""); setActionsOpen(value => !value); }}><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
        </footer>
      </div>
      {actionsOpen && <ChatPopover id={`chat-actions-${message.id}`} className="chat-message-actions" label={t(`Message from ${message.nickname}`, `Сообщение ${message.nickname}`)} anchor={triggerRef} placement="message" onClose={() => setActionsOpen(false)}>
        <div className="chat-quick-reactions" role="group" aria-label={t("Reactions", "Реакции")}>{REACTIONS.map(emoji => <button key={emoji} type="button" disabled={busy} aria-pressed={ownReaction === emoji} aria-label={`${ownReaction === emoji ? t("Remove reaction", "Убрать реакцию") : t("React", "Реакция")} ${emoji}`} onClick={() => react(emoji)}>{emoji}</button>)}</div>
        <div className="chat-message-commands">
          <button type="button" className="chat-reply-action" onClick={() => { setActionsOpen(false); onReply(); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5-6 6 6 6M3 11h10a8 8 0 0 1 8 8" /></svg>{t("Reply", "Ответить")}</button>
          <button type="button" className="chat-reply-action" onClick={async () => {
            try { await navigator.clipboard.writeText(message.body); setActionsOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
            catch { setCopyStatus(t("Copy unavailable. Select the text on desktop.", "Копирование недоступно. Выделите текст на компьютере.")); }
          }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>{t("Copy text", "Скопировать текст")}</button>
        </div>
        {copyStatus && <p className="chat-popover-status" role="status">{copyStatus}</p>}
      </ChatPopover>}
      {!!message.reactions.length && <div className="chat-reaction-chips" role="group" aria-label={t("Reactions", "Реакции")}>{REACTIONS.map(emoji => {
        const count = message.reactions.filter(value => value.emoji === emoji).length;
        return count > 0 && <button type="button" key={emoji} disabled={busy} aria-pressed={ownReaction === emoji} aria-label={`${emoji}: ${count}. ${ownReaction === emoji ? t("Remove your reaction", "Убрать свою реакцию") : t("React", "Поставить реакцию")}`} onClick={() => react(emoji)}><span>{emoji}</span><span>{count}</span></button>;
      })}</div>}
    </div>
  </article>;
}
