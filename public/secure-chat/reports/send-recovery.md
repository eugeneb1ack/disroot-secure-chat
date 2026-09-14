# Sending and session return — regression checks

2026-09-14. Technical self-review.

## Defects and correction

A temporary failure during publication previously took the same destructive path as an integrity failure: it removed a saved participant even though an exact pending ciphertext and candidate MLS state were already durable. Two regression tests reproduced this before the fix (the client was closed where persistence was expected). They pass with the corrected outbox lifecycle.

Pending ciphertext now stays in the encrypted vault and is retried automatically, unchanged, before any new operation. A temporary outage during reload returns the verified local conversation instead of a new-identity form. New sends are blocked while an earlier packet is awaiting confirmation. The composer remains editable and displays a distinct pending bubble. Integrity failures still stop the session; no candidate rollback or encryption-generation reuse is introduced. Durable clients attempt publication once per operation (8-second HTTP timeout); subsequent polls perform recovery, replacing the previous three consecutive blocking attempts.

The landing-page modal also did not reopen after a document reload. Its page allowed stale HTML for an hour. Open Chat and new invitations now use the no-store /secure-chat page. Legacy root fragments redirect there without placing the invitation secret in an HTTP request. Landing HTML must revalidate. New chat explicitly ends the current session and bypasses restoration when creating the next one.

## Executed checks

- **113 automated tests passed**, with lint and a production Docker build. [Raw results, commands and source hashes](security-tests.md).
- New regressions cover lost publication acknowledgement, offline-before-publication plus reload, interrupted key refresh and canonical routing of legacy invitation fragments. The existing offline-restore check now also asserts that the verified participant remains available during the outage.
- An isolated local proxy repeatedly forwarded the test packet to the real test relay but discarded its acknowledgement. The browser kept the same full fingerprint and pending message for more than one minute, including a document reload during the failure.
- After the proxy resumed normal responses, the browser confirmed the message exactly once and returned to the online state. No new participant was created. The automatic tests also verify that both retry ID and ciphertext are identical and the recipient receives one message.
- Back to site followed by Open Chat restored the same conversation, nickname, fingerprint and history without an intermediate opener or identity form.
- New chat produced a different fingerprint and an empty new conversation; the prior conversation was not reopened.
- A legacy invitation using /#secure-chat?... redirected to /secure-chat with its fragment preserved until client consumption.
- Before the patch, five ordinary production text exchanges were measured independently: 557–609 ms for send plus recipient poll. API requests were mostly 129–181 ms. This baseline did not reproduce every condition of the user's browser; the destructive error path was reproduced with controlled faults.

No production traffic was intercepted or fault-injected. The fault proxy was local, used disposable test sessions, and is not part of the runtime image. No real invitation, private key, token or user message is in this report. The checks cover the browser and recovery scenarios listed above.

## Русский

Воспроизведена ошибка: временный сбой отправки удалял сохранённого участника, хотя точный шифротекст уже находился в локальной записи. Теперь исходящий пакет переживает потерю ответа и перезагрузку; повторяется тот же пакет с тем же ID, без нового шифрования и дубликатов. При временном сбое восстановления показывается прежняя беседа, а не форма нового пользователя. Нарушение целостности по-прежнему останавливает сессию.

Open Chat и новые приглашения открывают отдельную страницу /secure-chat без кеширования. Старые ссылки с главной переводятся туда, секрет остаётся во фрагменте. Главная страница требует перепроверки HTML. «Новый чат» явно завершает прежнюю сессию и создаёт следующую, не восстанавливая предыдущую.

113 автоматических тестов, lint и production-сборка прошли. В браузере локальный proxy больше минуты терял подтверждения после реального приёма пакета relay. Прежний fingerprint и ожидающее сообщение сохранились даже после перезагрузки. После отключения сбоя сообщение подтвердилось один раз. Проверены также возврат через главную и Open Chat, старый формат приглашения. Обычные пять обменов на production до исправления заняли 557–609 мс каждый, включая опрос получателя; все условия браузера пользователя этот замер не воспроизводит.

Сбои вносились только в изолированный тестовый proxy. Переписка пользователей, ключи и токены в отчёт не включены. Это техническая самопроверка.
