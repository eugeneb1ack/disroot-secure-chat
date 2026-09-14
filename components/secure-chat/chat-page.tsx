"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { parseInvitation, type ChatInvitation } from "@/lib/secure-chat-invite";
const ChatWindow = dynamic(() => import("./chat-window").then(module => module.ChatWindow), { ssr: false });

export function ChatPage() {
  const [invitation, setInvitation] = useState<ChatInvitation | null>(null);
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
  return <main className="secure-chat-dialog chat-standalone">
    <header className="chat-window-header"><div><p className="chat-eyebrow">dis/root · encrypted conversations</p><h1>Secure<span> Chat</span></h1></div><a href="/secure-chat/security" target="_blank" rel="noreferrer" className="chat-button">SECURITY ↗</a></header>
    {invalid ? <p className="chat-error">This invitation is invalid or expired. Ask for a fresh link. <a href="/secure-chat">Start a new conversation →</a></p> : loaded && <ChatWindow invitation={invitation} onInvitationConsumed={() => setInvitation(null)} />}
  </main>;
}
