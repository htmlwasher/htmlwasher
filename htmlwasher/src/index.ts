// htmlwasher — a TypeScript HTML-cleanup library. HTML in → cleaned HTML out.
//
// Two composable pillars (see @/prompts/2026-6-24-init/prompt.md):
//   1. Boilerplate removal — a Trafilatura-derived, page-type-aware main-content
//      extractor that keeps the result AS an HTML subtree (never text/markdown).
//   2. HTML washing — sanitize-html-based cleanup at five levels.
//
// The public entry point is wash(); it is assembled in src/pipeline.ts as the
// boilerplate (Phase 2/5) and washing (Phase 6) pillars land. This module
// currently re-exports the stable type surface and the package version.
//
// TODO(@/prompts/2026-6-24-init/prompt.md): export the wash() pipeline once the
// boilerplate and washing pillars are wired (orchestration step).

export * from './types.js';

/**
 * Package version. Stable identifier exposed before the full pipeline lands.
 */
export const VERSION = '0.0.0-alpha.0';
