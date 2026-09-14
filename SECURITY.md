# Security policy

This project handles temporary keys and private conversations. Reports are welcome at [Telegram DM](https://t.me/mailsec). Send the affected revision, threat model, reproduction steps and expected/actual behavior. Use disposable test keys. Do not post live invitation links, private keys or other people's messages in public issues.

Supported code: the current `main` release and its pinned dependency lockfile. No response-time or bounty commitment is made.

## Required properties

- The relay must not receive plaintext, nicknames, the original invitation secret or MLS private state.
- Every rendered message must match its MLS-authenticated sender, current epoch and signed application context.
- A roster must match MLS leaves and its admission chain must reach the pinned founding key.
- New participants must not recover earlier message keys.
- Ciphertext retries must be identical; uncertain writes must not reuse an encryption generation.
- No key, plaintext or chat state may be persisted by the application.
- Joining and rekeying must not extend the shared expiry.
- All untrusted input, pending work and retained state must be bounded.
- The relay must remain separate from site credentials, files, public host ports and ordinary egress.

## Threat model and evidence

See [protocol](docs/secure-chat.md), [automated tests](public/secure-chat/reports/security-tests.md) and [review closeout](public/secure-chat/reports/review-closeout.md). Test success is not proof of security. The repository has not received an independent full cryptographic audit. In particular, delivered JavaScript, the endpoint device, host kernel and traffic analysis remain trust boundaries. Deliberate availability disruption by invited peers or fresh identities remains possible.

The internal adapter depends on exact `ts-mls` interfaces. Do not update the package without reviewing the sender-authentication, retention, consumed-buffer and compromise regressions. New dependencies require a review of browser bundling, network behavior and supply-chain changes.
