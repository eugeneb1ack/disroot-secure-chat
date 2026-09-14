# Secure Chat

**One link. Browser keys. Up to 24 hours.**

A small, ephemeral group chat using [MLS / RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html). Choose a nickname, generate keys in your browser, share the invitation privately. Guests generate their own keys. An online participant admits them automatically. Text and emoji; no accounts, files, administrators or recovery service.

[Русский](README.ru.md) · [Protocol](docs/secure-chat.md) · [Security review](SECURITY.md) · [Executed tests](public/secure-chat/reports/security-tests.md)

```text
Browser                         Isolated relay                     Browser
keys + plaintext  ── MLS ──►  ciphertext + routing  ── MLS ──►  verify + decrypt
        │                           │                                │
        └──────────── one shared expiry, at most 24 hours ────────────┘
```

## What is implemented

- Pinned `ts-mls` 1.6.4; X25519, AES-128-GCM, SHA-256 and Ed25519.
- Browser-only message keys, signed encrypted profiles and a founder-anchored admission chain.
- A 256-bit invitation secret in the URL fragment. HKDF separates bootstrap encryption from transport authorization; the secret itself is not sent to the relay.
- Message generations and periodic member key updates. An adapter explicitly removes old epoch state and preserves the authenticated MLS sender.
- Serialized writes, identical-ciphertext retries, and session destruction on an unresolved encrypted write.
- One shared deadline, at most 16 members. Bounded RAM-only relay storage; no chat database or disk archive.
- Separate non-root relay container: read-only filesystem, no published port, no site secrets, no ordinary Internet egress, bounded memory/CPU/processes.
- Responsive EN/RU messenger with a growing composer, emoji picker, encrypted replies/reactions and reduced-motion support.
- Reuse a live session across tabs of the same browser profile and origin; one original tab owns the keys and serializes all MLS writes.
- Optional Tor v3 onion gateway on the same host. The Tor service identity persists; chat state does not.

## Run locally

Node 22.18+ and Docker Compose are supported.

```sh
npm ci
npm run test:chat:report
npm run lint
npm run build
CHAT_LOCAL_PREVIEW=1 docker compose up -d --build
```

Open [localhost:3000/secure-chat](http://localhost:3000/secure-chat). For a real HTTP check:

```sh
CHAT_TEST_ORIGIN=http://127.0.0.1:3000 node --experimental-strip-types scripts/check-secure-chat.mjs
```

For development, set `SECURE_CHAT_RELAY_URL=http://127.0.0.1:3003`, run `npm run dev:chat`, then `npm run dev` in another terminal.

## Deploy

Copy `.env.example` to `.env`, set an exact HTTPS `CHAT_ORIGIN`, and keep `CHAT_LOCAL_PREVIEW=0`. Terminate TLS with a reverse proxy; the web port stays on loopback. Adapt `ops/secure-chat-nginx.conf` to that origin. Disable request logs, preserve bounded in-memory request buffering, and strip client-IP headers and cookies on the chat API. Never mount secrets, the Docker socket or application data into the relay.

The optional Tor unit and torrc are examples for a Debian/Ubuntu host with Tor and Snowflake installed. Its dedicated nginx listener must expose only chat routes and static assets. Allowlist the exact onion origin in both web and relay. See [deployment details](docs/secure-chat.md). Review the host configuration and test both routes before inviting users. Restarting the relay ends all active conversations.

## Evidence and limits

[The report](public/secure-chat/reports/security-tests.md) records actual executed tests, runtime, raw TAP output and source hashes. [The review closeout](public/secure-chat/reports/review-closeout.md) describes six pre-release findings, their fixes and regression scenarios. CI reruns the tests, lint and production build and exports fresh reports.

This is a technical self-review, **not an independent audit**. The selected suite is classical, not post-quantum. We do not claim equivalence or superiority to Signal. A compromised website or device can read live plaintext and keys. A malicious relay or invited member can disrupt service. A stolen participant state requires an honest update by that participant after the attacker loses access. JavaScript cannot guarantee physical memory erasure or delete recipient copies. HTTPS exposes the peer address to the endpoint; Tor changes that network relationship without eliminating traffic-analysis risks.

The shared deadline cannot be extended. Opening your invitation in the same browser reuses the original tab while it remains open. Closing or reloading the original tab loses its keys sooner; only then does a returning visitor need a new temporary identity. Do not reuse a sensitive identity based only on a familiar nickname; compare full fingerprints independently.

Questions or private security reports: [Telegram DM](https://t.me/mailsec).

[Messenger release verification / Проверка обновления](docs/secure-chat-messenger-release.md) · [Initial production deployment](docs/deployment-verification.md).
