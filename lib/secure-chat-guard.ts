export class ChatError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type ChatOriginPolicy = { publicOrigin?: string; onionOrigin?: string; allowLocal: boolean };
const localAuthority = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

function originPolicy(): ChatOriginPolicy {
  return { publicOrigin: process.env.SECURE_CHAT_ORIGIN, onionOrigin: process.env.SECURE_CHAT_ONION_ORIGIN, allowLocal: process.env.NODE_ENV !== "production" || process.env.SECURE_CHAT_LOCAL_PREVIEW === "1" };
}

export function chatOriginForHost(host: string, policy = originPolicy()) {
  if (policy.onionOrigin) {
    if (!/^http:\/\/[a-z2-7]{56}\.onion$/.test(policy.onionOrigin)) throw new ChatError("Configure an exact v3 onion origin.", 503);
    if (host === new URL(policy.onionOrigin).host) return policy.onionOrigin;
  }
  if (policy.publicOrigin) {
    let configured: URL;
    try { configured = new URL(policy.publicOrigin); } catch { throw new ChatError("Invalid chat origin configuration.", 503); }
    if (configured.protocol !== "https:" || configured.origin !== policy.publicOrigin || configured.username || configured.password || localAuthority.test(configured.host)) throw new ChatError("Configure an exact public HTTPS origin for Secure Chat.", 503);
    if (host === configured.host) return configured.origin;
  }
  if (policy.allowLocal && localAuthority.test(host)) return new URL(`http://${host}`).origin;
  throw new ChatError("Secure Chat is not enabled for this origin.", 403);
}

export function guardChatRequest(request: Request, policy = originPolicy()) {
  // Next standalone uses its bind address in request.url. Trust only configured
  // HTTP authority; production HTTPS terminates at the loopback-only gateway.
  const expected = chatOriginForHost(request.headers.get("host") ?? "", policy);
  const origin = request.headers.get("origin");
  if ((request.method === "POST" || origin !== null) && origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new ChatError("Use this site's chat window.", 403);
  const input = new URL(request.url);
  return new URL(`${input.pathname}${input.search}`, expected);
}
