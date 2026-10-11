import Link from "next/link";
import { isGiftPageLive } from "@/lib/gift";

export default function Footer() {
  return (
    <footer className="border-t border-gray-800/40 mt-12 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Game</h4>
            <div className="flex flex-col gap-2">
              <Link href="/play" className="text-sm text-gray-400 hover:text-white transition-colors">Play</Link>
              <Link href="/daily" className="text-sm text-gray-400 hover:text-white transition-colors">Daily Challenge</Link>
              <Link href="/how-to-play" className="text-sm text-gray-400 hover:text-white transition-colors">How To Play</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Collect</h4>
            <div className="flex flex-col gap-2">
              <Link href="/gallery" className="text-sm text-gray-400 hover:text-white transition-colors">NFT Gallery</Link>
              <Link href="/leaderboard" className="text-sm text-gray-400 hover:text-white transition-colors">Leaderboard</Link>
              <Link href="/shop" className="text-sm text-gray-400 hover:text-white transition-colors">Token Shop</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Account</h4>
            <div className="flex flex-col gap-2">
              <Link href="/profile" className="text-sm text-gray-400 hover:text-white transition-colors">Profile</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Links</h4>
            <div className="flex flex-col gap-2">
              <a href="https://github.com/radixguild/meme-grid-game" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-400 hover:text-white transition-colors">GitHub</a>
              <a href="https://radixguild.com" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-400 hover:text-white transition-colors">Radix Guild</a>
              {/* Same truth condition as the /gift route, which 404s when no
                  destination is configured — a dark tip jar is unlinked, not a
                  link into a 404. */}
              {isGiftPageLive() && (
                <Link href="/gift" className="text-sm text-gray-400 hover:text-white transition-colors">Gifts</Link>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-800/40 pt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-xs text-gray-400">
            MEME GRID — Web3 dice game on Radix. BETA.
          </div>
          <div className="text-xs text-gray-400">
            Built by bigdev
          </div>
        </div>
      </div>
    </footer>
  );
}
