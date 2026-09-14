import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Secure Chat", description: "One link. An ephemeral MLS conversation.", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "dark", themeColor: "#030609" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
