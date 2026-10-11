/**
 * Boot-check fixture for signer-custody.test.ts.
 *
 * assertSignerCustody() and the module-level constants it reads (ACCOUNT,
 * IS_MAINNET, NETWORK) are derived from process.env at MODULE LOAD time, same
 * as the rest of signer.ts — and, like the real server, are only ever meant
 * to be evaluated once per process. A dynamic `import()` inside the test
 * process does NOT re-evaluate an already-loaded module (verified directly:
 * tsx's loader caches by resolved path, a `?cachebust=` query on the specifier
 * does not defeat it either), so different custody scenarios cannot share one
 * process the way the module was written. This script is run once per
 * scenario, in its own subprocess with its own env — exactly how the real
 * server boots — via child_process.spawnSync in the test file.
 *
 * It also proves the offline property directly rather than assuming it from
 * reading the source: `fetch` is stubbed to fail loudly before the import,
 * so if assertSignerCustody (or anything it pulls in transitively) ever made
 * a network call, this would exit 9 with "FETCH_CALLED" on stderr instead of
 * completing normally.
 */
(globalThis as any).fetch = async () => {
  console.error("FETCH_CALLED");
  process.exit(9);
};

async function main() {
  const { assertSignerCustody } = await import("../../signer");
  await assertSignerCustody();
  // Only reached when assertSignerCustody did not process.exit(1) on a
  // mismatch — i.e. the no-op and verified-success paths.
  console.log("CUSTODY_CHECK_OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("CUSTODY_CHECK_THREW:", err?.message ?? err);
  process.exit(2);
});
