// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PageTypeClassifier } from './classifier.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(HERE, '..', '..', 'fixtures', 'classifier');

const read = (file: string) => readFileSync(join(FIX_DIR, file), 'utf8');

describe('PageTypeClassifier — 3-stage cascade', () => {
  const classifier = new PageTypeClassifier();

  it('URL heuristic + ML agree on a non-article type → confidence 1.0', async () => {
    // bbs.archlinux.org → Stage-1 forum; ML argmax forum → agreement, conf 1.0.
    const res = await classifier.classifyPage(read('0541.html'), 'https://bbs.archlinux.org/');
    expect(res.pageType).toBe('forum');
    expect(res.confidence).toBe(1.0);
  });

  it('docs URL + ML agree → documentation at confidence 1.0', async () => {
    const res = await classifier.classifyPage(read('4412.html'), 'https://docs.aws.amazon.com/');
    expect(res.pageType).toBe('documentation');
    expect(res.confidence).toBe(1.0);
  });

  it('no URL context → falls through to ML; confidence is the ML max prob', async () => {
    // hamy.xyz article fixture, but pass no URL so Stage-1 = article (no heuristic win).
    const res = await classifier.classifyPage(read('0488.html'), '');
    expect(res.pageType).toBe('article');
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
    expect(res.confidence).not.toBe(0.95); // not a synthetic refine-agreement score
  });
});
