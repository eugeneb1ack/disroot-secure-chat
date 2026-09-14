"use client";

import dynamic from "next/dynamic";
import { animate, scrambleText } from "animejs";
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseInvitation, type ChatInvitation } from "@/lib/secure-chat-invite";
import { ChatLanguageProvider, ChatLanguageSwitch, useChatLanguage } from "./chat-language";

const ChatWindow = dynamic(() => import("./chat-window").then(module => module.ChatWindow), { ssr: false, loading: ChatLoading });
const invitations = [
  { lang: "en", text: "No account. Private. Anonymous." },
  { lang: "ru", text: "Без аккаунта. Приватно. Анонимно." },
  { lang: "ja", text: "アカウント不要。プライベート。匿名。" },
  { lang: "zh-CN", text: "无需账号。私密。匿名。" },
  { lang: "pt-BR", text: "Sem conta. Privado. Anônimo." },
  { lang: "es", text: "Sin cuenta. Privado. Anónimo." },
];

function ChatLoading() {
  const { t } = useChatLanguage();
  return <p className="chat-loading" role="status">{t("Opening encrypted channel…", "Открываем зашифрованный чат…")}</p>;
}

class ChatBoundary extends Component<{ children: ReactNode; errorMessage: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="chat-loading" role="alert">{this.props.errorMessage}</p> : this.props.children; }
}

function ChatDialogContent({ invitation, onConsumed, onClose }: { invitation: ChatInvitation | null; onConsumed: () => void; onClose: () => void }) {
  const { language, t } = useChatLanguage();
  return <div className="chat-dialog-content" lang={language}>
    <header className="chat-window-header"><div><p className="chat-eyebrow">dis/root · {t("encrypted conversations", "зашифрованные беседы")}</p><h2 id="secure-chat-title">Secure<span> Chat</span></h2></div><div className="chat-header-actions"><ChatLanguageSwitch /><button className="chat-icon-button" type="button" aria-label={t("Hide chat", "Свернуть чат")} onClick={onClose}>×</button></div></header>
    <ChatBoundary errorMessage={t("Could not open the chat. Close this window and try again.", "Не удалось открыть чат. Закройте окно и попробуйте ещё раз.")}><ChatWindow invitation={invitation} onInvitationConsumed={onConsumed} /></ChatBoundary>
  </div>;
}

