# Secure Chat — session recovery verification

Date: 2026-09-14. Technical self-review, not an independent audit.

**109 automated checks passed**: 100 integration/negative scenarios and 9 MLS laboratory scenarios. Lint and the production Docker build passed. [Executed tests, source hashes and raw TAP](security-tests.md) identify the tested sources. Browser checks below are separate from that count.

## What changed

The old browser implementation held keys only in the original document. Reload destroyed that participant's keys. The new implementation durably stores an AES-256-GCM encrypted IndexedDB checkpoint before publishing ciphertext. Reload and reopening the invitation restore the same identity, MLS state, transport session and up to 256 locally received messages, in the same browser profile and origin. The shared deadline is unchanged.

Web Locks permit one active cryptographic writer. Other tabs use BroadcastChannel without receiving its private keys or token. Closing a page suspends the connection. End session deletes the local record and revokes the token. Neither local checkpoints nor private keys are uploaded to the relay.

## Observed browser checks

| Scenario | Result |
|---|---|
| Reload the creator's document | Same full fingerprint, nickname and previously sent message; no new-identity form. |
| Close the creator's tab and open its invitation in a new tab | Same participant, existing messages and two online participants. Sending after return succeeded. |
| Separate-origin guest | Independent keys, admission, reload and bidirectional text/emoji; no pre-admission message history. |
| End session, then reload | Returned to the identity form; the ended participant was not restored. |
| Replace only the preview web container | Existing session and history survived replacement and reload into the new web build. |
| Second tab, same profile and origin | Attached to the existing participant; two participants remained two, with one cryptographic writer. |
| Names and layout | Larger author names beside every message, explicit own-name label, readable roster summary and fingerprint identifiers. Desktop visually inspected. |
| EN/RU and mobile width | Both interface languages checked; document width equals viewport width at 390px. No horizontal overflow. |

## Automated crash and integrity scenarios

- Restore one or both clients, including a guest waiting for admission.
- Interrupt a write after server acceptance but before local acknowledgement: retry identical ciphertext, append once and continue with the next generation.
- Interrupt before publication and expire its lease: reclaim only at the same sequence; resend the saved packet unchanged.
- Interrupt an admission commit, or reload after a durable Welcome before relay ACK.
- Reject expired sessions, invalid signing keys, modified vault ciphertext, context or wrapping key.
- Retain the checkpoint on temporary relay failure, including interrupted HTTP response bodies and invalid gateway responses.
- Block publication on local storage failure; delete saved state and revoke transport access on End session.

## Limits and deployment

This is a client update; the relay protocol and its deployed process are unchanged. Web deployment must preserve the existing relay container and its start time. Older hashed web assets are retained for already-open pages. Already-destroyed keys from the previous implementation cannot be recovered by this update.

Browser tab close/reopen and page reload were exercised. A complete OS/browser-process restart, physical mobile keyboard and 24-hour endurance run were not exercised. The IndexedDB wrapping key is non-extractable through Web Crypto, but it is stored in the same profile: malicious same-origin JavaScript or device compromise can decrypt the record. Browser eviction, private mode, another origin/device, relay restart or missed events outside its bounded window can prevent restoration. If the browser is closed at expiry, it cannot execute cleanup; expired records are refused and removed on the next visit. Physical disk erasure, backups and recipient copies are not controlled.

[Previous presence/transport/onion release checks](presence-release-checks.md) are historical evidence for revision d76321a, not additional tests claimed for this patch. No real user messages, invitation secrets, private keys or session tokens are included.

## Русский

Исправлена потеря участника при перезагрузке: никнейм, ключи, транспортная сессия и до 256 полученных сообщений сохраняются в зашифрованной записи IndexedDB. Своя ссылка в том же профиле браузера и на том же origin возвращает в ту же беседу. Закрытие страницы не означает выход. «Завершить сессию» удаляет запись и отзывает токен. Общий срок до 24 часов не продлевается.

Пройдено **109 автоматических проверок**, lint и production-сборка. В браузере проверены перезагрузка создателя, закрытие вкладки и возврат по ссылке с прежним fingerprint и историей, отправка после возврата, независимый гость, повторная вкладка без дубликата участника, EN/RU. При ширине 390px горизонтального переполнения нет; десктопный интерфейс осмотрен визуально.

Тесты моделируют прерванную отправку до и после приёма сервером, истечение права записи, прерванный вход, Welcome до подтверждения, подмену локальных данных, сбои хранения и сети, завершение и истечение сессии. Повторно передаётся только сохранённый шифротекст; повторное использование поколения ключей запрещено.

Обновляется веб-часть. Relay с живыми беседами перезапускать нельзя. Уже потерянные ключи старой версии не восстанавливаются. Полный перезапуск процесса браузера, физическая мобильная клавиатура и сутки непрерывной работы не проверялись. Очистка данных сайта, приватный режим, другой origin/устройство, перезапуск relay или пропущенное окно событий могут помешать возврату. Локальное шифрование не защищает от взломанного кода сайта или устройства. При закрытом браузере просроченная запись удаляется при следующем посещении; физическое стирание и удаление копий не гарантируются. Это самопроверка, не независимый аудит.
