# Interface and multiple-tab regression checks

Verification date: 2026-09-14. This is an implementation report, not an independent security audit.

## Reproduced delivery failure

Multiple tabs sharing one identity used to trigger extra relay polls through the owning tab. Their combined reads could exhaust that session's read quota and surface HTTP 429 while sending. The new integration test failed against the previous implementation with `Too many requests. Retry shortly.`

Only the session owner now polls the relay. Mirror tabs read the owner's verified view over the existing same-origin BroadcastChannel. The regression test opens two mirrors, requests 35 polls from each, checks that they cause no extra relay reads, then verifies an incoming message reaches both mirrors and an outgoing message from a mirror reaches its peer. Relay limits and cryptographic validation are unchanged.

## Executed checks

- `npm run test:chat:report`: **114 passed** — 105 integration scenarios and nine MLS laboratory scenarios. [Machine-readable report](security-tests.json), [integration TAP](integration.tap), [MLS TAP](mls-ratchet.tap).
- ESLint and an isolated Docker production build completed successfully.
- Browser checks: reload restored the same temporary identity, message history, encrypted reply and reaction. Reply and reaction controls submitted actual test messages. Clicking outside the help panel and pressing Escape dismissed it; the conversation did not resize.
- Responsive inspection: chat at 390 × 844, 320 × 568 and a reduced 390 × 450 viewport; Security in English and Russian at 320 × 568. DOM measurements found no horizontal overflow in the review's paragraphs or table cells. The threat-model table becomes vertical cards on small screens.
- Message actions render above the conversation rather than inserting another row. Keyboard focus remains visible on controls; jumping to a quoted message no longer draws an outline around the entire row.

## Scope and limits

The new long-press handler cancels on movement, pointer cancellation, page blur, visibility change and unmount. Physical touch gestures and the iOS/Android software keyboard were not verified on real hardware in this run. The frame follows VisualViewport resize/scroll events without remounting the session; this is not a claim that every mobile browser has been tested.

The reported string `This room no longer exists.` was found in an old local development bundle and was absent from the current production client and relay examined during this run. Its occurrence in the user's session was not reproduced, so this report does not attribute that incident to the multiple-tab defect. A relay restart or the shared expiry really does remove the server's volatile conversation state; the client cannot reconstruct that state from an invitation alone.

No user conversations, invitation secrets or private keys are included in this report. The browser checks used a separate synthetic conversation.

---

# Проверка интерфейса и нескольких вкладок

Дата проверки: 14 сентября 2026 года. Это отчёт о реализации, не независимый аудит безопасности.

## Воспроизведённый сбой отправки

Дополнительные вкладки одного участника вызывали новые опросы relay через основную вкладку. Вместе они могли исчерпать лимит чтения сессии и получить HTTP 429, мешающий отправке. Новый регрессионный тест на прежней реализации завершился ошибкой `Too many requests. Retry shortly.`

Теперь relay опрашивает только вкладка, владеющая сессией. Остальные получают её проверенное состояние через существующий BroadcastChannel того же origin. Тест открывает две дополнительные вкладки, выполняет по 35 запросов, проверяет отсутствие лишних обращений к relay, затем доставку входящего сообщения в обе вкладки и исходящего сообщения из дополнительной вкладки собеседнику. Серверные лимиты и криптографические проверки сохранены.

## Что проверено

- `npm run test:chat:report`: **114 успешных проверок** — 105 интеграционных сценариев и девять лабораторных MLS. [JSON](security-tests.json), [интеграционный TAP](integration.tap), [MLS TAP](mls-ratchet.tap).
- ESLint и отдельная production-сборка в Docker прошли успешно.
- В браузере перезагрузка вернула того же участника, сообщения, зашифрованный ответ и реакцию. Ответы и реакции проверены реальной отправкой тестовых сообщений. Нажатие вне справки и Escape закрыли её без изменения размеров переписки.
- Проверены чат при 390 × 844, 320 × 568 и уменьшенной высоте 390 × 450, а также Security на английском и русском при 320 × 568. Измерения DOM не выявили горизонтального переполнения абзацев и ячеек. Таблица модели угроз на узком экране отображается карточками.
- Меню сообщения открывается поверх переписки. Фокус с клавиатуры виден на кнопках; переход к цитате больше не рисует рамку вокруг всей строки.

## Границы проверки

Обработчик долгого нажатия отменяет ожидание при движении, отмене касания, потере фокуса, скрытии страницы и удалении компонента. Сам жест и экранная клавиатура iOS/Android на физических устройствах в этом прогоне не проверялись. Размер области чата отслеживает VisualViewport без пересоздания сессии; это не означает проверку всех мобильных браузеров.

Строка `This room no longer exists.` обнаружена в старой локальной dev-сборке и отсутствовала в проверенных текущих production-клиенте и relay. В пользовательской сессии ошибка не воспроизведена, поэтому она не объявляется следствием дефекта нескольких вкладок. Перезапуск relay или общий срок действительно удаляют состояние беседы из RAM; одна ссылка не позволяет восстановить его.

В отчёте нет пользовательской переписки, секретов приглашений и приватных ключей. Браузерные проверки проведены в отдельной тестовой беседе.
