import { ChatError, guardChatRequest } from "@/lib/secure-chat-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let pending = 0;
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store, private" } });

async function forward(request: Request) {
  let admitted = false;
  try {
    const url = guardChatRequest(request);
    if (pending >= 32) return json("The relay is busy. Retry in a moment.", 429);
    const target = process.env.SECURE_CHAT_RELAY_URL;
    // Fixed operator configuration, never a request-controlled proxy destination.
    if (!target || !/^http:\/\/(?:secure-chat-relay:3000|127\.0\.0\.1:3003)$/.test(target)) return json("The chat relay is unavailable. Try again shortly.", 503);
    admitted = true; pending++;
    let body: Uint8Array | undefined;
    if (request.method === "POST") {
      if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return json("Expected JSON.", 415);
      const reader = request.body?.getReader();
      if (!reader) return json("Missing request body.", 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new ChatError("Request body timed out.", 408)); }, 10_000); });
        await Promise.race([deadline, (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 96_000) { void reader.cancel(); throw new ChatError("Request is too large.", 413); }
            chunks.push(value);
          }
        })()]);
        body = new Uint8Array(Buffer.concat(chunks));
      } finally { clearTimeout(timer); reader.releaseLock(); }
    }
    const response = await fetch(`${target}/api/secure-chat${url.search}`, {
      method: request.method,
      headers: { "Content-Type": "application/json", "X-Chat-Origin": url.origin, ...(request.headers.has("authorization") ? { Authorization: request.headers.get("authorization")! } : {}) },
      body: body as BodyInit | undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return json(error instanceof ChatError ? error.message : "The isolated chat relay is unavailable. Try again shortly.", error instanceof ChatError ? error.status : 503);
  } finally { if (admitted) pending--; }
}

export const GET = forward;
export const POST = forward;
