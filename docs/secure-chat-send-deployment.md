# Send recovery: production verification

2026-09-14. Technical self-review.

The deployed site source is `41689b8`; the corresponding standalone public source is `e7d22d8`. The deployment updated the web container only. The existing relay kept the same container ID and start time; its active conversations were not reset. Telegram services and the Tor service remained running.

## Evidence

- [113 automated tests and source hashes](../public/secure-chat/reports/security-tests.md), lint and the immutable production Docker build passed. [GitHub CI for the public source](https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34886554311) passed.
- [Controlled network failure and browser recovery](../public/secure-chat/reports/send-recovery.md): a local test proxy repeatedly discarded publication acknowledgements for more than one minute. Reload retained the same participant and pending packet; normal responses completed delivery once.
- Before promotion, the candidate passed nine HTTP scenarios through a loopback SSH tunnel. The same nine scenarios passed on public HTTPS after promotion at `2026-09-14T19:32:50Z`.
- A browser participant created on the previous release resumed after the production update with the same full fingerprint. A text message containing an emoji was sent and confirmed. Back to site → Open Secure Chat restored that conversation and its message directly, without entering a nickname again. A second reload retained the confirmed message. New chat then ended only this disposable test session and opened the new-conversation form.
- The deployed web and relay were healthy, with no OOM or restart counter increase. The previous web container was retained for rollback. All 36 static files from the previous image remain available in the new image for already-open pages.
- The published recovery report was compared byte-for-byte with the source. Homepage HTML now requires revalidation; `/secure-chat` uses `Cache-Control: no-store, private`.

## HTTP scenarios

1. Challenge authentication, encrypted admission and retention of the creator.
2. Bidirectional MLS text and Unicode emoji.
3. Authenticated encrypted replies, reactions and reaction removal.
4. Third-participant admission through a non-founder, without pre-join history.
5. Reply references do not expose pre-join message content to a new participant.
6. Three simultaneous writers deliver one copy of each message without manual retries.
7. Cross-origin requests are rejected and API responses are not cached.
8. Authenticated presence and explicit logout preserve verified member identities.
9. An invitation with no remaining participant capable of admitting a guest returns an explicit error.

These checks used disposable test conversations. No user's invitation or correspondence was opened. Production traffic was not fault-injected. This is not a 24-hour endurance test or a claim that every browser configuration is covered. Already-deleted private keys cannot be reconstructed from an invitation.

## Русский

В production опубликован код сайта `41689b8`, публичная версия исходников — `e7d22d8`. Обновлён только web-контейнер. Relay сохранил прежние ID и время запуска; действующие беседы не сбрасывались. Telegram и Tor продолжили работу.

Прошли 113 автоматических тестов, lint, production-сборка и GitHub CI. На candidate, затем на публичном HTTPS прошли девять сценариев: вход, обмен сообщениями, ответы и реакции, третий участник, ограничение истории, одновременная отправка, проверка Origin, presence и корректная ошибка для оставленной всеми беседы.

В браузере участник, созданный до обновления, восстановился с прежним fingerprint. Сообщение с эмодзи отправилось и подтвердилось. Возврат через главную и Open Secure Chat открыл прежнюю переписку без повторного ввода имени. Повторная перезагрузка сохранила подтверждённое сообщение. Кнопка New chat затем завершила только эту тестовую сессию и показала форму новой беседы. Контрольная локальная потеря подтверждений больше минуты, включая перезагрузку, отдельно описана в отчёте о восстановлении.

Это техническая самопроверка на тестовых беседах. Ключи и сообщения пользователей в отчёт не включены. Проверка не заменяет суточный нагрузочный прогон и не восстанавливает ключи, которые уже были удалены старой версией или настройками браузера.
