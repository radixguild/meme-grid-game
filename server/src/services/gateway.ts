// Radix Gateway API client for transaction verification and balance queries

const GATEWAY_URL = process.env.GATEWAY_URL || "https://mainnet.radixdlt.com";

interface GatewayResponse {
  ok: boolean;
  data?: any;
  error?: string;
}

async function gatewayPost(endpoint: string, body: any): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
  return res.json();
}

/**
 * Get committed transaction details by intent hash
 */
export async function getTransactionDetails(txHash: string): Promise<any> {
  return gatewayPost("/transaction/committed-details", {
    intent_hash: txHash,
    opt_ins: {
      receipt_events: true,
      receipt_state_changes: true,
      balance_changes: true,
      affected_global_entities: true,
    },
  });
}

/**
 * Get fungible balance for an account
 */
export async function getAccountBalance(
  accountAddress: string,
  resourceAddress: string
): Promise<string> {
  const data = await gatewayPost("/state/entity/page/fungibles/", {
    address: accountAddress,
    aggregation_level: "Vault",
  });

  const items = data?.items || [];
  for (const item of items) {
    if (item.resource_address === resourceAddress) {
      return item.vaults?.items?.[0]?.amount || "0";
    }
  }
  return "0";
}

/**
 * Get entity details (component state, metadata, etc.)
 */
export async function getEntityDetails(address: string): Promise<any> {
  return gatewayPost("/state/entity/details", {
    addresses: [address],
    aggregation_level: "Vault",
    opt_ins: { explicit_metadata: ["name", "symbol", "description"] },
  });
}

/**
 * Get current network status (epoch, round, etc.)
 */
export async function getNetworkStatus(): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}/status/gateway-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Gateway status error: ${res.status}`);
  return res.json();
}

export interface NftCollectionHolding {
  resource_address: string;
  name: string | null;
  icon_url: string | null;
  count: number;
}

export interface AccountHoldings {
  /** Non-fungible collections held (count > 0), with name/icon metadata. */
  nftCollections: NftCollectionHolding[];
  /** Every resource address the account holds, fungible or not (amount > 0). */
  resourceAddresses: string[];
  /**
   * True when the holdings could not be read in full: more pages than
   * MAX_HOLDINGS_PAGES, or a reply missing the account, either resource list,
   * or an item's address or amount. `resourceAddresses` may then be missing
   * entries, so a caller that must prove the account does NOT hold something
   * has to treat this as unproven.
   */
  incomplete: boolean;
}

/** Most pages read per resource list; an account with more counts as incomplete. */
export const MAX_HOLDINGS_PAGES = 20;

const HOLDINGS_METADATA = ["name", "icon_url"];

type ResourceItem = { resource_address: string; amount: number; raw: any };

/** One list item, or null when it has no resource address or no numeric amount. */
function parseResourceItem(it: any): ResourceItem | null {
  if (typeof it?.resource_address !== "string" || !it.resource_address) return null;
  const amount = Number(it.amount);
  if (it.amount === null || it.amount === undefined || !Number.isFinite(amount)) return null;
  return { resource_address: it.resource_address, amount, raw: it };
}

/**
 * Every item of one resource list: the first page from the entity details
 * reply, then the rest from the page endpoint, pinned to the same ledger state.
 * null when the list cannot be read in full.
 */
async function readResourceList(
  account: string,
  firstPage: any,
  endpoint: string,
  stateVersion: unknown,
  optIns?: Record<string, unknown>,
): Promise<ResourceItem[] | null> {
  const items: ResourceItem[] = [];
  let page = firstPage;
  for (let read = 1; ; read++) {
    if (!Array.isArray(page?.items)) return null;
    for (const raw of page.items) {
      const item = parseResourceItem(raw);
      if (!item) return null;
      items.push(item);
    }
    const cursor = page.next_cursor;
    if (cursor === undefined || cursor === null) return items;
    if (typeof cursor !== "string" || !cursor) return null;
    if (read >= MAX_HOLDINGS_PAGES || typeof stateVersion !== "number") return null;
    page = await gatewayPost(endpoint, {
      address: account,
      cursor,
      aggregation_level: "Global",
      at_ledger_state: { state_version: stateVersion },
      ...(optIns ? { opt_ins: optIns } : {}),
    });
  }
}

function metadataString(it: any, key: string): string | null {
  const entry = (it.explicit_metadata?.items || []).find((m: any) => m.key === key);
  const typed = entry?.value?.typed;
  if (typeof typed?.value === "string") return typed.value;
  if (Array.isArray(typed?.values) && typeof typed.values[0] === "string") return typed.values[0];
  return null;
}

/**
 * Everything an account holds (Global aggregation, name/icon metadata resolved
 * inline via the explicit_metadata opt-in), every page of both lists read at
 * one ledger state. Used for the public NFT prize-pool display and its custody
 * checks.
 */
export async function getAccountHoldings(account: string): Promise<AccountHoldings> {
  const data = await gatewayPost("/state/entity/details", {
    addresses: [account],
    aggregation_level: "Global",
    opt_ins: { explicit_metadata: HOLDINGS_METADATA },
  });
  const entity = Array.isArray(data?.items) && data.items.length === 1 ? data.items[0] : undefined;
  const stateVersion = data?.ledger_state?.state_version;

  const fungibles = await readResourceList(
    account, entity?.fungible_resources, "/state/entity/page/fungibles/", stateVersion,
  );
  // No point paging the second list once the first is known to be incomplete.
  const nonFungibles = fungibles && await readResourceList(
    account, entity?.non_fungible_resources, "/state/entity/page/non-fungibles/", stateVersion,
    { explicit_metadata: HOLDINGS_METADATA },
  );

  const nftCollections: NftCollectionHolding[] = (nonFungibles || [])
    .filter((it) => it.amount > 0)
    .map((it) => ({
      resource_address: it.resource_address,
      name: metadataString(it.raw, "name"),
      icon_url: metadataString(it.raw, "icon_url"),
      count: it.amount,
    }));

  const heldFungibles = (fungibles || [])
    .filter((it) => it.amount > 0)
    .map((it) => it.resource_address);

  return {
    nftCollections,
    resourceAddresses: [...heldFungibles, ...nftCollections.map((c) => c.resource_address)],
    incomplete: fungibles === null || nonFungibles === null,
  };
}
