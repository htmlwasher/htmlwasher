# SPDX-License-Identifier: Apache-2.0
"""Deterministic 89-feature numeric extractor + TF-IDF input text for the
htmlwasher page-type classifier.

This module is the Python half of the feature contract documented in
``training/FEATURES.md``. It MUST produce byte-identical feature vectors to the
TypeScript runtime extractor in ``htmlwasher/src/classifier/features/`` so the
ONNX model behaves the same at train and inference time.

Authoritative behaviour mirrored from the Rust references:

- ``rs-trafilatura/src/page_type/ml.rs`` ``extract_ml_features`` (fills f[0..89])
- ``rs-trafilatura/src/page_type/mod.rs`` ``extract_domain_path`` / ``contains_any``
- ``rs-trafilatura/src/extract.rs`` ``title_meta`` construction

Critical parity rules (see FEATURES.md "Ambiguities"):

- Every ``.len()`` is a UTF-8 BYTE length, not a Python code-point count. We
  encode to UTF-8 and count bytes for every length comparison/value.
- The 500_000-byte body-text gate is a strict ``>`` early-return that leaves
  f[63..89] at 0.0.
- ``[class*='x']`` is a case-sensitive attribute-substring match.
- Tree-side ``.text()`` is pure descendant-text concatenation (no separator);
  selectolax ``node.text(deep=True, separator="")`` matches dom_query's ``.text()``.
"""

from __future__ import annotations

import re

from selectolax.lexbor import LexborHTMLParser, LexborNode

N_NUMERIC = 89

# --- URL pattern constant lists (rs-trafilatura mod.rs, verbatim) ---

FORUM_DOMAINS = (
    "forum.",
    "forums.",
    "community.",
    "discuss.",
    "discussion.",
    "users.",
    "bbs.",
    "reddit.com",
    "stackoverflow.com",
    "stackexchange.com",
    "gamefaqs.",
    "discourse.",
    "news.ycombinator.com",
    "quora.com",
    "lemmy.",
    "tapatalk.com",
    "webhostingtalk.com",
    "netmums.com",
    "mumsnet.com",
    "nairaland.com",
    "lobste.rs",
)
FORUM_PATHS = (
    "/forum",
    "/forums/",
    "/thread/",
    "/threads/",
    "/topic/",
    "/topics/",
    "/discussion/",
    "/discussions/",
    "/community/",
    "/t/",
    "/questions/",
    "/question/",
    "/comments/",
    "/talk/",
)
FORUM_URL_PATTERNS = ("/viewtopic.php", "/showthread.php", "/item?id=")
DOCS_DOMAINS = (
    "docs.",
    "doc.",
    "wiki.",
    "devdocs.",
    "man7.org",
    "readthedocs.io",
    "readthedocs.org",
    "developer.hashicorp.com",
    "developer.mozilla.org",
)
DOCS_PATHS = (
    "/docs/",
    "/doc/",
    "/documentation/",
    "/reference/",
    "/api/",
    "/guide/",
    "/tutorial/",
    "/tutorials/",
    "/manual/",
    "/handbook/",
    "/wiki/",
    "/man-pages/",
    "/man/",
    "/concepts/",
    "/userguide/",
    "/quickstart",
    "/getting-started",
    "/book/",
    "/glossary/",
    "/tech_notes/",
)
PRODUCT_PATHS = ("/products/", "/product/", "/shop/", "/dp/", "/ip/")
CATEGORY_PATHS = (
    "/collections/",
    "/collection/",
    "/categories/",
    "/category/",
    "/browse/",
    "/cat/",
    "/subcategory/",
)
SERVICE_PATHS = (
    "/services/",
    "/service/",
    "/services.html",
    "/solutions/",
    "/solution/",
    "/offerings/",
    "/what-we-do",
)
SERVICE_SLUG_PATTERNS = (
    "-consulting-services",
    "-development-services",
    "-management-services",
    "-support-services",
    "-outsourcing-services",
    "-integration-services",
    "-development-company",
    "-consulting-company",
    "-ai-consulting",
    "-ai-development",
    "-ai-solutions",
)
LISTING_PATH_ENDINGS = (
    "/news",
    "/testimonials",
    "/coupons",
    "/issues",
    "/reviews",
    "/rankings",
    "-courses",
)
LISTING_PATH_CONTAINS = ("/awards/", "/trending/", "/list/")
ARTICLE_PATHS = (
    "/blog/",
    "/blog",
    "/news/",
    "/article/",
    "/articles/",
    "/post/",
    "/posts/",
    "/insight/",
    "/insights/",
    "/resource/",
    "/resources/",
    "/stories/",
    "/magazine/",
    "/journal/",
    "/press/",
    "/editorial/",
    "/opinion/",
    "/review/",
    "/column/",
)
BLOG_SLUG_PATTERNS = (
    "-ways-to-",
    "-tips-",
    "-reasons-",
    "-steps-to-",
    "-things-to-",
    "-best-",
    "-top-",
    "-essential-",
    "beginners-guide",
    "complete-guide",
    "ultimate-guide",
    "how-to-",
    "what-is-",
    "why-",
    "when-to-",
    "-vs-",
    "-versus-",
    "-comparison",
    "-checklist",
    "-trends-",
    "-strategies-",
    "-challenges-",
    "-benefits-",
    "-advantages-",
)

