import { ChatError, secureChatStore as store } from "./secure-chat-store.ts";
import type { LoginRequest } from "./secure-chat-protocol.ts";
import { guardChatRequest as guard } from "./secure-chat-guard.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
const token = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
const fail = (error: unknown) => json({ error: error instanceof ChatError ? error.message : "Invalid encrypted request." }, error instanceof ChatError ? error.status : 400);

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ChatError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 96_000) { await reader.cancel(); throw new ChatError("Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ChatError("Invalid request.");
  return data as Record<string, unknown>;
}

function field(data: Record<string, unknown>, name: string, max: number) {
  const value = data[name];
  if (typeof value !== "string" || !value || value.length > max) throw new ChatError(`Invalid ${name}.`);
  return value;
}

export function createChatHandlers(store: import("./secure-chat-store.ts").SecureChatStore) {
  return {
    async GET(request: Request) {
      try {
        const url = guard(request);
        if (url.searchParams.get("status") === "1") return json({ available: true, protocol: "disroot-mls-v2" });
        return json(store.snapshot(token(request), Number(url.searchParams.get("after") ?? 0)));
      } catch (error) { return fail(error); }
    },
    async POST(request: Request) {
      try {
        const url = guard(request), data = await readBody(request);
        const action = field(data, "action", 20), sessionToken = token(request);
        if (action === "challenge") return json(store.challenge(data as unknown as LoginRequest, url.origin));
        if (action === "authenticate") return json(await store.authenticate(field(data, "id", 64), field(data, "signature", 100), url.origin));
        store.session(sessionToken);
        if (action === "logout") return json(store.logout(sessionToken));
        if (action === "enqueue") return json(store.enqueue(sessionToken, field(data, "id", 32), field(data, "sealed", 16_000)));
        if (action === "claim") return json(store.claim(sessionToken, Number(data.seq)));
        if (action === "release") return json(store.release(sessionToken, field(data, "lease", 64)));
        if (action === "reject-join") return json(store.rejectJoin(sessionToken, field(data, "id", 32), field(data, "sealed", 4096)));
        if (action === "acknowledge") return json(store.acknowledge(sessionToken));
        if (action === "publish") return json(store.publish(sessionToken, {
          lease: field(data, "lease", 64), id: field(data, "id", 32), wire: field(data, "wire", 64_000),
          ...(data.bootstrap !== undefined ? { bootstrap: field(data, "bootstrap", 16_000) } : {}),
          ...(data.join !== undefined ? { join: field(data, "join", 32) } : {}),
          ...(data.welcome !== undefined ? { welcome: field(data, "welcome", 48_000) } : {}),
        }));
        throw new ChatError("Unknown action.");
      } catch (error) { return fail(error); }
    },
  };
}
export const { GET, POST } = createChatHandlers(store);
