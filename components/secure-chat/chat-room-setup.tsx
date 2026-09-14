"use client";

import { useState } from "react";
import { useChatLanguage } from "./chat-language";

export function ChatInviteLink({ link }: { link: string }) {
  const { t } = useChatLanguage();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="chat-invite-card"><p className="chat-eyebrow">{t("INVITE A FRIEND", "ПРИГЛАСИТЬ ДРУГА")}</p><p>{t("Share this link. Your friend creates a key and joins.", "Отправьте ссылку. Друг создаст свой ключ и войдёт в беседу.")}</p><label>{t("Private invitation link", "Приватная ссылка-приглашение")}<input readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" className="chat-button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{copied ? t("✓ LINK COPIED", "✓ ССЫЛКА СКОПИРОВАНА") : t("COPY INVITATION ↗", "СКОПИРОВАТЬ ССЫЛКУ ↗")}</button>{failed && <p role="status">{t("Select the link above and copy it manually.", "Выделите ссылку выше и скопируйте её вручную.")}</p>}<small>{t("Anyone with this link can join until the room expires. Earlier messages stay encrypted to their original recipients.", "Любой обладатель ссылки может войти до истечения срока беседы. Прежние сообщения доступны только их исходным получателям.")}</small></div>;
}
