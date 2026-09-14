# Secure Chat release verification — 2026-09-15 MSK

Runtime source: `3573c43` in the site repository. Public source: `63716b5` in `eugeneb1ack/disroot-secure-chat` (documentation-only commits can follow). Web and relay use the corresponding `3573c43-amd64` images.

- 115 automated checks passed: 106 integration scenarios and nine MLS laboratory scenarios. Both repositories have reports whose source SHA-256 entries match their own checked files.
- ESLint, production Docker builds and GitHub CI passed. CI run: https://github.com/eugeneb1ack/disroot-secure-chat/actions/runs/34897727281
- Nine HTTP scenarios passed against an isolated candidate and again through the public HTTPS route after activation: admission, bidirectional Unicode/emoji, encrypted replies/reactions/removal, a third participant admitted by a non-founder, history boundaries, three concurrent writers, Origin rejection/no-store, online/offline status and orphaned-invitation rejection.
- Published test JSON and the bilingual interface report match the release files byte-for-byte. The Russian Security page was inspected at 320 × 568 without paragraph/table-cell horizontal overflow.
- Web and relay were healthy with zero restart counts after activation. nginx configuration validation passed; Tor stayed active. Telegram containers retained their original IDs and start times. Their environment and the site's data mounts were preserved.
- All 48 static files from the previous web release retain their SHA-256 hashes in the new image (57 static files total).

The previous relay had rejected a new test conversation with a capacity error. The new implementation reclaims unreachable conversations when the room bound is reached, without evicting admitted offline sessions. The user's prior authorization to clear keys was used for this relay transition: old production invitations do not restore conversations through the new relay. Users must start a fresh conversation. The old isolated relay was retained on its old private network for rollback and applies its existing expiry clock; it is no longer the public chat's relay. No message/key state was copied between relays.

Physical iOS/Android long-press and software-keyboard behavior was not tested on hardware. The lower-edge right-click regression was reproduced and verified in the browser, as were menu dismissal, encrypted reactions, reload recovery and multiple-tab UI use. This is a technical self-review of the implementation.

## Проверка выпуска

Выпущены web и relay из `3573c43`. Успешно прошли 115 автоматических проверок, lint, Docker-сборки и CI. Девять сетевых сценариев выполнены на отдельном кандидате и повторно через публичный HTTPS после переключения. Проверены сообщения, ответы, реакции, одновременная отправка трёх участников, вход третьего участника, границы истории, Origin, отсутствие кеширования API и статусы подключения.

Опубликованные отчёты совпали со сборкой. Русская Security-страница проверена при 320 × 568 без горизонтального переполнения текста и ячеек. Web/relay здоровы, счётчики перезапусков — ноль; nginx проходит проверку, Tor работает. Telegram не перезапускался, окружение и том данных сайта сохранены. Все 48 прежних статических файлов остались с исходными хешами.

При переключении использовано ранее данное разрешение сбросить ключи ради исправления. Старые production-ссылки относятся к прежнему relay: для продолжения нужно создать новую беседу. Прежний изолированный relay сохранён для отката, без публичного маршрута; его данные удаляются по исходным срокам. Ключи и состояние между relay не переносились.

Физический iPhone/Android с экранной клавиатурой в этом прогоне не проверялся. Мигание при правом клике снизу сообщения воспроизведено и исправлено; браузерная проверка меню, реакций, перезагрузки и нескольких вкладок выполнена. Это отчёт о технической проверке реализации.
