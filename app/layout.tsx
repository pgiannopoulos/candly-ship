import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin", "greek"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Candly Ship",
  description: "Αποστολές παραγγελιών candly.gr με GT Courier",
  icons: { icon: "/brand/favicon.png" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el" className={manrope.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
