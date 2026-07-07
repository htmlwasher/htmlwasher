// Public type surface for trafilaturacore.
//
// The two orthogonal knobs (boilerplate-removal mode + HTML cleaning level) are
// plain string-union / `as const`-array types, NOT TypeScript `enum`s — mirroring
// htmlprocessing-server's `PROCESSING_MODES = [...] as const` pattern (locked
// decision #4 in the build brief). The cleaning level resolves to a preset
// `CleanConfig`; callers may instead pass a fully-custom `CleanConfig`
// (pure JSON data — see {@link CleanOptions.config}).

import type { CleanConfig } from './cleaning/presets/types.js';

export type { CleanConfig } from './cleaning/presets/types.js';

/**
 * Boilerplate-removal mode — gates the Trafilatura-derived main-content extraction.
 *
 * - `precision` → sets `favor_precision` (less noise, may miss content)
 * - `balanced`  → neither flag (neutral default)
 * - `recall`    → sets `favor_recall` (more content, may include noise)
 * - `none`      → skip boilerplate removal entirely (clean the whole document)
 *
 * `none` is trafilaturacore's addition (contextractor has no `none`).
 */
export const BOILERPLATE_MODES = ['precision', 'balanced', 'recall', 'none'] as const;
export type BoilerplateMode = (typeof BOILERPLATE_MODES)[number];
export const DEFAULT_BOILERPLATE_MODE = 'balanced' satisfies BoilerplateMode;

/**
 * HTML cleaning level — the single tag-inclusion control (it subsumes
 * images/tables/links). There are deliberately exactly these five; no `*-reader`
 * variants. `standard` is the default.
 *
 * - `minimal`    → strictest: scaffolding + headings/tables/lists/code + basic inline. No images.
 * - `standard`   → adds images, media, figures, rich inline. No div/span, no HTML5 structural, no styles.
 * - `permissive` → full HTML5 content incl. structural elements + div/span. Still no classes/IDs/styles.
 * - `styled`     → permissive + `class`/inline `style` + `<style>` CSS (with a CSS-URL allow-list).
 * - `correct`    → normalize-only: skip sanitization; parse5 well-forms + prettier reformats.
 */
export const CLEANING_LEVELS = ['minimal', 'standard', 'permissive', 'styled', 'correct'] as const;
export type CleaningLevel = (typeof CLEANING_LEVELS)[number];
export const DEFAULT_CLEANING_LEVEL = 'standard' satisfies CleaningLevel;

/**
 * Default upper bound on `clean()` input size, measured in UTF-8 bytes (10 MB).
 * Inputs larger than {@link CleanOptions.maxInputBytes} (defaulting to this) are
 * rejected at the boundary with a `RangeError` rather than processed — a
 * resource bound per the security guideline ("bound resource use; validate
 * input at every boundary").
 */
export const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;

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
 * Options for {@link clean}. These knobs (plus the optional source-URL context)
 * are the entire user-facing surface — there are deliberately no
 * `includeComments` / `includeTables` / `includeImages` / `includeLinks`
 * toggles. The cleaning `level` (or a fully-custom `config`) is the single
 * tag-inclusion control; comments are decided by the classified page type.
 */
export interface CleanOptions {
  /** Boilerplate-removal mode. Default `'balanced'`. */
  boilerplate?: BoilerplateMode;
  /** HTML cleaning level (named preset). Default `'standard'`. Ignored when `config` is set. */
  level?: CleaningLevel;
  /**
   * Fully-custom cleaning config — a {@link CleanConfig} (pure JSON data). When
   * set it drives the sanitize stage directly, taking precedence over the preset
   * `level` would select. The security floor still applies (`<script>` and `on*`
   * are always stripped; a config that allows inline `style` still gets the
   * CSS-URL allow-list). Validated at the boundary — see {@link isCleanConfig}.
   */
  config?: CleanConfig;
  /** Minify the output instead of prettier-formatting it. Default `false`. */
  minify?: boolean;
  /**
   * Upper bound on the input HTML size, measured in UTF-8 bytes. Defaults to
   * {@link DEFAULT_MAX_INPUT_BYTES} (10 MB). Inputs whose UTF-8 byte length
   * exceeds this are rejected at the boundary with a `RangeError` rather than
   * processed — a resource bound (validate input at every boundary). Set a
   * larger value to opt into processing bigger documents.
   */
  maxInputBytes?: number;
  /**
   * Optional source URL — context only, for the classifier's URL heuristics and
   * metadata `url`/`hostname`. trafilaturacore NEVER fetches it. This is not a
   * content-inclusion toggle.
   */
  url?: string;
}

