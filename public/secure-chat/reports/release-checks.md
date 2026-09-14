# Secure Chat — browser and transport verification

Date: 2026-09-14. Technical self-review, not an independent audit.

These checks used the release candidate on the production host before switching the main website. The candidate used read-only access to existing site data and a separate memory-only chat relay. The subsequent authentication-capacity correction is covered by [the 62 automated security checks](security-tests.md).

| Check | Observed result |
|---|---|
| Desktop messenger, 1280 × 720 | Creator stays in the conversation after a guest joins; both exchange messages. |
| Mobile messenger, 390 × 844 | Chat fits the viewport without horizontal document overflow; composer and emoji picker work. |
| Unicode and emoji | Russian text and multi-codepoint emoji arrive through the real browser UI. |
| Reload | The tab returns to key generation; its previous session is not restored. |
| Navigation | The chat uses an unlabelled square; ARCADE keeps its label. Accessible navigation names remain. |
| Security page | English/Russian controls render the protocol, threat boundaries, reports and audit contact. |
| Candidate HTTP through SSH | Three real clients authenticate, exchange MLS messages and admit a third guest through a non-founder. |
| Onion through the Tor network | The same three-client MLS scenario passes through a separate Tor client and the live v3 onion service. |
| New guest history | A new member receives subsequent messages, without pre-join readable history. |
| Cross-origin request | Rejected with HTTP 403; API responses use no-store. |
| Site regression suites | Arcade: 122 passed. Typing: 6 passed. |
| Public repository CI | Node 22 on Linux: dependency installation, 61 initial security checks, lint and production build passed. The subsequent capacity regression raises the current suite to 62. |

Candidate HTTP completion: **2026-09-14T14:01:15.997Z**. Onion completion: **2026-09-14T14:18:44.850Z**.

[Initial public CI run](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34852266949). [Current CI runs](https://github.com/eugeneb1ack/disroot-secure-chat/actions). [Deployment verification and operating configuration](https://github.com/eugeneb1ack/disroot-secure-chat/blob/main/docs/deployment-verification.md).

## Scope

The onion check runs the actual client cryptography in Node with HTTP carried through Tor SOCKS and remote hostname resolution. It is not a Tor Browser UI test. Network latency varies; the first onion circuits required warm-up. Browser checks used the Chromium-based in-app browser. They do not certify every browser, device or accessibility tool. Expiry tests advance an injected relay clock; no 24-hour endurance run is claimed. No public attack traffic, user messages, invitation links, private keys or session tokens are included in this report.

## Русский

Проверен релизный кандидат на рабочем сервере до переключения основного сайта. Доступ кандидата к прежним данным сайта был только для чтения; чат использовал отдельный relay в памяти.

- На десктопе 1280 × 720 и мобильном размере 390 × 844 проверены вход, сохранение создателя в чате, отправка текста и эмодзи. Горизонтального переполнения на мобильном размере нет.
- Перезагрузка возвращает вкладку к генерации ключей. Прежняя сессия не восстанавливается.
- В нижней навигации чат обозначен квадратом без подписи, ARCADE остаётся подписанным. Security переключается между английским и русским.
- Через HTTP и настоящую сеть Tor проверены три клиента: вход, двусторонняя MLS-переписка, подключение третьего участника не создателем, отсутствие прежней истории у нового гостя. Чужой Origin получает 403, ответы API — no-store.
- Пройдено 122 проверки Arcade и 6 проверок набора текста. Первоначальный публичный CI прошёл 61 проверку чата, lint и сборку; текущий набор содержит 62 проверки после отдельного исправления гонки квот.

Tor проверялся клиентским криптографическим кодом через SOCKS, а не интерфейсом Tor Browser. Первым onion-соединениям потребовалось время на построение маршрутов. Браузерная проверка выполнена во встроенном Chromium. Это не независимый аудит, не проверка всех браузеров и не суточный нагрузочный прогон. В отчёте нет переписки пользователей, секретных ссылок, ключей или токенов.
