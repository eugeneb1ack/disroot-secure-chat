# Session recovery — production verification

Date: 2026-09-14. Runtime source: `aed5639` (site), `35ab627` (public chat repository). Web image: `disrootsite:aed5639-amd64`. This document records checks after deployment; documentation-only commits do not change that runtime revision.

- 109 automated checks passed, with 19 source hashes verified against the deployed report. [Test report](../public/secure-chat/reports/security-tests.md).
- Public CI completed successfully: [run 34882097490](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34882097490). It repeated tests, lint and the production build on Node 22.
- Candidate and production HTTPS each passed all nine real HTTP scenarios: authentication/admission, bidirectional MLS text and emoji, replies/reactions, third-member admission without earlier history, private quote handling, three simultaneous writers, foreign-Origin rejection/no-store, presence/logout and orphaned invitation refusal.
- Candidate check: 2026-09-14T18:43:56.730Z. Production check: 2026-09-14T18:45:40.518Z.
- All 25 previous hashed/static files remained available in the new image (36 total), preserving assets used by already-open documents.
- A browser conversation created before deployment sent a message afterwards with the same identity. Its document was not reloaded for this continuity test.
- A new production browser conversation was then created and sent a message. A real document reload restored its exact full fingerprint, nickname and message without the identity form. A subsequent message was successfully sent after restoration.
- The website and relay were healthy, with zero web-container restarts and no OOM. Relay and both Telegram containers retained their exact container IDs and start times. Tor remained active. Existing environment values and data mounts were preserved. Nginx configuration validation passed.
- The previous web container/image and nginx configuration were retained for rollback. Only the web container was replaced; relay RAM state remained active.

The [browser and crash-test report](../public/secure-chat/reports/release-checks.md) covers local tab close/reopen, guest reload, multiple tabs, explicit End session and 390px layout checks. These are distinct from a full browser-process restart or a 24-hour endurance run, which were not performed. Already-destroyed keys from the previous version are unrecoverable. There are no user messages, invitation secrets, keys or tokens in these reports. This is a technical self-review.

## Русский

В production опубликован веб-образ `aed5639`, соответствующий публичному исходному коду `35ab627`. Документационные коммиты после выкладки не меняют версию работающего кода.

109 автоматических проверок прошли локально и повторно в GitHub CI вместе с lint и production-сборкой. Девять HTTP-сценариев прошли отдельно через candidate и основной HTTPS-адрес: вход, шифрованная переписка, ответы/реакции, третий участник, отсутствие прежней истории, три одновременные отправки, Origin/no-store, статусы и выход.

В браузере беседа, открытая до выкладки, продолжила отправку после переключения с прежним участником. Затем создана сессия новой версии: после настоящей перезагрузки страницы вернулись тот же полный fingerprint, никнейм и сообщение, без формы создания участника. Отправка нового сообщения после восстановления также прошла.

Обновлён только веб-контейнер. ID и время старта relay и Telegram не изменились, Tor активен, веб и relay healthy, OOM нет. Сохранены все 25 старых статических файлов, параметры окружения, монтирования, предыдущий контейнер и конфигурация nginx для отката. Живое состояние relay не уничтожалось.

Полный перезапуск процесса браузера и суточный прогон не выполнялись. Закрытие/повторное открытие вкладки, возврат гостя, несколько вкладок, явный выход и ширина 390px проверены на изолированном превью и описаны в отдельном отчёте. Уже потерянные ключи старой версии восстановить невозможно. Это техническая самопроверка.
