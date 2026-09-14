# Secure Chat — protocol and deployment

[Русский](secure-chat.ru.md) · [Security test report](../public/secure-chat/reports/security-tests.md) · [Review and remediation](../public/secure-chat/reports/review-closeout.md)

One link, one conversation, up to 24 hours. Text and emoji. Browser-generated keys. No account, administrator, attachment, archive or recovery service.

## Temporary identity

The browser generates a separate chat identity with Ed25519 signatures and an MLS KeyPackage. A basic MLS credential contains SHA-256 of its signing public key. Profiles bind the nickname to that key with a signature scoped to this conversation and its deadline. The browser checks case-insensitive nickname uniqueness; the full fingerprint identifies the temporary key, not a real person.

## Invitation and admission

A link contains a random 256-bit secret, a random conversation ID, the founding signing key and the shared expiry after #. This fragment is removed from the current history entry. HKDF-SHA-256 derives separate bootstrap-encryption and transport-capability keys. The original secret is never submitted to the relay. The founder signs the encrypted chat name. The anchor gives no administrative privileges. Every roster carries signed admission certificates chained to this founding key; an invitation holder cannot replace the group with an unrelated founder.

## Joining without an account

A separate browser-generated P-256 transport key signs a single-use, 60-second challenge bound to the origin, conversation, expiry, public transport key, capability hash and creation manifest. The relay consumes it before verification, then issues a 256-bit bearer token. A guest submits an encrypted, signed one-time MLS KeyPackage. An online participant automatically admits it through an MLS Add commit and an HPKE-protected Welcome. New guests receive future messages, without earlier history. All participants have the same capabilities. The full KeyPackage signature and MLS proposal are validated before taking a write lease. Invalid requests are rejected without closing existing participants; abandoned reservations expire after two minutes.

## Messaging Layer Security

The pinned implementation is ts-mls 1.6.4, using RFC 9420 suite MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519: X25519, AES-128-GCM, SHA-256 and Ed25519. MLS authenticates the group transcript and derives separate message generations. An additional application signature binds the sender fingerprint, message ID, text, epoch, conversation and deadline. Clients verify everything before rendering plain text. Public MLS messages, unsupported proposals and incomplete or trailing wire data are rejected. The application sender must match the cryptographically authenticated MLS leaf, preventing a participant from rewrapping another person’s signed text.

## Key updates and state discipline

Joining changes the MLS epoch. Each active client also refreshes its own leaf approximately every five minutes; a newly admitted client refreshes on its next poll. Old epochs and consumed message generations are not retained. There is no automatic cryptographic rollback. Clients serialize their operations, acquire a short relay write lease before encrypting, and retry only the identical ciphertext. If publication remains uncertain, the tab discards its keys and asks the user to rejoin. A small pinned-version adapter explicitly strips historical epoch state and preserves the authenticated sender; it does not rely on the library’s zero-retention default, which was found insufficient during review.

## One deadline

The creator chooses one name and receives one invitation. A key is bound to one conversation. Everyone shares the deadline, at most 24 hours after creation; joins and key updates cannot extend it. The relay cleans expired rooms, ciphertext, grants, challenges and bindings every second and on requests. It has no chat database, disk archive or backup. Restarting it clears active chats sooner. The relay keeps at most 256 events or 1,000,000 encoded characters per conversation; clients retain at most 256 readable messages in memory.

## Metadata minimization

Nicknames, the chat name, MLS KeyPackages and roster bundles are encrypted before reaching the relay. The relay sees temporary transport identifiers, the routing group, membership operations, packet sizes and timing. Short application messages are padded to a 1,024-byte MLS content target; larger messages still reveal size differences. There are no chat cookies, localStorage, IndexedDB, analytics, private-key uploads or attachments.

## Containment and resource limits

The relay runs separately with no site files, secrets, persistent volume, published port or ordinary Internet egress. Its root filesystem is read-only; it runs as a non-root user with all Linux capabilities dropped, no-new-privileges, 192 MiB memory, one CPU and 32 processes. The gateway uses a fixed internal destination and strips client-IP headers and cookies. Bounds include 16 conversations, 16 admitted transport identities per conversation, 256 sessions, 512 key bindings, 64 challenges, eight pending joins per conversation, four parallel signature verifications and 16 MB of retained event strings globally.

## Optional Tor route

Tor Browser can open the dedicated v3 onion service. It uses the same server and the Tor network; no second rented relay or exit node is needed. A separate restricted Tor service forwards only to a loopback chat gateway. The onion route exposes the chat, security page and required static assets, not the site’s other APIs. The Tor service identity persists so the public address stays stable; it contains no chat history. HTTPS and onion hosts are explicitly allowlisted, with same-origin checks on each.

