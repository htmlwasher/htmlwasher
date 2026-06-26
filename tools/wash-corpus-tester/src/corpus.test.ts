// Offline end-to-end corpus test.
//
// Runs htmlwasher over every saved WCXB fixture, prints the summary table,
// writes report.json + report.md, and asserts the run's hard invariants:
//   - zero security failures (no <script>, no on*= handler, no javascript: URL
//     survives at ANY washing level);
//   - zero hard structural failures (non-empty output, correct >= minimal tags);
//   - page-type accuracy at or above the floor (classifier plausibility is soft
//     per-fixture but enforced in aggregate).
//
// Fully offline + deterministic: same fixtures always yield the same result.

import { describe, expect, it } from 'vitest';
import { PAGE_TYPE_ACCURACY_FLOOR, runCorpus } from './corpus-runner.js';
import { printReport, renderSummary, writeReports } from './report.js';

describe('htmlwasher corpus (offline E2E)', () => {
  it('cleans every fixture with zero security/hard failures and plausible page types', async () => {
    const report = await runCorpus();

    // Surface the table + summary in the test output, and persist the reports.
    printReport(report);
    writeReports(report);

    // Core security invariant: nothing dangerous survived any washing level.
    expect(report.securityFailureCount, renderSummary(report)).toBe(0);

    // No hard structural assertion failed.
    expect(report.hardFailures, JSON.stringify(report.hardFailures, null, 2)).toHaveLength(0);

    // Page-type plausibility is soft per-fixture but enforced in aggregate.
    expect(
      report.pageTypeAccuracy,
      `page-type accuracy ${report.pageTypeAccuracy} below floor ${PAGE_TYPE_ACCURACY_FLOOR}`,
    ).toBeGreaterThanOrEqual(PAGE_TYPE_ACCURACY_FLOOR);

    // Overall verdict mirrors the two checks above.
    expect(report.ok).toBe(true);
  });
});
