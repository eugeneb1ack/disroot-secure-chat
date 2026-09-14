# Secure Chat — browser and transport verification

Date: 2026-09-14. Application revision: `d76321a`. Technical self-review.

That application revision passed **95 automated checks**, lint and a production build. The historical report is available in the Git history for that revision. The checks below were performed separately against an isolated candidate and the deployed application; they are not included in the 95-test count.

## Current release

| Check | Observed result |
|---|---|
| Production HTTPS, three independent clients | Authentication, encrypted admission, bidirectional Unicode/emoji and admission through a non-founder passed. |
| Simultaneous send | Three concurrent HTTP writers delivered all three messages exactly once without manual retries. |
| Replies and reactions | Authenticated replies, reaction set/remove and unchanged attribution passed. A new guest received no pre-join message content, including quoted text. |
| Participant status | Three online identities; logout marked the departed member offline without removing its verified identity. |
| Orphaned invitation | After all admitted test sessions ended, a new guest received an explicit refusal instead of waiting indefinitely. |
| Request boundaries | A foreign Origin received HTTP 403. API responses used no-store. |
| Production browser | A Russian/emoji message was sent. Reopening the copied invitation retained the participant and message. Back to site and reopening chat retained the same full fingerprint and message. |
| English and Russian | Messenger and security controls rendered in both languages. The messenger was visually inspected. |
| Isolated Docker preview | Same-tab and same-origin second-tab return reused one identity. A separate-origin guest joined, exchanged messages and appeared disconnected after logout. At 390px the document had no horizontal overflow; desktop layout was visually inspected. |
| Production onion gateway | The same nine HTTP scenarios passed with its real onion Host/Origin through a loopback SSH tunnel. This repeat check did not traverse Tor. |
| Deployment | Web and relay healthy, zero restarts, no OOM; relay on one internal network with no published port or persistent mount. Existing environment and data mounts preserved; Telegram services not restarted; Tor active; nginx validation passed. |
| Published pages and report | Homepage, chat, security and JSON report returned 200. The JSON matched the tested 95-check report byte-for-byte. Chat/security responses carried CSP and no-store. |

Candidate completion: **17:41:08.148 UTC**. Production HTTPS: **17:42:16.810 UTC**. Production onion gateway: **17:43:52.114 UTC**. [Machine-readable results](presence-release-http.json).

[Public CI for this application](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34874952906) · [Session return and presence release notes](https://github.com/eugeneb1ack/disroot-secure-chat/blob/main/docs/secure-chat-presence-release.md) · [Deployment configuration](https://github.com/eugeneb1ack/disroot-secure-chat/blob/main/docs/deployment-verification.md).

## Earlier transport verification

The initial release was tested through an independent Tor client and the live v3 onion service at **2026-09-14T14:18:44.850Z**. That test ran client cryptography in Node through Tor SOCKS with remote hostname resolution; it was not a Tor Browser UI test. Earlier site regression runs passed 122 Arcade checks and six typing checks. These are historical results, not fresh runs for the current revision.

## Scope and limits

Keys remain memory-only. Closing or reloading the original document destroys them. Returning through an invitation can attach to a still-live original document in the same browser profile and origin; it cannot recover destroyed keys. The approved relay update ended its previous conversations. A subsequent report-only web update keeps the relay running.

Presence uses a 20-second timeout tested with an injected clock. Browser logout was directly checked; attempted browser network emulation did not produce an observable offline state and is not reported as a passed network-loss test. Browser/OS suspension may delay updates. A 390px viewport check does not establish physical-device keyboard behavior. The scope covers the listed browser scenarios and injected-clock checks. There are no user messages, invitation secrets, private keys or session tokens in these reports.

## Русский

Версия приложения `d76321a` опубликована 14 сентября 2026 года. Пройдено **95 автоматических проверок**, lint и production-сборка. Дополнительно на рабочем HTTPS-адресе проверены:

- Три независимых клиента: вход, MLS-переписка, текст и эмодзи, подключение третьего участника через другого собеседника.
- Три одновременные отправки: каждое сообщение доставлено один раз, ручные повторы не потребовались.
- Ответы, установка и снятие реакций. Новый участник не получает прежнюю переписку, в том числе через цитаты.
- Статусы участников и выход. После завершения всех сессий ссылка выдаёт понятную ошибку входа.
- Отклонение чужого Origin с HTTP 403 и no-store для API.
- В браузере: отправка сообщения, возврат по своей ссылке и через «На сайт» с сохранением fingerprint и истории; интерфейсы чата и security на русском и английском.

Те же девять HTTP-сценариев прошли через рабочий onion-шлюз по SSH-туннелю с его настоящими Host/Origin. Этот повторный прогон не проходил через Tor; отдельный тест сети Tor выполнен ранее, в 14:18:44.850 UTC. На изолированном Docker-превью также проверены повторный вход в другой вкладке, подключение и выход гостя, отсутствие горизонтального переполнения при ширине 390px.

Сайт и relay healthy, без перезапусков и OOM. Изоляция relay сохранена, Telegram не перезапускался, Tor активен. Публичный JSON-отчёт совпадает с проверенным локальным файлом. Старые контейнеры сохранены для отката кода, но прежняя переписка из RAM после согласованного обновления невосстановима. Обновление только отчёта в веб-контейнере оставляет relay и новые беседы работать.

Ключи исходной вкладки теряются при её закрытии или перезагрузке. Статус может задерживаться из-за сна браузера или ОС; тайм-аут проверен тестовыми часами. Тест потери сети через эмуляцию браузера не засчитан. Физическая мобильная клавиатура и суточная непрерывная работа не проверялись. Это техническая самопроверка. В отчётах нет переписки пользователей, секретных ссылок, ключей или токенов.
