// SPDX-License-Identifier: Apache-2.0
//
// Phase 6: HTML washing levels. A faithful port of htmlprocessing-server's
// process-html.ts pipeline, retargeted onto htmlwasher's five WashingLevels
// (minimal | standard | permissive | styled | correct — NO `*-reader` variants).
//
// Pipeline order (matches the reference exactly):
//   NORMALIZE  — parse5 well-forming (full doc vs fragment via isHtmlDocument)
//   SANITIZE   — sanitize-html preset (skipped entirely for `correct`)
//   RE-NORMALIZE — only when the preset defines transformTags
//   DOCTYPE    — prepend `<!DOCTYPE html>` to full documents, post-sanitize
//   FORMAT     — prettier by default; html-minifier-terser when `minify: true`
//
// Messages accumulate across stages. Formatting failure is non-fatal (warning +
// unformatted output). `correct` is the caller's trust boundary: it ONLY normalizes
// existing markup — it does not sanitize, transform, or execute anything. It cannot
// INTRODUCE `<script>`/`on*`/`javascript:` (parse5 serialization adds no such
// constructs), but it also does not REMOVE whatever the input already contained.

import { minify as minifyHtml } from 'html-minifier-terser';
import type { Message, WashingLevel } from '../types.js';
import { sanitizeStyledHtml } from './css-sanitizer.js';
import { decodeBuffer } from './decode.js';
import { isHtmlDocument, normalizeHtml } from './normalize.js';
import { getSanitizeConfig } from './presets/index.js';
import { type Sanitizer, sanitizeHtmlBackend } from './sanitizer.js';

/** Options for {@link washHtml} / {@link washBuffer}. */
export interface WashOptions {
  /** Minify the output (html-minifier-terser) instead of prettier-formatting it. Default `false`. */
  minify?: boolean;
  /**
   * Use the hardened DOMPurify + jsdom sanitizer backend. Requires the optional
   * `dompurify` and `jsdom` deps; if either is missing, a warning is recorded and
   * washing falls back to the sanitize-html backend. Default `false`.
   */
  hardened?: boolean;
}

/** The output of a washing run: cleaned HTML plus accumulated diagnostics. */
export interface WashOutput {
  html: string;
  messages: Message[];
}

/**
 * Wash an HTML string at the given {@link WashingLevel}.
 *
 * Async because prettier, html-minifier-terser, and the hardened DOMPurify backend
 * are imported lazily. Empty/whitespace input returns `''`; malformed HTML never
 * throws (parse5 well-forms it, and sanitize/format failures degrade gracefully).
 */
export async function washHtml(
  html: string,
  level: WashingLevel,
  options: WashOptions = {},
): Promise<WashOutput> {
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

  // SANITIZE — every level EXCEPT `correct`. `correct` is normalize-only.
  const config = getSanitizeConfig(level);
  if (config !== undefined) {
    const sanitizer = await resolveSanitizer(hardened, messages);
    try {
      currentHtml = sanitizer.sanitize(currentHtml, config);
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

    // CSS-URL gap closure for the `styled` level: sanitize-html does not filter
    // `url()` / `expression()` / `@import` inside inline `style` or `<style>`.
    if (level === 'styled') {
      currentHtml = sanitizeStyledHtml(currentHtml);
    }
  }

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
 * and wash the result. Decoding diagnostics are prepended to the washing messages.
 */
export async function washBuffer(
  buffer: Uint8Array,
  level: WashingLevel,
  options: WashOptions = {},
): Promise<WashOutput> {
  const decoded = decodeBuffer(Buffer.from(buffer));
  if (decoded.html === undefined) {
    return { html: '', messages: decoded.messages };
  }
  const result = await washHtml(decoded.html, level, options);
  return {
    html: result.html,
    messages: [...decoded.messages, ...result.messages],
  };
}

/**
 * Resolve which sanitizer backend to use. Default is sanitize-html. When
 * `hardened` is requested, lazily load DOMPurify + jsdom; if they are not
 * installed, record a warning and fall back to sanitize-html.
 */
async function resolveSanitizer(hardened: boolean, messages: Message[]): Promise<Sanitizer> {
  if (!hardened) {
    return sanitizeHtmlBackend;
  }
  try {
    const { createDompurifyBackend } = await import('./dompurify-backend.js');
    return await createDompurifyBackend();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    messages.push({
      type: 'warning',
      text: `Hardened sanitizer (dompurify + jsdom) unavailable, falling back to sanitize-html: ${errorMessage}`,
    });
    return sanitizeHtmlBackend;
  }
}
