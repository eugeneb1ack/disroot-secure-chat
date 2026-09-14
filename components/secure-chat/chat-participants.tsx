"use client";
import { type ChatView, prettyFingerprint } from "@/lib/secure-chat-protocol";
import { useChatLanguage } from "./chat-language";

export function ChatParticipants({ view, connected }: { view: ChatView; connected: boolean }) {
  const { t } = useChatLanguage();
  const members = view.members.map(member => ({ ...member, status: !connected ? "unknown" : member.id === view.identity.id ? view.ready ? "online" : "connecting" : view.presence?.members.find(value => value.id === member.id)?.status ?? "unknown" }));
  const online = members.filter(member => member.status === "online").length;
  const statusText = (status: string) => status === "online" ? t("Online", "Онлайн") : status === "offline" ? t("Disconnected", "Нет связи") : status === "connecting" ? t("Joining…", "Подключается…") : t("Unknown", "Неизвестно");
  return <details className="chat-presence">
    <summary><span className="chat-presence-avatars" aria-hidden="true">{members.slice(0, 4).map(member => <span key={member.id} className={`chat-presence-avatar is-${member.status}`}>{member.nickname.slice(0, 1).toUpperCase()}</span>)}</span><span className="chat-presence-summary" aria-live="polite">{connected ? <><strong>{online}</strong> {t("online", "онлайн")}{!!view.presence?.joining && <small> · {t("joining", "подключаются")}: {view.presence.joining}</small>}</> : t("Reconnecting…", "Восстанавливаем связь…")}</span><span className="chat-presence-toggle">{t("Participants", "Участники")} <span aria-hidden="true">⌄</span></span></summary>
    <div className="chat-presence-list">
      {members.map(member => <div key={member.id} className={`chat-presence-member is-${member.status}`}><span className="chat-presence-avatar" aria-hidden="true">{member.nickname.slice(0, 1).toUpperCase()}</span><div><strong>{member.nickname}{member.id === view.identity.id && <small> · {t("you", "вы")}</small>}</strong><code title={prettyFingerprint(member.id)}>{prettyFingerprint(member.id)}</code></div><span className="chat-presence-state"><i aria-hidden="true" />{statusText(member.status)}</span></div>)}
      <p className="chat-presence-note">{t("Connection status updates automatically. A lost connection is detected after about 20 seconds; a sleeping device may take longer. Status is reported by the relay, not proof of identity.", "Статус обновляется автоматически. Обрыв связи определяется примерно за 20 секунд; спящий браузер может задержать обновление. Статус сообщает relay — это не проверка личности.")}</p>
      {view.ready && <details className="chat-presence-verification"><summary>{t("Verify conversation", "Проверить беседу")} · epoch {view.epoch}</summary><p>{t("Compare the full participant fingerprints and this conversation code through another trusted channel.", "Сверьте полные fingerprint участников и этот код беседы через другой доверенный канал.")}</p><code>{prettyFingerprint(view.verification)}</code></details>}
    </div>
  </details>;
}
