import { createServer } from "node:http";
import { GET, POST } from "../lib/secure-chat-handler.ts";
import { secureChatStore } from "../lib/secure-chat-store.ts";
import { chatOriginForHost } from "../lib/secure-chat-guard.ts";

// No file writes, outbound HTTP calls, shell execution, site code or site credentials.
const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 }, async (incoming, outgoing) => {
  const fail = (status, error) => { if (!outgoing.headersSent) outgoing.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store, private" }); outgoing.end(JSON.stringify({ error })); };
  if (incoming.url === "/healthz" && incoming.method === "GET") { outgoing.writeHead(200); outgoing.end("ok"); return; }
  try {
    const origin = incoming.headers["x-chat-origin"];
    if (typeof origin !== "string" || origin.length > 200 || chatOriginForHost(new URL(origin).host) !== origin) { fail(403, "Configured chat origin required."); return; }
    if (!["GET", "POST"].includes(incoming.method) || !/^\/api\/secure-chat(?:\?[^#]*)?$/.test(incoming.url ?? "")) { fail(404, "Unknown route."); return; }
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 96_000) { fail(413, "Request is too large."); incoming.destroy(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers({ Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json" });
    if (typeof incoming.headers.authorization === "string") headers.set("Authorization", incoming.headers.authorization);
    const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
    const response = await (incoming.method === "POST" ? POST(request) : GET(request));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { fail(400, "Invalid relay request."); }
});
server.maxConnections = 64;
server.maxRequestsPerSocket = 100;
server.setTimeout(20_000, socket => socket.destroy());
const cleanup = setInterval(() => secureChatStore.clean(), 1000);
cleanup.unref();
server.listen(Number(process.env.CHAT_RELAY_PORT ?? 3003), process.env.CHAT_RELAY_HOST ?? "127.0.0.1", () => console.log("Secure Chat relay ready; ephemeral ciphertext storage."));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
