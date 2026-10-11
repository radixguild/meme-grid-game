import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GiftDisclosure, GiftRails } from "@/components/gift/GiftRails";
import { isGiftPageLive } from "@/lib/gift";

export const metadata: Metadata = {
  title: "Gifts — Meme Grid",
  description:
    "Gifts cover the server behind Meme Grid. A gift buys nothing — no ROLLS, no NFTs, no leaderboard position, and no change to your odds.",
};

export default function GiftPage() {
  // The hard guard, at the route boundary: with no destination configured there
  // is nothing to send to, so the page does not exist at all. See lib/gift. The
  // nav and footer links use this same condition, so a dark page is unlinked
  // rather than being a 404 someone can navigate into.
  if (!isGiftPageLive()) notFound();

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold neon-glow text-center">Gifts</h1>
      <p className="text-gray-400 text-center text-sm">
        {/* NOT "free to play" — the game runs on ROLLS (BOARD_COST 5, ROLL_COST 1
            in server/src/game/economy.ts) and sells them in the Shop. You start
            with 500 free, which is a starting allowance, not a free game. */}
        You start with 500 free ROLLS, and buy more in the Shop if you want them. Gifts are
        separate: they cover the server and buy nothing in the game.
      </p>

      <GiftDisclosure />
      <GiftRails />
    </div>
  );
}
