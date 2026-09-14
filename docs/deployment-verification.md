# Deployment verification

Released: **2026-09-14**. Site revision: `1042d0b5dff43c69ecf187e3ab54629b5cb5da5f`. Web and relay images: `disrootsite:1042d0b-amd64` and `disrootsite-chat-relay:1042d0b-amd64`.

[Open chat](https://disroot.website/secure-chat) · [Technical Self Review, EN/RU](https://disroot.website/secure-chat/security) · [Machine-readable evidence](secure-chat-deployment-verification.json) · [Security tests](../public/secure-chat/reports/security-tests.md)

## Executed after deployment

| Check | Result |
|---|---|
| Public HTTPS: three clients, encrypted admission, text and emoji both directions | PASS — 2026-09-14T14:27:46.852Z |
| Live onion through an independent Tor client: same three-client MLS scenario | PASS — 2026-09-14T14:34:12.963Z |
| New guest history and cross-origin rejection | No earlier readable messages; foreign Origin returns 403. |
| Browser: desktop 1280 × 720 and mobile 390 × 844 | Two participants remain in one chat; messages and emoji deliver both ways; no mobile horizontal overflow. |
| Reload | Keys and readable session are discarded; generation form returns. |
| Navigation and Security | Unlabelled chat square, ARCADE label retained; English/Russian descriptions and reports work. |
| Public routes | Home, chat, Security, published test reports, Telegram feed and Arcade leaderboard return 200. `www` redirects to the canonical HTTPS host. |
| Chat response policy | No-store, nonce-based CSP, no-referrer, no chat cookies. HTTPS retains upgrade-insecure-requests; only the exact onion host omits it. |
| Relay isolation | Internal network only, no published port or mounts, non-root, read-only, all capabilities dropped, no-new-privileges, resource limits. A TCP egress probe fails with ENETUNREACH. |
| Runtime health | Web and relay healthy, zero restarts, no OOM; swap disabled. Request logging disabled for chat. |
| Existing services and data | Telegram poller/proxy keep the same IDs and start times. All nine existing data files remain; eight hashes match, only the existing live Telegram-feed file changed. |
| npm production advisory check | `npm audit --omit=dev`: zero reported vulnerabilities on this date. This checks known advisories, not undiscovered defects. |
| Public CI | [62 security tests, lint and production build passed](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34855221736) on Node 22/Linux. |

The deployed cryptographic and relay source files match the public repository's tested core. SHA-256 hashes are in [the security report](../public/secure-chat/reports/security-tests.json); site and standalone package metadata differ. The previous site container and nginx configuration were retained for rollback.

The optional onion address is published on the site's Security page. Tor uses the same VPS and a separate restricted service. Only chat routes and required static assets are forwarded through its loopback listener; Telegram and Arcade APIs return 404 there. The Tor service identity persists to retain its address and contains no chat history.

## Limits and diagnostics

This is a technical self-review, not an independent cryptographic audit. The onion check used the actual client code in Node with curl/SOCKS remote DNS through a separate Tor client. It is not a Tor Browser UI certification. Initial circuits needed warm-up; an initial post-release test lost its SSH diagnostic tunnel and passed after that tunnel was restored. HTTPS did not use that test tunnel. Network timing varies.

Temporary diagnostic SOCKS listeners and setup logs are removed after validation. The dedicated onion service stays active. The RAM relay has no special test-data deletion bypass: synthetic test conversations follow the same 24-hour deadline as any other conversation. Expiry tests use injected time; no 24-hour endurance run or physical erasure guarantee is claimed.

## Русский

Версия `1042d0b` опубликована 14 сентября 2026 года. После выкладки три клиента обменялись MLS-сообщениями и эмодзи через публичный HTTPS и настоящую сеть Tor. Новый гость не получил прежней истории; чужой Origin отклонён с 403. В двух браузерных вкладках проверены вход, сохранение создателя в беседе, двусторонняя доставка и эмодзи-панель. На размере 390 × 844 ширина документа — 390, горизонтального переполнения нет. Перезагрузка возвращает форму генерации ключей. Security работает на английском и русском; в навигации вместо CHAT остаётся квадрат, ARCADE сохраняет подпись.

Web и relay здоровы, без перезапусков и OOM. Relay работает без root, постоянного диска, секретов сайта и опубликованного порта, в закрытой Docker-сети. Проба исходящего TCP-соединения вернула ENETUNREACH. Файловая система только для чтения, capabilities сняты, действуют лимиты ресурсов; swap и логирование запросов чата отключены.

Telegram-poller и его proxy не перезапускались. Все девять прежних файлов данных сохранены; восемь совпадают по SHA-256, изменился только файл действующей Telegram-ленты. Главная страница, чат, отчёты, лента и Arcade API отвечают 200. Предыдущий контейнер сайта и nginx-конфигурация сохранены для отката.

Публичный CI прошёл 62 проверки безопасности, lint и production-сборку. Проверка опубликованных npm advisory для production-зависимостей не нашла известных уязвимостей на дату релиза. Это не доказательство отсутствия новых ошибок.

Tor проверялся реальным криптографическим клиентом через отдельный Tor-процесс, а не интерфейсом Tor Browser. Первая попытка после релиза потеряла диагностический SSH-туннель; после его восстановления полный сценарий прошёл. Временные SOCKS-порты и setup-логи убраны; рабочий onion-сервис остаётся активным. Синтетические тестовые беседы удаляются по обычному сроку, специального административного обхода нет. Проверка 24 часов использует тестовые часы. Независимый аудит и гарантированное физическое стирание памяти не заявляются.