# f[84]: regex matched against the lowercased body text (case handled by lowercasing).
_PRODUCT_COUNT_RE = re.compile(r"\d+\s*(results|items|products|pieces)")

# Vocabulary-density word lists (f[75..78]).
_COMMERCIAL_WORDS = (
    "price",
    "buy",
    "cart",
    "shop",
    "order",
    "shipping",
    "delivery",
    "stock",
    "sale",
    "discount",
    "offer",
    "deal",
    "checkout",
    "payment",
    "warranty",
    "returns",
    "refund",
)
_CONTENT_WORDS = (
    "posted",
    "author",
    "published",
    "updated",
    "comments",
    "share",
    "tweet",
    "read",
    "article",
    "blog",
    "opinion",
    "editor",
    "journalist",
    "source",
    "according",
)
_TECH_WORDS = (
    "api",
    "function",
    "parameter",
    "returns",
    "example",
    "syntax",
    "reference",
    "deprecated",
    "version",
    "module",
    "class",
    "method",
    "interface",
    "configuration",
    "install",
)
_FORUM_WORDS = (
    "reply",
    "thread",
    "post",
    "member",
    "joined",
    "reputation",
    "moderator",
    "admin",
    "quote",
    "likes",
    "views",
    "topic",
    "answered",
    "solution",
    "vote",
    "upvote",
)
_DOM_SIG_KEYWORDS = ("item", "card", "product", "post", "entry", "result", "row", "cell")
_CTA_PHRASES = (
    "get started",
    "free trial",
    "contact us",
    "sign up",
    "try free",
    "get pricing",
    "book a",
    "schedule",
)


def _blen(s: str) -> int:
    """UTF-8 byte length, matching Rust ``String::len`` / ``str::len``."""
    return len(s.encode("utf-8"))


def contains_any(haystack: str, needles: tuple[str, ...]) -> bool:
    """ANY needle is a substring of haystack (rs-trafilatura ``contains_any``)."""
    return any(n in haystack for n in needles)


def extract_domain_path(url_lower: str) -> tuple[str, str]:
    """rs-trafilatura ``extract_domain_path`` (NO ``//`` strip — see FEATURES.md).

    Strip a leading ``https://`` else ``http://``; split the remainder at the
    first ``/`` (path KEEPS the ``/``); else path is ``/``.
    """
    rest = url_lower
    if rest.startswith("https://"):
        rest = rest[len("https://") :]
    elif rest.startswith("http://"):
        rest = rest[len("http://") :]
    slash = rest.find("/")
    if slash >= 0:
        return rest[:slash], rest[slash:]
    return rest, "/"


def _node_text(node: LexborNode) -> str:
    """Pure descendant-text concatenation, matching dom_query ``Selection::text``."""
    text = node.text(deep=True, separator="")
    return text if text is not None else ""


def _selection_text(nodes: list[LexborNode]) -> str:
    """dom_query ``doc.select(sel).text()`` = concatenation across all matched nodes."""
    return "".join(_node_text(n) for n in nodes)


def _descendant_count(node: LexborNode, sel: str) -> int:
    """Count DESCENDANTS of ``node`` matching ``sel`` (excludes ``node`` itself).

    dom_query's ``Selection::select`` searches descendants only, but selectolax's
    ``node.css`` also returns ``node`` when it matches the selector. Filter the
    root out to preserve byte-for-byte parity (matters for f[85]'s card→price
    descendant check where a card's own class can match the price selector).
    """
    matches = node.css(sel)
    if not matches:
        return 0
    return sum(1 for m in matches if m != node)


