// CLI entry point for the offline corpus tester.
//
// Runs the full corpus, prints the readable table + summary to stdout, writes
// report.json + report.md into the package dir, and exits non-zero if any HARD
// assertion failed or page-type accuracy dropped below the floor.
//
// Usage: `pnpm -C tools/wash-corpus-tester run corpus` (tsx src/cli.ts).

import { runCorpus } from './corpus-runner.js';
import { printReport, writeReports } from './report.js';

async function main(): Promise<void> {
  const report = await runCorpus();
  printReport(report);
  const { jsonPath, mdPath } = writeReports(report);
  console.log('');
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);

  if (!report.ok) {
    console.error('');
    console.error('corpus run FAILED (hard assertions failed or page-type accuracy below floor)');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('corpus run crashed:', error);
  process.exit(1);
});
