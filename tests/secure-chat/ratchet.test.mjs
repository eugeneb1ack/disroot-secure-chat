import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { currentEpochState } from "../../lib/secure-chat-mls-adapter.ts";
import { wipe } from "../../lib/secure-chat-mls.ts";
import {
  acceptAll, createApplicationMessage, createCommit, createGroup,
  decodeMlsMessage, defaultCapabilities, defaultKeyPackageEqualityConfig,
  defaultLifetimeConfig, emptyPskIndex, encodeMlsMessage, generateKeyPackage,
  getCiphersuiteFromName, getCiphersuiteImpl, joinGroup, processMessage, zeroOutUint8Array,
} from "ts-mls";

// Research fixture only. Keys are pinned out of band in the test harness.
// This does NOT implement invitation authentication or a production directory.
const suiteName = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const suite = await getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readWire(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.length <= 64_000);
  const decoded = decodeMlsMessage(bytes, 0);
  assert.ok(decoded && decoded[1] === bytes.length, "Reject incomplete/trailing wire data");
  return decoded[0];
}

function installState(client, result) {
  const previous = client.state;
  client.state = currentEpochState(result.newState);
  result.consumed.forEach(zeroOutUint8Array);
  for (const value of result.consumed) assert.ok(value.every(byte => byte === 0));
  wipe(previous); wipe(result.newState);
  assert.equal(client.state.historicalReceiverData.size, 0);
}

function capture(client) {
  // Deliberately retain a forensic copy ONLY for the compromise tests.
  const { clientConfig, ...state } = client.state;
  return { state: { ...structuredClone(state), clientConfig } };
}

async function lab() {
  const pins = new Map();
  const config = {
    keyRetentionConfig: {
      retainKeysForGenerations: 0,
      retainKeysForEpochs: 0,
      maximumForwardRatchetSteps: 32,
    },
    lifetimeConfig: defaultLifetimeConfig,
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    paddingConfig: { kind: "padUntilLength", padUntilLength: 1024 },
    authService: {
      async validateCredential(credential, signaturePublicKey) {
        if (credential.credentialType !== "basic") return false;
        const pin = pins.get(decoder.decode(credential.identity));
        return !!pin && pin.length === signaturePublicKey.length
          && pin.every((byte, index) => byte === signaturePublicKey[index]);
      },
    },
  };

  async function identity(id, pin = true) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const keys = await generateKeyPackage(
      { credentialType: "basic", identity: encoder.encode(id) },
      defaultCapabilities(), { notBefore: now - 60n, notAfter: now + 86400n }, [], suite,
    );
    if (pin) pins.set(id, keys.publicPackage.leafNode.signaturePublicKey.slice());
    return { keys, state: undefined };
  }

  async function receive(client, bytes) {
    const wire = readWire(bytes);
    assert.ok(["mls_private_message", "mls_public_message"].includes(wire.wireformat));
    const result = await processMessage(wire, client.state, emptyPskIndex, acceptAll, suite);
    installState(client, result);
    return result;
  }

  async function add(sponsor, member, others = []) {
    const result = await createCommit({ state: sponsor.state, cipherSuite: suite }, {
      extraProposals: [{ proposalType: "add", add: { keyPackage: structuredClone(member.keys.publicPackage) } }],
      ratchetTreeExtension: true,
    });
    const commit = encodeMlsMessage(result.commit);
    const welcome = encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome });
    installState(sponsor, result);
    for (const other of others) await receive(other, commit);
    member.state = await joinGroup(readWire(welcome).welcome, member.keys.publicPackage,
      structuredClone(member.keys.privatePackage), emptyPskIndex, suite, undefined, undefined, config);
    Object.values(member.keys.privatePackage).forEach(zeroOutUint8Array);
    member.keys = undefined;
    return commit;
  }

  async function send(client, text) {
    const result = await createApplicationMessage(client.state, encoder.encode(text), suite);
    const wire = encodeMlsMessage({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage });
    installState(client, result);
    return wire;
  }

  async function refresh(client, peers) {
    const result = await createCommit({ state: client.state, cipherSuite: suite });
    const wire = encodeMlsMessage(result.commit);
    installState(client, result);
    for (const peer of peers) await receive(peer, wire);
    return wire;
  }

  const alice = await identity("alice");
  alice.state = await createGroup(crypto.getRandomValues(new Uint8Array(32)), alice.keys.publicPackage,
    structuredClone(alice.keys.privatePackage), [], suite, config);
  Object.values(alice.keys.privatePackage).forEach(zeroOutUint8Array);
  alice.keys = undefined;
  const bob = await identity("bob");
  await add(alice, bob);
  return { alice, bob, identity, receive, add, send, refresh };
}

