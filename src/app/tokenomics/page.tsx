"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  API_URL,
  ROLLS_PER_BOARD_TYPICAL,
  FREE_STARTING_ROLLS,
  MAX_XRD_PER_PURCHASE,
} from "@/lib/constants";
import { apiFetch } from "@/lib/api";

interface VaultBalance {
  token_name: string;
  total_deposited: number;
  total_distributed: number;
  remaining: number;
}

interface NftCollection {
  resource_address: string;
  name: string | null;
  icon_url: string | null;
  count: number;
}

interface NftPool {
  treasury_address: string | null;
  collections: NftCollection[];
  total_nfts: number;
}

export default function TokenomicsPage() {
  const [vaultBalances, setVaultBalances] = useState<VaultBalance[]>([]);
  const [nftPool, setNftPool] = useState<NftPool | null>(null);
  const [copied, setCopied] = useState(false);
  // Prices come from the server, never from literals on this page. Hardcoding them
  // here is the same duplication that let routes/daily.ts credit rolls at 10x their
  // price (see server/src/game/economy.ts's header) — it just moved to the client.
  const [prices, setPrices] = useState<{
    board_cost: number;
    roll_cost: number;
    xrd_per_roll: number | null;
    xrd_per_roll_source: string;
    free_starting_balance: number;
    phase: number;
  } | null>(null);

  useEffect(() => {
    apiFetch(`${API_URL}/vault/balances`)
      .then((r) => r.json())
      .then((data) => data.ok && setVaultBalances(data.balances))
      .catch(() => {});
    apiFetch(`${API_URL}/vault/nfts`)
      .then((r) => r.json())
      .then((data) => data.ok && setNftPool(data))
      .catch(() => {});
    apiFetch(`${API_URL}/token/info`)
      .then((r) => r.json())
      .then(
        (data) =>
          data.ok &&
          setPrices({
            board_cost: data.board_cost,
            roll_cost: data.roll_cost,
            // The rate is owner-settable component state, so it is READ, never assumed.
            // A page that hardcodes it quotes a price the vault has stopped charging.
            xrd_per_roll: data.xrd_per_roll ?? null,
            xrd_per_roll_source: data.xrd_per_roll_source ?? "unknown",
            free_starting_balance: data.free_starting_balance ?? FREE_STARTING_ROLLS,
            // 1 = no vault deployed, so nothing can be bought. Rendered, because a
            // page describing a purchase flow that is switched off is not transparency.
            phase: data.phase ?? 1,
          })
      )
      .catch(() => {});
  }, []);

  // A board is ~95 ROLLS — measured over 3,000 simulated boards against the real
  // engine, and bounded at 64-128 by the sum of the 64 cell thresholds. The old
  // "100-150" here overstated the top end: 150 is not reachable.
  const boardRolls = prices ? prices.board_cost + ROLLS_PER_BOARD_TYPICAL * prices.roll_cost : null;
  const boardXrd =
    prices && boardRolls !== null && prices.xrd_per_roll !== null
      ? boardRolls * prices.xrd_per_roll
      : null;

  // What the free trial actually buys, stated as a share of one board rather than as
  // a board count. The previous version divided a hardcoded 500 by an estimated board
  // cost and rendered "enough for N full boards" — at a 15-ROLL grant that sentence is
  // false in the direction that costs the player money.
  const freeRolls = prices?.free_starting_balance ?? FREE_STARTING_ROLLS;
  const trialPercent = boardRolls ? Math.round((freeRolls / boardRolls) * 100) : null;

  const copyTreasury = () => {
    if (!nftPool?.treasury_address) return;
    navigator.clipboard.writeText(nftPool.treasury_address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold neon-glow text-center">ROLLS — Tokenomics</h1>
      <p className="text-gray-400 text-center text-sm">
        Full transparency on how ROLLS work in the game.
      </p>

      {/* Phase 1 means VAULT_COMPONENT is unset: no vault is deployed, so buy_rolls
          cannot be called by anyone. Everything below about purchasing describes how
          it will work, and saying so up front is the whole point of this page. */}
      {prices && prices.phase < 2 && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-4 text-center">
          <p className="text-sm font-medium text-yellow-400">
            ROLLS are not for sale yet
          </p>
          <p className="text-xs text-gray-400 mt-1">
            No purchase vault is live, so nothing on this page can be bought right now.
            Play with the free trial; the rates below are what will apply when buying opens.
          </p>
        </div>
      )}

      {/* Reward Vault */}
      <Section title="Reward Vault" emoji="&#x1F3C6;">
        {vaultBalances.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 mb-2">
              Meme coins gifted to the vault are distributed to players through lucky drops,
              milestones, and tournaments. Lucky drops settle when you <em>complete</em> a
              board — an unfinished board pays nothing.
            </p>
            {vaultBalances.map((v) => (
              <div key={v.token_name} className="bg-gray-800/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-yellow-400">{v.token_name}</span>
                  <span className="text-green-400 font-bold">{v.remaining.toLocaleString()} available</span>
                </div>
                <div className="w-full bg-gray-700/50 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-cyan-500 h-2 rounded-full transition-all"
                    style={{ width: `${v.total_deposited > 0 ? Math.max(2, (v.remaining / v.total_deposited) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>Distributed: {v.total_distributed.toLocaleString()}</span>
                  <span>Total deposited: {v.total_deposited.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-500 text-sm">No meme coins in the vault yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              When meme coins are loaded, they&apos;ll be distributed as lucky drops,
              milestone rewards, and tournament prizes. Drops are rolled once per
              completed cell, but only when the whole board is finished.
            </p>
          </div>
        )}
        <div className="mt-3 space-y-1 text-xs text-gray-500">
          <p><span className="text-cyan-400">Lucky Drop:</span> settled at board completion — 15% per completed cell, random amount. Abandon the board and you get none of it.</p>
          <p><span className="text-cyan-400">Milestone:</span> Reward at 10, 25, 50, 100, 250 completed boards &mdash; paid only while the vault still holds that token</p>
          <p><span className="text-cyan-400">Tournament:</span> Top 3 split a prize pot &mdash; run by the operator, not yet on an automatic schedule</p>
        </div>
      </Section>

      {/* NFT Prize Pool */}
      <Section title="NFT Prize Pool — Gift an NFT!" emoji="&#x1F381;">
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            The prize pool holds NFTs gifted by the community. Every NFT donated gets
            <span className="text-purple-400 font-medium"> raffled off to active players</span>.
          </p>
          {nftPool && !nftPool.treasury_address ? (
            <div className="bg-gray-800/40 rounded-lg p-3 text-center">
              <p className="text-sm text-yellow-400 font-medium">Donations open soon &#x1F6A7;</p>
              <p className="text-xs text-gray-500 mt-1">
                We&apos;re finalising the treasury account. The address will be published here —
                don&apos;t send NFTs to any address claiming to be MEME GRID until then.
              </p>
            </div>
          ) : nftPool?.treasury_address ? (
            <div className="bg-gray-800/40 rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-1">Treasury address (Radix mainnet)</div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-cyan-300 break-all flex-1">{nftPool.treasury_address}</code>
                <button
                  onClick={copyTreasury}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600/30 border border-purple-500/40 text-purple-300 hover:bg-purple-600/50 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Treasury address loading&hellip;</p>
          )}
          {nftPool && nftPool.collections.length > 0 ? (
            <div>
              <div className="text-xs text-gray-400 mb-2">
                Currently in the pool: <span className="text-purple-400 font-bold">{nftPool.total_nfts} NFT{nftPool.total_nfts === 1 ? "" : "s"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {nftPool.collections.map((c) => (
                  <div key={c.resource_address} className="bg-gray-800/30 rounded-lg p-2 flex items-center gap-2">
                    {c.icon_url?.startsWith("https://") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.icon_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    ) : (
                      <span className="text-xl shrink-0">&#x1F381;</span>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs text-gray-300 truncate">{c.name || "Unknown collection"}</div>
                      <div className="text-[10px] text-purple-400 font-bold">&times;{c.count}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : nftPool?.treasury_address ? (
            <p className="text-xs text-gray-500 text-center py-2">
              The pool is just getting started — be the first to gift an NFT! &#x1F9A6;
            </p>
          ) : null}
          <div className="space-y-1 text-xs text-gray-500 border-t border-gray-800 pt-2">
            {/* Do NOT describe the raffle in the present tense until it exists. There is
                no ticket implementation anywhere in server/src — searching for "ticket"
                returns the copy on this page and nothing else. The shape is also not
                settled: docs/GAME-MODEL-STRATEGY.md rules that tickets come from otter
                squares with a weekly cap, deliberately NOT one-per-board, because
                one-per-board is a proxy for spend and lets a payer buy the raffle. */}
            <p><span className="text-purple-400">How drops will work:</span> a weekly draw picks a random NFT and a random ticket, and the NFT is sent straight to the winner&apos;s wallet, on-chain.</p>
            <p>Tickets are earned by playing — never bought, and never awarded for spending ROLLS.</p>
            <p className="text-gray-400">Not live yet: the pool is being seeded and the draw is not running. Gifted NFTs appear in the pool above once they are cleared for prizes.</p>
          </div>
        </div>
      </Section>

      {/* Exchange Rate */}
      <Section title="Exchange Rate" emoji="&#x1F4B1;">
        <div className="text-center py-4">
          <div className="text-4xl font-bold text-green-400 mb-1">
            {prices?.xrd_per_roll != null
              ? `${prices.xrd_per_roll.toLocaleString()} XRD = 1 ROLL`
              : "—"}
          </div>
          {/* Not "fixed". The rate is component state the owner can change with
              set_price, without a redeploy. Calling it fixed was the single most
              misleading line on this page: it was also 112x off. */}
          <p className="text-xs text-gray-500">
            Set on-chain by the vault contract. It can be changed by the operator — this
            page reads the live value rather than quoting a number baked into the site.
          </p>
          {/* Only an alarm once a vault EXISTS to be read. In phase 1 the source is
              always "config" because nothing is deployed — saying the live value
              "could not be read" there reports a failure that has not happened. */}
          {prices && prices.phase >= 2 && prices.xrd_per_roll_source === "config" && (
            <p className="text-[10px] text-yellow-500/80 mt-2">
              Showing the fallback rate — the live contract value could not be read just now.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat
            label="Min purchase"
            value={
              prices?.xrd_per_roll != null ? `${prices.xrd_per_roll.toLocaleString()} XRD` : "—"
            }
          />
          <Stat label="Max purchase" value={`${MAX_XRD_PER_PURCHASE.toLocaleString()} XRD`} />
        </div>
        {/* The real floor is "enough XRD to buy one whole ROLL", which moves with the
            price. The contract's own MIN_XRD is a 0.000001 dust guard, not a business
            minimum, so quoting it here would understate what you actually need. */}
        <p className="text-[10px] text-gray-400 mt-2">
          Purchases buy whole ROLLS, so the smallest useful purchase is one ROLL&apos;s worth
          of XRD. The maximum is a per-transaction limit in the contract, not a wallet cap.
        </p>
      </Section>

      {/* Cost to Play */}
      <Section title="Cost to Play" emoji="&#x1F3B2;">
        <div className="space-y-2 text-sm">
          <Row
            label="New board"
            cost={prices ? (prices.board_cost > 0 ? `${prices.board_cost} ROLLS` : "Free") : "—"}
            note={`8x8 grid, ~${ROLLS_PER_BOARD_TYPICAL} rolls to complete`}
          />
          <Row
            label="Each dice roll"
            cost={prices ? `${prices.roll_cost} ROLL${prices.roll_cost === 1 ? "" : "S"}` : "—"}
            note="Free if extra turn earned"
          />
          <Row
            label="Typical board, all in"
            cost={boardRolls !== null ? `~${boardRolls} ROLLS` : "—"}
            note="measured over 3,000 simulated boards; never more than 128"
          />
          <Row
            label="Typical board, in XRD"
            cost={boardXrd !== null ? `~${Math.round(boardXrd).toLocaleString()} XRD` : "—"}
            note="at the current rate, which can change"
          />
        </div>
      </Section>

      {/* Free Start */}
      {/* The owner's brief for this page was "publish the economics honestly". This
          section is the one that decides whether that is true: it is where a player
          forms an expectation about what they get for nothing. Saying "N full boards"
          off a stale 500 was the exact opposite. State the limit plainly. */}
      <Section title="Free Trial" emoji="&#x1F381;">
        <div className="space-y-2 text-sm text-gray-300">
          <p>
            Every new player gets{" "}
            <span className="text-yellow-400 font-bold">{freeRolls} free ROLLS</span>, once.
            Guest mode (no wallet) gets the same.
          </p>
          {trialPercent !== null && boardRolls !== null && (
            <p>
              That is <span className="text-yellow-400">about {trialPercent}% of one board</span>{" "}
              (~{boardRolls} ROLLS) — enough to see how the game plays,{" "}
              <span className="text-yellow-400">not enough to finish a board</span>.
            </p>
          )}
          <p className="text-xs text-gray-500 pt-1">
            That is deliberate. Rewards settle when a board is <em>completed</em>, so a trial
            that cannot reach a completed board pays nothing — which is what stops the free
            grant from being farmed with throwaway addresses. It is a demo, not an income.
          </p>
          <p className="text-xs text-gray-500">
            The grant is one-off. There is no recurring free allowance: daily streaks pay XP
            bonuses and power-ups, not ROLLS.
          </p>
        </div>
      </Section>

      {/* Earning ROLLS */}
      <Section title="Earning ROLLS Back" emoji="&#x1F4B0;">
        <div className="space-y-1 text-sm">
          <Row label="Level 2 (2,000 XP)" cost="+25 ROLLS" />
          <Row label="Level 3 (6,000 XP)" cost="+50 ROLLS" />
          <Row label="Level 4 (15,000 XP)" cost="+100 ROLLS" />
          <Row label="Level 5 (30,000 XP)" cost="+150 ROLLS" />
          <Row label="Level 10 (300,000 XP)" cost="+1,000 ROLLS" />
          {/* Streaks pay ZERO ROLLS at every tier (server/src/game/streaks.ts). They
              used to pay 10-205/day, which was the farm vector — a daily check-in is
              not work. Only the XP bonus and the power-up unlock survive, and saying
              otherwise here is a promise the server visibly does not keep. */}
          <div className="border-t border-gray-800 pt-2 mt-2">
            <Row label="Daily streak (Day 7)" cost="+20% XP + X-Ray" note="no ROLLS" />
            <Row label="Daily streak (Day 14)" cost="+30% XP + Magnet" note="no ROLLS" />
            <Row label="Daily streak (Day 30)" cost="+50% XP + Row Bomb" note="no ROLLS" />
          </div>
          <p className="text-xs text-gray-500 pt-2">
            Streaks pay no ROLLS at any tier. Showing up is not the same as playing, and
            paying a currency for a check-in is what made the old free allowance farmable.
          </p>
        </div>
      </Section>

      {/* One-Way Economy */}
      <Section title="One-Way Economy" emoji="&#x1F6A7;">
        <div className="space-y-2 text-sm text-gray-300">
          <div className="flex items-center gap-2 text-yellow-400 font-medium">
            <span>XRD &rarr; ROLLS</span>
            <span className="text-green-400">&#x2705;</span>
          </div>
          <p>
            Buy ROLLS with XRD at the current rate
            {prices?.xrd_per_roll != null
              ? ` (${prices.xrd_per_roll.toLocaleString()} XRD per ROLL)`
              : ""}
            . Your XRD goes into the on-chain treasury vault, which funds the game&apos;s
            running costs and its prize pools. It is not held on your behalf and it is not
            an investment in anything.
          </p>
          <div className="flex items-center gap-2 text-yellow-400 font-medium">
            <span>ROLLS &rarr; XRD</span>
            <span className="text-red-400">&#x274C; Not available</span>
          </div>
          <p>ROLLS cannot be converted back to XRD. This is a game token — spend it on boards, rolls, and power-ups.</p>
          <p className="text-xs text-gray-500 mt-2">
            The smart contract has no redeem/swap-back function. The ROLLS resource allows burning, and burning
            returns nothing &mdash; but note that spending ROLLS in-game does <em>not</em> burn anything on-chain:
            gameplay debits your server-side balance, so a roll costs no network fee and needs no wallet approval.
            Treasury withdrawals require the owner badge &mdash; players cannot access the vault.
          </p>
        </div>
      </Section>

      {/* Power-Up Costs */}
      <Section title="Power-Up Costs" emoji="&#x26A1;">
        <div className="space-y-1 text-sm">
          <Row label="Re-Roll" cost="5 ROLLS" note="Hit a new random cell" />
          <Row label="X-Ray" cost="10 ROLLS" note="Reveal all cells for 5 rolls" />
          <Row label="Cell Swap" cost="15 ROLLS" note="Change a rug pull to normal" />
          <Row label="Magnet" cost="20 ROLLS" note="Target near-complete cells for 3 rolls" />
          <Row label="Row Bomb" cost="30 ROLLS" note="Complete an entire row instantly" />
        </div>
        <p className="text-xs text-gray-500 mt-2">Power-ups also drop for free during gameplay (15% chance on cell completion).</p>
      </Section>

      {/* Scoring (not ROLLS) */}
      <Section title="Scoring (Points, not ROLLS)" emoji="&#x1F3AF;">
        <p className="text-xs text-gray-500 mb-2">Score is a ranking metric — not converted to ROLLS.</p>
        <div className="grid grid-cols-2 gap-1 text-xs text-gray-400">
          <span>Normal cell: +10 pts</span>
          <span>Double cell: +20 pts</span>
          <span>Diamond: +30 pts</span>
          <span>Moon: +50 pts</span>
          <span>Rug Pull: -15 pts</span>
          <span>Row/Col line: +25 pts</span>
          <span>Diagonal: +50 pts</span>
          <span>BLACKOUT: +500 pts</span>
        </div>
      </Section>

      {/* Smart Contract */}
      <Section title="Smart Contract" emoji="&#x1F50D;">
        <div className="space-y-2 text-sm text-gray-300">
          <p>ROLLS is a Radix fungible token minted by a Scrypto smart contract.</p>
          {/* Every line here is checked against scrypto/meme-token/src/lib.rs. The
              previous version said "Burn authority: Anyone can burn" (it is
              global_caller, not allow_all) and "Immutable — no admin override", which
              is the claim a player would most reasonably rely on and the one that was
              least true: the owner can reprice, pause and drain the treasury. A
              transparency page that omits the operator's powers is marketing. */}
          <div className="space-y-1 text-xs text-gray-500">
            <p><span className="text-gray-400">Mint authority:</span> the component only — ROLLS can only be created against an XRD payment, never by hand</p>
            <p><span className="text-gray-400">Burn authority:</span> the component only, so every burn is recorded</p>
            <p><span className="text-gray-400">Supply:</span> uncapped, and backed 1:1 by the XRD paid for it</p>
            <p><span className="text-gray-400">Code:</span> fixed — the blueprint cannot be swapped or proxied</p>
          </div>
          <div className="mt-3 border-t border-gray-800 pt-2 space-y-1 text-xs text-gray-500">
            <p className="text-gray-400">What the operator can do:</p>
            <p>&bull; <span className="text-yellow-500/90">Change the price</span> of future purchases, without warning and without a redeploy. It never affects ROLLS you already hold.</p>
            <p>&bull; <span className="text-yellow-500/90">Pause</span> buying and burning.</p>
            <p>&bull; <span className="text-yellow-500/90">Withdraw the XRD treasury.</span> The XRD you spend is spent — it is revenue, not a deposit held for you.</p>
            <p>&bull; <span className="text-yellow-500/90">Point the ROLLS token at a future vault</span>, so a later version can inherit your balance rather than stranding it.</p>
            <p className="text-gray-400 pt-1">
              Pausing needs a separate hot key; repricing, withdrawing and reassigning
              all need the cold owner badge, which is held offline.
            </p>
          </div>
        </div>
      </Section>

      <div className="text-center">
        <Link href="/play" className="inline-block px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-green-600 to-cyan-600 text-white shadow-lg shadow-green-500/20 transition-all hover:scale-105">
          Start Playing
        </Link>
      </div>
    </div>
  );
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
      <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
        <span>{emoji}</span> {title}
      </h2>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/30 rounded-lg p-3 text-center">
      <div className="text-lg font-bold text-green-400">{value}</div>
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
    </div>
  );
}

function Row({ label, cost, note }: { label: string; cost: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-300">{label}</span>
      <div className="text-right">
        <span className="text-yellow-400 font-medium">{cost}</span>
        {note && <span className="text-gray-400 text-xs ml-2">{note}</span>}
      </div>
    </div>
  );
}
