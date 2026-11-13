/**
 * NFT Minter — queues and processes on-chain NFT mints for game achievements.
 *
 * Flow: achievement unlock → queue entry → worker picks up → sign TX → mint to player wallet
 * Decoupled from gameplay — game unlocks immediately, minting happens async.
 */

import { getDb } from "../db/connection";
import { signAndSubmit, waitForCommit, ACCOUNT } from "./signer";
import { isOnChainAddress } from "../middleware/validate";
import { getMintDailyCap, utcDay } from "./mint-cap";

// These are set after deploy — loaded from deploy-state.json or env
const NFT_RESOURCE = process.env.NFT_RESOURCE || "";
const NFT_MINTER_BADGE = process.env.NFT_MINTER_BADGE || "";
const ICON_BASE_URL = process.env.NFT_ICON_BASE_URL || "https://memegrid.radixguild.com/nfts";

const MAX_ATTEMPTS = 3;

/**
 * Escape a value for interpolation into a manifest string literal. Catalog
 * text is trusted today, but an unescaped quote would silently reshape the
 * manifest rather than fail loudly.
 */
function manifestString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/**
 * Queue an NFT for minting. Called when an achievement unlocks an NFT.
 */
export function queueNftMint(nftUnlockId: number, address: string, nftKey: string, nftName: string, rarity: string): number {
  // Guests have no wallet to deposit into — their address can't go into a
  // mint manifest, so queueing one only burns retries against a tx that can
  // never build. The unlock still stands in-game (gallery, XP); connecting a
  // wallet later earns future NFTs on-chain.
  if (!isOnChainAddress(address)) return 0;

  const db = getDb();

  // Don't queue if already queued
  const existing = db.prepare(
    "SELECT id FROM nft_mint_queue WHERE nft_unlock_id = ?"
  ).get(nftUnlockId) as any;

  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO nft_mint_queue (nft_unlock_id, radix_address, nft_key, nft_name, rarity)
    VALUES (?, ?, ?, ?, ?)
  `).run(nftUnlockId, address, nftKey, nftName, rarity);

  console.log(`[nft-minter] Queued mint: ${nftKey} for ${address.slice(0, 20)}...`);
  return result.lastInsertRowid as number;
}

/**
 * On-chain NonFungibleLocalId for one unlock.
 *
 * Must be unique across the resource (a duplicate aborts the mint) and must
 * satisfy the blueprint's rule — 1-64 alphanumeric/underscore, else
 * NonFungibleLocalId::string panics and the whole transaction fails. The
 * unlock id supplies uniqueness; truncation keeps long keys inside 64.
 */
export function buildNftLocalId(nftKey: string, unlockId: number): string {
  const suffix = `_${unlockId}`;
  const safeKey = nftKey
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 64 - suffix.length);
  return `${safeKey}${suffix}`;
}

/**
 * Build the manifest to mint an NFT and deposit it to the player.
 *
 * Mints straight off the resource rather than through MemeGridNfts::mint_nft,
 * because that component cannot mint: the resource's `minter` role demands a
 * proof of the minter/owner badge, and the component holds neither — it calls
 * mint_non_fungible from its own call frame, where our transaction's badge
 * proof isn't in scope, so every call through it aborts Unauthorized. (The
 * blueprint reserves its own address "for self-referencing auth" and then
 * never uses it — the intended `require(global_caller(...))` rule was never
 * wired, and fixing it means redeploying to a brand-new resource address.)
 *
 * Minting from the transaction root keeps the badge proof in scope, so the
 * existing, already-deployed collection works untouched. Verified against
 * mainnet with /transaction/preview.
 *
 * The data tuple's field order must track MemeGridNft exactly:
 *   (name, description, rarity, icon_url, game_key)
 */
export function buildMintManifest(
  playerAddress: string,
  nftId: string,
  nftKey: string,
  nftName: string,
  description: string,
  rarity: string,
): string {
  const iconUrl = `${ICON_BASE_URL}/${rarity}.svg`;

  return `
CALL_METHOD
  Address("${ACCOUNT}")
  "create_proof_of_amount"
  Address("${NFT_MINTER_BADGE}")
  Decimal("1");

MINT_NON_FUNGIBLE
  Address("${NFT_RESOURCE}")
  Map<NonFungibleLocalId, Tuple>(
    NonFungibleLocalId("<${nftId}>") => Tuple(Tuple(
      "${manifestString(nftName)}",
      "${manifestString(description)}",
      "${manifestString(rarity)}",
      "${manifestString(iconUrl)}",
      "${manifestString(nftKey)}"
    ))
  );

TAKE_ALL_FROM_WORKTOP
  Address("${NFT_RESOURCE}")
  Bucket("nft");

CALL_METHOD
  Address("${playerAddress}")
  "try_deposit_or_abort"
  Bucket("nft")
  None;
`.trim();
}

/** Last UTC day the "cap reached" line was logged, so the 30s worker logs it once a day. */
let capLoggedForDay: string | null = null;

/**
 * Claim the next mint to attempt, or null if there is none or today's
 * NFT_MINT_DAILY_CAP is used up (see services/mint-cap.ts).
 *
 * The cap check, the row claim (status → minting, attempts + 1) and the day's
 * counter increment are one transaction, so the count can never run behind
 * the attempts actually started. A row the cap holds back is not touched at
 * all: it keeps its status and attempt count and is claimed on a later day.
 */
export function claimNextMint(now: Date = new Date()): any | null {
  const db = getDb();
  const cap = getMintDailyCap();
  const day = utcDay(now);

  return db.transaction(() => {
    // Pick oldest pending or failed (with retries left)
    // radix_address filter is defence in depth — queueNftMint() already rejects
    // guests, but a legacy row must never reach the manifest builder.
    const item = db.prepare(`
      SELECT q.*, u.id as unlock_id
      FROM nft_mint_queue q
      JOIN nft_unlocks u ON u.id = q.nft_unlock_id
      WHERE q.status IN ('pending', 'failed')
        AND q.attempts < ?
        AND q.radix_address LIKE 'account_%'
      ORDER BY q.created_at ASC, q.id ASC
      LIMIT 1
    `).get(MAX_ATTEMPTS) as any;

    if (!item) return null;

    if (cap.limit !== null) {
      const started =
        (db.prepare("SELECT started FROM nft_mint_daily_count WHERE day = ?").get(day) as any)?.started ?? 0;
      if (started >= cap.limit) {
        if (capLoggedForDay !== day) {
          capLoggedForDay = day;
          console.warn(`[nft-minter] holding mints for ${day} (UTC): ${cap.describe}; ${started} started today. Queued mints are kept.`);
        }
        return null;
      }
    }

    db.prepare("UPDATE nft_mint_queue SET status = 'minting', attempts = attempts + 1 WHERE id = ?")
      .run(item.id);
    db.prepare(`
      INSERT INTO nft_mint_daily_count (day, started) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET started = started + 1
    `).run(day);

    return item;
  })();
}

/**
 * Process one pending mint from the queue.
 * Returns true if a mint was processed, false if the queue is empty or
 * today's mint cap is used up.
 */
export async function processOneMint(): Promise<boolean> {
  if (!NFT_RESOURCE || !NFT_MINTER_BADGE) {
    return false; // NFT system not configured
  }

  const db = getDb();
  const item = claimNextMint();
  if (!item) return false;

  // `attempts` was read before the claim incremented it.
  console.log(`[nft-minter] Processing: ${item.nft_key} for ${item.radix_address.slice(0, 20)}... (attempt ${item.attempts + 1})`);

  try {
    // Get description from nft catalog
    const { getNftByKey } = require("../game/nfts");
    const nftDef = getNftByKey(item.nft_key);
    const description = nftDef?.description || `Achievement NFT: ${item.nft_name}`;

    // The on-chain local id must be unique across the whole resource, so it
    // cannot be the achievement key — every player unlocks "first_grid", and
    // the second mint of that id aborts as a duplicate. Suffixing the unlock
    // id makes it unique per player-achievement while `game_key` (passed
    // below, unchanged) still identifies which catalog design this is.
    // Derived from the row, not a counter, so a retry re-mints the same id
    // rather than minting a second NFT.
    const nftId = buildNftLocalId(item.nft_key, item.nft_unlock_id);

    const manifest = buildMintManifest(
      item.radix_address,
      nftId,
      item.nft_key,
      item.nft_name,
      description,
      item.rarity,
    );

    const intentHash = await signAndSubmit(manifest);
    const result = await waitForCommit(intentHash);

    if (result.success) {
      // Mark as minted
      db.prepare(`
        UPDATE nft_mint_queue SET status = 'minted', tx_hash = ?, minted_at = strftime('%s','now')
        WHERE id = ?
      `).run(intentHash, item.id);

      // Update nft_unlocks table
      db.prepare("UPDATE nft_unlocks SET minted_on_chain = 1 WHERE id = ?")
        .run(item.nft_unlock_id);

      console.log(`[nft-minter] ✅ Minted ${item.nft_key}: ${intentHash}`);
      return true;
    } else {
      const errorMsg = JSON.stringify(result.status).slice(0, 200);
      db.prepare("UPDATE nft_mint_queue SET status = 'failed', last_error = ? WHERE id = ?")
        .run(errorMsg, item.id);
      console.error(`[nft-minter] ❌ Failed ${item.nft_key}: ${errorMsg}`);
      return true;
    }
  } catch (err: any) {
    db.prepare("UPDATE nft_mint_queue SET status = 'failed', last_error = ? WHERE id = ?")
      .run(err.message.slice(0, 200), item.id);
    console.error(`[nft-minter] ❌ Error ${item.nft_key}: ${err.message}`);
    return true;
  }
}

/**
 * Get mint queue status for a player.
 */
export function getMintQueueStatus(address: string) {
  const db = getDb();
  return db.prepare(`
    SELECT nft_key, nft_name, rarity, status, tx_hash, attempts, created_at, minted_at
    FROM nft_mint_queue
    WHERE radix_address = ?
    ORDER BY created_at DESC
  `).all(address);
}

/**
 * Get overall queue stats (admin).
 */
export function getMintQueueStats() {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM nft_mint_queue WHERE status = 'pending'").get() as any)?.c ?? 0;
  const minting = (db.prepare("SELECT COUNT(*) as c FROM nft_mint_queue WHERE status = 'minting'").get() as any)?.c ?? 0;
  const minted = (db.prepare("SELECT COUNT(*) as c FROM nft_mint_queue WHERE status = 'minted'").get() as any)?.c ?? 0;
  const failed = (db.prepare("SELECT COUNT(*) as c FROM nft_mint_queue WHERE status = 'failed' AND attempts >= 3").get() as any)?.c ?? 0;
  return { pending, minting, minted, failed_permanent: failed };
}
