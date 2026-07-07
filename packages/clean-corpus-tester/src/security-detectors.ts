// Security detectors for the cleaned output HTML (HARD assertions).
//
// The handler + javascript:-URL detectors are anchored to TAG context: the
// opening-tag substrings are extracted first and the patterns run only inside
// those tags. Running them over the whole output would trip on escaped visible
// text — benign prose like "chapter one = introduction" (" one =") or
// documentation quoting "javascript:void(0)" legitimately survives cleaning as
// escaped text content. The input is our own serializer's output, so a
// pragmatic opening-tag regex (no comment/CDATA handling; a raw `>` inside an
// attribute value truncates that tag) is acceptable in this test harness.

// A raw `<script` opening tag. Safe to test on the WHOLE output: escaped text
// can never contain a raw `<script`.
const SCRIPT_TAG = /<script[\s/>]/i;

// Opening-tag (incl. self-closing) substrings; never matches closing tags,
// comments, or doctypes (those don't start `<[a-zA-Z]`).
const OPENING_TAG = /<[a-zA-Z][^>]*>/g;

// An event-handler attribute inside a tag: `on<word>=` preceded by whitespace,
// a quote, or a slash (the attribute delimiters), so a tag-name substring like
// a literal "lemonade=" can never match. Covers onclick, onerror, etc.
const TAG_EVENT_HANDLER = /[\s"'/]on[a-z]+\s*=/i;

// A `javascript:` URL inside a tag, restricted to the tight set of attributes
// that can actually carry a URL scheme and are plausible in cleaned output:
// href/src/action/formaction, SVG's xlink:href, and <object data>.
const TAG_JAVASCRIPT_URL =
  /(?:href|src|action|formaction|xlink:href|data)\s*=\s*["']?\s*javascript:/i;

function openingTags(html: string): string[] {
  return html.match(OPENING_TAG) ?? [];
}

/** True if a raw `<script>` tag survives anywhere in `html`. */
export function hasScriptTag(html: string): boolean {
  return SCRIPT_TAG.test(html);
}

/**
 * The first inline event-handler attribute surviving inside an opening tag
 * (e.g. `onclick=`), or `undefined`. Escaped text content never matches.
 */
export function findEventHandlerAttr(html: string): string | undefined {
  for (const tag of openingTags(html)) {
    const raw = TAG_EVENT_HANDLER.exec(tag)?.[0];
    // Drop the single leading delimiter character the regex anchors on.
    if (raw !== undefined) return raw.slice(1).trim();
  }
  return undefined;
}

/**
 * True if any opening tag carries a `javascript:` URL in a URL-bearing
 * attribute. Escaped text like "javascript:void(0)" never matches.
 */
export function hasJavascriptUrl(html: string): boolean {
  return openingTags(html).some((tag) => TAG_JAVASCRIPT_URL.test(tag));
}
