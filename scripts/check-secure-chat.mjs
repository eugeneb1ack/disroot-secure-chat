import assert from "node:assert/strict";
import { SecureChatClient, ChatApiError } from "../lib/secure-chat-client.ts";
const origin = process.env.CHAT_TEST_ORIGIN ?? "http://127.0.0.1:3005";
const endpoint = process.env.CHAT_TEST_ENDPOINT ?? origin;
// Optional endpoint override reaches a loopback release candidate with its real
// Host/Origin. No secrets or invitation URLs are printed by this smoke test.
const transport = async (action, token, after = 0) => {
  const response = await fetch(`${endpoint}/api/secure-chat?after=${after}`, { method: action ? "POST" : "GET", redirect: "error", headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(action ? { body: JSON.stringify(action) } : {}), signal: AbortSignal.timeout(20_000) });
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
  const c = await SecureChatClient.connect("CheckCharlie", "", a.invitation, origin, transport); clients.push(c);
  await b.poll(); await a.poll(); await c.poll(); await b.poll(); await a.poll();
  assert.equal(c.view.messages.length, 0); await c.send("Three participants"); await a.poll(); await b.poll();
  assert.equal(a.view.messages.at(-1).body, "Three participants"); results.push("Non-founder admission, third client, no pre-join history");
  const denied = await fetch(`${endpoint}/api/secure-chat`, { method: "POST", headers: { Host: new URL(origin).host, Origin: "https://invalid.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "challenge" }) });
  assert.equal(denied.status, 403); results.push("Cross-origin rejection and no-store API responses");
  console.log(JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), origin, checks: results }, null, 2));
} finally { clients.forEach(client => client.close()); }
