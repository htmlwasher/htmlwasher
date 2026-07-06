// Placeholder entry point for the live-crawl tester.
//
// This is an OPTIONAL, OUT-OF-BRIEF scaffold and is NOT yet implemented. The
// brief's offline Phase 8 / Section 7 E2E deliverable is `packages/wash-corpus-tester/`
// (offline, no network) — NOT this package; the brief explicitly forbids a network
// fetcher in this repo. If this scaffold is ever implemented, it would fetch live
// URLs across the 7 page types and must be a polite fetcher honoring robots.txt +
// per-host rate limits (Crawlee/Apify industry standards; NOT Crawlee/Playwright
// itself).
//
// NOTE: because it would hit the network, it is NOT part of the offline `pnpm test`
// suite — it would be run explicitly via `pnpm run test:live`.

function main(): void {
  console.log(
    'live-crawl-tester: out-of-brief optional scaffold, not yet implemented (the offline E2E tester is packages/wash-corpus-tester/)',
  );
}

main();
process.exit(0);
