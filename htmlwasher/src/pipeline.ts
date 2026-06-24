// SPDX-License-Identifier: Apache-2.0
// Orchestrates the two pillars into the public wash() API:
//   metadata (sidecar) + boilerplate(mode) → wash(level).
//
// The boilerplate stage currently routes by mode only; page-type classification
// and per-type profile selection (Phase 4/5) plug into `runBoilerplate` once the
// trained classifier lands. `none` bypasses extraction and washes the whole
// document. wash() is async because the washing formatter (prettier / minifier)
// is loaded lazily.

import { extractContentHTML } from './core/extract.js';
import type { ExtractFocus } from './core/options.js';
import { extractMetadata } from './metadata/index.js';
import {
  type BoilerplateMode,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_WASHING_LEVEL,
  type Message,
  type Metadata,
  type WashOptions,
  type WashResult,
} from './types.js';
import { washHtml } from './washing/wash.js';

const MODE_TO_FOCUS: Record<Exclude<BoilerplateMode, 'none'>, ExtractFocus> = {
  precision: 'precision',
  balanced: 'balanced',
  recall: 'recall',
};

/** Run the boilerplate-removal stage for a given mode; returns content HTML to wash. */
function runBoilerplate(
  html: string,
  mode: BoilerplateMode,
  url: string | undefined,
  messages: Message[],
): string {
  if (mode === 'none') return html; // wash the whole document
  const focus = MODE_TO_FOCUS[mode];
  const result = extractContentHTML(html, { focus, originalUrl: url });
  if (result.html === '') {
    messages.push({
      type: 'warning',
      text: 'boilerplate removal produced no content; washing the whole document',
    });
    return html;
  }
  return result.html;
}

function hasMetadata(meta: Metadata): boolean {
  return Object.values(meta).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));
}

/**
 * Clean a page: HTML in → cleaned HTML out (+ an optional metadata sidecar).
 *
 * Two orthogonal knobs: the boilerplate-removal `mode` (default `'balanced'`;
 * `'none'` washes the whole document) and the washing `level` (default
 * `'standard'`). `minify` (default `false`) emits minified rather than
 * prettier-formatted HTML. `url` is optional context (never fetched).
 */
export async function wash(html: string, options: WashOptions = {}): Promise<WashResult> {
  const mode = options.boilerplate ?? DEFAULT_BOILERPLATE_MODE;
  const level = options.level ?? DEFAULT_WASHING_LEVEL;
  const minify = options.minify ?? false;
  const messages: Message[] = [];

  let metadata: Metadata | undefined;
  try {
    const meta = extractMetadata(html, options.url);
    if (hasMetadata(meta)) metadata = meta;
  } catch (error) {
    messages.push({
      type: 'warning',
      text: `metadata extraction failed: ${(error as Error).message}`,
    });
  }

  const contentHtml = runBoilerplate(html, mode, options.url, messages);
  const washed = await washHtml(contentHtml, level, { minify });
  messages.push(...washed.messages);

  return metadata ? { html: washed.html, messages, metadata } : { html: washed.html, messages };
}
