// SPDX-License-Identifier: Apache-2.0
//
// The sanitizer seam. Washing always runs HTML through a `Sanitizer`, of which
// there are two implementations behind one interface:
//
//   - `sanitizeHtmlBackend` (DEFAULT): sanitize-html driven by a `SanitizeConfig`
//     preset. This is the byte-for-byte port of htmlprocessing-server behavior.
//   - `dompurifyBackend` (opt-in, `hardened: true`): DOMPurify over a jsdom window,
//     using the same allow-list derived from the preset. DOMPurify + jsdom are
//     OPTIONAL dependencies and are imported lazily; if either is missing the
//     caller falls back to the sanitize-html backend (handled in wash.ts).
//
// `filterEventHandlers` is shared defense-in-depth: every attribute whose
// lowercased name starts with `on` is stripped from the allow-list before
// sanitizing, regardless of backend or preset. Likewise `<script>` is force-
// removed from `allowedTags` and kept in `nonTextTags`: the named presets never
// list it, but a fully-custom config (WashOptions.config) could, and the
// security floor — "<script>/on*/javascript: stripped at EVERY level" — must
// hold for custom configs too.

import sanitizeHtml from 'sanitize-html';
import type { SanitizeConfig } from './presets/index.js';

/** Tags never allowed in washed output, regardless of preset or custom config. */
const ALWAYS_FORBIDDEN_TAGS = new Set(['script']);

/** A pluggable HTML sanitizer. Synchronous string→string given a resolved config. */
export interface Sanitizer {
  readonly name: string;
  sanitize(html: string, config: SanitizeConfig): string;
}

/**
 * Strip every event-handler attribute (`on*`) from an allow-list. Pure helper,
 * exported for testing. Defense-in-depth: presets never list `on*` attributes,
 * but this guarantees it even if a future preset slips one in.
 */
export function filterEventHandlers(attrs: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [tag, attrList] of Object.entries(attrs)) {
    result[tag] = attrList.filter((attr) => !attr.toLowerCase().startsWith('on'));
  }
  return result;
}

/** Translate a `SanitizeConfig` preset into sanitize-html's option shape. */
function toSanitizeHtmlOptions(config: SanitizeConfig): sanitizeHtml.IOptions {
  const options: sanitizeHtml.IOptions = {};

  if (config.allowedTags !== undefined) {
    // Force-remove always-forbidden tags (<script>) so a custom config cannot
    // allow them — defense-in-depth, like filterEventHandlers for on* below.
    options.allowedTags = config.allowedTags.filter(
      (tag) => !ALWAYS_FORBIDDEN_TAGS.has(tag.toLowerCase()),
    );
  }
  if (config.allowedAttributes !== undefined) {
    // Filter out event handler attributes (on*) for security.
    options.allowedAttributes = filterEventHandlers(config.allowedAttributes);
  }
  if (config.allowedClasses !== undefined) {
    options.allowedClasses = config.allowedClasses;
  }
  if (config.selfClosing !== undefined) {
    options.selfClosing = config.selfClosing;
  }
  if (config.transformTags !== undefined) {
    // Simple string mappings are valid sanitize-html transformers.
    options.transformTags = { ...config.transformTags };
  }
  if (config.nonTextTags !== undefined) {
    // Always discard <script> content (never keep it as text), even if a custom
    // config cleared nonTextTags. sanitize-html's default already includes it;
    // this guarantees it when the config overrides the default.
    options.nonTextTags = config.nonTextTags.includes('script')
      ? config.nonTextTags
      : [...config.nonTextTags, 'script'];
  }

  // The `styled` preset knowingly allows `<style>`; sanitize-html warns loudly
  // about its inability to filter CSS. We acknowledge it (the washing pipeline
  // layers its own CSS sanitizer on top — see css-sanitizer.ts) to silence the
  // per-call console warning. This does NOT relax any tag/attribute filtering.
  if ((config.allowedTags ?? []).includes('style')) {
    options.allowVulnerableTags = true;
  }

  return options;
}

/** The default backend: sanitize-html. */
export const sanitizeHtmlBackend: Sanitizer = {
  name: 'sanitize-html',
  sanitize(html: string, config: SanitizeConfig): string {
    return sanitizeHtml(html, toSanitizeHtmlOptions(config));
  },
};

/**
 * The mandatory security floor for the `correct` washing level (and any
 * normalize-only path with no sanitize preset/config). The brief makes security
 * "non-negotiable at EVERY level (including `correct`)": always strip `<script>`,
 * every `on*` event-handler attribute, and `javascript:`/`vbscript:`/untrusted
 * `data:` URLs. This config preserves ALL benign tags and attributes (no tag
 * allow-list, no `transformTags` renames) so arbitrary tags (`<custom-x>`),
 * `data-*` attributes, and deprecated tags (`<strike>`) pass through unchanged —
 * keeping `correct` faithful to its normalize-only intent for benign markup —
 * while force-removing only the three active-content vectors:
 *   - `<script>` is dropped (element + text) via `exclusiveFilter` + `nonTextTags`;
 *   - every `on*` attribute is stripped via the wildcard `transformTags['*']`;
 *   - URL-bearing attributes are scheme-filtered to http/https/ftp/mailto/tel,
 *     which rejects `javascript:`/`vbscript:`/`data:`/`file:`.
 * CSS-borne vectors inside inline `style`/`<style>` are NOT closed here — the
 * caller layers `sanitizeStyledHtml` on top (sanitize-html does not inspect CSS).
 */
const SECURITY_FLOOR_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: false,
  allowedAttributes: false,
  allowVulnerableTags: true,
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: [
    'href',
    'src',
    'cite',
    'srcset',
    'action',
    'formaction',
    'poster',
    'background',
    'xlink:href',
    'longdesc',
    'usemap',
  ],
  exclusiveFilter: (frame) => ALWAYS_FORBIDDEN_TAGS.has(frame.tag),
  nonTextTags: ['script'],
  transformTags: {
    '*': (tagName, attribs) => {
      const cleaned: Record<string, string> = {};
      for (const [name, value] of Object.entries(attribs)) {
        if (name.toLowerCase().startsWith('on')) continue;
        cleaned[name] = value;
      }
      return { tagName, attribs: cleaned };
    },
  },
};

/**
 * Apply the mandatory {@link SECURITY_FLOOR_OPTIONS} security floor: strip
 * `<script>`, all `on*` handlers, and dangerous URL schemes while preserving every
 * benign tag/attribute. Exported for testing. Used by `washHtml` on the `correct`
 * (no-config) path so the floor holds at EVERY washing level. CSS in inline
 * `style`/`<style>` must still be cleaned separately (`sanitizeStyledHtml`).
 */
export function enforceSecurityFloor(html: string): string {
  return sanitizeHtml(html, SECURITY_FLOOR_OPTIONS);
}
