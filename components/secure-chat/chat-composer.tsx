"use client";

import { animate } from "animejs";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { MAX_TEXT, prettyFingerprint, type Profile, type ReadableMessage } from "@/lib/secure-chat-protocol";
import { chatError, useChatLanguage } from "./chat-language";

const emojiGroups = [
  { en: "Faces", ru: "Эмоции", emoji: ["🙂", "😊", "😂", "😅", "🥹", "😎", "🤔", "🫠", "👀", "🤖", "👾", "💀"] },
  { en: "Reactions", ru: "Реакции", emoji: ["👍", "👋", "🙌", "🤝", "🫶", "❤️", "💚", "🔥", "✨", "🎉", "💯", "✅"] },
  { en: "More", ru: "Ещё", emoji: ["🔐", "🔑", "💻", "🛠️", "🐧", "🐛", "☕", "🍕", "🎮", "🎧", "🌙", "🚀"] },
];

export function ChatComposer({ draft, setDraft, reply, onCancelReply, onSend, onEnd, identity, ready, connected, busy, error }: {
  draft: string; setDraft: (value: string) => void; reply?: ReadableMessage; onCancelReply: () => void;
  onSend: (event: FormEvent) => void; onEnd: () => void; identity: Profile; ready: boolean; connected: boolean; busy: boolean; error: string;
}) {
  const { language, t } = useChatLanguage();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const replyId = reply?.id;
  useEffect(() => {
    const input = composerRef.current;
    if (input) { input.style.height = "0px"; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }
  }, [draft, ready]);
  useEffect(() => { if (replyId) composerRef.current?.focus(); }, [replyId]);
  useEffect(() => {
    if (!emojiOpen) return;
    const panel = emojiRef.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel?.contains(event.target) && !emojiButtonRef.current?.contains(event.target)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const animation = panel && !matchMedia("(prefers-reduced-motion: reduce)").matches ? animate(panel, { opacity: [0, 1], translateY: [8, 0], duration: 180, ease: "out(3)" }) : undefined;
    return () => { document.removeEventListener("pointerdown", outside); animation?.cancel(); };
  }, [emojiOpen]);
  const insertEmoji = (emoji: string) => {
    const { start, end } = selection.current;
    const value = draft.slice(0, start) + emoji + draft.slice(end);
    if (value.length > MAX_TEXT) return;
    const cursor = start + emoji.length;
    setDraft(value); setEmojiOpen(false);
    requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(cursor, cursor); selection.current = { start: cursor, end: cursor }; });
  };
  return <form className="chat-composer" onSubmit={onSend}>
    {emojiOpen && <div className="chat-emoji-picker" ref={emojiRef} role="dialog" aria-label={t("Choose an emoji", "Выбрать эмодзи")} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEmojiOpen(false); emojiButtonRef.current?.focus(); } }}><header><span>EMOJI</span><button type="button" className="chat-text-button" aria-label={t("Close emoji picker", "Закрыть панель эмодзи")} onClick={() => { setEmojiOpen(false); emojiButtonRef.current?.focus(); }}>×</button></header>{emojiGroups.map(group => <div key={group.en}><p>{t(group.en, group.ru)}</p><div className="chat-emoji-grid">{group.emoji.map(emoji => <button key={emoji} type="button" aria-label={`${t("Insert", "Вставить")} ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div></div>)}</div>}
    {error && <p className="chat-error" role="alert">{chatError(error, language)}</p>}
    <div className="chat-compose-surface">
      {reply && <div className="chat-reply-preview"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5-6 6 6 6M3 11h10a8 8 0 0 1 8 8" /></svg><div><strong>{t("Reply to", "Ответ для")} {reply.nickname}</strong><span>{reply.body}</span></div><button type="button" aria-label={t("Cancel reply", "Отменить ответ")} onClick={() => { onCancelReply(); composerRef.current?.focus(); }}>×</button></div>}
      <div className="chat-compose-row">
        <button className="chat-emoji-trigger" type="button" ref={emojiButtonRef} aria-label={t("Choose emoji", "Выбрать эмодзи")} aria-expanded={emojiOpen} disabled={!ready || busy} onClick={() => { const input = composerRef.current; if (input) selection.current = { start: input.selectionStart, end: input.selectionEnd }; setEmojiOpen(current => !current); }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 14c1 4 7 4 8 0M8 9h1m6 0h1" /></svg></button>
        <label className="chat-sr-only" htmlFor="chat-message">{t("Message", "Сообщение")}</label>
        <textarea id="chat-message" ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} onSelect={event => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} rows={1} maxLength={MAX_TEXT} disabled={!ready} readOnly={busy} placeholder={!ready ? t("Waiting for a participant…", "Ждём участника…") : t("Write a message…", "Написать сообщение…")} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          if (event.key === "Escape" && reply) { event.preventDefault(); event.stopPropagation(); onCancelReply(); }
        }} />
        <button className="chat-send-button" type="submit" disabled={!ready || !connected || !draft.trim() || busy} aria-label={t("Encrypt and send message", "Зашифровать и отправить сообщение")}>{busy ? <span className="chat-send-pending" aria-hidden="true">···</span> : <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 11 7-7 7 7M12 4v16" /></svg>}</button>
      </div>
    </div>
    <div className="chat-composer-foot"><span className="chat-current-alias" title={prettyFingerprint(identity.id)}><span aria-hidden="true">⌑</span> {identity.nickname}</span><span className="chat-compose-hint">{draft.length >= MAX_TEXT * .9 ? `${draft.length} / ${MAX_TEXT}` : t("Shift + Enter for a new line", "Shift + Enter — новая строка")}</span><button type="button" className="chat-text-button" onClick={onEnd}>{t("End session", "Завершить сессию")}</button></div>
  </form>;
}
