// SPDX-License-Identifier: Apache-2.0
// Resolve the shipped model artifacts (`model.onnx`, `tfidf-vocab.json`) at runtime.
//
// The package `files` list ships `src/classifier/model/` verbatim (NOT copied into
// `dist/`). So from the compiled module the artifacts live at one of two places
// depending on whether we run from `dist/` (published) or `src/` (local dev/test):
// - dist:  <module>/../../src/classifier/model/...   (dist/classifier/* → src/classifier/model)
// - src:   <module>/model/...                        (src/classifier/* → src/classifier/model)
// We probe both and return the first that exists.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATE_DIRS = [
  join(HERE, 'model'), // running from src/classifier (dev/test) or if model ever sits beside the module
  join(HERE, '..', '..', 'src', 'classifier', 'model'), // running from dist/classifier (published)
];

function resolveModelDir(): string {
  for (const dir of CANDIDATE_DIRS) {
    if (existsSync(join(dir, 'model.onnx'))) return dir;
  }
  // Fall back to the first candidate; callers surface a clear error on read failure.
  return CANDIDATE_DIRS[0] as string;
}

const MODEL_DIR = resolveModelDir();

export const MODEL_ONNX_PATH = join(MODEL_DIR, 'model.onnx');
export const TFIDF_VOCAB_PATH = join(MODEL_DIR, 'tfidf-vocab.json');
