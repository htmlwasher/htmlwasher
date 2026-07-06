// Sanity check: run the boilerplate-removal core over a handful of real pages
// from the adbar/trafilatura test corpus and assert a sensible main-content HTML
// fragment comes out (Phase 2 gate). The corpus lives OUTSIDE this repo (cloned
// to ~/r/htmlwasher-sources/), so this suite skips gracefully when it is absent
// — it stays green in CI and validates against real pages locally. The full
// precision/recall/F1 scoring lives in the Phase 7 validation harness.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractContentHTML } from '../src/core/extract.js';

const CORPUS_DIR = join(process.env.HOME ?? '', 'r/htmlwasher-sources/trafilatura/tests/cache');
const hasCorpus = existsSync(CORPUS_DIR);

// (file, minimum expected extracted-text chars, a substring that must appear)
const PAGES: ReadonlyArray<[string, number, string]> = [
  ['rs-ingenieure.de.tragwerksplanung.html', 200, 'Tragwerksplanung'],
  ['blog.python.org.html', 200, 'Python'],
  ['theplanetarypress.com.forestlands.html', 1000, 'forest'],
  ['netzpolitik.org.abmahnungen.html', 1000, 'Männer'],
];

describe.skipIf(!hasCorpus)('adbar corpus — sensible main-content HTML', () => {
  for (const [file, minChars, needle] of PAGES) {
    it(file, () => {
      const html = readFileSync(join(CORPUS_DIR, file), 'utf8');
      const { html: out, textLength } = extractContentHTML(html, { focus: 'balanced' });

      expect(textLength).toBeGreaterThan(minChars);
      expect(out.toLowerCase()).toContain(needle.toLowerCase());
      // Security + cleanliness invariants of the core's HTML output.
      expect(/<script/i.test(out)).toBe(false);
      expect(/ on[a-z]+=/i.test(out)).toBe(false);
      expect(/\sclass=/.test(out)).toBe(false);
      expect(/\sstyle=/.test(out)).toBe(false);
    });
  }
});
