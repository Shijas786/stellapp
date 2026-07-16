import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Stellapp — Chat. Build. Pay. On Stellar.",
  description: "Send, receive, swap, deploy Soroban contracts and more — all on Stellar, all inside WhatsApp. The first WhatsApp-native crypto wallet powered by AI.",
  keywords: ["Stellar", "WhatsApp", "crypto", "DeFi", "USDC", "XLM", "Soroban", "smart contracts", "AI wallet", "StellApp"],
  authors: [{ name: "StellApp" }],
  openGraph: {
    title: "Stellapp — Chat. Build. Pay. On Stellar.",
    description: "Send, receive, swap, deploy Soroban contracts and more — all on Stellar, all inside WhatsApp.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0A0D10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
