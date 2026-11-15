import { Router } from "express";
import { validateAddress, parseLimit } from "../middleware/validate";
import { adminAuth } from "../middleware/admin-auth";
import { requireAuth } from "../middleware/require-auth";
import { getDb } from "../db/connection";
import { getPendingRewards, getRewardHistory, distributeTournamentPrizes } from "../game/rewards";
import { getAccountHoldings } from "../services/gateway";
import { filterAllowedPrizeCollections } from "../services/prize-allowlist";
import { refuseIfSigner, refuseIfHoldsCustodyBadge, type TreasuryRefusal } from "../services/treasury-guard";

const router = Router();

// GET /api/vault/balances — public pool balances
router.get("/vault/balances", (_req, res) => {
  const db = getDb();
  const balances = db.prepare(`
    SELECT token_name, token_resource, total_deposited, total_distributed, remaining
    FROM vault_balances
    ORDER BY token_name
  `).all();

  res.json({ ok: true, balances });
});

// GET /api/vault/config — public reward config
router.get("/vault/config", (_req, res) => {
  const db = getDb();
  const configs = db.prepare(`
    SELECT token_name, trigger_type, enabled, drop_chance, drop_min, drop_max, milestone_config, tournament_splits
    FROM reward_config
    WHERE enabled = 1
  `).all();

  res.json({ ok: true, configs });
});

// GET /api/vault/rewards/:address — player's reward history
router.get("/vault/rewards/:address", validateAddress, (req, res) => {
  const { address } = req.params;
  const limit = parseLimit(req.query.limit, 50, 200);
  const rewards = getRewardHistory(address, limit);
  const pending = getPendingRewards(address);

  const totalEarned = rewards.reduce((sum: number, r: any) => sum + r.amount, 0);
  const totalPending = pending.reduce((sum: number, r: any) => sum + r.amount, 0);

  res.json({
    ok: true,
    rewards,
    pending,
    summary: {
      total_earned: Math.round(totalEarned * 100) / 100,
      total_pending: Math.round(totalPending * 100) / 100,
      total_claimed: Math.round((totalEarned - totalPending) * 100) / 100,
    },
  });
});

// POST /api/vault/deposit — admin: load meme coins into vault
router.post("/vault/deposit", adminAuth, (req, res) => {
  const { token_name, amount, token_resource } = req.body;
  if (!token_name || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ ok: false, error: "token_name and positive amount required" });
    return;
  }

  const db = getDb();

  // Upsert vault balance
  db.prepare(`
    INSERT INTO vault_balances (token_name, token_resource, total_deposited)
    VALUES (?, ?, ?)
    ON CONFLICT(token_name) DO UPDATE SET
      total_deposited = total_deposited + ?,
      token_resource = COALESCE(?, token_resource),
      updated_at = strftime('%s','now')
  `).run(token_name, token_resource || null, amount, amount, token_resource || null);

  const balance = db.prepare("SELECT * FROM vault_balances WHERE token_name = ?").get(token_name);

  res.json({ ok: true, message: `Deposited ${amount} ${token_name} into vault`, balance });
});

