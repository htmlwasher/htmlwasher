// Offline end-to-end corpus test.
//
// Runs trafilaturacore over every saved WCXB fixture, prints the summary table,
// writes report.json + report.md, and asserts the run's hard invariants:
//   - zero security failures (no <script>, no on*= handler, no javascript: URL
//     survives in ANY combo);
//   - zero hard structural failures (non-empty output, styled-config >= default
//     tags);
//   - page-type accuracy at or above the floor (classifier plausibility is soft
//     per-fixture but enforced in aggregate).
//
// Fully offline + deterministic: same fixtures always yield the same result.

import { describe, expect, it } from 'vitest';
import {
  type AssertionFailure,
  COMBOS,
  type CorpusReport,
  PAGE_TYPE_ACCURACY_FLOOR,
  runCorpus,
} from './corpus-runner.js';
import { printReport, renderSummary, writeReports } from './report.js';

// runCorpus reads every fixture and cleans each through the full combo matrix —
// expensive, so compute it once and share across the assertions below.
let reportPromise: Promise<CorpusReport> | undefined;
const getReport = (): Promise<CorpusReport> => {
  reportPromise ??= runCorpus();
  return reportPromise;
};

describe('trafilaturacore corpus (offline E2E)', () => {
  it('cleans every fixture with zero security/hard failures and plausible page types', async () => {
    const report = await getReport();

    // Surface the table + summary in the test output, and persist the reports.
    printReport(report);
    writeReports(report);

    // Core security invariant: nothing dangerous survived in any combo.
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

  it('exercises every boilerplate mode plus the styled custom config', () => {
    // The matrix must cover all four modes (incl. the renamed clean-only) and
    // the one custom-config combo where a CSS-URL-allow-list regression would
    // surface across real fixtures.
    const labels = COMBOS.map((c) => c.label);
    expect(labels).toContain('balanced');
    expect(labels).toContain('precision');
    expect(labels).toContain('recall');
    expect(labels).toContain('clean-only');
    expect(labels).toContain('balanced+styled-config');
  });

  it('runs the styled-config superset baseline on the SAME boilerplate input (not vacuous)', () => {
    // The `styled-config-superset` assertion compares `balanced+styled-config`
    // against `balanced` — both must extract with the same boilerplate mode so
    // the comparison isolates the config difference, not an extraction one.
    const styled = COMBOS.find((c) => c.label === 'balanced+styled-config');
    const reference = COMBOS.find((c) => c.label === 'balanced');
    expect(styled?.boilerplate).toBe('balanced');
    expect(reference?.boilerplate).toBe('balanced');
    expect(reference?.config).toBeUndefined();
  });

  it('includes a non-English (Czech) fixture so classifier English-bias regressions surface', async () => {
    // Regression for validation-corpus-3: the offline harness must exercise at
    // least one non-English page; otherwise a non-English classification
    // regression passes silently.
    const report = await getReport();
    const czech = report.fixtures.find((f) => f.file === 'article/cs-9001.html');
    expect(
      czech,
      'Czech fixture article/cs-9001.html must be registered in corpus.json',
    ).toBeDefined();
    // Its security/structural HARD assertions must all pass like any other page.
    const czechHardFailures: AssertionFailure[] = report.hardFailures.filter(
      (f) => f.fixture === 'article/cs-9001.html',
    );
    expect(czechHardFailures, JSON.stringify(czechHardFailures, null, 2)).toHaveLength(0);
  });
});