export function SecureChatSection({ active, onOpenChange }: { active: boolean; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [invitation, setInvitation] = useState<ChatInvitation | null>(null);
  const consumeInvitation = useCallback(() => setInvitation(null), []);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const readLink = () => {
      const next = parseInvitation(location.hash);
      if (!next) return;
      // The fragment is never part of an HTTP request. Remove it from this history entry.
      history.replaceState(history.state, "", `${location.pathname}${location.search}#secure-chat`);
      setInvitation(next); setStarted(true); setOpen(true);
    };
    const timer = window.setTimeout(readLink, 0);
    window.addEventListener("hashchange", readLink);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", readLink); };
  }, []);

  useEffect(() => {
    const panel = previewRef.current;
    if (!panel) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let animations: Array<{ cancel: () => void }> = [];
    const stop = () => { animations.forEach(animation => animation.cancel()); animations = []; };
    const sync = () => {
      stop();
      if (!active || open || motion.matches || document.hidden) return;
      const sheen = panel.querySelector(".chat-panel-sheen");
      const stream = panel.querySelector(".chat-binary-stream");
      const route = panel.querySelectorAll(".secure-chat-preview-flow span");
      if (sheen) animations.push(animate(sheen, { translateX: ["-140%", "240%"], opacity: [0, .55, 0], duration: 3200, delay: 1100, loop: true, ease: "inOut(2)" }));
      if (stream) animations.push(animate(stream, { translateX: ["-6%", "6%"], opacity: [.3, .85, .3], duration: 4200, alternate: true, loop: true, ease: "inOut(2)" }));
      route.forEach((node, index) => animations.push(animate(node, { opacity: [.4, 1, .4], duration: 2200, delay: index * 360, loop: true, ease: "inOut(2)" })));
    };
    sync(); motion.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    return () => { stop(); motion.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [active, open]);

  useEffect(() => {
    const target = textRef.current;
    if (!target) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let animation: { cancel: () => void } | undefined;
    let timer = 0;
    let index = 0;
    const stop = () => { clearInterval(timer); animation?.cancel(); };
    const render = () => {
      animation?.cancel();
      target.lang = invitations[index].lang;
      animation = animate(target, { innerHTML: scrambleText({ chars: "01", cursor: "_", duration: 1100, text: invitations[index].text }), ease: "linear" });
    };
    const sync = () => {
      stop(); index = 0; target.lang = "en"; target.textContent = invitations[0].text;
      if (!active || open || motion.matches || document.hidden) return;
      render(); timer = window.setInterval(() => { index = (index + 1) % invitations.length; render(); }, 7000);
    };
    sync();
    motion.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    return () => { stop(); motion.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const launcher = buttonRef.current;
    dialog?.showModal(); onOpenChange(true);
    const animation = dialog && !matchMedia("(prefers-reduced-motion: reduce)").matches ? animate(dialog, { opacity: [0, 1], translateY: [16, 0], duration: 300, ease: "out(3)" }) : undefined;
    return () => { animation?.cancel(); dialog?.close(); onOpenChange(false); launcher?.focus({ preventScroll: true }); };
  }, [open, onOpenChange]);

  return <>
    <div className="secure-chat-intro">
      <div className="secure-chat-copy">
        <p className="label">PRIVATE CHAT / MLS</p>
        <h2>Secure<span> Chat</span><i aria-hidden="true">_</i></h2>
        <p className="secure-chat-invitation" ref={textRef} lang="en">{invitations[0].text}</p>
        <p className="secure-chat-description">End-to-end encrypted. Keys stay in your browser. One link. Up to 24 hours. No archive.</p>
        <button type="button" className="chat-button chat-primary" ref={buttonRef} onClick={() => { setStarted(true); setOpen(true); }}>OPEN SECURE CHAT <span aria-hidden="true">↗</span></button>
        <p className="secure-chat-footnote">Temporary keys · Private invitations</p>
      </div>
      <div className="secure-chat-preview" ref={previewRef} aria-label="How Secure Chat works">
        <span className="chat-panel-sheen" aria-hidden="true" />
        <div className="secure-chat-preview-head"><span className="chat-status-dot" />KEY EXCHANGE<span>MLS / 02</span></div>
        <div className="secure-chat-key-art" aria-hidden="true"><pre>{"  010101   ┌────────────┐\n  10  01───┤  PUBLIC    │\n  010101   │  KEY       │\n           └──────┬─────┘\n  ┌───────────────┘\n  ↓  01101000 01101001"}</pre></div>
        <div className="chat-binary-strip" aria-hidden="true"><span className="chat-binary-stream">01110011 01100101 01100011 01110101 01110010 01100101</span></div>
        <div className="secure-chat-preview-flow"><span>01 / YOUR KEY</span><span>02 / YOUR ALIAS</span><span>03 / SAY HELLO</span></div>
        <div className="secure-chat-preview-foot">One link <span>/</span> Invite friends <span>/</span> 24 hours</div>
      </div>
    </div>
    {started && createPortal(<dialog className="secure-chat-dialog" ref={dialogRef} aria-labelledby="secure-chat-title" onCancel={event => { event.preventDefault(); setOpen(false); setInvitation(null); }} onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
      <ChatLanguageProvider><ChatDialogContent invitation={invitation} onConsumed={consumeInvitation} onClose={() => { setOpen(false); setInvitation(null); }} /></ChatLanguageProvider>
    </dialog>, document.body)}
  </>;
}
