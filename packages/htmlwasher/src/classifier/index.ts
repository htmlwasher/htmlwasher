// SPDX-License-Identifier: Apache-2.0
// Public surface of the page-type classifier.

export {
  classifyPage,
  type InferenceBackend,
  type MlResult,
  OnnxNodeClassifier,
  OnnxWebClassifier,
  PageTypeClassifier,
  type PageTypeResult,
} from './classifier.js';
export { buildFeatureVector, loadVocab, scaleNumeric } from './features/index.js';
export { extractNumericFeatures } from './features/numeric.js';
export { titleMetaText } from './features/text.js';
export { computeTfidf } from './features/tfidf.js';
export { extractHtmlSignals, refineWithHtmlSignals, refineWithSignals } from './html-signals.js';
export { classifyUrl } from './url-heuristics.js';
