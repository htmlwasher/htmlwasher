// htmlwasher — a TypeScript HTML-cleanup library. HTML in → cleaned HTML out.
//
// Two composable pillars (see @/prompts/2026-6-24-init/prompt.md):
//   1. Boilerplate removal — a Trafilatura-derived, page-type-aware main-content
//      extractor that keeps the result AS an HTML subtree (never text/markdown).
//   2. HTML washing — sanitize-html-based cleanup at five levels.
//
// The public entry point is wash() (src/pipeline.ts), composing the boilerplate
// (Phase 2) and washing (Phase 6) pillars plus the metadata sidecar (Phase 3).
// Page-type classification + per-type profile routing (Phase 4/5) plug into the
// boilerplate stage as the trained classifier lands.

export { wash } from './pipeline.js';
export * from './types.js';

/**
 * Package version. Stable identifier exposed before the full pipeline lands.
 */
export const VERSION = '0.0.0-alpha.0';