def _element_children(node: LexborNode) -> list[LexborNode]:
    """Direct ELEMENT children of ``node`` (matches dom_query ``Selection::children``).

    Walks ``child``/``next`` siblings manually and keeps only element nodes
    (selectolax tags a node ``-text``/``-comment`` for non-elements). This avoids
    two selectolax pitfalls: ``node.iter()`` (a) INCLUDES comment nodes — which
    dom_query's ``children()`` excludes — and (b) segfaults on some deeply nested
    trees when ``.attributes`` is read off the iterated child wrappers.
    """
    out: list[LexborNode] = []
    child = node.child
    while child is not None:
        tag = child.tag
        if tag and not tag.startswith("-"):
            out.append(child)
        child = child.next
    return out


# meta-tag routing keys (rs-trafilatura metadata/meta_tags.rs, first-wins per group).
_DESCRIPTION_KEYS = (
    "description",
    "og:description",
    "twitter:description",
    "dc.description",
    "excerpt",
)
_OG_TYPE_KEY = "og:type"


def _scan_meta(tree: LexborHTMLParser) -> dict[str, str]:
    """Resolve first-wins meta values keyed by ``name||property||itemprop||http-equiv``.

    Mirrors ``examine_meta``: the routing key is the first present of those four
    attributes, lowercased; empty key/content rows are skipped; the FIRST meta in
    document order wins per key.
    """
    out: dict[str, str] = {}
    for meta in tree.css("meta"):
        attrs = meta.attributes
        key = (
            attrs.get("name")
            or attrs.get("property")
            or attrs.get("itemprop")
            or attrs.get("http-equiv")
            or ""
        ).lower()
        content = attrs.get("content") or ""
        if not key or not content:
            continue
        out.setdefault(key, content)
    return out


def title_meta_text(html: str) -> str:
    """Return ``"{title} {description}"`` — the only TF-IDF input (extract.rs).

    PARITY CAVEAT: this is a deliberately simplified ``title_meta``. ``title`` is
    the ``<title>`` element text (trimmed); ``description`` is the first present
    meta value among ``description``/``og:description``/``twitter:description``/
    ``dc.description``/``excerpt`` (trimmed). It does NOT replicate
    rs-trafilatura's full metadata pipeline (DOM title fallbacks, HTML-entity
    decoding, site-suffix stripping). Because TF-IDF is locked from whatever text
    THIS function produces, the TS runtime MUST implement this identical simplified
    logic for vocabulary parity — not the full metadata extractor.
    """
    tree = LexborHTMLParser(html)
    title_node = tree.css_first("title")
    title = title_node.text(deep=True, separator="").strip() if title_node else ""

    meta = _scan_meta(tree)
    description = ""
    for key in _DESCRIPTION_KEYS:
        if key in meta:
            description = meta[key].strip()
            break

    return f"{title} {description}"


def _og_type(tree: LexborHTMLParser) -> str:
    """Raw og:type content, lowercased (``Metadata.page_type`` analogue).

    Read from the first meta whose routing key is ``og:type`` (name or property
    or itemprop), mirroring ``examine_meta``. Empty string when absent.
    """
    return _scan_meta(tree).get(_OG_TYPE_KEY, "").lower()


