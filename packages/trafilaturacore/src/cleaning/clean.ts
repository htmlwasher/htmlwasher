// SPDX-License-Identifier: Apache-2.0
//
// The HTML cleaning stage, built around the single Trafilatura-aligned
// DEFAULT_CLEAN_CONFIG (see ./config.ts — upstream Trafilatura has no
// "cleaning levels", so neither does trafilaturacore).
//
// Pipeline order:
//   NORMALIZE      — parse5 well-forming (full doc vs fragment via isHtmlDocument)
//   SANITIZE       — sanitize-html with DEFAULT_CLEAN_CONFIG or a custom config
//   RE-NORMALIZE   — only when the config defines transformTags
//   SECURITY FLOOR — UNCONDITIONAL: enforceSecurityFloor + cleanStyledHtml on EVERY
//                    path (default and custom config alike)
//   DOCTYPE        — prepend `<!DOCTYPE html>` to full documents, post-floor
//   FORMAT         — prettier by default; html-minifier-terser when `minify: true`
//
// Messages accumulate across stages. Formatting failure is non-fatal (warning +
// unformatted output). The security floor is non-negotiable and UNCONDITIONAL
// for EVERY config: the final pass always runs
// `enforceSecurityFloor` + `cleanStyledHtml`, which force-strip `<script>`, all
// `on*` handlers, `javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous
// inline CSS, while leaving every benign tag/attribute in place. This is what makes
// the v2 cleaning stage a safe sole-sanitization-authority for the unsanitized HTML
// the Rust boilerplate core emits (context doc 09) and closes the wildcard-config
// bypass a `{ allowedAttributes: { '*': ['*'] } }` custom config otherwise exploited.

import { minify as minifyHtml } from 'html-minifier-terser';
import type { Message } from '../types.js';
import { type Cleaner, cleanHtmlBackend, enforceSecurityFloor } from './cleaner.js';
import { type CleanConfig, DEFAULT_CLEAN_CONFIG } from './config.js';
import { cleanStyledHtml } from './css-cleaner.js';
import { decodeBuffer } from './decode.js';
import { isHtmlDocument, normalizeHtml } from './normalize.js';

/** Options for {@link cleanHtml} / {@link cleanBuffer}. */
export interface CleanOptions {
  /** Minify the output (html-minifier-terser) instead of prettier-formatting it. Default `false`. */
  minify?: boolean;
  /**
   * Use the hardened DOMPurify + jsdom cleaner backend. Requires the optional
   * `dompurify` and `jsdom` deps; if either is missing, a warning is recorded and
   * cleaning falls back to the sanitize-html backend. Default `false`.
   */
  hardened?: boolean;
  /**
   * Fully-custom sanitize config. When set it drives the sanitize stage directly,
   * replacing the Trafilatura-aligned {@link DEFAULT_CLEAN_CONFIG}.
   */
  config?: CleanConfig;
}

/** The output of a cleaning run: cleaned HTML plus accumulated diagnostics. */
export interface CleanOutput {
  html: string;
  messages: Message[];
}

/**
 * Clean an HTML string with the Trafilatura-aligned {@link DEFAULT_CLEAN_CONFIG}
 * (or a fully-custom `options.config`).
 *
 * Async because prettier, html-minifier-terser, and the hardened DOMPurify backend
 * are imported lazily. Empty/whitespace input returns `''`; malformed HTML never
 * throws (parse5 well-forms it, and sanitize/format failures degrade gracefully).
 */
