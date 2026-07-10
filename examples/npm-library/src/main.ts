import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clean, DEFAULT_BOILERPLATE_MODE, DEFAULT_MAX_INPUT_BYTES } from 'trafilaturacore';

// trafilaturacore is HTML in -> cleaned HTML out, and OFFLINE: clean() never
// fetches the network. Everything below runs against a local sample file.
const samplePath = fileURLToPath(new URL('../../sample.html', import.meta.url));
const html = await readFile(samplePath, 'utf8');

console.log('default boilerplate mode:', DEFAULT_BOILERPLATE_MODE);
console.log('default maxInputBytes:', DEFAULT_MAX_INPUT_BYTES);

// The simplest call: defaults to `balanced`, keeps comments/tables/images/links.
// Boilerplate (nav, sidebar, footer) is dropped; the article body is kept.
const result = await clean(html);
console.log('cleaned html length:', result.html.length);
console.log('page type:', result.pageType, 'confidence:', result.confidence?.toFixed(3));

// The metadata sidecar is additive — it never replaces or converts the HTML.
console.log('title:', result.metadata?.title);
console.log('author:', result.metadata?.author);

// Non-fatal diagnostics surface as messages rather than throws.
for (const message of result.messages) {
  console.log(`[${message.type}] ${message.text}`);
}

// The four boilerplate modes. `keep` skips main-content
// extraction entirely (HTML cleanup only) — so it reports no page type and
// never loads the native module.
for (const boilerplate of ['precision', 'balanced', 'recall', 'keep'] as const) {
  const r = await clean(html, { boilerplate });
  console.log(`${boilerplate}: ${r.html.length} bytes, pageType=${r.pageType ?? '(none)'}`);
}

// Tri-state content toggles: each defaults to keep; an explicit `false`
// subtracts that content family. `includeComments` is accepted but is a soft
// no-op (comment retention follows the page-type profile in the Rust core).
const lean = await clean(html, { includeImages: false, includeLinks: false, includeTables: false });
console.log('lean has <img>?', lean.html.includes('<img'));
console.log('lean has <a href>?', lean.html.includes('<a href'));
console.log('lean has <table>?', lean.html.includes('<table'));

// Minify instead of pretty-printing.
const minified = await clean(html, { minify: true });
console.log('minified length:', minified.html.length);

// `url` is context only — used by the classifier's URL heuristics and the
// metadata sidecar. It is NEVER fetched.
const withUrl = await clean(html, {
  url: 'https://example.com/blog/how-boilerplate-removal-works',
});
console.log('metadata url:', withUrl.metadata?.url, 'hostname:', withUrl.metadata?.hostname);

// A custom cleaning config (plain JSON data) REPLACES the default
// Trafilatura-aligned config. The unconditional security floor still applies:
// <script>, on* handlers, and dangerous URL schemes are always stripped.
const custom = await clean(html, {
  config: {
    allowedTags: ['h1', 'h2', 'p', 'a', 'strong', 'em'],
    allowedAttributes: { a: ['href'] },
  },
});
console.log('custom-config length:', custom.html.length);

// Boundary guards reject bad input rather than silently degrading.
try {
  await clean(html, { maxInputBytes: 10 });
} catch (error) {
  console.log('oversized input rejected:', (error as RangeError).constructor.name);
}
try {
  // An invalid mode is rejected at the boundary (the cast mimics untrusted input).
  await clean(html, { boilerplate: 'nonsense' as never });
} catch (error) {
  console.log('invalid mode rejected:', (error as TypeError).constructor.name);
}
