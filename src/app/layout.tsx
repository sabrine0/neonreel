import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { BRAND, Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: BRAND,
  description: "Turn an idea into images and narrated multi-scene videos on your own GPU.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
          <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
            <Link href="/" aria-label={`${BRAND} home`} className="group shrink-0">
              <Logo />
            </Link>
            <NavLinks />
          </nav>
          <div aria-hidden className="neon-line absolute inset-x-0 -bottom-px h-px" />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      </body>
    </html>
  );
}