export async function cleanHtml(html: string, options: CleanOptions = {}): Promise<CleanOutput> {
  const shouldMinify = options.minify ?? false;
  const hardened = options.hardened ?? false;
  const messages: Message[] = [];
  let currentHtml = html;

  // NORMALIZE — always. parse5 (WHATWG HTML5) well-forms broken markup.
  const isDocument = isHtmlDocument(currentHtml);
  const normalizeResult = normalizeHtml(currentHtml, !isDocument);
  messages.push(...normalizeResult.messages);
  if (normalizeResult.html === undefined) {
    return { html: '', messages };
  }
  currentHtml = normalizeResult.html;
  if (currentHtml === '') {
    return { html: '', messages };
  }

  // SANITIZE — a custom `config` replaces the Trafilatura-aligned default.
  const config = options.config ?? DEFAULT_CLEAN_CONFIG;
  {
    const cleaner = await resolveCleaner(hardened, messages);
    try {
      currentHtml = cleaner.clean(currentHtml, config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown HTML cleanup error';
      messages.push({ type: 'error', text: `HTML cleanup failed: ${errorMessage}` });
      return { html: '', messages };
    }

    // RE-NORMALIZE — only when tag transforms ran (fixes nesting churned by renames).
    if (config.transformTags !== undefined) {
      const reNormalizeResult = normalizeHtml(currentHtml, !isHtmlDocument(currentHtml));
      if (reNormalizeResult.html !== undefined) {
        currentHtml = reNormalizeResult.html;
      }
      // Do not fail if re-normalization fails — keep the sanitized HTML.
    }
  }

  // SECURITY FLOOR — UNCONDITIONAL final cleaning pass on EVERY path (default AND
  // custom config). In v2 the TS cleaning stage is the SOLE
  // sanitization authority (the Rust boilerplate core sanitizes nothing — context
  // doc 09), so the floor can never be gated. `enforceSecurityFloor` force-strips
  // `<script>`, every `on*` handler, and `javascript:`/`vbscript:`/untrusted `data:`
  // URL schemes while preserving all benign tags/attributes; `cleanStyledHtml`
  // then closes the inline-CSS gap sanitize-html leaves untouched
  // (`url(javascript:|data:)`, `expression()`, `@import`, `-moz-binding`). Running
  // BOTH here — NOT gated on `configAllowsStyle`'s literal-`'style'` check — closes
  // the proven bypass where a custom `{ allowedAttributes: { '*': ['*'] } }` config
  // sails through sanitize-html still carrying `onclick` and a `javascript:` CSS URL
  // (doc 09, empirically verified). Both passes preserve benign markup and are
  // idempotent no-ops on already-clean output, so layering them over the sanitize
  // stage costs safety, not fidelity.
  currentHtml = enforceSecurityFloor(currentHtml);
  currentHtml = cleanStyledHtml(currentHtml);

  // DOCTYPE — full documents only, post-sanitize, if not already present.
  if (
    isHtmlDocument(currentHtml) &&
    !currentHtml.trimStart().toLowerCase().startsWith('<!doctype')
  ) {
    currentHtml = `<!DOCTYPE html>\n${currentHtml}`;
  }

  // FORMAT — prettier (default) or minify. Non-fatal on failure.
  try {
    if (shouldMinify) {
      currentHtml = await minifyHtml(currentHtml, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        minifyCSS: true,
        minifyJS: true,
      });
    } else {
      const prettier = await import('prettier');
      currentHtml = await prettier.format(currentHtml, {
        parser: 'html',
        printWidth: 120,
        tabWidth: 2,
        htmlWhitespaceSensitivity: 'ignore',
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown formatting error';
    messages.push({ type: 'warning', text: `HTML formatting failed: ${errorMessage}` });
    // Do not fail — return the unformatted HTML.
  }

  return { html: currentHtml, messages };
}

/**
 * Decode a byte buffer to UTF-8 (BOM → valid-UTF-8 fast path → chardet/iconv-lite)
 * and clean the result. Decoding diagnostics are prepended to the cleaning messages.
 */
export async function cleanBuffer(
  buffer: Uint8Array,
  options: CleanOptions = {},
): Promise<CleanOutput> {
  const decoded = decodeBuffer(Buffer.from(buffer));
  if (decoded.html === undefined) {
    return { html: '', messages: decoded.messages };
  }
  const result = await cleanHtml(decoded.html, options);
  return {
    html: result.html,
    messages: [...decoded.messages, ...result.messages],
  };
}

/**
 * Resolve which cleaner backend to use. Default is sanitize-html. When
 * `hardened` is requested, lazily load DOMPurify + jsdom; if they are not
 * installed, record a warning and fall back to sanitize-html.
 */
async function resolveCleaner(hardened: boolean, messages: Message[]): Promise<Cleaner> {
  if (!hardened) {
    return cleanHtmlBackend;
  }
  try {
    const { createDompurifyBackend } = await import('./dompurify-backend.js');
    return await createDompurifyBackend();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    messages.push({
      type: 'warning',
      text: `Hardened cleaner (dompurify + jsdom) unavailable, falling back to sanitize-html: ${errorMessage}`,
    });
    return cleanHtmlBackend;
  }
}
