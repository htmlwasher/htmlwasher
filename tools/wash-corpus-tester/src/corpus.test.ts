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
import {
  type AssertionFailure,
  COMBOS,
  type CorpusReport,
  PAGE_TYPE_ACCURACY_FLOOR,
  runCorpus,
} from './corpus-runner.js';
import { printReport, renderSummary, writeReports } from './report.js';

// runCorpus reads every fixture and washes each through the full combo matrix —
// expensive, so compute it once and share across the assertions below.
let reportPromise: Promise<CorpusReport> | undefined;
const getReport = (): Promise<CorpusReport> => {
  reportPromise ??= runCorpus();
  return reportPromise;
};

describe('htmlwasher corpus (offline E2E)', () => {
  it('cleans every fixture with zero security/hard failures and plausible page types', async () => {
    const report = await getReport();

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

  it('exercises the precision boilerplate mode and the styled washing level', () => {
    // Regression for validation-corpus-2: these two were never run across the
    // corpus, so a CSS-URL-allow-list (styled) or precision-extraction
    // regression could pass silently. The combo matrix must cover both.
    const combos = COMBOS.map((c) => `${c.boilerplate}x${c.level}`);
    expect(combos).toContain('precisionxminimal');
    expect(combos).toContain('balancedxstyled');
  });

  it('runs the correct-superset baseline on the SAME boilerplate input (not vacuous)', () => {
    // Regression for validation-corpus-0: the `correct-superset` assertion must
    // compare `none`x`correct` against `none`x`minimal` (same full-document
    // input), not against `balanced`x`minimal` (an extraction-stripped subset).
    // If it ever reverts to the cross-input comparison, the assertion becomes
    // near-vacuous (a full doc always supersets its own extracted subset).
    const combos = COMBOS.map((c) => `${c.boilerplate}x${c.level}`);
    expect(combos).toContain('nonexcorrect');
    expect(combos).toContain('nonexminimal');
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