test("three independent clients exchange serialized, encrypted Unicode messages", async () => {
  const { alice, bob, identity, add, send, receive } = await lab();
  const charlie = await identity("charlie");
  await add(bob, charlie, [alice]);
  for (const [sender, receivers] of [[alice, [bob, charlie]], [bob, [alice, charlie]], [charlie, [alice, bob]]]) {
    const text = "Привет · hello · こんにちは 🔐🙂";
    const wire = await send(sender, text);
    assert.equal(Buffer.from(wire).includes(Buffer.from(text)), false);
    for (const receiver of receivers) {
      const result = await receive(receiver, wire);
      assert.equal(result.kind, "applicationMessage");
      assert.equal(decoder.decode(result.message), text);
    }
  }
});

test("a later member cannot process pre-join ciphertext but can read new messages", async () => {
  const { alice, bob, identity, add, send, receive } = await lab();
  const past = await send(alice, "before joining");
  assert.equal(decoder.decode((await receive(bob, past)).message), "before joining");
  const charlie = await identity("charlie");
  await add(alice, charlie, [bob]);
  await assert.rejects(() => receive(capture(charlie), past));
  assert.equal(decoder.decode((await receive(charlie, await send(bob, "after joining"))).message), "after joining");
});

test("copied state before consumption reads a message; current consumed state rejects it", async () => {
  const { alice, bob, send, receive } = await lab();
  const before = capture(bob);
  const wire = await send(alice, "one-use generation");
  assert.equal(decoder.decode((await receive(before, wire)).message), "one-use generation");
  await receive(bob, wire);
  await assert.rejects(() => receive(capture(bob), wire));
  assert.equal(bob.state.historicalReceiverData.size, 0);
});

test("another member's refresh does not heal a copied participant state", async () => {
  const { alice, bob, send, receive, refresh } = await lab();
  const stolenBob = capture(bob);
  const update = await refresh(alice, [bob]);
  await receive(stolenBob, update);
  const wire = await send(alice, "still compromised");
  assert.equal(decoder.decode((await receive(stolenBob, wire)).message), "still compromised");
  assert.equal(decoder.decode((await receive(bob, wire)).message), "still compromised");
});

test("the compromised participant's honest refresh prevents its old snapshot following the new epoch", async () => {
  const { alice, bob, send, receive, refresh } = await lab();
  const stolenBob = capture(bob);
  const before = await send(alice, "control: attacker can read before refresh");
  await receive(bob, before);
  assert.equal(decoder.decode((await receive(stolenBob, before)).message), "control: attacker can read before refresh");
  const update = await refresh(bob, [alice]);
  await assert.rejects(() => receive(capture(stolenBob), update));
  const after = await send(alice, "new epoch");
  await assert.rejects(() => receive(stolenBob, after));
  assert.equal(decoder.decode((await receive(bob, after)).message), "new epoch");
});

test("a different key cannot reuse a pinned identity", async () => {
  const { alice, identity, add } = await lab();
  // Pin an identity which is NOT already in the group, so rejection cannot
  // merely be the duplicate-member check.
  const expected = await identity("charlie");
  const impostor = await identity("charlie", false);
  await assert.rejects(() => add(alice, impostor));
  await add(alice, expected);
});

test("tampered wire data is rejected without consuming the valid message", async () => {
  const { alice, bob, send, receive } = await lab();
  const wire = await send(alice, "integrity");
  const altered = wire.slice();
  altered[altered.length - 1] ^= 1;
  await assert.rejects(() => receive(bob, altered));
  assert.equal(decoder.decode((await receive(bob, wire)).message), "integrity");
});

test("framing rejects trailing bytes and padding hides the difference between two short texts", async () => {
  const { alice, bob, send, receive } = await lab();
  const short = await send(alice, "a");
  const longer = await send(alice, "a somewhat longer text message");
  assert.equal(short.length, longer.length);
  const withGarbage = new Uint8Array(short.length + 1);
  withGarbage.set(short);
  await assert.rejects(() => receive(bob, withGarbage));
});

test("local crypto timing sample (not browser or network latency)", async context => {
  const { alice, bob, send, receive } = await lab();
  const samples = [];
  for (let index = 0; index < 30; index++) {
    const start = performance.now();
    const wire = await send(alice, "benchmark 🔐");
    assert.equal(decoder.decode((await receive(bob, wire)).message), "benchmark 🔐");
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  context.diagnostic(JSON.stringify({ suite: suiteName, engine: process.version,
    samples: samples.length, operation: "serialize + encrypt + decrypt + verify",
    medianMs: Number(samples[15].toFixed(2)), p95Ms: Number(samples[28].toFixed(2)) }));
});