/** Result of {@link clean}: cleaned HTML, diagnostics, and an optional metadata sidecar. */
export interface CleanResult {
  html: string;
  messages: Message[];
  metadata?: Metadata;
  /** The page type the classifier routed extraction through (omitted when `boilerplate: 'none'`). */
  pageType?: PageType;
  /** Classifier confidence in `pageType` (0–1; omitted when `boilerplate: 'none'`). */
  confidence?: number;
}

/** Runtime guard: is `value` a valid {@link BoilerplateMode}? */
export function isBoilerplateMode(value: unknown): value is BoilerplateMode {
  return typeof value === 'string' && (BOILERPLATE_MODES as readonly string[]).includes(value);
}

/** Runtime guard: is `value` a valid {@link CleaningLevel}? */
export function isCleaningLevel(value: unknown): value is CleaningLevel {
  return typeof value === 'string' && (CLEANING_LEVELS as readonly string[]).includes(value);
}

/** Runtime guard: is `value` a valid {@link PageType}? */
export function isPageType(value: unknown): value is PageType {
  return typeof value === 'string' && (PAGE_TYPES as readonly string[]).includes(value);
}

/** The only keys a custom {@link CleanConfig} JSON document may carry. */
const CLEAN_CONFIG_KEYS = [
  'allowedTags',
  'allowedAttributes',
  'allowedClasses',
  'selfClosing',
  'nonTextTags',
  'transformTags',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringArrayRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every(isStringArray);
}

function isStringRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

/**
 * Validate a value against the {@link CleanConfig} shape. Returns a clear,
 * specific error message, or `null` when it is a valid config. Used by both
 * surfaces (library `clean()` and the CLI `--config <file.json>`) so an invalid
 * custom config is rejected at the boundary with the same message. Rejects
 * unknown keys and wrong-typed fields; every field is optional, so `{}` is valid.
 */
export function cleanConfigError(value: unknown): string | null {
  if (!isPlainObject(value)) return 'expected a JSON object';
  for (const key of Object.keys(value)) {
    if (!(CLEAN_CONFIG_KEYS as readonly string[]).includes(key)) {
      return `unknown field '${key}' (allowed: ${CLEAN_CONFIG_KEYS.join(', ')})`;
    }
  }
  if (value.allowedTags !== undefined && !isStringArray(value.allowedTags))
    return "'allowedTags' must be an array of strings";
  if (value.selfClosing !== undefined && !isStringArray(value.selfClosing))
    return "'selfClosing' must be an array of strings";
  if (value.nonTextTags !== undefined && !isStringArray(value.nonTextTags))
    return "'nonTextTags' must be an array of strings";
  if (value.allowedAttributes !== undefined && !isStringArrayRecord(value.allowedAttributes))
    return "'allowedAttributes' must map tag names to arrays of strings";
  if (value.allowedClasses !== undefined && !isStringArrayRecord(value.allowedClasses))
    return "'allowedClasses' must map tag names to arrays of strings";
  if (value.transformTags !== undefined && !isStringRecord(value.transformTags))
    return "'transformTags' must map tag names to tag-name strings";
  return null;
}

/**
 * Runtime guard: is `value` a valid {@link CleanConfig}? Mirrors
 * {@link isCleaningLevel} / {@link isBoilerplateMode}. Use
 * {@link cleanConfigError} when you need the specific reason for a rejection.
 */
export function isCleanConfig(value: unknown): value is CleanConfig {
  return cleanConfigError(value) === null;
}
