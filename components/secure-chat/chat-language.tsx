"use client";

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";

export type ChatLanguage = "en" | "ru";
const subscribe = () => () => {};
const browserLanguage = (): ChatLanguage => navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
const serverLanguage = (): ChatLanguage => "en";
const ChatLanguageContext = createContext<{ language: ChatLanguage; setLanguage: (language: ChatLanguage) => void } | null>(null);

export function ChatLanguageProvider({ children }: { children: ReactNode }) {
  const preferred = useSyncExternalStore(subscribe, browserLanguage, serverLanguage);
  const [selected, setSelected] = useState<ChatLanguage | null>(null);
  // Language is UI state only: no cookies, browser storage or key recreation.
  return <ChatLanguageContext.Provider value={{ language: selected ?? preferred, setLanguage: setSelected }}>{children}</ChatLanguageContext.Provider>;
}

export function useChatLanguage() {
  const context = useContext(ChatLanguageContext);
  if (!context) throw new Error("ChatLanguageProvider is required.");
  return { ...context, t: (en: string, ru: string) => context.language === "ru" ? ru : en };
}

export function ChatLanguageSwitch() {
  const { language, setLanguage, t } = useChatLanguage();
  return <div className="chat-language-switch" role="group" aria-label={t("Interface language", "Язык интерфейса")}>
    <button type="button" lang="en" aria-label="English" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
    <button type="button" lang="ru" aria-label="Русский" aria-pressed={language === "ru"} onClick={() => setLanguage("ru")}>RU</button>
  </div>;
}

