// SPDX-License-Identifier: Apache-2.0
// The single Trafilatura-aligned cleaning configuration (plus the CleanConfig
// shape it instantiates). This replaces the former five-level preset system —
// upstream Trafilatura has no "cleaning levels", so trafilaturacore keeps only
// the elements Trafilatura or rs-trafilatura themselves emit.
//
// Derivation (from ~/r/trafilatura-sources, Trafilatura 2.1.0):
//   - `allowedTags` = Trafilatura's HTML output vocabulary — TEI_VALID_TAGS
//     (trafilatura/xml.py) rendered to HTML via HTML_CONVERSIONS
//     (trafilatura/htmlprocessing.py): p, h1–h6 (head rend), ul/li (list/item),
//     table/tr/td/th (row/cell), blockquote (quote), pre (code), br (lb),
//     img (graphic), a (ref), i/strong/u/var/sub/sup (hi rend), del — TEI's two
//     remaining members never reach HTML output (upstream strips every div from
//     the result body before serialization, and ab is TEI-only) — plus the
//     html/head/meta/body document scaffolding Trafilatura's build_html_output
//     emits (title added because trafilaturacore also cleans whole documents) —
//     UNION the content-semantic tags rs-trafilatura's serializer whitelist
//     additionally emits (native/src/extract.rs EMIT_TAGS): ol, code, hr,
//     dl/dt/dd, caption/colgroup/col, q, em/b/s, kbd/samp, and the
//     include_images survivors figure/figcaption/picture/source.
//   - `nonTextTags` (subtree discarded) = Trafilatura's MANUALLY_CLEANED list
//     (trafilatura/settings.py; the Rust core's TAGS_TO_CLEAN is the same list
//     via go-trafilatura, minus the newer fencedframe/noindex additions), minus
//     the image-mode rescues (figure/picture/source), minus `head` (kept as
//     scaffolding), and minus `footer` — the Rust core intentionally emits
//     header/footer inside article/main, so the TS stage unwraps rather than
//     destroys them (`header` was never in MANUALLY_CLEANED).
//   - Everything else is simply not allowed — sanitize-html unwraps the tag
//     and keeps its content. This covers Trafilatura's MANUALLY_STRIPPED list
//     (abbr, cite, mark, small, tbody/thead/tfoot, …) plus the structural
//     containers upstream handles inside its extractor instead (div is
//     corrected to p and span is stripped in main_extractor.py).
//   - CUT_EMPTY_ELEMS has no sanitize-html equivalent (empty-element pruning
//     already happens in the Rust core's extraction path); it is intentionally
//     not mirrored here.
//   - `allowedAttributes` = Trafilatura's kept attributes (a[href],
//     img[src|alt|title], meta[name|content]) union rs-trafilatura's per-tag
//     whitelist (whitelist_attrs in native/src/extract.rs) — except
//     time[datetime] (dropped: `time` subtrees are discarded via nonTextTags),
//     plus html[lang] and meta[charset] as trafilaturacore's own
//     whole-document scaffolding hygiene.
//   - `transformTags` maps deprecated tags into the canonical set: strike→del
//     and tt→var mirror Trafilatura's CONVERSIONS/REND round-trip
//     (htmlprocessing.py); dir→ul and listing/xmp/plaintext→pre are
//     trafilaturacore's own legacy-HTML normalizations (kept from the former
//     presets; no upstream analogue).

/**
 * Internal sanitize configuration type.
 * Defines the subset of sanitize-html options used by the cleaning stage.
 */
export interface CleanConfig {
  /** Tags to allow in the output. */
  allowedTags?: string[];
  /** Attributes allowed per tag. Key is tag name, value is array of allowed attribute names. */
  allowedAttributes?: Record<string, string[]>;
  /** CSS classes allowed per tag. Key is tag name, value is array of allowed class names. */
  allowedClasses?: Record<string, string[]>;
  /** Tags that are self-closing. */
  selfClosing?: string[];
  /** Tags whose content should be completely discarded (not preserved as text). */
  nonTextTags?: string[];
  /** Tags to transform to other tags. Key is source tag, value is target tag. */
  transformTags?: Record<string, string>;
}

