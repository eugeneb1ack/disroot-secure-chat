# Messenger release verification — 14 September 2026

Runtime source: `7c1505e` (site). Public implementation: `d65ee16fe8c38471757b19f95f4d60c56413f84a`.

[Production](https://disroot.website/secure-chat) · [Technical self-review, EN/RU](https://disroot.website/secure-chat/security) · [77 automated checks](https://disroot.website/secure-chat/reports/security-tests.md) · [Public CI](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34864690394)

## Implemented and checked

- Compact auto-growing composer, emoji insertion at the cursor, Enter to send and Shift + Enter for a new line. Reply preview, verified local quotes and a compact message action menu.
- Six reactions, one per participant per message, with explicit replacement/removal. Replies and reactions are signed application data inside MLS. The relay contract and storage remain unchanged.
- EN/RU inside the chat. Switching languages preserves the draft and identity. The outer landing page remains English; Secure Chat precedes the final Arcade slide.
- Same-profile, same-origin live-tab resume: opening the invitation attaches to the original client without another relay login. The owner alone holds private keys and the relay token. A mirrored view forwards commands and receives readable UI state over a local BroadcastChannel.

## Automated checks

`npm run test:chat:report`: **77 passed** (68 production integration/hostile-input checks and 9 MLS laboratory fixtures). The generated JSON report includes source SHA-256 hashes and raw TAP output. This release adds 15 checks for replies, reactions, malformed or substituted metadata, history boundaries, idempotency, immutable view snapshots and live-session reuse.

`npm run lint` and `npm run build` passed for the site and standalone public project. The immutable Linux/amd64 Docker build passed. Public CI completed successfully for the implementation commit above.

## HTTP verification

`scripts/check-secure-chat.mjs` ran against the final local image, a loopback production candidate with real Host/Origin, and the published HTTPS site.

- Local image: 2026-09-14 15:46:14 UTC — passed.
- Production candidate: 2026-09-14 15:50:27 UTC — passed.
- Published HTTPS: 2026-09-14 15:52:03 UTC — passed.

Each run established three independent temporary clients and verified challenge/sign-in, encrypted admission, bidirectional Unicode/emoji messages, authenticated replies, reaction set/removal, non-founder admission, no pre-join history (including through replies), cross-origin rejection and no-store API responses. Test participants closed their keys afterward. Their ciphertext follows the ordinary relay deadline; no cleanup bypass exists.

## Browser verification

Codex in-app browser, local final image and published HTTPS:

- Local two-participant exchange: guest message, reply through a mirrored view, correct verified quote at the recipient, and reaction to that reply.
- Automatic same-identity resume with retained readable history, without creating a second member; verified locally and on production.
- Hiding/reopening the landing-page chat preserves its session. Explicit End session in an attached view closes the original identity; merely closing an attached view leaves the owner alive (covered by integration tests).
- Desktop layout and mobile widths 390 and 320 pixels; no horizontal document overflow at the tested widths. The composer remains within the viewport and the narrow message menu wraps within the message column.
- Growing/shrinking input, multiline draft, emoji insertion, language switch with draft preservation, and Escape/focus return for the emoji and message-action panels.
- Updated EN/RU technical explanation and live test-report delivery verified on the public site.

## Production state

Web: `disrootsite:7c1505e-amd64`, healthy. Relay: `disrootsite-chat-relay:1042d0b-amd64`, unchanged and healthy. Relay and Telegram container IDs/start times were checked unchanged. Web environment and persistent site mounts were preserved. The previous web container is retained for rollback. HTTPS and the onion gateway point at the new web process; the onion gateway returned HTTP 200 and its Tor service remained active.

Image archive SHA-256: `a27e500ae21f4ba09caa49fa4e55d118cdedd8ffc80314c7ea82983b2c7bf62f` (matched before loading on the server).

## Limits

This is a technical self-review. The expiry tests advance an injected clock; no new 24-hour endurance test was performed. New onion checks covered the existing local gateway and service status; a full Tor-network exchange was not rerun for this UI release (the previous deployment report records that earlier check). Mobile checks use browser viewport sizes, not a physical iOS/Android keyboard. Browser suspension can delay the original tab; its closure/reload still destroys the identity. No persistent key backup or restore was added. People sharing a browser profile can access that profile’s live session. The same-origin website and browser remain trusted.

## По-русски

Опубликован веб-клиент `7c1505e`: новое поле ввода, ответы, реакции, EN/RU и возврат по ссылке в открытую сессию. Прошли 77 автоматических проверок, lint, production-сборка и CI публичного репозитория. Реальный HTTP-обмен трёх клиентов проверен локально, на кандидате и после публикации. В браузере проверены ответы и реакции между участниками, повторное открытие своей сессии, сворачивание окна, смена языка без потери черновика и узкие мобильные экраны.

Relay и Telegram не перезапускались. Старый веб-контейнер сохранён для отката. Ключи остаются в исходной вкладке; дополнительная вкладка использует её очередь шифрования. После закрытия или перезагрузки исходной вкладки восстановить прежнюю личность нельзя. Физический мобильный клавиатурный ввод, новый суточный прогон и повторный полный обмен через сеть Tor в этот релиз не входят. Область выполненных проверок описана в этом отчёте.
