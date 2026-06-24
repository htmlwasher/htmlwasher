// Placeholder entry point for the live-crawl tester.
//
// This package is scaffolded but NOT yet implemented. The real implementation
// will fetch live URLs across the 7 page types, run extraction + classification,
// and report PASS/FAIL. See @/prompts/2026-6-24-init/prompt.md Section 7 for the
// full specification.
//
// NOTE: when implemented, this hits the network and is therefore NOT part of the
// offline `pnpm test` suite. Run it explicitly via `pnpm run test:live`.

function main(): void {
  console.log(
    "live-crawl-tester: not yet implemented — see @/prompts/2026-6-24-init/prompt.md Section 7",
  );
}

main();
process.exit(0);
