// Transaction verification — confirms on-chain deposit receipts

import { getTransactionDetails } from "./gateway";

const VAULT_COMPONENT = process.env.VAULT_COMPONENT || "";
const MEME_RESOURCE = process.env.MEME_RESOURCE || "";
const XRD_RESOURCE = process.env.XRD_RESOURCE_ADDRESS ||
  "resource_rdx1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxradxrd";

export interface VerificationResult {
  valid: boolean;
  memeAmount: number;
  xrdAmount: string;
  error?: string;
}

export interface BuyRollsConfig {
  vaultComponent: string;
  rollsResource: string;
  xrdResource: string;
}

// ── Exact Radix Decimal arithmetic ──────────────────────────────────────────
// Radix Decimals carry 18 fractional digits. parseFloat loses precision long
// before that, and a credit decision must not depend on float rounding, so the
// amounts below are compared as fixed-point BigInts.
const SCALE = 10n ** 18n;
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d{1,18}))?$/;

export function parseDecimal(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return null;
  const n = BigInt(m[2]) * SCALE + BigInt((m[3] ?? "").padEnd(18, "0"));
  return m[1] ? -n : n;
}

function formatDecimal(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

function fail(error: string): VerificationResult {
  return { valid: false, memeAmount: 0, xrdAmount: "0", error };
}

/** Read one named Decimal field out of a Gateway programmatic-SBOR tuple. */
function decimalField(data: any, name: string): bigint | null {
  const fields = data?.fields;
  if (!Array.isArray(fields)) return null;
  const f = fields.find((x: any) => x?.field_name === name);
  if (!f || f.kind !== "Decimal") return null;
  return parseDecimal(f.value);
}

/** Net balance change of one resource on one entity, or null if unreadable. */
function netChange(changes: any[], entity: string, resource: string): bigint | null {
  let total = 0n;
  for (const c of changes) {
    if (c?.entity_address !== entity || c?.resource_address !== resource) continue;
    const d = parseDecimal(c.balance_change);
    if (d === null) return null;
    total += d;
  }
  return total;
}

/**
 * Decide what a committed transaction entitles `expectedAccount` to. Pure: no
 * Gateway call, so every rule below is pinned by services/__tests__/tx-verifier.test.ts.
 *
 * Credit only what THIS transaction MINTED for THIS payer (MG-1, 2026-10-06).
 * ROLLS are an ordinary transferable fungible (the blueprint sets mint/burn roles
 * only), and the shop leaves bought ROLLS in the player's wallet. The previous
 * rule — "credit the account's positive ROLLS balance change, as long as the vault
 * appears somewhere in the transaction" — therefore credited tokens that were
 * merely MOVED into the account: transfer N ROLLS in from a second wallet, buy one
 * roll in the same manifest, and N+1 got credited again, without limit.
 *
 * The rules now, all of which must hold (anything unreadable is a refusal):
 *   1. the transaction is CommittedSuccess;
 *   2. the receipt carries at least one `BuyRollsEvent` emitted by the vault's
 *      own Main module (`emitter.entity.entity_address === vaultComponent`) —
 *      the event, not the balance changes, says how much was minted;
 *   3. the ROLLS balance change on `expectedAccount` EQUALS the total minted —
 *      not "at least": any extra ROLLS came from somewhere other than the mint;
 *   4. the XRD debit on `expectedAccount` is at least the total `xrd_paid` the
 *      vault reports — the payer is the account being credited;
 *   5. the minted total is a positive whole number of ROLLS.
 */
export function evaluateBuyRollsTransaction(
  txDetails: any,
  expectedAccount: string,
  cfg: BuyRollsConfig
): VerificationResult {
  const transaction = txDetails?.transaction;
  if (!transaction) return fail("Transaction not found");

  const status = transaction.transaction_status;
  if (status !== "CommittedSuccess") return fail(`Transaction status: ${status}`);

  const events = transaction.receipt?.events;
  if (!Array.isArray(events)) {
    return fail("Transaction receipt events unavailable — cannot confirm what was minted");
  }

  let minted = 0n;
  let xrdPaid = 0n;
  let buyEvents = 0;
  for (const ev of events) {
    if (ev?.name !== "BuyRollsEvent") continue;
    const emitter = ev.emitter;
    if (
      emitter?.type !== "Method" ||
      emitter?.entity?.entity_address !== cfg.vaultComponent ||
      emitter?.object_module_id !== "Main"
    ) {
      continue; // someone else's component can emit an event with the same name
    }
    const rolls = decimalField(ev.data, "rolls_amount");
    const paid = decimalField(ev.data, "xrd_paid");
    if (rolls === null || paid === null || rolls <= 0n || paid <= 0n) {
      return fail("Unreadable BuyRollsEvent from the vault component");
    }
    minted += rolls;
    xrdPaid += paid;
    buyEvents++;
  }

  if (buyEvents === 0) {
    return fail("Transaction did not mint ROLLS through the expected vault component");
  }
  if (minted % SCALE !== 0n) return fail("Minted ROLLS amount is not a whole number");
  const mintedWhole = minted / SCALE;
  if (mintedWhole > BigInt(Number.MAX_SAFE_INTEGER)) return fail("Minted ROLLS amount out of range");

  const changes = transaction.balance_changes?.fungible_balance_changes;
  if (!Array.isArray(changes)) {
    return fail("Transaction balance changes unavailable — cannot confirm the payer");
  }

  const rollsDelta = netChange(changes, expectedAccount, cfg.rollsResource);
  if (rollsDelta === null) return fail("Unreadable ROLLS balance change");
  if (rollsDelta !== minted) {
    return fail(
      `ROLLS received by this account (${formatDecimal(rollsDelta)}) does not equal ` +
        `ROLLS minted by this transaction (${formatDecimal(minted)})`
    );
  }

  const xrdDelta = netChange(changes, expectedAccount, cfg.xrdResource);
  if (xrdDelta === null) return fail("Unreadable XRD balance change");
  if (-xrdDelta < xrdPaid) {
    return fail(
      `XRD paid by this account (${formatDecimal(-xrdDelta)}) is less than ` +
        `the vault's price for the minted ROLLS (${formatDecimal(xrdPaid)})`
    );
  }

  return { valid: true, memeAmount: Number(mintedWhole), xrdAmount: formatDecimal(xrdPaid) };
}

/**
 * Verify a buy_rolls transaction on-chain and return what it entitles
 * `expectedAccount` to. See evaluateBuyRollsTransaction for the rules.
 */
export async function verifyBuyMemeTransaction(
  txHash: string,
  expectedAccount: string
): Promise<VerificationResult> {
  // Skip verification if no component configured (Phase 1 mode)
  if (!VAULT_COMPONENT || !MEME_RESOURCE) {
    return fail("Token verification not configured (Phase 1 mode — use direct deposit)");
  }

  try {
    const txDetails = await getTransactionDetails(txHash);
    return evaluateBuyRollsTransaction(txDetails, expectedAccount, {
      vaultComponent: VAULT_COMPONENT,
      rollsResource: MEME_RESOURCE,
      xrdResource: XRD_RESOURCE,
    });
  } catch (err: any) {
    return fail(`Verification failed: ${err.message}`);
  }
}
