import type { Metadata } from "next";
import { connection } from "next/server";
import { SecurityReviewContent } from "@/components/secure-chat/security-review";

export const metadata: Metadata = {
  title: "Secure Chat · Security Review · dis/root",
  description: "Browser keys, encryption, invitations and 24-hour deletion. Technical self-review in English and Russian: controls, trust boundaries and reproducible checks.",
  alternates: { canonical: "/secure-chat/security" },
};

export default async function SecurityReview() {
  await connection(); // Match the site's per-request nonce CSP.
  const onion = process.env.SECURE_CHAT_ONION_ORIGIN;
  return <SecurityReviewContent onionOrigin={onion && /^http:\/\/[a-z2-7]{56}\.onion$/.test(onion) ? onion : undefined} />;
}
