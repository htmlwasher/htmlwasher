// SPDX-License-Identifier: Apache-2.0
// URL pattern constant lists, verbatim from rs-trafilatura `page_type/mod.rs` (the
// authoritative port target — NOT web-page-classifier's divergent url_heuristics.rs).
// Shared by the numeric URL features f[0..14] and the Stage-1 `classifyUrl` cascade.

export const FORUM_DOMAINS = [
  'forum.',
  'forums.',
  'community.',
  'discuss.',
  'discussion.',
  'users.',
  'bbs.',
  'reddit.com',
  'stackoverflow.com',
  'stackexchange.com',
  'gamefaqs.',
  'discourse.',
  'news.ycombinator.com',
  'quora.com',
  'lemmy.',
  'tapatalk.com',
  'webhostingtalk.com',
  'netmums.com',
  'mumsnet.com',
  'nairaland.com',
  'lobste.rs',
] as const;

export const FORUM_PATHS = [
  '/forum',
  '/forums/',
  '/thread/',
  '/threads/',
  '/topic/',
  '/topics/',
  '/discussion/',
  '/discussions/',
  '/community/',
  '/t/',
  '/questions/',
  '/question/',
  '/comments/',
  '/talk/',
] as const;

export const FORUM_URL_PATTERNS = ['/viewtopic.php', '/showthread.php', '/item?id='] as const;

export const DOCS_DOMAINS = [
  'docs.',
  'doc.',
  'wiki.',
  'devdocs.',
  'man7.org',
  'readthedocs.io',
  'readthedocs.org',
  'developer.hashicorp.com',
  'developer.mozilla.org',
] as const;

export const DOCS_PATHS = [
  '/docs/',
  '/doc/',
  '/documentation/',
  '/reference/',
  '/api/',
  '/guide/',
  '/tutorial/',
  '/tutorials/',
  '/manual/',
  '/handbook/',
  '/wiki/',
  '/man-pages/',
  '/man/',
  '/concepts/',
  '/userguide/',
  '/quickstart',
  '/getting-started',
  '/book/',
  '/glossary/',
  '/tech_notes/',
] as const;

export const PRODUCT_PATHS = ['/products/', '/product/', '/shop/', '/dp/', '/ip/'] as const;

/** Stage-1 only: `classifyUrl` checks PRODUCT_DOMAINS; f[5] does NOT (f[13] is a separate check). */
export const PRODUCT_DOMAINS = ['shop.', 'store.'] as const;

export const CATEGORY_PATHS = [
  '/collections/',
  '/collection/',
  '/categories/',
  '/category/',
  '/browse/',
  '/cat/',
  '/subcategory/',
] as const;

export const SERVICE_PATHS = [
  '/services/',
  '/service/',
  '/services.html',
  '/solutions/',
  '/solution/',
  '/offerings/',
  '/what-we-do',
] as const;

export const SERVICE_SLUG_PATTERNS = [
  '-consulting-services',
  '-development-services',
  '-management-services',
  '-support-services',
  '-outsourcing-services',
  '-integration-services',
  '-development-company',
  '-consulting-company',
  '-ai-consulting',
  '-ai-development',
  '-ai-solutions',
] as const;

export const LISTING_PATH_ENDINGS = [
  '/news',
  '/testimonials',
  '/coupons',
  '/issues',
  '/reviews',
  '/rankings',
  '-courses',
] as const;

export const LISTING_PATH_CONTAINS = ['/awards/', '/trending/', '/list/'] as const;

export const ARTICLE_PATHS = [
  '/blog/',
  '/blog',
  '/news/',
  '/article/',
  '/articles/',
  '/post/',
  '/posts/',
  '/insight/',
  '/insights/',
  '/resource/',
  '/resources/',
  '/stories/',
  '/magazine/',
  '/journal/',
  '/press/',
  '/editorial/',
  '/opinion/',
  '/review/',
  '/column/',
] as const;

export const BLOG_SLUG_PATTERNS = [
  '-ways-to-',
  '-tips-',
  '-reasons-',
  '-steps-to-',
  '-things-to-',
  '-best-',
  '-top-',
  '-essential-',
  'beginners-guide',
  'complete-guide',
  'ultimate-guide',
  'how-to-',
  'what-is-',
  'why-',
  'when-to-',
  '-vs-',
  '-versus-',
  '-comparison',
  '-checklist',
  '-trends-',
  '-strategies-',
  '-challenges-',
  '-benefits-',
  '-advantages-',
] as const;

/** ANY needle is a substring of haystack (rs-trafilatura `contains_any`). */
export function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

/**
 * rs-trafilatura `extract_domain_path` (NO `//` strip — see FEATURES.md divergence).
 * Strip a leading `https://` else `http://`; split the remainder at the first `/`
 * (path KEEPS the `/`); else path is `/`.
 */
export function extractDomainPath(urlLower: string): { domain: string; path: string } {
  let rest = urlLower;
  if (rest.startsWith('https://')) {
    rest = rest.slice('https://'.length);
  } else if (rest.startsWith('http://')) {
    rest = rest.slice('http://'.length);
  }
  const slash = rest.indexOf('/');
  if (slash >= 0) {
    return { domain: rest.slice(0, slash), path: rest.slice(slash) };
  }
  return { domain: rest, path: '/' };
}
