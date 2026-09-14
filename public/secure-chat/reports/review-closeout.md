# Secure Chat v2 — review and remediation

Date: 2026-09-14. **Technical self-review; not an independent cryptographic audit.**

[English protocol](https://github.com/eugeneb1ack/disroot-secure-chat/blob/main/docs/secure-chat.md) · [Русский](https://github.com/eugeneb1ack/disroot-secure-chat/blob/main/docs/secure-chat.ru.md) · [Executed tests and source hashes](security-tests.json)

A Codex Security review examined a pre-release snapshot of the chat code in `lib/`. Coverage was partial: 12 of 31 files in that directory were reviewed, focused on Secure Chat. Unrelated Arcade, typing and Telegram code was excluded. The gateway, UI and deployment received separate integration and configuration checks. This is not a whole-site or infrastructure penetration test.

The pre-release review reported five medium-severity issues and one low-severity issue. They were corrected before publication. The following executable regression scenarios cover their relevant failure paths; successful regression tests are evidence of the specified corrections, not proof that all variants are impossible.

| Finding in the pre-release version | Correction | Executed regression |
|---|---|---|
| An invitation holder could present an alternate group without the pinned founder | Verify the founder leaf and a signed admission-certificate chain rooted in that key | Construct an alternate group using raw MLS primitives; reject its Welcome. Reject a broken certificate chain in a real founder roster. |
| A member could wrap another sender's signed payload in its own MLS message | Preserve the authenticated MLS sender leaf and match it to the application identity; bind the application signature to the epoch | An admitted adversarial peer decrypts Alice's real message and re-encrypts that signed payload; Alice's production receiver rejects it. |
| An invalid inner KeyPackage could abort an incumbent session during admission | Fully validate the MLS Add proposal before acquiring a write lease or encrypting a commit | Sign an outer join request containing an invalid inner KeyPackage; reject the guest and keep both incumbent clients exchanging messages. |
| Logged-out unadmitted sessions retained member reservations | Release unadmitted reservations on logout and enforce a two-minute deadline even without enqueue | Repeat 32 guest logins/logouts; a later guest can enter. Advance the clock for a login abandoned before enqueue. |
| Global capacity was checked before evicting old events | Compute eviction before capacity admission; reserve at most 1,000,000 encoded event characters per conversation | Fill all 16 relay windows to the 16,000,000-character limit and continue replacing events for 40 rounds. |
| The pinned library's zero-epoch-retention setting retained historical state | A small adapter clones only current-epoch data, empties historical state and wipes disposable source buffers | Reject withheld prior-epoch ciphertext after refresh; verify the retained copy has no old epochs and does not alias wiped live buffers. Compromise fixtures use the same adapter. |

## Additional checks

The linked report runs the actual client/store/handler integration and separate MLS compromise fixtures. It includes 16 real participants, concurrent sends and admissions, lost acknowledgements, fail-closed uncertain publication, challenge replay, Origin enforcement, private-JWK rejection, nickname collisions, context binding, tampering, parser bounds, key cleanup and the shared deadline. Bounded negative-input tests use 256 malformed packets and 32 ciphertext mutations. They are not an exhaustive fuzzer.

The compromise tests deliberately preserve a stolen-state copy. They demonstrate both cases: another participant's update does **not** repair that compromise, while an honest update by the affected participant prevents the old snapshot following the new epoch after the attacker loses endpoint access. No post-quantum or Signal-equivalence claim is made.

## Русский

Проверена предварительная версия клиентского протокола и relay. Найдено шесть проблем: подмена исходной группы, повторная упаковка чужого подписанного текста, отключение участника повреждённым KeyPackage, утечка незавершённых мест, блокировка записи при заполнении общего лимита и фактическое сохранение старых эпох библиотекой. Все шесть исправлены и покрыты отдельными повторными проверками до публикации.

Область проверки ограничена: 12 из 31 файла `lib/`, относящиеся к чату; это не аудит всего сайта. HTTP, браузер и конфигурация проверяются отдельно. Полный список выполненных тестов, дата, среда и SHA-256 исходников доступны в [отчёте](security-tests.json). Ускоренная проверка 24 часов использует тестовые часы, а не суточное ожидание. Отчёт не заменяет независимый аудит и не гарантирует отсутствие остальных уязвимостей.

Для независимой проверки или запроса материалов: [Telegram DM](https://t.me/mailsec). Please disclose exploitable issues privately; do not include live invitation links or private keys in public issues.
