"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isGiftPageLive } from "@/lib/gift";
import SoundToggle from "./SoundToggle";

const NAV_LINKS = [
  { href: "/play", label: "Play", emoji: "\ud83c\udfb2" },
  { href: "/daily", label: "Daily Challenge", emoji: "\ud83d\udcc5" },
  { href: "/shop", label: "Shop", emoji: "\ud83d\udcb0" },
  { href: "/tokenomics", label: "Tokenomics", emoji: "\ud83d\udcca" },
  { href: "/leaderboard", label: "Leaderboard", emoji: "\ud83c\udfc6" },
  { href: "/gallery", label: "NFTs", emoji: "\ud83d\uddbc\ufe0f" },
  { href: "/profile", label: "Profile", emoji: "\ud83d\udc64" },
  { href: "/how-to-play", label: "How To Play", emoji: "\ud83d\udcd6" },
];

// The gift link uses the SAME truth condition as the /gift route, which 404s
// when no destination is configured — so a dark tip jar is simply unlinked,
// never a nav entry that leads to a 404. NEXT_PUBLIC_* is inlined at build
// time, so this is a constant in the bundle and cannot drift from the guard.
const NAV_LINKS_WITH_GIFT = isGiftPageLive()
  ? [...NAV_LINKS, { href: "/gift", label: "Gifts", emoji: "\ud83c\udf81" }]
  : NAV_LINKS;

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger button — visible only on mobile */}
      <button
        onClick={() => setOpen(!open)}
        className="sm:hidden flex flex-col gap-1 p-2"
        aria-label="Toggle menu"
      >
        <span className={cn("w-5 h-0.5 bg-gray-400 transition-transform", open && "rotate-45 translate-y-1.5")} />
        <span className={cn("w-5 h-0.5 bg-gray-400 transition-opacity", open && "opacity-0")} />
        <span className={cn("w-5 h-0.5 bg-gray-400 transition-transform", open && "-rotate-45 -translate-y-1.5")} />
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div className="sm:hidden absolute top-14 left-0 right-0 bg-[var(--bg-dark)] border-b border-gray-800/60 z-50">
          <div className="flex flex-col p-4 gap-1">
            {NAV_LINKS_WITH_GIFT.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                  pathname === link.href
                    ? "bg-green-600/10 text-green-400"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                )}
              >
                <span>{link.emoji}</span>
                <span>{link.label}</span>
              </Link>
            ))}
            {/* Header row has no space for this on a phone — see app/layout.tsx. */}
            <div className="mt-1 flex items-center gap-3 border-t border-gray-800/60 px-4 pt-3 text-sm text-gray-400">
              <SoundToggle />
              <span>Sound effects</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
