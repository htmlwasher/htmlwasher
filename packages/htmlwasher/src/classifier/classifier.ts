// SPDX-License-Identifier: Apache-2.0
// The page-type classifier: an ONNX inference backend behind a swappable interface,
// plus the 3-stage cascade (URL heuristics → HTML-signal refinement → ML) that
// produces the final `{ pageType, confidence }`.
//
// Inference math (matches the trained sklearn→ONNX pipeline):
// - feed the 189-float vector to the model `input`;
// - read `probabilities` [1,7] and the int64 `label`;
// - argmax over probabilities → class index → classLabels[idx] → PageType.
//
// Cascade agreement rule (extract.rs):
// - url_type != article  AND ml == url_type      → (url_type, 1.0)
// - refined != article   AND ml == refined       → (refined, 0.95)
// - else                                          → (ml, ml_max_prob)

import { readFileSync } from 'node:fs';
import { parseDocumentSpec } from '../core/dom.js';
import type { PageType } from '../types.js';
import { isPageType } from '../types.js';
import { buildFeatureVector, loadVocab, type ModelVocab } from './features/index.js';
import { extractHtmlSignals, refineWithSignals } from './html-signals.js';
import { MODEL_ONNX_PATH } from './model-paths.js';
import { classifyUrl } from './url-heuristics.js';

/** Result of a single ML inference: the argmax class and its softmax probability. */
export interface MlResult {
  pageType: PageType;
  confidence: number;
}

/** Final cascade output. */
export interface PageTypeResult {
  pageType: PageType;
  confidence: number;
}

/**
 * Swappable inference backend. Both `onnxruntime-node` (default) and
 * `onnxruntime-web` implement this — the cascade only needs raw ML inference over
 * the 189-float vector.
 */
export interface InferenceBackend {
  /** Run the model on a 189-length feature vector, returning the 7 class probabilities. */
  run(features: number[]): Promise<number[]>;
}

/** Map a vocabulary class label string to a `PageType` (defaults to `article`). */
function labelToPageType(label: string): PageType {
  const lower = label.toLowerCase();
  if (lower === 'category') return 'collection';
  if (lower === 'docs') return 'documentation';
  return isPageType(lower) ? lower : 'article';
}

/** Argmax over the 7 class probabilities → `{ pageType, confidence }`. */
function decode(probabilities: number[], vocab: ModelVocab): MlResult {
  let bestIdx = 0;
  let bestProb = probabilities[0] ?? 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    const p = probabilities[i] ?? 0;
    if (p > bestProb) {
      bestProb = p;
      bestIdx = i;
    }
  }
  const label = vocab.classLabels[bestIdx] ?? 'article';
  return { pageType: labelToPageType(label), confidence: bestProb };
}

/**
 * Default backend using `onnxruntime-node`. The session is created lazily once and
 * cached for the lifetime of the classifier.
 */
export class OnnxNodeClassifier implements InferenceBackend {
  private sessionPromise?: Promise<import('onnxruntime-node').InferenceSession>;
  private readonly modelPath: string;

  constructor(modelPath: string = MODEL_ONNX_PATH) {
    this.modelPath = modelPath;
  }

  private async session(): Promise<import('onnxruntime-node').InferenceSession> {
    if (this.sessionPromise === undefined) {
      this.sessionPromise = import('onnxruntime-node').then((ort) =>
        ort.InferenceSession.create(this.modelPath),
      );
    }
    return this.sessionPromise;
  }

  async run(features: number[]): Promise<number[]> {
    const ort = await import('onnxruntime-node');
    const session = await this.session();
    const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
    const inputName = session.inputNames[0] ?? 'input';
    const output = await session.run({ [inputName]: tensor });
    const probs = output.probabilities ?? output[session.outputNames[1] ?? 'probabilities'];
    if (probs === undefined) {
      throw new Error('classifier: model produced no `probabilities` output');
    }
    return Array.from(probs.data as Float32Array, (v) => Number(v));
  }
}

/**
 * Optional `onnxruntime-web` (WASM) backend. `onnxruntime-web` is an
 * optionalDependency; this lazily imports it so the package works with only the
 * node backend installed. Same interface, so it is a drop-in replacement.
 */
export class OnnxWebClassifier implements InferenceBackend {
  private sessionPromise?: Promise<import('onnxruntime-web').InferenceSession>;
  private readonly modelPath: string;

  constructor(modelPath: string = MODEL_ONNX_PATH) {
    this.modelPath = modelPath;
  }

  private async session(): Promise<import('onnxruntime-web').InferenceSession> {
    if (this.sessionPromise === undefined) {
      // `onnxruntime-web`'s `create(string)` overload treats the string as a URI
      // and fetch()es it — an absolute filesystem path does NOT resolve in the
      // browser/WASM runtime. Read the model into a Uint8Array and use the buffer
      // overload (inference-session.d.ts:523), which loads identically across the
      // Node-host WASM path and the browser.
      const model = new Uint8Array(readFileSync(this.modelPath));
      this.sessionPromise = import('onnxruntime-web').then((ort) =>
        ort.InferenceSession.create(model),
      );
    }
    return this.sessionPromise;
  }

  async run(features: number[]): Promise<number[]> {
    const ort = await import('onnxruntime-web');
    const session = await this.session();
    const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
    const inputName = session.inputNames[0] ?? 'input';
    const output = await session.run({ [inputName]: tensor });
    const probs = output.probabilities ?? output[session.outputNames[1] ?? 'probabilities'];
    if (probs === undefined) {
      throw new Error('classifier: model produced no `probabilities` output');
    }
    return Array.from(probs.data as Float32Array, (v) => Number(v));
  }
}

/**
 * The page-type classifier. Holds a swappable inference backend (default:
 * `onnxruntime-node`) and runs the 3-stage cascade.
 */
export class PageTypeClassifier {
  private readonly backend: InferenceBackend;

  constructor(backend: InferenceBackend = new OnnxNodeClassifier()) {
    this.backend = backend;
  }

  /** Run the raw ML model on raw HTML + URL → `{ pageType, confidence }`. */
  async classifyMl(html: string, url: string): Promise<MlResult> {
    const vocab = loadVocab();
    const features = buildFeatureVector(html, url);
    const probabilities = await this.backend.run(features);
    return decode(probabilities, vocab);
  }

  /**
   * Full 3-stage cascade. `url` defaults to `''` (no URL context → all URL features
   * are 0 and Stage-1 returns `article`).
   */
  async classifyPage(html: string, url = ''): Promise<PageTypeResult> {
    const urlType = classifyUrl(url);

    const doc = parseDocumentSpec(html);
    const refined = refineWithSignals(urlType, extractHtmlSignals(doc));

    const ml = await this.classifyMl(html, url);

    if (urlType !== 'article' && ml.pageType === urlType) {
      return { pageType: urlType, confidence: 1.0 };
    }
    if (refined !== 'article' && ml.pageType === refined) {
      return { pageType: refined, confidence: 0.95 };
    }
    return { pageType: ml.pageType, confidence: ml.confidence };
  }
}

let defaultClassifier: PageTypeClassifier | undefined;

/** Module-level convenience using a cached default (node-backed) classifier. */
export function classifyPage(html: string, url = ''): Promise<PageTypeResult> {
  if (defaultClassifier === undefined) defaultClassifier = new PageTypeClassifier();
  return defaultClassifier.classifyPage(html, url);
}
