import type { Metadata } from "next";
import { connection } from "next/server";
import { ChatPage } from "@/components/secure-chat/chat-page";

export const metadata: Metadata = {
  title: "Secure Chat · dis/root",
  description: "One link. Browser keys. An encrypted conversation for up to 24 hours.",
  alternates: { canonical: "/secure-chat" },
  robots: { index: false, follow: false },
};

export default async function SecureChatPage() {
  await connection();
  return <ChatPage />;
}
