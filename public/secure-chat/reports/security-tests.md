# Secure Chat — automated security checks

Generated: 2026-09-14T14:20:53.805Z

Runtime: v26.8.2 (darwin/arm64)

**62 checks; PASSED. Technical self-review, not an independent audit.**

[Machine-readable report and source hashes](security-tests.json).

## Production integration and hostile inputs

`node --experimental-strip-types --test --test-reporter=tap lib/secure-chat-v2.test.mjs`

Exit: 0. [Raw TAP output](integration.tap).

- PASS — production clients: creator remains in the same chat after a guest joins
- PASS — production clients: bidirectional Unicode and emoji survive relay serialization
- PASS — a third client joins through a non-founder and cannot read earlier messages
- PASS — lost publish acknowledgement retries identical wire and appends once
- PASS — uncertain writes discard the session instead of reusing MLS generations
- PASS — expired write lease fails closed after encryption
- PASS — simultaneous sends serialize without duplicate delivery
- PASS — nickname and cleartext never enter the production relay state or request bodies
- PASS — the invitation secret is domain-separated from the transport capability
- PASS — invitation parser rejects duplicates, downgrade, expired and oversized links
- PASS — bootstrap AEAD binds packet purpose and room deadline
- PASS — tampered manifest and wrong founder anchor are rejected
- PASS — one-use login challenge rejects replays and concurrent authentication
- PASS — invalid signature consumes a challenge and cannot be retried with the correct key
- PASS — login challenge binds the browser origin
- PASS — private transport JWK fields are rejected before importing a key
- PASS — a transport key cannot create a second conversation
- PASS — concurrent authentication at the binding limit leaves no orphan conversations
- PASS — wrong invitation capability and extended deadline cannot join
- PASS — 24-hour cleanup removes room, messages, sessions, pending joins and bindings
- PASS — join and key updates do not extend the shared deadline
- PASS — challenge floods are bounded without IP storage
- PASS — cross-site Origin, fetch-site and unconfigured Host are denied
- PASS — API rejects malformed JSON, oversize body and legacy admin actions
- PASS — MLS rejects a replayed message and accepts the following generation
- PASS — tampered ciphertext fails without consuming the valid generation
- PASS — message identifier substitution fails even with valid MLS ciphertext
- PASS — MLS framing rejects truncated, trailing and noncanonical base64 data
- PASS — an invitation holder cannot substitute another participant's signed nickname
- PASS — case-insensitive nickname collisions cannot enter the verified roster
- PASS — Welcome is one-use and cannot be consumed by a different KeyPackage
- PASS — a pending encrypted packet blocks generation of a second ciphertext
- PASS — padding equalizes two short application messages
- PASS — closing the client clears its active identity state and invitation secret
- PASS — bounded parser fuzz: 256 deterministic malformed MLS packets never render text
- PASS — integrity mutation matrix: 32 ciphertext bit flips are rejected
- PASS — an old relay snapshot cannot roll back a live client's cursor
- PASS — a substituted event packet closes the client without rendering unverified text
- PASS — unknown bearer token cannot read, claim, publish or enumerate a room
- PASS — cross-conversation packets cannot decrypt even with a reused message id
- PASS — audit regression: an invitation holder's alternate MLS group lacks the pinned founder
- PASS — audit regression: a real founder roster without a valid admission chain is rejected
- PASS — audit regression: an admitted peer cannot rewrap Alice's signed text as its MLS message
- PASS — audit regression: a signed request with an invalid inner KeyPackage cannot close incumbents
- PASS — audit regression: current state drops withheld prior-epoch ciphertext after refresh
- PASS — audit regression: the state adapter discards retained old epochs without aliasing live secrets
- PASS — audit regression: repeated unadmitted logouts release all member reservations
- PASS — audit regression: an abandoned login without enqueue expires after two minutes
- PASS — audit regression: sixteen full relay windows keep accepting bounded replacement writes
- PASS — simultaneous incumbent admission attempts leave all three clients usable
- PASS — closing during asynchronous key refresh cannot resurrect a cryptographic session
- PASS — sixteen real MLS participants fit the relay packet budgets and exchange text
- PASS — only the configured v3 onion authority is allowed, with exact same-origin POST

## MLS retention and compromise scenarios (laboratory fixtures)

`node --experimental-strip-types --test --test-reporter=tap tests/secure-chat/ratchet.test.mjs`

Exit: 0. [Raw TAP output](mls-ratchet.tap).

- PASS — three independent clients exchange serialized, encrypted Unicode messages
- PASS — a later member cannot process pre-join ciphertext but can read new messages
- PASS — copied state before consumption reads a message; current consumed state rejects it
- PASS — another member's refresh does not heal a copied participant state
- PASS — the compromised participant's honest refresh prevents its old snapshot following the new epoch
- PASS — a different key cannot reuse a pinned identity
- PASS — tampered wire data is rejected without consuming the valid message
- PASS — framing rejects trailing bytes and padding hides the difference between two short texts
- PASS — local crypto timing sample (not browser or network latency)

## Limits

- The source hashes identify the tested files, including uncommitted work. gitHead alone does not identify this build.
- Expiry is tested by advancing an injected relay clock; this is not a 24-hour endurance test.
- The parser test contains 256 deterministic malformed packets; the integrity test mutates 32 ciphertext bytes. These are bounded negative tests, not exhaustive fuzzing.
- Compromise fixtures exercise pinned ts-mls 1.6.4. They are not a formal proof, interoperability certification, post-quantum validation or independent cryptographic audit.
- The timing sample measures local Node cryptography, not browser or network latency.
- Browser, HTTP and deployment checks are recorded separately and are not implied by this report.
