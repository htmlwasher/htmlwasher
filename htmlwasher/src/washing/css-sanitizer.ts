// SPDX-License-Identifier: Apache-2.0
//
// CSS sanitizer for the `styled` washing level.
//
// WHY THIS EXISTS: sanitize-html validates element attributes and URL schemes on
// href/src/cite, but it does NOT inspect the CSS inside an inline `style="…"`
// attribute or a `<style>…</style>` element. At the `styled` level we deliberately
// preserve both, which reopens a class of CSS-borne injection vectors that
// sanitize-html leaves untouched. This module closes that gap.
//
// POLICY (default-deny on anything that can fetch/execute):
//   - `url(...)` values: allowed only for http:, https:, protocol-relative `//`,
//     and same-/relative-path references. EVERYTHING ELSE — `javascript:`,
//     `vbscript:`, `data:` (including `data:image/*`; see note), `file:`, and any
//     unknown scheme — is stripped (the whole declaration's `url(...)` token is
//     replaced with a neutral placeholder). `data:` is denied by default because
//     CSS `data:` URIs are a known SVG/script-smuggling vector and `styled` is not
//     meant to inline binary payloads.
//   - `expression(...)` (legacy IE dynamic CSS that executes JS): stripped.
//   - `@import` (pulls in remote/arbitrary stylesheets, bypasses the URL policy):
//     the whole at-rule is stripped.
//   - `-moz-binding` (XBL bindings could run script in old Gecko): the whole
//     declaration is stripped.
//   - HTML/CSS comment delimiters used to smuggle the above (`/*…*/`, `<!--`,
//     `-->`) are neutralized before matching so they cannot hide a banned token.
//
// The sanitizer is applied to BOTH inline `style` attributes and `<style>` element
// text AFTER sanitize-html has run, so it operates on an already tag-cleaned tree.

const DANGEROUS_COMMENT = /\/\*[\s\S]*?\*\/|<!--|-->/g;

// `url( … )` capture — quote-tolerant, whitespace-tolerant. Three precise
// branches so a QUOTED argument is captured in full even when it contains nested
// parens (e.g. `url("javascript:alert(1)")`): double-quoted, single-quoted, then
// bare. For the bare branch a trailing run of `)` is also consumed so an unquoted
// nested-paren payload (e.g. `url(javascript:alert(1))`) leaves no dangling `)`.
const URL_FUNC = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)*/gi;

// IE `expression( … )` — strip the whole call, including its (possibly
// nested-paren) argument, so no executable token nor stray `)` survives.
const EXPRESSION_FUNC = /expression\s*\([^;}{]*\)*/gi;

// `@import …;` (or `@import … <newline>`) at-rule.
const IMPORT_RULE = /@import[^;]*;?/gi;

// `-moz-binding: …;` declaration.
const MOZ_BINDING = /-moz-binding\s*:[^;]*;?/gi;

/** A `url(...)` argument is safe if it is http(s), protocol-relative, or a relative/same-doc path. */
function isSafeCssUrl(raw: string): boolean {
  const value = raw.trim();
  if (value === '') {
    return false;
  }
  // A CSS backslash escape (e.g. `\6a` → 'j') can smuggle a banned scheme past
  // the scheme regex below (`\6a avascript:` decodes to `javascript:`). No
  // legitimate url scheme/host needs one — reject any url() arg containing `\`.
  if (/\\/.test(value)) {
    return false;
  }
  const lower = value.toLowerCase();

  // Protocol-relative `//host/...` is treated as https-equivalent → allow.
  if (lower.startsWith('//')) {
    return true;
  }

  // Any explicit scheme: allow ONLY http/https. Everything else (javascript,
  // vbscript, data, file, blob, …) is denied.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/.exec(lower);
  if (schemeMatch) {
    const scheme = schemeMatch[1];
    return scheme === 'http' || scheme === 'https';
  }

  // No scheme → relative path, fragment, or query → allow.
  return true;
}

/**
 * Sanitize a CSS string (inline `style` value or `<style>` body) per the policy
 * above. Banned constructs are removed; safe `url(...)` references are preserved.
 */
export function sanitizeCss(css: string): string {
  if (css === '') {
    return css;
  }

  // Neutralize comment delimiters that could be used to hide banned tokens, e.g.
  // `url(/*x*/javascript:…)` or `expr/**/ession(…)`.
  let out = css.replace(DANGEROUS_COMMENT, ' ');

  // Drop whole at-rules / declarations that are unconditionally dangerous.
  out = out.replace(IMPORT_RULE, '');
  out = out.replace(MOZ_BINDING, '');

  // Strip IE `expression(...)` entirely — function name, argument, and closing
  // paren(s) — so it can no longer parse as a CSS function.
  out = out.replace(EXPRESSION_FUNC, '');

  // Filter `url(...)` by scheme. Read whichever branch matched (double-quoted,
  // single-quoted, or bare); a non-http(s) scheme replaces the WHOLE token.
  out = out.replace(URL_FUNC, (match, dq?: string, sq?: string, bare?: string) => {
    const urlArg = dq ?? sq ?? bare ?? '';
    return isSafeCssUrl(urlArg) ? match : "url('')";
  });

  return out;
}

const STYLE_ATTR = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const STYLE_ELEMENT = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

/** Decode the small set of HTML entities that can appear in an attribute value. */
function decodeAttrEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'");
}

/** Re-encode the characters that must stay escaped inside a double-quoted attribute. */
function encodeAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Apply {@link sanitizeCss} to every inline `style` attribute and every `<style>`
 * element body in an HTML string. Used only at the `styled` washing level.
 */
export function sanitizeStyledHtml(html: string): string {
  let out = html.replace(
    STYLE_ATTR,
    (_match, prefix: string, _full: string, dq?: string, sq?: string) => {
      const rawValue = dq ?? sq ?? '';
      const decoded = decodeAttrEntities(rawValue);
      const cleaned = sanitizeCss(decoded);
      return `${prefix}"${encodeAttrValue(cleaned)}"`;
    },
  );

  out = out.replace(STYLE_ELEMENT, (_match, open: string, body: string, close: string) => {
    return `${open}${sanitizeCss(body)}${close}`;
  });

  return out;
}
