import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { SecureChatClient, ChatApiError } from "../lib/secure-chat-client.ts";
const origin = process.env.CHAT_TEST_ORIGIN ?? "http://127.0.0.1:3005";
const endpoint = process.env.CHAT_TEST_ENDPOINT ?? origin;
const socks = process.env.CHAT_TEST_SOCKS;
if (socks && !/^127\.0\.0\.1:\d{1,5}$/.test(socks)) throw new Error("Use a loopback test SOCKS tunnel.");
async function request(path, action, token, requestOrigin = origin) {
  const headers = { Host: new URL(origin).host, Origin: requestOrigin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (endpoint === origin && !socks) return fetch(`${endpoint}${path}`, { method: action ? "POST" : "GET", redirect: "error", headers, ...(action ? { body: JSON.stringify(action) } : {}), signal: AbortSignal.timeout(20_000) });
  // curl preserves the candidate's HTTP authority. Put tokens and bodies on
  // stdin, never in argv, shell text or test output. Tor DNS stays inside SOCKS.
  const config = ["silent", "show-error", "include", "max-time = 40", `url = ${JSON.stringify(endpoint + path)}`, ...(socks ? [`socks5-hostname = ${JSON.stringify(socks)}`] : []), ...Object.entries(headers).map(([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`), ...(action ? [`data-binary = ${JSON.stringify(JSON.stringify(action))}`] : [])].join("\n");
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("curl", ["--config", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; let bytes = 0;
    child.stdout.on("data", value => { bytes += value.length; if (bytes > 3_000_000) child.kill(); else chunks.push(value); });
    child.stderr.resume(); child.on("error", reject); child.on("exit", code => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`Test transport failed (curl ${code}, ${action?.action ?? "snapshot"}).`)));
    child.stdin.end(config + "\n");
  });
  const split = raw.indexOf("\r\n\r\n"), head = raw.slice(0, split).split("\r\n"), status = Number(head.shift().split(" ")[1]);
  return new Response(raw.slice(split + 4), { status, headers: head.map(line => { const colon = line.indexOf(":"); return [line.slice(0, colon), line.slice(colon + 1).trim()]; }) });
}
// Optional endpoint override reaches a loopback release candidate with its real
// Host/Origin. No secrets or invitation URLs are printed by this smoke test.
const transport = async (action, token, after = 0) => {
  const response = await request(`/api/secure-chat?after=${after}`, action, token);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const data = await response.json();
  if (!response.ok) throw new ChatApiError(data.error, response.status);
  return data;
};
const clients = [], results = [];
try {
  const a = await SecureChatClient.connect("CheckAlice", "Release verification", null, origin, transport); clients.push(a);
  const b = await SecureChatClient.connect("CheckBob", "", a.invitation, origin, transport); clients.push(b);
  await a.poll(); await b.poll(); await a.poll();
  assert.equal(a.view.ready && b.view.ready, true); results.push("HTTP challenge, authentication, encrypted admission, creator retained");
  await a.send("Release check: Привет 🙂"); await b.poll(); assert.equal(b.view.messages.at(-1).body, "Release check: Привет 🙂");
  await b.send("Return path 👩🏽‍💻"); await a.poll(); assert.equal(a.view.messages.at(-1).body, "Return path 👩🏽‍💻"); results.push("Bidirectional MLS text and emoji");
  const target = { id: a.view.messages[0].id, sender: a.view.messages[0].sender };
  await b.send("Encrypted reply", target); await a.poll(); assert.deepEqual(a.view.messages.at(-1).replyTo, target);
  await b.react(target, "🔥"); await a.poll(); assert.deepEqual(a.view.messages[0].reactions, [{ sender: b.view.identity.id, emoji: "🔥" }]);
  await b.react(target, null); await a.poll(); assert.deepEqual(a.view.messages[0].reactions, []);
  results.push("Authenticated encrypted reply, reaction and reaction removal");
  const c = await SecureChatClient.connect("CheckCharlie", "", a.invitation, origin, transport); clients.push(c);
  await b.poll(); await a.poll(); await c.poll(); await b.poll(); await a.poll();
  assert.equal(c.view.messages.length, 0); await c.send("Three participants"); await a.poll(); await b.poll();
  assert.equal(a.view.messages.at(-1).body, "Three participants"); results.push("Non-founder admission, third client, no pre-join history");
  await b.send("Reply after admission", target); await a.poll(); await c.poll();
  assert.deepEqual(c.view.messages.at(-1).replyTo, target); assert.equal(c.view.messages.some(message => message.id === target.id), false);
  results.push("Replies do not disclose pre-join message content to a new guest");
  const denied = await request("/api/secure-chat", { action: "challenge" }, undefined, "https://invalid.example");
  assert.equal(denied.status, 403); results.push("Cross-origin rejection and no-store API responses");
  console.log(JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), origin, checks: results }, null, 2));
} finally { clients.forEach(client => client.close()); }
