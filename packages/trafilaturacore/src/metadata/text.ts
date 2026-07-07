// SPDX-License-Identifier: Apache-2.0
// Shared text helpers ported from trafilatura/utils.py (HTML_STRIP_TAGS, trim,
// line_processing, remove_control_characters) and trafilatura/json_metadata.py
// (normalize_json) — Apache-2.0.

import { type HElement, type HNode, TEXT_NODE, trim } from './dom.js';

/** Strip HTML comments and tags from a raw string. Mirrors `utils.HTML_STRIP_TAGS`. */
const HTML_STRIP_TAGS = /<!--[\s\S]*?-->|<[^>]*>/g;

/** Remove `<...>` markup from a string (mirrors `json_metadata.JSON_REMOVE_HTML`). */
const JSON_REMOVE_HTML = /<[^>]+>/g;

const UNICODE_ESCAPE = /\\u([0-9a-fA-F]{4})/g;

// C0 control chars trafilatura's remove_control_characters strips, keeping the
// whitespace ones (\t \n \r), plus DEL. Written with \u escapes so the source
// carries no literal control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: faithful port of utils.remove_control_characters.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Remove HTML comments and tags from a string (mirrors `HTML_STRIP_TAGS.sub`). */
export function stripHtmlTags(text: string): string {
  return text.replace(HTML_STRIP_TAGS, '');
}

function safeCodePoint(code: number): string {
  if (Number.isNaN(code) || code < 0 || code > 0x10ffff) return '';
  // Drop lone surrogates (mirrors trafilatura's surrogate filter in normalize_json).
  if (code >= 0xd800 && code <= 0xdfff) return '';
  return String.fromCodePoint(code);
}

/** The named entities `unescapeHtml` decodes (faithful subset of Python `unescape`). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Numeric (hex, then decimal) + named forms in ONE alternation, so decoding is a
// single scan like Python's `html.unescape` — never a chain of replaces.
const HTML_ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g;

/**
 * Decode the small set of named/numeric HTML entities trafilatura's `unescape`
 * touches in metadata. linkedom already decodes entities in element text, but
 * attribute values and JSON-LD payloads can still carry them, so we decode the
 * common ones here. Not a full entity table (faithful subset of Python `unescape`).
 * Single-pass, matching `html.unescape` semantics: a double-escaped entity
 * decodes exactly once (`&amp;lt;` → `&lt;`, never `<`).
 */
export function unescapeHtml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(HTML_ENTITY, (match, hex?: string, dec?: string, name?: string) => {
    if (hex !== undefined) return safeCodePoint(Number.parseInt(hex, 16));
    if (dec !== undefined) return safeCodePoint(Number.parseInt(dec, 10));
    if (name !== undefined) return NAMED_ENTITIES[name] ?? match;
    return match;
  });
}

/**
 * Normalize a string pulled out of JSON-LD: decode escapes/entities, strip
 * markup, drop lone surrogates, and trim. Mirrors `json_metadata.normalize_json`.
 */
export function normalizeJson(input: string): string {
  let s = input;
  if (s.includes('\\')) {
    s = s.replace(/\\n/g, '').replace(/\\r/g, '').replace(/\\t/g, '');
    s = s.replace(UNICODE_ESCAPE, (_m, hex: string) => safeCodePoint(Number.parseInt(hex, 16)));
    s = [...s]
      .filter((c) => {
        const code = c.codePointAt(0) ?? 0;
        return code < 0xd800 || code > 0xdfff;
      })
      .join('');
    s = unescapeHtml(s);
  }
  return trim(s.replace(JSON_REMOVE_HTML, ''));
}

/**
 * Line-level cleanup used for category/tag link text. Mirrors
 * `utils.line_processing` for the single-line, non-preserve-space path: decode
 * the spacing HTML entities, strip control chars, collapse whitespace; an
 * all-whitespace result becomes undefined.
 */
export function lineProcessing(line: string): string | undefined {
  const decoded = line
    .replace(/&#13;/g, '\r')
    .replace(/&#10;/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(CONTROL_CHARS, '');
  const s = trim(decoded.replace(/\s+/g, ' '));
  if (s.length === 0) return undefined;
  return s;
}

/**
 * lxml `" ".join(elem.itertext())`: descendant text-node values in document
 * order, joined with a single space. trafilatura's `extract_metainfo`
 * (metadata.py) uses this instead of `text_content()` so bylines/titles split
 * across adjacent inline elements with no separating whitespace (e.g.
 * `<span>John</span><span>Doe</span>`) come out space-separated. Implemented
 * locally in metadata/ so it does not perturb core/dom.ts.
 */
export function iterText(el: HElement): string {
  const parts: string[] = [];
  const walk = (n: HNode): void => {
    for (const c of n.childNodes) {
      if (c.nodeType === TEXT_NODE) parts.push(c.textContent ?? '');
      else walk(c);
    }
  };
  walk(el);
  return parts.join(' ');
}

/** Dedupe while preserving first-seen order (Python `dict.fromkeys` idiom). */
export function dedupeOrdered(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
