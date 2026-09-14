"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseInvitation, type ChatInvitation } from "@/lib/secure-chat-invite";
import { ChatLanguageProvider, ChatLanguageSwitch, useChatLanguage } from "./chat-language";
const ChatWindow = dynamic(() => import("./chat-window").then(module => module.ChatWindow), { ssr: false });

export function ChatPage() {
  return <ChatLanguageProvider><ChatPageContent /></ChatLanguageProvider>;
}

function ChatPageContent() {
  const { language, t } = useChatLanguage();
  const frameRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const frame = frameRef.current, viewport = window.visualViewport;
    if (!frame || !viewport) return;
    let scheduled = 0;
    const sync = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => {
        // Safari's visual viewport shrinks/pans with the keyboard independently
        // of the layout viewport. Resize this frame, never the session component.
        if (viewport.scale !== 1) return;
        frame.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
        frame.style.setProperty("--chat-viewport-top", `${viewport.offsetTop}px`);
        const editing = document.activeElement?.matches("input, textarea");
        frame.classList.toggle("is-keyboard-open", !!editing && innerHeight - viewport.height > 120);
      });
    };
    sync(); viewport.addEventListener("resize", sync); viewport.addEventListener("scroll", sync);
    document.addEventListener("focusin", sync); document.addEventListener("focusout", sync);
    return () => { cancelAnimationFrame(scheduled); viewport.removeEventListener("resize", sync); viewport.removeEventListener("scroll", sync); document.removeEventListener("focusin", sync); document.removeEventListener("focusout", sync); };
  }, []);
  const [invitation, setInvitation] = useState<ChatInvitation | null>(null);
  const consumeInvitation = useCallback(() => setInvitation(null), []);
  const [loaded, setLoaded] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const read = () => {
      const parsed = parseInvitation(location.hash);
      setInvalid(!!location.hash && location.hash !== "#secure-chat" && !parsed);
      setInvitation(parsed);
      history.replaceState(history.state, "", location.pathname);
      setLoaded(true);
    };
    const timer = window.setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", read); };
  }, []);
  return <main ref={frameRef} className="secure-chat-dialog chat-standalone" lang={language}>
    <header className="chat-window-header"><div><Link href="/#secure-chat" prefetch={false} className="chat-back-link" aria-label={t("Back to site", "На сайт")}>← <span className="chat-back-label">{t("Back to site", "На сайт")}</span></Link><h1>Secure<span> Chat</span></h1></div><div className="chat-header-actions chat-page-actions"><ChatLanguageSwitch /><a href="/secure-chat/security" target="_blank" rel="noreferrer" className="chat-button chat-security-button" aria-label={t("Security review", "О защите")}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></svg><span>{t("SECURITY ↗", "О ЗАЩИТЕ ↗")}</span></a></div></header>
    {invalid ? <p className="chat-error">{t("This invitation is invalid or expired. Ask for a fresh link.", "Приглашение недействительно или его срок истёк. Попросите новую ссылку.")} <a href="/secure-chat">{t("Start a new conversation →", "Создать новую беседу →")}</a></p> : loaded && <ChatWindow invitation={invitation} onInvitationConsumed={consumeInvitation} />}
  </main>;
}