def extract_numeric_features(html: str, url: str) -> list[float]:
    """Extract exactly 89 numeric features per ``FEATURES.md``.

    ``html`` is the raw page HTML; ``url`` is the source URL (the WCXB dataset
    only ships a domain, so callers pass ``https://{domain}/`` — a documented
    parity caveat). Returns a list of 89 floats; booleans are 1.0/0.0.
    """
    f = [0.0] * N_NUMERIC

    url_lower = url.lower()
    domain, path = extract_domain_path(url_lower)

    # === f[0..14]: URL pattern features ===
    f[0] = 1.0 if contains_any(domain, FORUM_DOMAINS) else 0.0
    f[1] = 1.0 if contains_any(path, FORUM_PATHS) else 0.0
    f[2] = 1.0 if contains_any(url_lower, FORUM_URL_PATTERNS) else 0.0
    f[3] = 1.0 if contains_any(domain, DOCS_DOMAINS) else 0.0
    f[4] = 1.0 if contains_any(path, DOCS_PATHS) else 0.0
    f[5] = 1.0 if contains_any(path, PRODUCT_PATHS) else 0.0
    f[6] = 1.0 if contains_any(path, CATEGORY_PATHS) else 0.0
    f[7] = 1.0 if contains_any(path, SERVICE_PATHS) else 0.0
    f[8] = 1.0 if contains_any(url_lower, SERVICE_SLUG_PATTERNS) else 0.0
    f[9] = 1.0 if contains_any(path, ARTICLE_PATHS) else 0.0
    f[10] = 1.0 if contains_any(url_lower, BLOG_SLUG_PATTERNS) else 0.0
    path_trimmed = path.rstrip("/")
    f[11] = 1.0 if any(path_trimmed.endswith(p) for p in LISTING_PATH_ENDINGS) else 0.0
    f[12] = 1.0 if contains_any(path, LISTING_PATH_CONTAINS) else 0.0
    f[13] = 1.0 if ("shop." in domain or "store." in domain) else 0.0

    tree = LexborHTMLParser(html)

    def select(sel: str) -> list[LexborNode]:
        nodes = tree.css(sel)
        return list(nodes) if nodes else []

    def select_len(sel: str) -> int:
        return len(select(sel))

    # === f[14..63]: HTML structural features ===

    # Paragraph stats (trimmed byte-length > 20).
    p_count = 0
    p_total_len = 0
    for node in select("p"):
        trimmed = _node_text(node).strip()
        if _blen(trimmed) > 20:
            p_count += 1
            p_total_len += _blen(trimmed)
    f[14] = float(p_count)
    f[15] = (p_total_len / p_count) if p_count > 0 else 0.0
    f[16] = float(select_len("h1, h2, h3, h4, h5, h6"))
    h2_count = select_len("h2")
    body_nodes = select("body")
    body_text_full = _selection_text(body_nodes)
    body_text_len = _blen(body_text_full)
    f[17] = (body_text_len / h2_count) if h2_count > 0 else 0.0
    f[18] = 1.0 if select_len("article") > 0 else 0.0
    f[19] = 1.0 if select_len("time") > 0 else 0.0
    f[20] = 1.0 if select_len("main") > 0 else 0.0
    f[21] = 1.0 if select_len("aside") > 0 else 0.0
    f[22] = (
        1.0
        if select_len('meta[name="author"], meta[property="article:author"], [class*="author"]') > 0
        else 0.0
    )

    # JSON-LD signals (substring match on raw script text; quotes are part of needle).
    for node in select('script[type="application/ld+json"]'):
        text = _node_text(node)
        if '"Article"' in text or '"NewsArticle"' in text or '"BlogPosting"' in text:
            f[23] = 1.0
        if '"Product"' in text:
            f[24] = 1.0
        if '"FAQPage"' in text:
            f[25] = 1.0
        if '"CollectionPage"' in text or '"OfferCatalog"' in text:
            f[26] = 1.0
        if '"ItemList"' in text:
            f[27] = 1.0
        if '"LocalBusiness"' in text:
            f[28] = 1.0
        if '"Service"' in text:
            f[29] = 1.0
        if '"AggregateOffer"' in text:
            f[30] = 1.0

    og_type = _og_type(tree)
    f[31] = 1.0 if "product" in og_type else 0.0
    f[32] = 1.0 if og_type == "article" else 0.0
    f[33] = 1.0 if og_type == "website" else 0.0
    f[34] = (
        1.0
        if select_len("[class*='product-grid'], [class*='product-list'], [class*='product-card']")
        > 0
        else 0.0
    )
    f[35] = (
        1.0
        if select_len("[class*='add-to-cart'], [class*='addtocart'], [class*='buy-now']") > 0
        else 0.0
    )
    f[36] = float(
        select_len("[class*='product-card'], [class*='product-tile'], [class*='product-item']")
    )
    f[37] = (
        1.0 if select_len("link[rel='next'], [class*='pagination'], [class*='pager']") > 0 else 0.0
    )
    f[38] = float(select_len("code, pre"))
    f[39] = (
        1.0
        if select_len(
            "[class*='docs-sidebar'], [class*='doc-sidebar'], "
            "[class*='docs-nav'], [class*='table-of-contents']"
        )
        > 0
        else 0.0
    )

    link_count = select_len("a")
    p_text = _selection_text(select("p"))
    p_words = len(p_text.split())
    f[40] = (link_count / p_words) if p_words > 0 else 0.0
    f[41] = float(p_words)
    f[42] = float(
        select_len("[class*='grid'], [class*='col-'], [class*='column'], [class*='card']")
    )
    f[43] = float(select_len("svg"))

    cta_count = 0
    for node in select("button, a"):
        text = _node_text(node).lower()
        if any(phrase in text for phrase in _CTA_PHRASES):
            cta_count += 1
    f[44] = float(cta_count)
    f[45] = 1.0 if select_len("[class*='hero']") > 0 else 0.0
    f[46] = 1.0 if select_len("[class*='testimonial']") > 0 else 0.0
    f[47] = 1.0 if select_len("[class*='pricing']") > 0 else 0.0
    f[48] = 1.0 if select_len("[class*='feature']") > 0 else 0.0
    f[49] = 1.0 if select_len("[class*='breadcrumb']") > 0 else 0.0
    f[50] = float(select_len("form"))
    f[51] = float(select_len("img"))
    f[52] = float(select_len("ul, ol"))
    f[53] = float(select_len("table"))
    f[54] = float(select_len("nav"))
    f[55] = float(select_len("section"))
    f[56] = float(select_len("button"))
    f[57] = float(select_len("input"))
    f[58] = float(body_text_len)

    link_hrefs: set[str] = set()
    for node in select("a[href]"):
        href = node.attributes.get("href")
        if href is not None:
            link_hrefs.add(href)
    f[59] = float(len(link_hrefs))
    f[60] = float(select_len("[class*='comment']"))
    f[61] = float(select_len("[class*='post']"))
    f[62] = float(select_len("[class*='message']"))

    # === 500,000-byte body-text gate: early return leaves f[63..89] at 0.0 ===
    if body_text_len > 500_000:
        return f

    # === f[63..73]: Enhanced structural features ===

    # f[63]/f[64]: repeated sibling RAW class strings.
    shallow_nodes = select("body > *, body > * > *, body > * > * > *")
    max_repeated_class = 0
    parents_with_repeats = 0
    for node in shallow_nodes:
        children = _element_children(node)
        if len(children) < 3:
            continue
        class_counts: dict[str, int] = {}
        for child in children:
            cls = child.attributes.get("class")
            if cls is not None:
                class_counts[cls] = class_counts.get(cls, 0) + 1
        if class_counts:
            max_count = max(class_counts.values())
            if max_count >= 3:
                parents_with_repeats += 1
                max_repeated_class = max(max_repeated_class, max_count)
    f[63] = float(max_repeated_class)
    f[64] = float(parents_with_repeats)

    # f[65]: currency-symbol occurrences in body text.
    f[65] = float(body_text_full.count("$") + body_text_full.count("€") + body_text_full.count("£"))

    # f[66]: image-to-text ratio (denominator is body bytes / 1000).
    img_count = int(f[51])
    f[66] = (img_count / (body_text_len / 1000.0)) if body_text_len > 0 else 0.0

    # f[67]: heading breadth ratio (level read from 2nd char of tag name).
    heading_level_counts = [0, 0, 0, 0, 0, 0]
    for node in select("h1, h2, h3, h4, h5, h6"):
        name = node.tag or ""
        if len(name) >= 2 and name[1].isdigit():
            level = int(name[1])
            if 1 <= level <= 6:
                heading_level_counts[level - 1] += 1
    max_same_level = max(heading_level_counts)
    n_levels_used = sum(1 for c in heading_level_counts if c > 0)
    f[67] = (max_same_level / n_levels_used) if n_levels_used > 0 else 0.0

    # body_lower is computed once and reused by f[75..78], f[84], f[86].
    body_lower = body_text_full.lower()
    f[68] = 1.0 if "breadcrumblist" in body_lower else 0.0

    # f[69]: repeated link texts (lowercased trimmed, byte-len > 3, count >= 3).
    link_text_counts: dict[str, int] = {}
    for node in select("a"):
        text = _node_text(node).strip().lower()
        if _blen(text) > 3:
            link_text_counts[text] = link_text_counts.get(text, 0) + 1
    f[69] = float(sum(1 for c in link_text_counts.values() if c >= 3))

    # f[70]: section link-density population variance with the flush-before-assign quirk.
    section_ratios: list[float] = []
    current_links = 0
    current_text_len = 0
    for node in select("section, article, div"):
        if current_text_len > 50:
            section_ratios.append(current_links / current_text_len * 1000.0)
        current_links = 0
        current_text_len = 0
        current_links = _descendant_count(node, "a")
        current_text_len = _blen(_node_text(node).strip())
    if current_text_len > 50:
        section_ratios.append(current_links / current_text_len * 1000.0)
    if len(section_ratios) >= 3:
        mean = sum(section_ratios) / len(section_ratios)
        var = sum((r - mean) ** 2 for r in section_ratios) / len(section_ratios)
        f[70] = var

    f[71] = 1.0 if select_len('meta[name="robots"][content*="noindex"]') > 0 else 0.0

    path_segments = sum(1 for s in path.strip("/").split("/") if s)
    f[72] = float(path_segments)

    # === f[73..81]: DOM vocabulary features ===

    # f[73]/f[74]: structural signature ``tag`` or ``tag|keyword``.
    dom_max_sig = 0
    dom_parents_with_repeats = 0
    for node in shallow_nodes:
        children = _element_children(node)
        if len(children) < 3:
            continue
        sig_counts: dict[str, int] = {}
        for child in children:
            tag = (child.tag or "").lower()
            if not tag:
                continue
            cls = (child.attributes.get("class") or "").lower()
            keyword = ""
            for kw in _DOM_SIG_KEYWORDS:
                if kw in cls:
                    keyword = kw
                    break
            sig = tag if not keyword else f"{tag}|{keyword}"
            sig_counts[sig] = sig_counts.get(sig, 0) + 1
        if sig_counts:
            top = max(sig_counts.values())
            if top >= 3:
                dom_parents_with_repeats += 1
                dom_max_sig = max(dom_max_sig, top)
    f[73] = float(dom_max_sig)
    f[74] = float(dom_parents_with_repeats)

    # f[75..78]: vocabulary densities over exact whitespace-split tokens of body_lower.
    body_words = body_lower.split()
    total_words = len(body_words)
    if total_words > 0:
        word_counts: dict[str, int] = {}
        for word in body_words:
            word_counts[word] = word_counts.get(word, 0) + 1
        f[75] = sum(word_counts.get(w, 0) for w in _COMMERCIAL_WORDS) / total_words
        f[76] = sum(word_counts.get(w, 0) for w in _CONTENT_WORDS) / total_words
        f[77] = sum(word_counts.get(w, 0) for w in _TECH_WORDS) / total_words
        f[78] = sum(word_counts.get(w, 0) for w in _FORUM_WORDS) / total_words

    # f[79]/f[80]: reuse the f[69] link-text frequency map.
    f[79] = float(max(link_text_counts.values()) if link_text_counts else 0)
    f[80] = float(sum(1 for c in link_text_counts.values() if c >= 3))

    # === f[81..89]: Collection-specific features ===

    f[81] = 1.0 if select_len('meta[property="og:type"][content*="product.group"]') > 0 else 0.0
    f[82] = (
        1.0
        if select_len(
            "[class*='filter'][class*='sidebar'], [class*='filter'][class*='panel'], "
            "[class*='filter'][class*='bar'], [class*='filter'][class*='menu']"
        )
        > 0
        else 0.0
    )
    f[83] = (
        1.0
        if select_len(
            "[class*='sort'][class*='select'], [class*='sort'][class*='dropdown'], "
            "[class*='sort'][class*='control'], [class*='sort'][class*='option']"
        )
        > 0
        else 0.0
    )
    f[84] = 1.0 if _PRODUCT_COUNT_RE.search(body_lower) else 0.0

    card_selector = (
        "[class*='product-card'], [class*='product-tile'], [class*='product-item'], "
        "[class*='product-grid-item'], [class*='grid-item'], [class*='collection-item']"
    )
    card_nodes = select(card_selector)
    total_cards = len(card_nodes)
    cards_with_price = 0
    for node in card_nodes:
        if _descendant_count(node, "[class*='price'], [class*='cost'], [class*='amount']") > 0:
            cards_with_price += 1
    f[85] = float(cards_with_price)
    f[86] = 1.0 if ("collectionpage" in body_lower or "productcollection" in body_lower) else 0.0
    f[87] = float(total_cards)
    f[88] = (cards_with_price / total_cards) if total_cards > 0 else 0.0

    return f
