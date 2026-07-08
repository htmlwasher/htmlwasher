// Public type surface for trafilaturacore.
//
// The knobs (boilerplate-removal mode + optional custom cleaning config) are
// plain string-union / `as const`-array types, NOT TypeScript `enum`s (locked
// decision #4 in the build brief). Cleaning uses the single Trafilatura-aligned
// `DEFAULT_CLEAN_CONFIG`; callers may instead pass a fully-custom `CleanConfig`
// (pure JSON data — see {@link CleanOptions.config}).

import type { CleanConfig } from './cleaning/config.js';

export type { CleanConfig } from './cleaning/config.js';
export { DEFAULT_CLEAN_CONFIG } from './cleaning/config.js';

/**
 * Boilerplate-removal mode — gates the Trafilatura-derived main-content extraction.
 *
 * - `precision`              → sets `favor_precision` (less noise, may miss content)
 * - `balanced`               → neither flag (neutral default)
 * - `recall`                 → sets `favor_recall` (more content, may include noise)
 * - `clean-keep-boilerplate` → skip boilerplate removal entirely: HTML cleanup only,
 *   keeping the whole document (no page-type, no confidence, never loads the Rust FFI)
 *
 * All four modes clean; `precision`/`balanced`/`recall` mirror Trafilatura's
 * internal focus. `clean-keep-boilerplate` is trafilaturacore's addition (upstream
 * has no such mode) — it does the cleanup without boilerplate removal / main-content
 * extraction, so boilerplate is kept.
 */
export const BOILERPLATE_MODES = [
  'precision',
  'balanced',
  'recall',
  'clean-keep-boilerplate',
] as const;
export type BoilerplateMode = (typeof BOILERPLATE_MODES)[number];
export const DEFAULT_BOILERPLATE_MODE = 'balanced' satisfies BoilerplateMode;

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
 * Options for {@link clean}. The `boilerplate` mode + the cleaning `config` are the
 * core knobs; the four `include*` tri-state toggles below mirror Trafilatura's
 * `include_*` flags for the downstream Contextractor consumer. The
 * Trafilatura-aligned `DEFAULT_CLEAN_CONFIG` (or a fully-custom `config`) is the
 * baseline tag-inclusion control; each `include*: false` subtracts a content family
 * on top of it (see {@link deriveContentConfig}).
 */
export interface CleanOptions {
  /** Boilerplate-removal mode. Default `'balanced'`. */
  boilerplate?: BoilerplateMode;
  /**
   * Keep comments. Tri-state; default keep. **Soft no-op**: comment retention is
   * decided by the page-type profile in the Rust core, not by a tag-level toggle,
   * so this does not feed {@link deriveContentConfig}. Accepted and validated at the
   * boundary for Contextractor consumer-contract parity.
   */
  includeComments?: boolean;
  /**
   * Keep tables. Tri-state; default keep. An explicit `false` discards table
   * subtrees (`table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`).
   */
  includeTables?: boolean;
  /**
   * Keep images. Tri-state; default keep. An explicit `false` discards image
   * subtrees (`img`/`figure`/`figcaption`/`picture`/`source`). Note: Contextractor
   * defaults images off, but trafilaturacore keeps them and subtracts only on an
   * explicit `false`.
   */
  includeImages?: boolean;
  /**
   * Keep links. Tri-state; default keep. An explicit `false` unwraps `<a>` (anchor
   * text kept, `href` dropped).
   */
  includeLinks?: boolean;
  /**
   * Fully-custom cleaning config — a {@link CleanConfig} (pure JSON data). When
   * set it drives the sanitize stage directly, replacing the default
   * Trafilatura-aligned `DEFAULT_CLEAN_CONFIG`. The security floor still applies
   * (`<script>` and `on*` are always stripped; a config that allows inline
   * `style` still gets the CSS-URL allow-list). Validated at the boundary — see
   * {@link isCleanConfig}.
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
  /** The page type the classifier routed extraction through (omitted when `boilerplate: 'clean-keep-boilerplate'`). */
  pageType?: PageType;
  /** Classifier confidence in `pageType` (0–1; omitted when `boilerplate: 'clean-keep-boilerplate'`). */
  confidence?: number;
}

/** Runtime guard: is `value` a valid {@link BoilerplateMode}? */
export function isBoilerplateMode(value: unknown): value is BoilerplateMode {
  return typeof value === 'string' && (BOILERPLATE_MODES as readonly string[]).includes(value);
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
 * {@link isBoilerplateMode} / {@link isPageType}. Use
 * {@link cleanConfigError} when you need the specific reason for a rejection.
 */
export function isCleanConfig(value: unknown): value is CleanConfig {
  return cleanConfigError(value) === null;
}
