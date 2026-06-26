// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type InferenceBackend,
  OnnxNodeClassifier,
  OnnxWebClassifier,
  PageTypeClassifier,
} from './classifier.js';
import { buildFeatureVector } from './features/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(HERE, '..', '..', 'fixtures', 'classifier');

const read = (file: string) => readFileSync(join(FIX_DIR, file), 'utf8');

interface ParityItem {
  file: string;
  url: string;
  argmaxLabel: string;
}
const parity = JSON.parse(read('parity.json')) as ParityItem[];

/** Whether the optional `onnxruntime-web` (WASM) backend can initialize in this env. */
async function webBackendUsable(): Promise<boolean> {
  try {
    const backend = new OnnxWebClassifier();
    // A trivial 189-length vector is enough to force session creation + one run.
    await backend.run(new Array(189).fill(0));
    return true;
  } catch {
    return false;
  }
}
const WEB_USABLE = await webBackendUsable();

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

describe('PageTypeClassifier — swappable InferenceBackend seam', () => {
  it('consumes a hand-rolled mock backend (argmax → PageType, no ONNX)', async () => {
    // Class label order: 0=article 1=forum 2=product 3=collection 4=listing
    //                    5=documentation 6=service. Peak at index 2 → product.
    const probs = [0.05, 0.05, 0.7, 0.05, 0.05, 0.05, 0.05];
    let received: number[] | undefined;
    const mock: InferenceBackend = {
      run(features: number[]): Promise<number[]> {
        received = features;
        return Promise.resolve(probs);
      },
    };
    const ml = await new PageTypeClassifier(mock).classifyMl('<html><body>x</body></html>', '');
    expect(ml.pageType).toBe('product');
    expect(ml.confidence).toBe(0.7);
    // The seam fed the assembled 189-float vector to the swapped backend.
    expect(received).toHaveLength(189);
  });

  it('feeds the full 189-vector built from the same HTML to the backend', async () => {
    const html = read('4853.html');
    let received: number[] | undefined;
    const mock: InferenceBackend = {
      run(features: number[]): Promise<number[]> {
        received = features;
        return Promise.resolve([1, 0, 0, 0, 0, 0, 0]);
      },
    };
    const ml = await new PageTypeClassifier(mock).classifyMl(html, '');
    expect(ml.pageType).toBe('article');
    expect(received).toEqual(buildFeatureVector(html, ''));
  });
});

describe('OnnxWebClassifier — WASM parity with the node backend', () => {
  it.skipIf(!WEB_USABLE)('argmax matches OnnxNodeClassifier over the parity fixtures', async () => {
    const web = new PageTypeClassifier(new OnnxWebClassifier());
    const node = new PageTypeClassifier(new OnnxNodeClassifier());
    for (const item of parity) {
      const html = read(item.file);
      const [webMl, nodeMl] = await Promise.all([
        web.classifyMl(html, item.url),
        node.classifyMl(html, item.url),
      ]);
      expect(webMl.pageType, `web vs node argmax for ${item.file}`).toBe(nodeMl.pageType);
    }
  });
});
