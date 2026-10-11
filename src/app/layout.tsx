import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Link from "next/link";
import MobileNav from "@/components/MobileNav";
import SoundToggle from "@/components/SoundToggle";
import Footer from "@/components/Footer";
import PhaseBanner from "@/components/PhaseBanner";
import { OBTAINABLE_NFT_COUNT } from "@/lib/constants";
import { CELL_TYPE_COUNT } from "@/lib/game-config";

export const metadata: Metadata = {
  title: "MEME GRID | Web3 Dice Game on Radix",
  // NFT counts here must be the EARNABLE count, not the 23-entry catalog size —
  // 10 catalog entries have unlock conditions that are not implemented.
  description: `Roll dice, complete the 8x8 grid, earn ROLLS and collect achievement NFTs. ${CELL_TYPE_COUNT} cell types, combo bonuses, power-ups, and ${OBTAINABLE_NFT_COUNT} NFTs to earn.`,
  keywords: ["meme", "grid", "game", "radix", "web3", "dice", "nft", "defi"],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "MEME GRID — Web3 Dice Game on Radix",
    description: "Roll dice, complete the grid, earn ROLLS and collect legendary NFTs.",
    type: "website",
    siteName: "MEME GRID",
  },
  twitter: {
    card: "summary_large_image",
    title: "MEME GRID — Web3 Dice Game",
    description: `8x8 grid, ${CELL_TYPE_COUNT} cell types, combos up to 10x, ${OBTAINABLE_NFT_COUNT} NFTs to earn. Play now on Radix.`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen grid-bg flex flex-col">
        <Providers>
          <PhaseBanner />
          <header className="border-b border-gray-800/60 backdrop-blur-sm sticky top-0 z-50 bg-[var(--bg-dark)]/80">
            <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between relative">
              <Link href="/" className="flex items-center gap-2 font-bold text-lg shrink-0">
                <span className="text-2xl">🎲</span>
                <span className="neon-glow">MEME GRID</span>
              </Link>

              {/* Right-hand controls. The connect button MUST stay a single
                  element rendered at every breakpoint: RDT binds to the first
                  `radix-connect-button` in the document and only that one
                  (`document.querySelector` in its connect-button module). A
                  second, breakpoint-hidden copy meant the bound button was
                  `display:none` on mobile and the visible one was inert — the
                  mobile "can't connect wallet" bug. Use <ConnectButton /> for
                  any additional in-page connect affordance. */}
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="hidden sm:flex items-center gap-4">
                  <Link href="/play" className="text-sm text-gray-400 hover:text-white transition-colors">Play</Link>
                  <Link href="/how-to-play" className="text-sm text-gray-400 hover:text-white transition-colors">How To Play</Link>
                  <Link href="/daily" className="text-sm text-gray-400 hover:text-white transition-colors">Daily</Link>
                  <Link href="/leaderboard" className="text-sm text-gray-400 hover:text-white transition-colors">Leaderboard</Link>
                  <Link href="/shop" className="text-sm text-gray-400 hover:text-white transition-colors">Shop</Link>
                  <Link href="/tokenomics" className="text-sm text-gray-400 hover:text-white transition-colors">Tokenomics</Link>
                  <Link href="/gallery" className="text-sm text-gray-400 hover:text-white transition-colors">NFTs</Link>
                </div>
                {/* Below sm: the row is logo + connect pill + hamburger inside
                    ~343px, and the connect button cannot be shrunk or hidden (RDT
                    binds the first one in the document and only that one). The
                    sound toggle is the one element that can move, so it lives in
                    the dropdown on phones. */}
                <div className="hidden sm:block">
                  <SoundToggle />
                </div>
                <radix-connect-button />
                <div className="sm:hidden">
                  <MobileNav />
                </div>
              </div>
            </nav>
          </header>
          <main className="max-w-6xl mx-auto px-4 py-6 flex-1">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