const errors: Record<string, string> = {
  "The relay response was interrupted or invalid.": "Ответ сервера прерван или повреждён. Соединение будет восстановлено.",
  "Browser session storage is unavailable. Allow site storage to keep this conversation after a reload.": "Хранилище браузера недоступно. Разрешите хранение данных сайта, чтобы возвращаться после перезагрузки.",
  "This browser cannot safely restore chat sessions. Use a browser with Web Locks and site storage enabled.": "Для безопасного восстановления нужны Web Locks и доступное хранилище сайта. Откройте чат в поддерживающем их браузере.",
  "Your conversation is open in another tab. Wait for that tab to reconnect.": "Беседа открыта в другой вкладке. Дождитесь её подключения и повторите вход.",
  "Too many saved conversations. End an existing session first.": "Слишком много сохранённых бесед. Сначала завершите одну из сессий.",
  "The saved conversation could not be verified. Its local copy was removed.": "Не удалось проверить сохранённую сессию. Повреждённая локальная копия удалена.",
  "Invalid or expired saved conversation.": "Сохранённая сессия повреждена или её срок истёк.",
  "The interrupted write cannot be reconciled safely. Start a new session.": "Не удалось безопасно восстановить прерванную отправку. Потребуется новая сессия.",
  "The conversation is busy. Try returning shortly.": "Беседа обновляется. Повторите вход немного позже.",
  "Saved session has ended.": "Сохранённая сессия завершена.",
  "Saved conversation exceeds the browser storage limit.": "Сохранённая беседа превышает локальный лимит хранения.",
  "The conversation is busy. Your message was not sent. Try again shortly.": "Беседа пока занята. Отправка не выполнена. Повторите чуть позже.",
  "No participant is online. Ask your friend to open the original chat tab, then retry.": "Сейчас никто не онлайн. Попросите друга открыть исходную вкладку чата и повторите вход.",
  "No participant can open this conversation anymore. Create a new conversation and share its new link.": "В этой беседе больше не осталось активных ключей для подключения. Создайте новую беседу и отправьте новую ссылку.",
  "Invalid participant connection state.": "Не удалось проверить данные подключения участников.",
  "Invalid transport identity binding.": "Не удалось проверить привязку соединения к ключу участника.",
  "Another conversation is open in this tab. End it before opening a different invitation.": "В этой вкладке уже открыта другая беседа. Завершите её перед входом по другому приглашению.",
  "Could not connect.": "Не удалось подключиться.",
  "Connection failed.": "Не удалось подключиться.",
  "Connection interrupted.": "Соединение прервано.",
  "Could not send.": "Не удалось отправить сообщение.",
  "The relay is temporarily unreachable.": "Relay временно недоступен. Попробуйте ещё раз.",
  "The chat relay is unavailable. Try again shortly.": "Relay чата недоступен. Повторите попытку чуть позже.",
  "The isolated chat relay is unavailable. Try again shortly.": "Relay чата недоступен. Повторите попытку чуть позже.",
  "The relay is at capacity.": "Чат-сервер заполнен. Попробуйте подключиться позже.",
  "The relay is busy. Retry in a moment.": "Relay занят. Повторите попытку чуть позже.",
  "Too many requests. Retry shortly.": "Слишком много запросов. Подождите немного.",
  "Conversation is at capacity.": "В беседе нет свободных мест.",
  "Join queue is full.": "Очередь подключения заполнена. Подождите немного.",
  "Verification is busy.": "Проверка ключей занята. Повторите попытку чуть позже.",
  "Choose 3–24 letters, numbers, dots, underscores or hyphens.": "Никнейм: 3–24 латинские буквы, цифры, точки, дефисы или подчёркивания.",
  "Choose a chat name of up to 40 visible characters.": "Название беседы: до 40 видимых символов.",
  "Invalid message text.": "Сообщение должно содержать от 1 до 4000 символов без управляющих кодов.",
  "The original chat tab has closed. Its keys are no longer available.": "Исходная вкладка закрыта. Её ключи больше недоступны.",
  "The original tab is not responding. Keep it open to use this session.": "Исходная вкладка не отвечает. Оставьте её открытой для продолжения сессии.",
  "Delivery from the original tab is unconfirmed. Check the conversation before retrying.": "Отправка из исходной вкладки не подтверждена. Проверьте переписку перед повторной отправкой.",
  "Invalid message interaction.": "Не удалось проверить ответ или реакцию.",
  "The original message is no longer available in this tab.": "Исходного сообщения больше нет в памяти вкладки. Выберите другое сообщение.",
  "Invalid or expired invitation.": "Приглашение недействительно или его срок истёк.",
  "Invitation is unavailable or expired.": "Приглашение недоступно или его срок истёк.",
  "Conversation expired.": "Срок беседы истёк.",
  "Conversation session expired. Open a fresh invitation.": "Срок сессии истёк. Откройте новое приглашение.",
  "This conversation has expired. Generate a fresh invitation.": "Срок беседы истёк. Создайте новое приглашение.",
  "This conversation has ended. Its keys have been discarded.": "Беседа завершена. Её ключи удалены из вкладки.",
  "This conversation has expired. Its active server state and this tab’s keys are discarded.": "Срок беседы истёк. Её активное состояние на сервере и ключи этой вкладки удалены.",
  "This nickname or admission request was rejected. Choose another nickname and open the invitation again.": "Никнейм или запрос на вход отклонён. Выберите другой никнейм и откройте приглашение заново.",
  "That nickname is already in this conversation. Choose another.": "Этот никнейм уже занят в беседе. Выберите другой.",
  "This key already belongs to a conversation.": "Этот ключ уже связан с беседой.",
  "This tab missed too much state. Rejoin with a fresh key.": "Вкладка пропустила слишком много событий. Войдите по приглашению с новым ключом.",
  "A conversation event is missing. Rejoin with a fresh key.": "Пропущено событие беседы. Войдите по приглашению с новым ключом.",
  "Keep this tab open while an online participant connects you.": "Оставьте вкладку открытой. Участник онлайн подключит вас к беседе.",
  "Wait for an online participant to connect you.": "Дождитесь подключения участником, который сейчас онлайн.",
  "Another participant is updating the conversation. Retry in a moment.": "Другой участник обновляет ключи беседы. Повторите попытку чуть позже.",
  "Conversation is updating. Retry.": "Беседа обновляется. Повторите попытку.",
  "Write window is too short. Retry.": "Время отправки истекло. Повторите попытку.",
  "Write lease expired. Rejoin with a fresh key.": "Время отправки истекло. Войдите по приглашению с новым ключом.",
  "Sign-in challenge expired or invalid.": "Запрос на подтверждение входа недействителен или истёк. Повторите вход.",
  "Sign-in challenge expired.": "Время подтверждения входа истекло. Повторите вход.",
  "Signature rejected.": "Подпись отклонена.",
  "Signature verification failed.": "Проверка подписи не пройдена.",
  "Use this site's chat window.": "Откройте чат на этом сайте.",
  "Secure Chat is not enabled for this origin.": "Secure Chat недоступен по этому адресу.",
};

export function chatError(message: string, language: ChatLanguage) {
  if (language === "en") return message;
  if (message.startsWith("The write could not be confirmed.")) return "Отправка не подтверждена. Ключи удалены из вкладки, чтобы исключить небезопасное повторное использование. Откройте приглашение заново.";
  return errors[message] ?? "Не удалось выполнить операцию или проверить данные. Повторите попытку; если сессия завершена, откройте приглашение заново.";
}
