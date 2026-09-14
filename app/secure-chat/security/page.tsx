import type { Metadata } from "next";
import { connection } from "next/server";
import { SecurityReviewContent } from "@/components/secure-chat/security-review";

export const metadata: Metadata = {
  title: "Secure Chat · Security Review · dis/root",
  description: "One link. Your keys. MLS end-to-end encryption. Explore the chat architecture, lifecycle, open source and reproducible checks in English and Russian.",
  alternates: { canonical: "/secure-chat/security" },
};

export default async function SecurityReview() {
  await connection(); // Match the site's per-request nonce CSP.
  const onion = process.env.SECURE_CHAT_ONION_ORIGIN;
  return <SecurityReviewContent onionOrigin={onion && /^http:\/\/[a-z2-7]{56}\.onion$/.test(onion) ? onion : undefined} />;
}
