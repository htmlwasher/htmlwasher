// Phase 7 — validation against the adbar/trafilatura evaluation corpus.
//
// `eval-expectations.json` holds the per-page `with` (strings that must survive
// extraction) and `without` (boilerplate that must not) annotations for the 100
// pages whose cached HTML is present in the trafilatura checkout. Those
// annotations are derived from adbar/trafilatura's `tests/evaldata.py`
// (Apache-2.0; see the repo NOTICE for attribution). The HTML itself lives OUTSIDE
// this repo (cloned to ~/r/htmlwasher-sources/), so this suite skips gracefully
// when the corpus is absent — green in CI, real scoring locally.
//
// Scoring follows trafilatura's methodology: a `with` string found in the
// extracted text is a true positive (else a false negative / recall miss); a
// `without` string found is a false positive (precision miss). Precision/recall/
// F1 are aggregated across all pages. Latest local run (balanced + minimal):
// P≈0.75, R≈0.84, F1≈0.79 — in the same ballpark as upstream Trafilatura.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { wash } from '../../src/index.js';

interface EvalEntry {
  file: string;
  with: string[];
  without: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTATIONS = JSON.parse(
  readFileSync(join(HERE, '../../fixtures/validation/eval-expectations.json'), 'utf8'),
) as Record<string, EvalEntry>;
const CACHE_DIR = join(process.env.HOME ?? '', 'r/htmlwasher-sources/trafilatura/tests/cache');
const hasCorpus = existsSync(CACHE_DIR);

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const toText = (html: string): string => norm(html.replace(/<[^>]+>/g, ' '));

describe.skipIf(!hasCorpus)('adbar eval corpus — extraction quality', () => {
  it('scores precision/recall/F1 in the upstream ballpark', async () => {
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let pages = 0;

    for (const entry of Object.values(EXPECTATIONS)) {
      const path = join(CACHE_DIR, entry.file);
      if (!existsSync(path)) continue;
      pages++;
      const { html } = await wash(readFileSync(path, 'utf8'), {
        boilerplate: 'balanced',
        level: 'minimal',
      });
      const text = toText(html);
      for (const needle of entry.with) {
        if (text.includes(norm(needle))) tp++;
        else fn++;
      }
      for (const needle of entry.without) {
        if (text.includes(norm(needle))) fp++;
      }
    }

    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);
    const f1 = (2 * precision * recall) / (precision + recall || 1);
    // The validation harness reports its score (noConsole is not enforced here).
    console.log(
      `adbar eval: pages=${pages} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} f1=${f1.toFixed(3)}`,
    );

    expect(pages).toBeGreaterThan(50);
    // Floors well below the observed ~0.79 F1 so the suite is a regression guard,
    // not a flaky exact-match assertion.
    expect(recall).toBeGreaterThan(0.65);
    expect(precision).toBeGreaterThan(0.6);
    expect(f1).toBeGreaterThan(0.65);
  }, 120_000);
});
