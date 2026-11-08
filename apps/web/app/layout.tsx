import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "HookRelay · Webhook infrastructure",
  description: "Reliable webhook delivery. Own your infrastructure.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
