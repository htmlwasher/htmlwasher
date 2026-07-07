// SPDX-License-Identifier: Apache-2.0
// parse5-based
// WHATWG-HTML5 well-forming: full documents via parse+serialize, fragments via
// parseFragment+serialize. `isHtmlDocument` is the document/fragment heuristic.

import { parse, parseFragment, serialize } from 'parse5';
import type { Message } from '../types.js';

export interface NormalizeHtmlResult {
  html: string | undefined;
  messages: Message[];
}

/**
 * Normalize HTML using parse5 (WHATWG HTML5 compliant parser).
 * Handles broken/malformed HTML and produces valid output.
 *
 * @param html - Input HTML (can be broken/invalid)
 * @param isFragment - If true, parse as fragment (no html/head/body wrapper).
 *                     If false, parse as full document.
 * @returns Normalized HTML or undefined with error messages
 */
export function normalizeHtml(html: string, isFragment = true): NormalizeHtmlResult {
  const messages: Message[] = [];

  if (!html || html.trim() === '') {
    return { html: '', messages };
  }

  try {
    if (isFragment) {
      const fragment = parseFragment(html);
      const normalized = serialize(fragment);
      return { html: normalized, messages };
    }
    const document = parse(html);
    const normalized = serialize(document);
    return { html: normalized, messages };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse5 error';
    messages.push({
      type: 'error',
      text: `HTML normalization failed: ${errorMessage}`,
    });
    return { html: undefined, messages };
  }
}

/**
 * Detect if HTML appears to be a full document or a fragment.
 * Returns true if it looks like a full document (has doctype, html, head, or body tags).
 */
export function isHtmlDocument(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('<!doctype') ||
    /<html[\s>]/i.test(html) ||
    /<head[\s>]/i.test(html) ||
    /<body[\s>]/i.test(html)
  );
}
