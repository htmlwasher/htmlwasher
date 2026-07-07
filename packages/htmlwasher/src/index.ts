// htmlwasher — a hybrid Rust + TypeScript content-extraction library.
// HTML in → cleaned HTML out (+ metadata sidecar and page type).
//
// The public entry point is the async wash() (src/pipeline.ts), composing:
//   - the @htmlwasher/native Rust core — Trafilatura-derived boilerplate removal
//     + page-type classification, emitting preserve-markup, UNSANITIZED HTML;
//   - the TypeScript washing levels (src/washing/) — the sole sanitization
//     authority over that output;
//   - the TypeScript metadata sidecar (src/metadata/).

export { wash } from './pipeline.js';
export * from './types.js';

/**
 * Package version. Stable identifier exposed before the full pipeline lands.
 */
export const VERSION = '0.0.0-alpha.0';