// POST /api/vault/setup — admin: configure reward triggers for a token
router.post("/vault/setup", adminAuth, (req, res) => {
  const { token_name, trigger_type, drop_chance, drop_min, drop_max, milestone_config, tournament_pool_pct, tournament_splits } = req.body;
  if (!token_name || !trigger_type) {
    res.status(400).json({ ok: false, error: "token_name and trigger_type required" });
    return;
  }

  const validTriggers = ["lucky_drop", "milestone", "tournament"];
  if (!validTriggers.includes(trigger_type)) {
    res.status(400).json({ ok: false, error: `trigger_type must be one of: ${validTriggers.join(", ")}` });
    return;
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO reward_config (token_name, trigger_type, drop_chance, drop_min, drop_max, milestone_config, tournament_pool_pct, tournament_splits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_name, trigger_type) DO UPDATE SET
      drop_chance = COALESCE(?, drop_chance),
      drop_min = COALESCE(?, drop_min),
      drop_max = COALESCE(?, drop_max),
      milestone_config = COALESCE(?, milestone_config),
      tournament_pool_pct = COALESCE(?, tournament_pool_pct),
      tournament_splits = COALESCE(?, tournament_splits)
  `).run(
    token_name, trigger_type,
    drop_chance ?? 0.15, drop_min ?? 1, drop_max ?? 10,
    milestone_config ? JSON.stringify(milestone_config) : null,
    tournament_pool_pct ?? 0.1, tournament_splits ? JSON.stringify(tournament_splits) : null,
    // ON CONFLICT values
    drop_chance ?? null, drop_min ?? null, drop_max ?? null,
    milestone_config ? JSON.stringify(milestone_config) : null,
    tournament_pool_pct ?? null, tournament_splits ? JSON.stringify(tournament_splits) : null,
  );

  res.json({ ok: true, message: `Configured ${trigger_type} for ${token_name}` });
});

// POST /api/vault/claim/:address — player claims pending rewards
// required-for-wallets: claiming moves rewards out of the pool, so a real
// `account_…` address needs a proven ROLA session (items 3/14). Guests are
// unaffected — they never hold a session and keep the legacy-style fallback.
router.post("/vault/claim/:address", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const db = getDb();

  try {
    const result = db.transaction(() => {
      const pending = getPendingRewards(address);
      if (pending.length === 0) {
        return { claimed: 0, rewards: [] };
      }

      // Mark all pending as claimed
      const ids = pending.map((r: any) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(`
        UPDATE reward_history
        SET status = 'claimed', claimed_at = strftime('%s','now')
        WHERE id IN (${placeholders})
      `).run(...ids);

      // Summarize by token
      const summary: Record<string, number> = {};
      for (const r of pending as any[]) {
        summary[r.token_name] = (summary[r.token_name] || 0) + r.amount;
      }

      return {
        claimed: pending.length,
        rewards: pending,
        summary,
      };
    })();

    if (result.claimed === 0) {
      res.json({ ok: true, message: "No pending rewards to claim", claimed: 0 });
      return;
    }

    // TODO Phase 2: Queue on-chain token transfer for each claimed reward
    // For now, rewards are marked "claimed" in the DB — on-chain distribution
    // happens when the token projects deposit real tokens to the server wallet.

    res.json({
      ok: true,
      message: `Claimed ${result.claimed} rewards`,
      claimed: result.claimed,
      summary: result.summary,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/vault/tournament — admin: run weekly tournament distribution
router.post("/vault/tournament", adminAuth, (req, res) => {
  const weekLabel = req.body.week_label || `week-${new Date().toISOString().slice(0, 10)}`;

  try {
    const db = getDb();
    const drops = db.transaction(() => distributeTournamentPrizes(weekLabel))();
    res.json({ ok: true, distributed: drops.length, drops });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/vault/nfts — public listing of the operator-held prize account.
// The server holds no key to that account and nothing here moves anything out
// of it. 5-min cache keeps Gateway traffic negligible under player load.
let nftPoolCache: { at: number; payload: unknown } | null = null;
const NFT_POOL_TTL_MS = 5 * 60 * 1000;
// When the Gateway fails, the last checked answer is served only until it is
// this old; after that the account counts as unchecked and nothing is published.
const NFT_POOL_STALE_MAX_MS = 2 * NFT_POOL_TTL_MS;
// After a check fails (Gateway error or timeout), no new check starts for this
// long; requests in the window get the same stale-or-empty answer without a
// Gateway call. Without it, every page view re-runs a chain of up to 39 calls
// against a Gateway that is already failing.
const NFT_POOL_RETRY_AFTER_MS = 30 * 1000;

const EMPTY_POOL = { ok: true, treasury_address: null, collections: [], total_nfts: 0 } as const;

// The check in flight, if any. Requests that arrive while it runs share its
// answer instead of starting a check of their own.
let nftPoolInflight: Promise<unknown> | null = null;
// When the last check failed; cleared by any completed check.
let nftPoolFailedAt: number | null = null;

/** Test hook: the cache is module state and outlives a single test case. */
export function resetNftPoolCacheForTests(): void {
  nftPoolCache = null;
  nftPoolInflight = null;
  nftPoolFailedAt = null;
}

/** Test hook: make the cached answer and the last failure `ms` older than they are. */
export function ageNftPoolCacheForTests(ms: number): void {
  if (nftPoolCache) nftPoolCache.at -= ms;
  if (nftPoolFailedAt !== null) nftPoolFailedAt -= ms;
}

function refuseTreasury(reason: TreasuryRefusal): typeof EMPTY_POOL {
  console.warn(`[vault] not publishing NFT_TREASURY_ACCOUNT (${reason})`);
  // Cached like a good answer, so a refused account costs one check per TTL.
  nftPoolCache = { at: Date.now(), payload: EMPTY_POOL };
  nftPoolFailedAt = null;
  return EMPTY_POOL;
}

/**
 * The answer when the account could not be checked just now: the last checked
 * answer while it is recent. Without one the account is unchecked, so publish
 * nothing rather than the address.
 */
function answerWithoutCheck(): unknown {
  const cached = nftPoolCache;
  return cached && Date.now() - cached.at < NFT_POOL_STALE_MAX_MS ? cached.payload : EMPTY_POOL;
}

/**
 * One full check of `treasury`. A Gateway failure does not reject: it is
 * remembered (see NFT_POOL_RETRY_AFTER_MS) and answered by answerWithoutCheck().
 */
async function checkNftPool(treasury: string): Promise<unknown> {
  const signerRefusal = await refuseIfSigner(treasury);
  if (signerRefusal) return refuseTreasury(signerRefusal);

  try {
    const holdings = await getAccountHoldings(treasury);
    const badgeRefusal = refuseIfHoldsCustodyBadge(holdings);
    if (badgeRefusal) return refuseTreasury(badgeRefusal);
    // The public prize pool must never surface or count a resource that isn't
    // explicitly allowlisted. Fails closed: empty allowlist → empty pool.
    // docs/PROJECT-STATE.md item 16.
    const collections = filterAllowedPrizeCollections(holdings.nftCollections);
    const payload = {
      ok: true,
      treasury_address: treasury,
      collections,
      total_nfts: collections.reduce((sum, c) => sum + c.count, 0),
    };
    nftPoolCache = { at: Date.now(), payload };
    nftPoolFailedAt = null;
    return payload;
  } catch (err) {
    nftPoolFailedAt = Date.now();
    console.warn(
      `[vault] NFT prize account check failed, retrying in ${NFT_POOL_RETRY_AFTER_MS / 1000}s: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return answerWithoutCheck();
  }
}

router.get("/vault/nfts", async (_req, res) => {
  // NFT_TREASURY_ACCOUNT only — deliberately NO fallback to RADIX_MAINNET_ADDRESS,
  // the signer's own account. The address is published only after
  // services/treasury-guard.ts has ruled out the signer and any account holding
  // a known custody badge; anything unproven publishes nothing.
  const treasury = process.env.NFT_TREASURY_ACCOUNT || null;

  if (!treasury) {
    res.json(EMPTY_POOL);
    return;
  }
  if (nftPoolCache && Date.now() - nftPoolCache.at < NFT_POOL_TTL_MS) {
    res.json(nftPoolCache.payload);
    return;
  }
  if (nftPoolFailedAt !== null && Date.now() - nftPoolFailedAt < NFT_POOL_RETRY_AFTER_MS) {
    res.json(answerWithoutCheck());
    return;
  }

  // Single flight: one check at a time. Cleared only by the check that set it,
  // so a check that outlives a test-hook reset cannot clear a newer one.
  if (!nftPoolInflight) {
    const check: Promise<unknown> = checkNftPool(treasury).finally(() => {
      if (nftPoolInflight === check) nftPoolInflight = null;
    });
    nftPoolInflight = check;
  }
  res.json(await nftPoolInflight);
});

export default router;
