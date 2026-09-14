"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { parseInvitation, type ChatInvitation } from "@/lib/secure-chat-invite";
import { ChatLanguageProvider, ChatLanguageSwitch, useChatLanguage } from "./chat-language";
const ChatWindow = dynamic(() => import("./chat-window").then(module => module.ChatWindow), { ssr: false });

export function ChatPage() {
  return <ChatLanguageProvider><ChatPageContent /></ChatLanguageProvider>;
}

function ChatPageContent() {
  const { language, t } = useChatLanguage();
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
  return <main className="secure-chat-dialog chat-standalone" lang={language}>
    <header className="chat-window-header"><div><Link href="/#secure-chat" prefetch={false} className="chat-back-link">← {t("Back to site", "На сайт")}</Link><h1>Secure<span> Chat</span></h1></div><div className="chat-header-actions chat-page-actions"><ChatLanguageSwitch /><a href="/secure-chat/security" target="_blank" rel="noreferrer" className="chat-button">{t("SECURITY ↗", "О ЗАЩИТЕ ↗")}</a></div></header>
    {invalid ? <p className="chat-error">{t("This invitation is invalid or expired. Ask for a fresh link.", "Приглашение недействительно или его срок истёк. Попросите новую ссылку.")} <a href="/secure-chat">{t("Start a new conversation →", "Создать новую беседу →")}</a></p> : loaded && <ChatWindow invitation={invitation} onInvitationConsumed={consumeInvitation} />}
  </main>;
}