## Conditions and limits

### Forward secrecy has specific conditions

Consumed generations and old epochs are discarded. A copied participant state is not healed merely because another member updates. Recovery requires that the affected participant makes an honest update after the attacker loses access to its device. This suite is classical, not post-quantum. There is no claim of security superior or equivalent to Signal, and no independent audit of this integration or the selected ts-mls release is asserted.

### The delivered client remains trusted

A compromised website, extension, browser or device can steal plaintext and live keys. MLS does not fix hostile JavaScript delivered by the operator. A malicious relay can delay, suppress or partition traffic; transcript comparison helps participants notice divergent views but is not an external transparency service. Compare full key fingerprints and conversation codes through another trusted channel.

### An invitation grants access

Anyone with the full link can join while a participant is online and capacity remains. There is no revocation, moderation or recovery backdoor. Closing a tab does not revoke a copied invitation. If every participant loses their keys, the existing conversation cannot be reconstructed by the server. A returning user creates a new temporary identity.

### Deletion is bounded by the endpoints

Expiry removes active application references and best-effort wipes mutable key buffers. JavaScript and browser memory do not guarantee physical zeroization. Recipients can keep messages or screenshots. A malicious host can record ciphertext or metadata. There is no application recovery service, but code cannot erase copies held elsewhere.

### Anonymity is not invisibility

Ordinary HTTPS exposes a peer address to the network endpoint even when access logs are disabled. A VPN replaces that address with the provider’s exit address. Tor Browser can separate your access network from the destination; timing correlation, an exposed invitation and a compromised endpoint remain risks. Transport identifiers and traffic patterns remain visible to the relay.

### Availability is deliberately bounded

Global and per-session quotas reduce overload without storing IP addresses; fresh keys can still be used for Sybil attacks. A malicious invited participant can disrupt a conversation. Guests need an existing participant online within the two-minute admission window. A tab that misses more than the retained event window must rejoin with a fresh key. Encryption does not guarantee delivery or protection from denial of service.

## Code map

| Boundary | Source |
|---|---|
| Wire contract | `lib/secure-chat-protocol.ts` |
| Fragment parser | `lib/secure-chat-invite.ts` |
| MLS and admission | `lib/secure-chat-mls.ts` |
| Version-specific sender/retention adapter | `lib/secure-chat-mls-adapter.ts` |
| Serialized browser lifecycle | `lib/secure-chat-client.ts` |
| RAM relay and limits | `lib/secure-chat-store.ts` |
| Request validation | `lib/secure-chat-handler.ts`, `lib/secure-chat-guard.ts` |
| Fixed upstream gateway | `app/api/secure-chat/route.ts` |
| Isolated process | `scripts/secure-chat-relay.mjs`, `Dockerfile.chat-relay` |

## Run / проверка

```sh
npm ci
npm run test:chat:report
npm run lint
npm run build
# Isolated local preview:
CHAT_LOCAL_PREVIEW=1 docker compose up -d --build
CHAT_TEST_ORIGIN=http://127.0.0.1:3000 node --experimental-strip-types scripts/check-secure-chat.mjs
```

The HTTP smoke creates three temporary test participants; it has no cleanup bypass and its encrypted relay state follows the ordinary deadline. Test reports distinguish injected-clock expiry from a real 24-hour endurance run.

## Production operations

Use the production compose override, never the local preview flag. Build immutable revision-tagged images, start an alternate-loopback candidate, check it, then switch the gateway. Preserve the previous image and nginx configuration for rollback. Do not copy site secrets or mount its data into the relay. The site may have unrelated persistent services; isolate them from this chat. Restarting or replacing the relay ends active conversations.

Nginx must disable site access logs and chat request error logs, keep bodies in bounded memory, strip IP headers and cookies on the chat route, and publish only the canonical HTTPS origin. Historical and hosting-provider logs are outside this feature and are not silently deleted. The optional Tor service exposes only a loopback chat gateway; its persistent service identity is distinct from ephemeral message state. The host kernel, Docker, network provider and delivered frontend remain trust boundaries.

## References

- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420.html)
- [RFC 9750 — MLS architecture](https://www.rfc-editor.org/rfc/rfc9750.html)
- [Pinned implementation: ts-mls](https://github.com/LukaJCB/ts-mls)
- [Tor onion setup](https://community.torproject.org/onion-services/setup/)
- [Signal Double Ratchet](https://signal.org/docs/specifications/doubleratchet/)
