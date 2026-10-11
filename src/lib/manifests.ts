// Transaction manifest builders for Radix wallet interactions

function sanitize(val: string): string {
  return val.replace(/["\\\n\r;]/g, "");
}

function validateAddress(addr: string, prefix: string): string {
  if (!addr.match(new RegExp(`^${prefix}[a-z0-9]{20,}`))) {
    throw new Error(`Invalid ${prefix} address`);
  }
  return addr;
}

const XRD_MAINNET = "resource_rdx1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxradxrd";
const XRD_STOKENET = "resource_tdx_2_1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxtziuj9";

function getXrd(network: string): string {
  return network === "mainnet" ? XRD_MAINNET : XRD_STOKENET;
}

export function buyMemeManifest(
  vaultComponent: string,
  account: string,
  xrdAmount: string,
  network = "mainnet"
): string {
  const v = validateAddress(vaultComponent, "component_");
  const a = validateAddress(account, "account_");
  const xrd = getXrd(network);
  const amt = sanitize(xrdAmount);

  return `CALL_METHOD
  Address("${a}")
  "withdraw"
  Address("${xrd}")
  Decimal("${amt}")
;
TAKE_ALL_FROM_WORKTOP
  Address("${xrd}")
  Bucket("xrd_payment")
;
CALL_METHOD
  Address("${v}")
  "buy_rolls"
  Bucket("xrd_payment")
;
CALL_METHOD
  Address("${a}")
  "deposit_batch"
  Expression("ENTIRE_WORKTOP")
;`;
}

export function burnMemeManifest(
  vaultComponent: string,
  memeResource: string,
  account: string,
  memeAmount: string,
): string {
  const v = validateAddress(vaultComponent, "component_");
  const a = validateAddress(account, "account_");
  const r = validateAddress(memeResource, "resource_");
  const amt = sanitize(memeAmount);

  return `CALL_METHOD
  Address("${a}")
  "withdraw"
  Address("${r}")
  Decimal("${amt}")
;
TAKE_ALL_FROM_WORKTOP
  Address("${r}")
  Bucket("rolls_payment")
;
CALL_METHOD
  Address("${v}")
  "burn_rolls"
  Bucket("rolls_payment")
;`;
}
