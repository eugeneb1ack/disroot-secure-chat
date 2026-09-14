"use client";
import { animate } from "animejs";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MAX_TEXT as maxMessageLength, nicknamePattern, prettyFingerprint, type ChatView } from "@/lib/secure-chat-protocol";
import type { SecureChatClient } from "@/lib/secure-chat-client";
import { ChatGuide } from "./chat-guide";
import { ChatInviteLink } from "./chat-room-setup";
import { invitationLink, type ChatInvitation } from "@/lib/secure-chat-invite";
const emojiGroups = [
  { name: "Faces", emoji: ["🙂", "😊", "😂", "😅", "🥹", "😎", "🤔", "🫠", "👀", "🤖", "👾", "💀"] },
  { name: "Reactions", emoji: ["👍", "👋", "🙌", "🤝", "🫶", "❤️", "💚", "🔥", "✨", "🎉", "💯", "✅"] },
  { name: "Terminal life", emoji: ["🔐", "🔑", "💻", "🛠️", "🐧", "🐛", "☕", "🍕", "🎮", "🎧", "🌙", "🚀"] },
];


function IdentityGate({ onConnect, invited }: { onConnect: (nickname: string, name: string) => Promise<void>; invited: boolean }) {
  const [nickname, setNickname] = useState("");
  const [chatName, setChatName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await onConnect(nickname, chatName.trim() || "Private conversation"); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not connect."); }
    finally { setBusy(false); }
  };
  return <div className="chat-identity-gate">
    <div className="chat-gate-symbol" aria-hidden="true">[ key ]</div>
    <p className="chat-eyebrow">EPHEMERAL / MLS</p>
    <h3>One link. Just us.</h3>
    <p className="chat-muted">No account. No password. No backup to manage.</p>
    <div className="chat-key-boundary"><div><span aria-hidden="true">⌑</span><p><strong>Your keys stay in this tab</strong><small>Generated in memory. Never uploaded or saved in browser storage.</small></p></div><div><span aria-hidden="true">↗</span><p><strong>The invitation opens the conversation</strong><small>Share it privately. Anyone with the full link can join.</small></p></div></div>
    <form onSubmit={submit} className="chat-key-form">
      <label>Nickname<input name="nickname" autoComplete="off" spellCheck={false} required minLength={3} maxLength={24} pattern={nicknamePattern.source} value={nickname} disabled={busy} onChange={event => setNickname(event.target.value)} placeholder="your_alias" /></label>
      {!invited && <label>Chat name <span className="chat-muted">(optional)</span><input name="chatName" autoComplete="off" maxLength={40} value={chatName} disabled={busy} onChange={event => setChatName(event.target.value)} placeholder="Private conversation" /></label>}
      {error && <p className="chat-error" role="alert">{error}</p>}
      <button className="chat-button chat-primary" type="submit" disabled={busy}>{busy ? "CREATING YOUR ENCRYPTED CONVERSATION…" : "GENERATE KEYS & ENTER →"}</button>
      <p className="chat-form-note">Up to 24 hours, with one shared deadline. Closing or reloading this tab discards your keys sooner. An existing participant must be online to connect a new guest.</p>
      <details className="chat-private-help"><summary>What identifies a participant?</summary><p>Every message is signed by a temporary key. Its fingerprint appears beside the nickname. Names are unique in the verified conversation roster, but they are not accounts or proof of a real identity. A fresh session has a different fingerprint.</p></details>
      <details className="chat-private-help"><summary>What reaches the server?</summary><p>Encrypted messages and encrypted participant profiles, temporary connection identifiers and routing metadata. Your invitation secret, message keys and readable messages stay with the participants. The HTTPS server can still see your network address during a connection; it does not need to log it. A compromised website or device remains a point of trust.</p></details>
    </form>
  </div>;
}

