// SPDX-License-Identifier: Apache-2.0
//
// Phase 6 — HTML washing levels. Public surface of the washing pillar: the five
// WashingLevel sanitize/normalize/format pipeline ported from htmlprocessing-server,
// with htmlwasher's CSS-URL hardening for `styled` and an optional DOMPurify backend.

export { sanitizeCss, sanitizeStyledHtml } from './css-sanitizer.js';
export { type DecodeBufferResult, decodeBuffer } from './decode.js';
export { isHtmlDocument, type NormalizeHtmlResult, normalizeHtml } from './normalize.js';
export { getSanitizeConfig, type SanitizeConfig } from './presets/index.js';
export { filterEventHandlers, type Sanitizer, sanitizeHtmlBackend } from './sanitizer.js';
export { type WashOptions, type WashOutput, washBuffer, washHtml } from './wash.js';
