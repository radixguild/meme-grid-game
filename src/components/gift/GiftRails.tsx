import Link from "next/link";
import { giftDestination } from "@/lib/gift";
import { XrdGiftCard } from "./XrdGiftCard";
import { BtcGiftCard } from "./BtcGiftCard";

/**
 * The gift rails. Callers supply their own framing, but NOT the disclosure —
 * GiftDisclosure ships with the rails on purpose. "A gift buys nothing" has to
 * appear wherever gifts are asked for, and a caller that forgot it would be
 * the bug.
 *
 * Each rail is a plain `&&` on its own destination: unset or invalid resolves
 * to null in lib/gift, so an unconfigured rail renders nothing and there is no
 * placeholder to leak.
 */
function GiftSection({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
      <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
        <span>{emoji}</span> {title}
      </h2>
      {children}
    </div>
  );
}

export function GiftRails() {
  const xrd = giftDestination("xrd");
  const btc = giftDestination("btc");

  return (
    <>
      {xrd && (
        <GiftSection title="XRD" emoji="&#x1FA99;">
          <XrdGiftCard address={xrd} />
        </GiftSection>
      )}

      {btc && (
        <GiftSection title="Bitcoin" emoji="&#x20BF;">
          <BtcGiftCard address={btc} />
        </GiftSection>
      )}

      <p className="text-xs text-gray-500 text-center">
        Gifts go to bigdev, who builds and runs the game. There is no company behind it — it is one
        person paying for a server.
      </p>
    </>
  );
}

/**
 * The honest-copy disclosure. Rendered above the rails on every surface that
 * asks for a gift — this is the claim the page exists to NOT overstate.
 *
 * Two things are specific to THIS app and must not be softened:
 *
 * 1. This is a GAME with paid rolls, prize NFTs and a leaderboard, so the
 *    thing a donor might think they are buying is an advantage. Say plainly
 *    that they are not. Anything else would make the fairness claims on
 *    /how-to-play and /tokenomics false.
 * 2. These addresses are NOT the reward vault. /tokenomics describes a vault
 *    whose contents are distributed back to players; a donor who confuses the
 *    two would be funding bigdev while believing they were funding prizes.
 *    The distinction is stated, with a link, rather than left to inference.
 */
export function GiftDisclosure() {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4 space-y-3 text-sm leading-relaxed">
      <p className="text-gray-300">
        <strong className="text-white">A gift buys nothing.</strong> No ROLLS, no rolls, no boards,
        no NFTs, no leaderboard position, and no change to your odds on any cell. The game does not
        know who gifted and could not favour them if it wanted to. It is a thank-you, not a
        purchase.
      </p>
      <p className="text-gray-400">
        <strong className="text-gray-200">This is not the reward vault.</strong> Gifts here go to
        bigdev and pay for the server. The vault on{" "}
        <Link href="/tokenomics" className="text-cyan-400 hover:underline">
          Tokenomics
        </Link>{" "}
        is a different address whose contents go back to players as lucky drops, milestones and
        tournament prizes. If you meant to fund player rewards, send there instead — nothing sent
        to the addresses below reaches the vault.
      </p>
      <p className="text-gray-400">
        Gifts are not refundable, and nothing on this page is a purchase of anything. If you want
        ROLLS, buy them in the{" "}
        <Link href="/shop" className="text-cyan-400 hover:underline">
          Shop
        </Link>
        .
      </p>
    </div>
  );
}