/** Recursively freeze a config literal so the shared default stays immutable. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * The default cleaning configuration — Trafilatura's canonical output-tag set
 * (see the derivation in the module header). Deeply frozen: it is a shared
 * singleton, so callers extend it by spreading into a custom
 * {@link CleanConfig}, never by mutation:
 *
 * ```ts
 * const config = {
 *   ...DEFAULT_CLEAN_CONFIG,
 *   allowedTags: [...(DEFAULT_CLEAN_CONFIG.allowedTags ?? []), 'mark'],
 * };
 * ```
 */
export const DEFAULT_CLEAN_CONFIG: CleanConfig = deepFreeze({
  allowedTags: [
    // Document scaffolding (Trafilatura's build_html_output emits html/body,
    // plus head/meta when metadata is on; title kept because trafilaturacore
    // also cleans whole documents in `boilerplate: 'clean-only'` mode)
    'html',
    'head',
    'meta',
    'title',
    'body',
    // Block content (p; quote→blockquote; code→pre; hr kept per rs-trafilatura)
    'p',
    'blockquote',
    'pre',
    'hr',
    // Headings (head rend="h1…h6")
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    // Lists (list/item → ul/li; ol + the dl family kept per rs-trafilatura)
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    // Tables (row/cell → tr/td/th; caption/colgroup/col per rs-trafilatura —
    // thead/tbody/tfoot are deliberately absent: both upstreams strip them)
    'table',
    'caption',
    'tr',
    'td',
    'th',
    'colgroup',
    'col',
    // Links (ref → a)
    'a',
    // Images (graphic → img; figure/figcaption/picture/source survive both
    // upstreams' cleaning when images are on — the Rust core's default)
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    // Inline formatting (hi rend → i/strong/u/var/sub/sup; em/b/s/q/code/kbd/
    // samp kept per rs-trafilatura's serializer whitelist)
    'i',
    'em',
    'strong',
    'b',
    'u',
    's',
    'q',
    'code',
    'kbd',
    'samp',
    'var',
    'sub',
    'sup',
    // Edit tracking (del survives both upstreams; ins does not)
    'del',
    // Line breaks (lb → br)
    'br',
  ],
  allowedAttributes: {
    html: ['lang'],
    meta: ['charset', 'name', 'content'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    source: ['src', 'srcset', 'type', 'media'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    blockquote: ['cite'],
    q: ['cite'],
    col: ['span'],
    colgroup: ['span'],
    ol: ['start', 'type', 'reversed'],
    code: ['class'],
  },
  selfClosing: ['img', 'br', 'hr', 'meta', 'source', 'col'],
  // Trafilatura's MANUALLY_CLEANED (subtree removed with content), minus the
  // image-mode rescues (figure/picture/source), minus `head` (scaffolding),
  // minus `footer` (the Rust core emits header/footer inside article/main —
  // unwrapping keeps their content; `header` was never in the upstream list).
  // `fencedframe`/`noindex` are upstream additions with no HTML meaning
  // beyond removal.
  nonTextTags: [
    'applet',
    'area',
    'aside',
    'audio',
    'blink',
    'button',
    'canvas',
    'datalist',
    'dialog',
    'embed',
    'fencedframe',
    'fieldset',
    'form',
    'frame',
    'frameset',
    'iframe',
    'input',
    'ins',
    'label',
    'legend',
    'link',
    'map',
    'marquee',
    'math',
    'menu',
    'menuitem',
    'nav',
    'noindex',
    'noscript',
    'object',
    'optgroup',
    'option',
    'output',
    'param',
    'progress',
    'rp',
    'rt',
    'rtc',
    'script',
    'select',
    'style',
    'svg',
    'textarea',
    'time',
    'track',
    'use',
    'video',
  ],
  transformTags: {
    strike: 'del',
    tt: 'var',
    dir: 'ul',
    listing: 'pre',
    xmp: 'pre',
    plaintext: 'pre',
  },
});
