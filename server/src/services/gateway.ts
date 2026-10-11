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

/**
 * List NFT collections held by an account (Global aggregation), with
 * name/icon metadata resolved inline via the explicit_metadata opt-in —
 * one Gateway call total. Used for the public NFT prize-pool display.
 */
export async function getAccountNftHoldings(account: string): Promise<NftCollectionHolding[]> {
  const data = await gatewayPost("/state/entity/details", {
    addresses: [account],
    aggregation_level: "Global",
    opt_ins: { explicit_metadata: ["name", "icon_url"] },
  });
  const items = data?.items?.[0]?.non_fungible_resources?.items || [];
  return items
    .map((it: any): NftCollectionHolding => {
      const meta = (key: string): string | null => {
        const entry = (it.explicit_metadata?.items || []).find((m: any) => m.key === key);
        const typed = entry?.value?.typed;
        if (typeof typed?.value === "string") return typed.value;
        if (Array.isArray(typed?.values) && typeof typed.values[0] === "string") return typed.values[0];
        return null;
      };
      return {
        resource_address: it.resource_address,
        name: meta("name"),
        icon_url: meta("icon_url"),
        count: Number(it.amount) || 0,
      };
    })
    .filter((c: NftCollectionHolding) => c.count > 0);
}
