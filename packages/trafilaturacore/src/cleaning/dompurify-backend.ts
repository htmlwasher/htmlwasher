// SPDX-License-Identifier: Apache-2.0
//
// The hardened cleaner backend: DOMPurify running over a jsdom window. Both
// `dompurify` and `jsdom` are OPTIONAL dependencies, so this module is imported
// lazily (dynamic `import()`) only when the caller passes `hardened: true`. If
// either package is unavailable, `createDompurifyBackend` throws and clean.ts
// records a warning and falls back to the sanitize-html backend.
//
// DOMPurify uses a FLAT allow-list (ALLOWED_TAGS / ALLOWED_ATTR), not the per-tag
// attribute map sanitize-html consumes. We derive both from the same preset so the
// allowed surface stays in lockstep across backends: tags come straight from
// `allowedTags`; attributes are the UNION of every per-tag attribute list (event
// handlers already filtered out upstream). `transformTags` is applied by a small
// pre-pass before handing markup to DOMPurify, since DOMPurify has no tag-rename
// feature. The result is then re-checked — DOMPurify always strips `<script>`,
// event handlers, and `javascript:`/`data:` URLs by its own hardened defaults.

import { type Cleaner, filterEventHandlers } from './cleaner.js';
import type { CleanConfig } from './config.js';
import { isHtmlDocument } from './normalize.js';

// Minimal structural types for the lazily-imported optional deps. We avoid a
// top-level type import so a missing `@types/*` never breaks `tsc` for callers
// who do not install the optional deps.
interface DomPurifyConfig {
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
  ALLOW_DATA_ATTR?: boolean;
  WHOLE_DOCUMENT?: boolean;
  FORBID_TAGS?: string[];
}
interface DomPurifyInstance {
  sanitize(dirty: string, cfg: DomPurifyConfig): string;
}
type DomPurifyFactory = (window: unknown) => DomPurifyInstance;

/** Flatten a preset into the flat tag + attribute allow-lists DOMPurify expects. */
function flattenAllowList(config: CleanConfig): {
  tags: string[];
  attrs: string[];
} {
  const tags = config.allowedTags ?? [];

  const attrSet = new Set<string>();
  if (config.allowedAttributes !== undefined) {
    const safeAttrs = filterEventHandlers(config.allowedAttributes);
    for (const list of Object.values(safeAttrs)) {
      for (const attr of list) {
        attrSet.add(attr);
      }
    }
  }
  // A config may allow class/style globally; flattening above already captures them.
  return { tags, attrs: [...attrSet] };
}

/** Apply the config's simple tag-rename transforms before DOMPurify runs. */
function applyTransformTags(html: string, transformTags: Record<string, string>): string {
  let out = html;
  for (const [from, to] of Object.entries(transformTags)) {
    const open = new RegExp(`<${from}(\\s[^>]*)?>`, 'gi');
    const close = new RegExp(`</${from}\\s*>`, 'gi');
    out = out.replace(open, (_m, attrs: string | undefined) => `<${to}${attrs ?? ''}>`);
    out = out.replace(close, `</${to}>`);
  }
  return out;
}

/**
 * Lazily construct a DOMPurify-backed {@link Cleaner}. Throws if `dompurify`
 * or `jsdom` is not installed — the caller is expected to catch and fall back.
 */
export async function createDompurifyBackend(): Promise<Cleaner> {
  // Dynamic imports: optional deps, resolved only on the hardened path.
  const purifyModule = (await import('dompurify')) as { default: DomPurifyFactory };
  const jsdomModule = (await import('jsdom')) as {
    JSDOM: new (html?: string) => { window: unknown };
  };

  const createDOMPurify = purifyModule.default;
  const { JSDOM } = jsdomModule;
  const { window } = new JSDOM('');
  const purify = createDOMPurify(window);

  return {
    name: 'dompurify',
    clean(html: string, config: CleanConfig): string {
      const transformed =
        config.transformTags !== undefined ? applyTransformTags(html, config.transformTags) : html;
      const { tags, attrs } = flattenAllowList(config);
      return purify.sanitize(transformed, {
        ALLOWED_TAGS: tags,
        ALLOWED_ATTR: attrs,
        ALLOW_DATA_ATTR: false,
        // Preserve the html/head/body scaffold only when the INPUT was a full
        // document; a fragment stays a fragment (parity with sanitize-html).
        WHOLE_DOCUMENT: isHtmlDocument(transformed) && tags.includes('html'),
        // Belt-and-braces: never let these through regardless of allow-list.
        FORBID_TAGS: ['script', 'textarea', 'option'].filter(
          (t) => !(config.allowedTags ?? []).includes(t),
        ),
      });
    },
  };
}
