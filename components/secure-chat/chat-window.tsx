"use client";
import { animate } from "animejs";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { nicknamePattern, type ChatView, type MessageReference, type Reaction } from "@/lib/secure-chat-protocol";
import type { ChatSession } from "@/lib/secure-chat-session";
import { ChatGuide } from "./chat-guide";
import { chatError, useChatLanguage } from "./chat-language";
import { ChatInviteLink } from "./chat-room-setup";
import { invitationLink, type ChatInvitation } from "@/lib/secure-chat-invite";
import { ChatMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";
import { findMessage } from "@/lib/secure-chat-interactions";
import { ChatParticipants } from "./chat-participants";

function IdentityGate({ onConnect, invited, onStartNew }: { onConnect: (nickname: string, name: string) => Promise<void>; invited: boolean; onStartNew: () => void }) {
  const { language, t } = useChatLanguage();
  const [nickname, setNickname] = useState("");
  const [chatName, setChatName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await onConnect(nickname, chatName.trim() || t("Private conversation", "Приватная беседа")); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not connect."); }
    finally { setBusy(false); }
  };
  return <div className="chat-identity-gate">
    <div className="chat-gate-symbol" aria-hidden="true">[ key ]</div>
    <p className="chat-eyebrow">{t("EPHEMERAL / MLS", "ВРЕМЕННЫЕ КЛЮЧИ / MLS")}</p>
    <h3>{t("One link. Just us.", "Одна ссылка. Только мы.")}</h3>
    <p className="chat-muted">{t("No account. No password. No backup to manage.", "Без аккаунта, пароля и резервных копий.")}</p>
    <div className="chat-key-boundary"><div><span aria-hidden="true">⌑</span><p><strong>{t("Your keys stay in this browser", "Ключи остаются в этом браузере")}</strong><small>{t("Saved encrypted on this device until expiry. Never uploaded.", "Сохраняются зашифрованными на устройстве до истечения срока. На сервер не передаются.")}</small></p></div><div><span aria-hidden="true">↗</span><p><strong>{t("The invitation opens the conversation", "Ссылка открывает беседу")}</strong><small>{t("Share it privately. Anyone with the full link can join.", "Передайте её лично. Войти может любой, у кого есть полная ссылка.")}</small></p></div></div>
    <form onSubmit={submit} className="chat-key-form">
      <label>{t("Nickname", "Никнейм")}<input name="nickname" autoComplete="off" spellCheck={false} required minLength={3} maxLength={24} pattern={nicknamePattern.source} value={nickname} disabled={busy} onChange={event => setNickname(event.target.value)} placeholder="your_alias" title={t("3–24 Latin letters, numbers, dots, underscores or hyphens", "3–24 латинские буквы, цифры, точки, дефисы или подчёркивания")} /></label>
      {!invited && <label>{t("Chat name", "Название беседы")} <span className="chat-muted">{t("(optional)", "(необязательно)")}</span><input name="chatName" autoComplete="off" maxLength={40} value={chatName} disabled={busy} onChange={event => setChatName(event.target.value)} placeholder={t("Private conversation", "Приватная беседа")} /></label>}
      {error && <p className="chat-error" role="alert">{chatError(error, language)}</p>}
      <button className="chat-button chat-primary" type="submit" disabled={busy}>{busy ? t("CREATING YOUR ENCRYPTED CONVERSATION…", "СОЗДАЁМ ЗАШИФРОВАННУЮ БЕСЕДУ…") : t("GENERATE KEYS & ENTER →", "СОЗДАТЬ КЛЮЧИ И ВОЙТИ →")}</button>
      {invited && <button className="chat-button" type="button" disabled={busy} onClick={onStartNew}>{t("Start a new conversation", "Создать новую беседу")}</button>}
      <p className="chat-form-note">{t("Return through your link in the same browser, even after a reload. Up to 24 hours. Clearing site data or ending the session removes this access.", "Возвращайтесь по своей ссылке в том же браузере, даже после перезагрузки. До 24 часов. Очистка данных сайта или завершение сессии удаляет этот доступ.")}</p>
      <details className="chat-private-help"><summary>{t("What identifies a participant?", "Как отличить участника?")}</summary><p>{t("Every message is signed by a temporary key. Its fingerprint appears beside the nickname. Names are unique in the verified conversation roster, but they are not accounts or proof of a real identity. A fresh session has a different fingerprint.", "Каждое сообщение подписано временным ключом. Рядом с никнеймом указан его fingerprint. Никнеймы в проверенном списке участников не повторяются, но не подтверждают личность человека. В новой сессии будет другой fingerprint.")}</p></details>
      <details className="chat-private-help"><summary>{t("What reaches the server?", "Что получает сервер?")}</summary><p>{t("Encrypted messages and encrypted participant profiles, temporary connection identifiers and routing metadata. Your invitation secret, message keys and readable messages stay with the participants. The HTTPS server can still see your network address during a connection; it does not need to log it. A compromised website or device remains a point of trust.", "Зашифрованные сообщения и профили, временные идентификаторы соединений и данные для доставки. Секрет приглашения, ключи сообщений и открытый текст остаются у участников. При HTTPS сервер видит сетевой адрес подключения, даже без его записи в логи. Взломанный сайт или устройство могут нарушить защиту.")}</p></details>
    </form>
  </div>;
}

export function ChatWindow({ invitation, onInvitationConsumed }: { invitation: ChatInvitation | null; onInvitationConsumed: () => void }) {
  const { language, t } = useChatLanguage();
  const [view, setView] = useState<ChatView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [startFresh, setStartFresh] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageReference>();
  const [inviteLink, setInviteLink] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const clientRef = useRef<ChatSession | null>(null);
  const generation = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const roomName = view?.name ?? t("Private conversation", "Приватная беседа");
  const count = view?.members.length ?? 0;
  const plural = new Intl.PluralRules(language).select(count);
  const participantLabel = t(count === 1 ? "participant" : "participants", plural === "one" ? "участник" : plural === "few" ? "участника" : "участников");
  const dateLocale = language === "ru" ? "ru-RU" : "en-GB";
  const messages = view?.messages ?? [];
  const hasView = !!view;
  const viewExpires = view?.expires;
  const release = useCallback(() => {
    generation.current++; clientRef.current?.detach(); clientRef.current = null;
    setView(null); setDraft(""); setReplyTo(undefined); setInviteLink(""); setShowInvite(false); setConnected(false); setMirrored(false);
  }, []);
  const lock = useCallback(() => { clientRef.current?.close(); release(); }, [release]);
  const newConversation = async () => {
    setBusy(true);
    await clientRef.current?.close();
    release(); setStartFresh(true); setResuming(false); setBusy(false); onInvitationConsumed();
  };
  useEffect(() => {
    if (startFresh && !invitation) return;
    if (clientRef.current) {
      if (!invitation) return;
      const active = clientRef.current.invitation;
      const same = active.room === invitation.room && active.secret === invitation.secret && active.founder === invitation.founder && active.expires === invitation.expires;
      const timer = setTimeout(() => {
        if (!same) setError("Another conversation is open in this tab. End it before opening a different invitation.");
        onInvitationConsumed();
      }, 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setResuming(true);
      try {
        const { browserChatSession } = await import("@/lib/secure-chat-browser-session");
        const { currentChatSession, retainChatSession } = await import("@/lib/secure-chat-runtime");
        const resumed = currentChatSession(invitation) ?? await browserChatSession(invitation);
        const session = resumed ? retainChatSession(resumed) : null;
        if (cancelled) { session?.detach(); return; }
        if (session) {
          clientRef.current = session; setMirrored(session.mirrored); setView(session.view); setInviteLink(invitationLink(location.origin, session.invitation));
          setConnected(true); setError(""); onInvitationConsumed();
        }
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Connection interrupted.");
      } finally { if (!cancelled) setResuming(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [invitation, onInvitationConsumed, startFresh]);
  useEffect(() => {
    let alive = true, timer = 0;
    const lifecycle = generation;
    const poll = async () => {
      const client = clientRef.current;
      if (client) {
        try {
          if (client.closed) throw new Error(client.pollingError ?? "This conversation has ended. Its keys have been discarded.");
          if (client.pollingError) throw new Error(client.pollingError);
          if (alive && clientRef.current === client) { setView(client.view); setConnected(true); setError(""); }
        }
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
    return () => { alive = false; clearTimeout(timer); clearTimeout(timerStart); lifecycle.current++; clientRef.current?.detach(); clientRef.current = null; };
  }, [lock, release]);
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
    const { browserChatSession } = await import("@/lib/secure-chat-browser-session");
    const { currentChatSession, retainChatSession } = await import("@/lib/secure-chat-runtime");
    const session = currentChatSession(invitation) ?? await browserChatSession(invitation, { nickname, name }, startFresh);
    if (!session) throw new Error("Could not open this conversation.");
    const client = retainChatSession(session);
    if (generation.current !== current) { client.detach(); return; }
    clientRef.current = client; setMirrored(client.mirrored);
    setView(client.view); setInviteLink(invitationLink(location.origin, client.invitation));
    setConnected(true); setError(""); setStartFresh(false); onInvitationConsumed();
  };
  const send = async (event: FormEvent) => {
    event.preventDefault(); const client = clientRef.current;
    if (!client || !draft.trim() || busy || client.view.deliveryPending) return;
    const body = draft;
    setBusy(true); setError("");
    try { await client.send(body, replyTo); if (clientRef.current === client) { setDraft(current => current === body ? "" : current); setReplyTo(undefined); setView(client.view); setConnected(true); nearBottom.current = true; } }
    catch (error) { if (clientRef.current === client) { if (client.closed) lock(); else if (client.view.deliveryPending) { setView(client.view); setDraft(current => current === body ? "" : current); setReplyTo(undefined); } setError(error instanceof Error ? error.message : "Could not send."); } }
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
  const react = async (target: MessageReference, emoji: Reaction | null) => {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy(true); setError("");
    try { await client.react(target, emoji); if (clientRef.current === client) setView(client.view); }
    catch (error) { if (clientRef.current === client) { if (client.closed) lock(); setError(error instanceof Error ? error.message : "Could not send."); } }
    finally { setBusy(false); }
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
    <section className="chat-conversation" aria-label={roomName} lang={language}>
      <header className="chat-room-header"><div><h3><span aria-hidden="true">#</span> {roomName}</h3><p>{view ? `${count} ${participantLabel} · ${connected ? t("encrypted connection", "зашифрованное соединение") : t("reconnecting…", "восстанавливаем связь…")}` : t("No account. Private. Anonymous.", "Без аккаунта. Приватно. Анонимно.")}</p></div><div className="chat-room-tools"><button className="chat-button chat-guide-toggle" type="button" aria-expanded={showGuide} aria-controls="chat-guide-panel" onClick={() => setShowGuide(current => !current)}>{t("How it works", "Как это работает")} <span aria-hidden="true">{showGuide ? "−" : "+"}</span></button></div></header>
      {!view ? <div className="chat-gate-scroll">{invitation && <div className="chat-invitation-banner"><strong>{t("Private invitation.", "Приватное приглашение.")}</strong><p>{t("Create a key to join this room.", "Создайте ключ, чтобы войти в беседу.")}</p></div>}{error && <p className="chat-error" role="alert">{chatError(error, language)}</p>}{resuming ? <p className="chat-loading" role="status">{t("Looking for your open session…", "Ищем вашу открытую сессию…")}</p> : <IdentityGate key={invitation ? "invited" : "new"} onConnect={connect} invited={!!invitation} onStartNew={onInvitationConsumed} />}</div> : <>
        <div className="chat-room-notice chat-pinned-invite"><div><strong>{t("24 HOURS. THEN GONE.", "24 ЧАСА. ПОТОМ ВСЁ ИСЧЕЗНЕТ.")}</strong><small>{t("Ends", "До")} {new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(view!.expires))} · {t("shared deadline", "единый срок")}</small></div><button type="button" className="chat-button" aria-expanded={showInvite} onClick={() => setShowInvite(current => !current)}>{t("Invite friends", "Пригласить друзей")} {showInvite ? "−" : "↗"}</button></div>
        {showInvite && <div className="chat-invite-scroll"><ChatInviteLink link={inviteLink} /></div>}
        <ChatParticipants view={view} connected={connected} />
        <div className="chat-messages" ref={messagesRef} role="log" aria-label={t("Encrypted messages", "Зашифрованные сообщения")} aria-live="polite" aria-relevant="additions" onScroll={event => { const target = event.currentTarget; nearBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80; }}>
          {!messages.length && !view.pendingMessage && <div className="chat-empty"><span className="chat-empty-symbol" aria-hidden="true">[ … ]</span><p className="chat-eyebrow">{t("ENCRYPTED CHANNEL", "ЗАШИФРОВАННЫЙ ЧАТ")}</p><h3>{view.ready ? t("No messages yet.", "Сообщений пока нет.") : t("Connecting your keys…", "Подключаем ваши ключи…")}</h3><small>{view.ready ? t("Share the invitation. Your friends join with their own keys.", "Отправьте ссылку друзьям. Они войдут со своими ключами.") : view.presence?.available === 0 ? t("No connected participant yet. Ask your friend to reopen this link in their usual browser.", "Пока никто не на связи. Попросите друга открыть эту ссылку в привычном браузере.") : t("An online participant is connecting you. Keep this tab open.", "Участник онлайн подключает вас. Оставьте вкладку открытой.")}</small></div>}
          {messages.map((message, index) => {
            const own = message.sender === view.identity.id;
            const grouped = index > 0 && messages[index - 1].sender === message.sender && Date.parse(message.time) - Date.parse(messages[index - 1].time) < 5 * 60_000;
            const target = { id: message.id, sender: message.sender };
            return <ChatMessage key={message.id} message={message} original={message.replyTo ? findMessage(messages, message.replyTo) : undefined} own={own} grouped={grouped} identity={view.identity.id} busy={busy || !connected} onReply={() => setReplyTo(target)} onReact={emoji => void react(target, emoji)} />;
          })}
          {view.pendingMessage && <div className="chat-pending-message" role="status"><strong>{view.identity.nickname}</strong><p>{view.pendingMessage.body}</p><small>{t("Saved here · waiting for delivery confirmation", "Сохранено здесь · ждём подтверждения доставки")}</small></div>}
        </div>
        {mirrored && <p className="chat-session-mirror" role="status">{t("Connected through your original tab. Keep it open.", "Подключено через исходную вкладку. Оставьте её открытой.")}</p>}
        <ChatComposer draft={draft} setDraft={setDraft} reply={replyTo ? findMessage(messages, replyTo) : undefined} onCancelReply={() => setReplyTo(undefined)} onSend={send} onEnd={() => void newConversation()} identity={view.identity} ready={view.ready} connected={connected} busy={busy || !!view.deliveryPending} error={error} />
      </>}
    </section>
    {showGuide && <aside id="chat-guide-panel" className="chat-guide-panel"><ChatGuide /></aside>}
  </div>;
}
