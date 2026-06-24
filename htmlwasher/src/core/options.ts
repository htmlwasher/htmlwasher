// SPDX-License-Identifier: Apache-2.0
// Internal options for the extraction core. The public `boilerplate` mode union
// maps onto `focus` here (Phase 5 wires the mapping); the core keeps a generous
// content tag set — the washing level (Phase 6) does the final tag narrowing, so
// these are not re-exposed as public `include*` toggles.

/** Mirrors trafilatura's precision/recall focus (go `Options.Focus`). */
export type ExtractFocus = 'precision' | 'balanced' | 'recall';

export interface CoreOptions {
  /** precision → favor_precision, recall → favor_recall, balanced → neither. */
  focus: ExtractFocus;
  /** Keep `<a>` links (generous default). */
  includeLinks: boolean;
  /** Keep `<img>`/`<picture>`/`<source>` (generous default). */
  includeImages: boolean;
  /** Drop tables entirely (default false — tables survive). */
  excludeTables: boolean;
  /** Treat `comment*`-classed nodes as content (forum profile). */
  commentsAsContent: boolean;
  /** Drop near-duplicate text blocks. */
  deduplicate: boolean;
  /** Original URL, used only to absolutize links (never fetched). */
  originalUrl?: string;
}

export const DEFAULT_CORE_OPTIONS: CoreOptions = {
  focus: 'balanced',
  includeLinks: true,
  includeImages: true,
  excludeTables: false,
  commentsAsContent: false,
  deduplicate: false,
};

/** Resolve a partial override against the generous defaults. */
export function resolveCoreOptions(overrides?: Partial<CoreOptions>): CoreOptions {
  return { ...DEFAULT_CORE_OPTIONS, ...overrides };
}
