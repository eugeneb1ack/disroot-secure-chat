# Secure Chat — session return and participant presence

2026-09-14. Technical self-review; not an independent audit.

## Changes

- The live session and admission poller belong to the document, outside React screen lifetimes. Next client navigation to the main site and reopening chat reuse its identity and messages.
- A background document continues polling; focus, visibility and network wakeups trigger an immediate attempt. Concurrent client polls share one in-flight operation.
- Invitations use the current chat document path (`/` or `/secure-chat`). Reopening the copied invitation in that document changes its fragment instead of loading a different document.
- Participant presence uses authenticated relay reads with a 20-second timeout. A signed, encrypted `connection-v1` profile extension binds the MLS fingerprint to a temporary transport ID. Invalid signatures and duplicate bindings are rejected. No plaintext nickname or fingerprint is added to relay records.
- The participant panel distinguishes online, disconnected, joining and unknown states. Disconnection does not remove cryptographic membership or rewrite message attribution.
- An invitation with no surviving admitted session receives an explicit error. If surviving transports have stopped polling, new sign-in asks the guest to wait for an original tab to reconnect. A waiting guest receives an explicit error if the last admitted session leaves.
- A Back to site link and a separate Start a new conversation action replace dead-end navigation. EN/RU guide and security review describe the implementation.

## Write-lease contention fix

A reproducible regression held another participant’s lease for 250 ms. The previous client exhausted eight immediate retries in roughly 75 ms and rejected the send before the lease was released. User sends now back off with jitter before encryption, allowing an abandoned 20-second lease to expire within a 25-second contention budget. Background admission and key refresh yield rather than expose routine contention as a connection error. The composer shows Sending / Отправляем and retains an unsent draft. Tests cover delayed lease release, four simultaneous writers without manual retries, background admission yielding and cancellation before encryption. Individual HTTP timeouts remain separate from the contention budget.

## Verification

The [automated report](../public/secure-chat/reports/security-tests.md) contains the exact checks, raw TAP and source hashes. The regression cases cover presence timeout/reconnection/logout, metadata privacy, forged and duplicate profile bindings, immutable views, old relays, malformed snapshots, orphaned invitations, background admission, poll teardown and SPA session retention.

Browser checks against an isolated Docker preview:

- Reopen the copied landing-page invitation in the same tab: the path stays `/`, the same fingerprint and message remain, and no nickname form appears. Open that link in another same-origin tab: it attaches to the same identity, with one participant rather than a duplicate.
- Create a conversation, send a message, follow Back to site, reopen chat: same nickname, full fingerprint and local message retained.
- Invite a second browser origin through the same isolated relay: both participants become ready, see two online and exchange messages; the new guest has no prior history.
- End the guest session: the founder sees one online and the guest marked Disconnected / Нет связи; the verified roster still has two members.
- EN/RU participant controls render in the site's existing style. At 390px the document has no horizontal overflow. Desktop layout was visually inspected.
- Real HTTP presence check: three online identities, logout marks the departed profile offline without removing it, and closing all test sessions makes a new admission fail explicitly.
- Real HTTP gateway/relay smoke: three participants, non-founder admission, text/emoji, replies, reaction set/remove, no pre-join history, foreign-Origin rejection and no-store responses.

## Limits

- Keys remain memory-only. Closing or reloading the original document, browser eviction or browser shutdown still loses them. Returning through a copied invitation can reuse an original document that remains alive in the same browser profile and origin; it cannot reconstruct destroyed keys.
- Presence is relay-reported availability, not proof of identity, instantaneous disconnect detection or cryptographic revocation. The OS can suspend background pages. No attempt is made to bypass browser power management.
- The 20-second timeout is exercised with an injected relay clock. Browser logout was checked directly; browser network emulation did not produce an observable offline state and is not counted as a passed network-loss test.
- These are bounded regression/security tests, not an independent audit, a physical-device keyboard test or a 24-hour endurance run.
- Updating the RAM-only relay ends its active conversations. Deployment requires an explicit release window; deployment evidence is recorded after release, not inferred from local tests.

## Русский

Сессия теперь живёт вне React-экрана: переход «На сайт» и возвращение через интерфейс сайта сохраняют никнейм, ключи и прочитанные сообщения. Скопированная ссылка использует текущий путь страницы, чтобы повторный переход в том же документе не вызывал перезагрузку. Фоновая вкладка продолжает подключать гостей.

Список участников показывает, кто онлайн, кто подключается и у кого нет связи. Без успешного опроса статус истекает через 20 секунд. Relay хранит только последнее время опроса временной сессии в RAM. Никнеймы и связь fingerprint с транспортом остаются в подписанных зашифрованных профилях. Статус не отзывает ключ и не подтверждает личность человека.

Потерянные ключи восстановить нельзя: закрытие или перезагрузка исходного документа остаются границей сессии. Если принять гостя больше некому, вход выдаёт понятную ошибку, а не создаёт ещё одного участника в бесконечном ожидании. Фактические тесты и ограничения перечислены выше; это техническая самопроверка, не независимый аудит.

Browser lifecycle references: [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API). Background timers and document lifetimes are browser-controlled; the implementation does not promise persistence after a document is destroyed.
