// Public type surface for htmlwasher.
//
// The two orthogonal knobs (boilerplate-removal mode + HTML washing level) are
// plain string-union / `as const`-array types, NOT TypeScript `enum`s — mirroring
// htmlprocessing-server's `PROCESSING_MODES = [...] as const` pattern (locked
// decision #4 in the build brief).

/**
 * Boilerplate-removal mode — gates the Trafilatura-derived main-content extraction.
 *
 * - `precision` → sets `favor_precision` (less noise, may miss content)
 * - `balanced`  → neither flag (neutral default)
 * - `recall`    → sets `favor_recall` (more content, may include noise)
 * - `none`      → skip boilerplate removal entirely (wash the whole document)
 *
 * `none` is htmlwasher's addition (contextractor has no `none`).
 */
export const BOILERPLATE_MODES = ['precision', 'balanced', 'recall', 'none'] as const;
export type BoilerplateMode = (typeof BOILERPLATE_MODES)[number];
export const DEFAULT_BOILERPLATE_MODE = 'balanced' satisfies BoilerplateMode;

/**
 * HTML washing level — the single tag-inclusion control (it subsumes
 * images/tables/links). There are deliberately exactly these five; no `*-reader`
 * variants. `standard` is the default.
 *
 * - `minimal`    → strictest: scaffolding + headings/tables/lists/code + basic inline. No images.
 * - `standard`   → adds images, media, figures, rich inline. No div/span, no HTML5 structural, no styles.
 * - `permissive` → full HTML5 content incl. structural elements + div/span. Still no classes/IDs/styles.
 * - `styled`     → permissive + `class`/inline `style` + `<style>` CSS (with a CSS-URL allow-list).
 * - `correct`    → normalize-only: skip sanitization; parse5 well-forms + prettier reformats.
 */
export const WASHING_LEVELS = ['minimal', 'standard', 'permissive', 'styled', 'correct'] as const;
export type WashingLevel = (typeof WASHING_LEVELS)[number];
export const DEFAULT_WASHING_LEVEL = 'standard' satisfies WashingLevel;

/**
 * The 7 page types the classifier routes extraction through. Note `collection`
 * (not `category`) is the serialized form — the rs-trafilatura `Category` enum
 * variant serializes to the string `"collection"`.
 */
export const PAGE_TYPES = [
  'article',
  'forum',
  'product',
  'collection',
  'listing',
  'documentation',
  'service',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Severity of a pipeline diagnostic message. */
export type MessageType = 'info' | 'warning' | 'error';

/** A non-fatal diagnostic accumulated while running the pipeline. */
export interface Message {
  type: MessageType;
  text: string;
}

/**
 * Optional metadata sidecar returned alongside the cleaned HTML. It never
 * replaces or converts the HTML content — it is purely additive context.
 */
export interface Metadata {
  title?: string;
  author?: string;
  url?: string;
  hostname?: string;
  description?: string;
  sitename?: string;
  /** ISO-8601 date string when resolvable. */
  date?: string;
  categories?: string[];
  tags?: string[];
  image?: string;
  pageType?: PageType;
  license?: string;
}

/**
 * Options for {@link wash}. These three knobs (plus the optional source-URL
 * context) are the entire user-facing surface — there are deliberately no
 * `includeComments` / `includeTables` / `includeImages` / `includeLinks`
 * toggles. The washing `level` is the single tag-inclusion control; comments
 * are decided by the classified page type.
 */
export interface WashOptions {
  /** Boilerplate-removal mode. Default `'balanced'`. */
  boilerplate?: BoilerplateMode;
  /** HTML washing level. Default `'standard'`. */
  level?: WashingLevel;
  /** Minify the output instead of prettier-formatting it. Default `false`. */
  minify?: boolean;
  /**
   * Optional source URL — context only, for the classifier's URL heuristics and
   * metadata `url`/`hostname`. htmlwasher NEVER fetches it. This is not a
   * content-inclusion toggle.
   */
  url?: string;
}

/** Result of {@link wash}: cleaned HTML, diagnostics, and an optional metadata sidecar. */
export interface WashResult {
  html: string;
  messages: Message[];
  metadata?: Metadata;
}

/** Runtime guard: is `value` a valid {@link BoilerplateMode}? */
export function isBoilerplateMode(value: unknown): value is BoilerplateMode {
  return typeof value === 'string' && (BOILERPLATE_MODES as readonly string[]).includes(value);
}

/** Runtime guard: is `value` a valid {@link WashingLevel}? */
export function isWashingLevel(value: unknown): value is WashingLevel {
  return typeof value === 'string' && (WASHING_LEVELS as readonly string[]).includes(value);
}

/** Runtime guard: is `value` a valid {@link PageType}? */
export function isPageType(value: unknown): value is PageType {
  return typeof value === 'string' && (PAGE_TYPES as readonly string[]).includes(value);
}