export function ChatWindow({ invitation, onInvitationConsumed }: { invitation: ChatInvitation | null; onInvitationConsumed: () => void }) {
  const [view, setView] = useState<ChatView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const clientRef = useRef<SecureChatClient | null>(null);
  const generation = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const messagesRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const roomName = view?.name ?? "Private conversation";
  const messages = view?.messages ?? [];
  const hasView = !!view;
  const viewExpires = view?.expires;
  const lock = useCallback(() => {
    generation.current++; clientRef.current?.close(); clientRef.current = null;
    setView(null); setDraft(""); setEmojiOpen(false); setInviteLink(""); setShowInvite(false); setConnected(false);
  }, []);
  useEffect(() => {
    let alive = true, timer = 0;
    const lifecycle = generation;
    const poll = async () => {
      const client = clientRef.current;
      if (client && !document.hidden) {
        try { await client.poll(); if (alive && clientRef.current === client) { setView(client.view); setConnected(true); } }
        catch (error) {
          if (alive && clientRef.current === client) {
            setConnected(false);
            if (client.closed) lock();
            setError(error instanceof Error ? error.message : "Connection interrupted.");
          }
        }
      }
      if (alive) timer = window.setTimeout(poll, 2000);
    };
    const timerStart = window.setTimeout(poll, 100);
    const pagehide = () => lock();
    window.addEventListener("pagehide", pagehide);
    return () => { alive = false; clearTimeout(timer); clearTimeout(timerStart); window.removeEventListener("pagehide", pagehide); lifecycle.current++; clientRef.current?.close(); clientRef.current = null; };
  }, [lock]);
  useEffect(() => {
    if (!viewExpires) return;
    const expires = viewExpires;
    const expire = () => { if (Date.now() >= expires) { lock(); setError("This conversation has expired. Its active server state and this tab’s keys are discarded."); } };
    const timer = window.setTimeout(expire, Math.max(0, expires - Date.now()));
    window.addEventListener("focus", expire); document.addEventListener("visibilitychange", expire);
    return () => { clearTimeout(timer); window.removeEventListener("focus", expire); document.removeEventListener("visibilitychange", expire); };
  }, [viewExpires, lock]);
  const connect = async (nickname: string, name: string) => {
    const current = ++generation.current;
    const { SecureChatClient } = await import("@/lib/secure-chat-client");
    const client = await SecureChatClient.connect(nickname, name, invitation, location.origin);
    if (generation.current !== current) { client.close(); return; }
    clientRef.current = client;
    setView(client.view); setInviteLink(invitationLink(location.origin, client.invitation));
    setConnected(true); setError(""); onInvitationConsumed();
  };
  const send = async (event: FormEvent) => {
    event.preventDefault(); const client = clientRef.current;
    if (!client || !draft.trim() || busy) return;
    setBusy(true); setError("");
    try { await client.send(draft); if (clientRef.current === client) { setDraft(""); setView(client.view); setConnected(true); nearBottom.current = true; } }
    catch (error) { if (clientRef.current === client) { if (client.closed) lock(); setError(error instanceof Error ? error.message : "Could not send."); } }
    finally { setBusy(false); }
  };
  const lastMessage = messages.at(-1)?.id;
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => { if (nearBottom.current) container.scrollTop = container.scrollHeight; });
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasView]);
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
    if (value.length > maxMessageLength) return;
    const cursor = start + emoji.length;
    setDraft(value); setEmojiOpen(false);
    requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(cursor, cursor); selection.current = { start: cursor, end: cursor }; });
  };

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !lastMessage) return;
    if (nearBottom.current) container.scrollTop = container.scrollHeight;
    const bubble = container.lastElementChild;
    if (bubble && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const animation = animate(bubble, { opacity: [0.3, 1], translateY: [8, 0], duration: 240, ease: "out(3)" });
      return () => { animation.cancel(); };
    }
  }, [lastMessage]);

  return <div className={`chat-workspace chat-single-conversation${!view ? " is-starting" : ""}${showGuide ? " has-guide" : ""}`}>
    <section className="chat-conversation" aria-label={roomName}>
      <header className="chat-room-header"><div><h3><span aria-hidden="true">#</span> {roomName}</h3><p>{view ? `${view?.members.length ?? 0} ${view?.members.length === 1 ? "participant" : "participants"} · ${connected ? "encrypted connection" : "reconnecting…"}` : "No account. Private. Anonymous."}</p></div><div className="chat-room-tools"><button className="chat-button chat-guide-toggle" type="button" aria-expanded={showGuide} aria-controls="chat-guide-panel" onClick={() => setShowGuide(current => !current)}>How it works <span aria-hidden="true">{showGuide ? "−" : "+"}</span></button></div></header>
      {!view ? <div className="chat-gate-scroll">{invitation && <div className="chat-invitation-banner"><strong>Private invitation.</strong><p>Create a key to join this room.</p></div>}{error && <p className="chat-error" role="alert">{error}</p>}<IdentityGate onConnect={connect} invited={!!invitation} /></div> : <>
        <div className="chat-room-notice chat-pinned-invite"><div><strong>24 HOURS. THEN GONE.</strong><small>Ends {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(view!.expires))} · no recovery</small></div><button type="button" className="chat-button" aria-expanded={showInvite} onClick={() => setShowInvite(current => !current)}>Invite friends {showInvite ? "−" : "↗"}</button></div>
        {showInvite && <div className="chat-invite-scroll"><ChatInviteLink link={inviteLink} /></div>}
        <details className="chat-recipients"><summary>Participant keys <span>{view.members.length} / epoch {view.epoch}</span></summary><div><p>Compare full fingerprints with your friends. Matching conversation codes confirm the same MLS transcript.</p>{view.members.map(member => <div className="chat-recipient" key={member.id}><strong>{member.nickname}{member.id === view.identity.id ? " (you)" : ""}</strong><code>{prettyFingerprint(member.id)}</code></div>)}{view.ready && <div className="chat-recipient"><strong>Conversation code</strong><code>{prettyFingerprint(view.verification)}</code></div>}</div></details>
        <div className="chat-messages" ref={messagesRef} role="log" aria-label="Encrypted messages" aria-live="polite" aria-relevant="additions" onScroll={event => { const target = event.currentTarget; nearBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80; }}>
          {!messages.length && <div className="chat-empty"><span className="chat-empty-symbol" aria-hidden="true">[ … ]</span><p className="chat-eyebrow">ENCRYPTED CHANNEL</p><h3>{view.ready ? "No messages yet." : "Connecting your keys…"}</h3><small>{view.ready ? "Share the invitation. Your friends join with their own keys." : "Keep this tab open. An existing participant will connect you automatically."}</small></div>}
          {messages.map((message, index) => {
            const own = message.sender === view.identity.id;
            const grouped = index > 0 && messages[index - 1].sender === message.sender && Date.parse(message.time) - Date.parse(messages[index - 1].time) < 5 * 60_000;
            const emojiOnly = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(message.body) && [...message.body].length <= 24;
            return <article key={message.id} className={`chat-message-row${own ? " is-own" : ""}${grouped ? " is-grouped" : ""}`}>
              <span className="chat-message-avatar" aria-hidden="true">{message.nickname.slice(0, 2).toUpperCase()}</span>
              <div className="chat-message"><header><strong title={prettyFingerprint(message.sender)}>{own ? "You" : message.nickname}</strong><span className="chat-message-key-id" title={prettyFingerprint(message.sender)}>{message.sender.slice(-8).toUpperCase()}</span></header><p className={emojiOnly ? "chat-emoji-message" : undefined}>{message.body}</p><footer><small>{"✓ Signature checked"}</small><time dateTime={message.time}>{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.time))}</time></footer></div>
            </article>;
          })}
        </div>
        <form className="chat-composer" onSubmit={send}>
          {emojiOpen && <div className="chat-emoji-picker" ref={emojiRef} role="dialog" aria-label="Choose an emoji" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEmojiOpen(false); emojiButtonRef.current?.focus(); } }}><header><span>EMOJI</span><button type="button" className="chat-text-button" aria-label="Close emoji picker" onClick={() => { setEmojiOpen(false); emojiButtonRef.current?.focus(); }}>×</button></header>{emojiGroups.map(group => <div key={group.name}><p>{group.name}</p><div className="chat-emoji-grid">{group.emoji.map(emoji => <button key={emoji} type="button" aria-label={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div></div>)}</div>}
          {error && <p className="chat-error" role="alert">{error}</p>}
          <label className="chat-sr-only" htmlFor="chat-message">Message to {roomName}</label>
          <div className="chat-compose-row"><button className="chat-emoji-trigger" type="button" ref={emojiButtonRef} aria-label="Choose emoji" aria-expanded={emojiOpen} disabled={!view?.ready || busy} onClick={() => { const input = composerRef.current; if (input) selection.current = { start: input.selectionStart, end: input.selectionEnd }; setEmojiOpen(current => !current); }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 14c1 4 7 4 8 0M8 9h1m6 0h1" /></svg></button><textarea id="chat-message" ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} onSelect={event => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} rows={2} maxLength={maxMessageLength} disabled={!view?.ready || busy} placeholder={!view?.ready ? "Waiting for an online participant…" : "Message…"} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="chat-button chat-primary" type="submit" disabled={!view?.ready || !connected || !draft.trim() || busy} aria-label="Encrypt and send message">{busy ? "…" : "SEND ↑"}</button></div>
          <div className="chat-composer-foot"><span><span className="chat-compose-privacy">↳ ENCRYPTED IN YOUR BROWSER · </span>{draft.length}/{maxMessageLength}</span><span className="chat-current-alias" title={prettyFingerprint(view.identity.id)}>{view.identity.nickname} · {view.identity.id.slice(-8).toUpperCase()}</span><button type="button" className="chat-text-button" onClick={lock}>End session</button></div>
        </form>
      </>}
    </section>
    {showGuide && <aside id="chat-guide-panel" className="chat-guide-panel"><ChatGuide /></aside>}
  </div>;
}
