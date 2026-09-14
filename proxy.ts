import { NextRequest, NextResponse } from "next/server";

const isDevelopment = process.env.NODE_ENV !== "production";
const htmlCacheControl = "private, max-age=300, stale-while-revalidate=3600";

function createNonce() {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

function createContentSecurityPolicy(nonce: string, onion: boolean) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDevelopment ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!onion ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const onionOrigin = process.env.SECURE_CHAT_ONION_ORIGIN;
  const onion = !!onionOrigin && /^http:\/\/[a-z2-7]{56}\.onion$/.test(onionOrigin) && request.headers.get("host") === new URL(onionOrigin).host;
  const contentSecurityPolicy = createContentSecurityPolicy(nonce, onion);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Cache-Control", request.nextUrl.pathname.startsWith("/secure-chat") ? "no-store, private" : htmlCacheControl);
  if (request.nextUrl.pathname.startsWith("/secure-chat")) response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|favicon-32.png|icon-192.png|icon-512.png|apple-touch-icon.png|audio|images).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
