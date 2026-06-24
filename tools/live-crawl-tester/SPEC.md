# SPEC — @htmlwasher/live-crawl-tester

Status: pending / not implemented. This document describes the intended behavior of the live-crawl tester. The current `src/index.ts` is a placeholder.

## Purpose

End-to-end validation of [`trafilatura-alpha`](../../trafilatura-alpha) against real websites. The tester fetches live URLs across all 7 page types, runs extraction plus the page-type classifier over the fetched HTML, and reports PASS/FAIL per URL with a per-page-type summary.

It is a separate workspace package and is **not** run by the offline `pnpm test` suite, because it performs network requests.

## Page types

The tester covers all 7 page types the classifier distinguishes:

- `article`
- `forum`
- `product`
- `collection`
- `listing`
- `documentation`
- `service`

## Polite fetcher (intended)

- Plain HTTP via `undici` — no Crawlee, no Playwright, no headless browser, no JS rendering.
- Honor `robots.txt` (via `robots-parser`) before fetching any URL.
- Descriptive, identifying User-Agent.
- Rate limit to about 1 request per second per host.
- Concurrency capped at 2 in-flight requests.
- Request timeout with bounded retry/backoff.
- Cache fetched HTML to disk under `fixtures/` so reruns avoid re-fetching.

## Config shape — `urls.json`

A JSON object keyed by the 7 page types. Each key maps to an array of URL strings. Each page type should list **at least 3** real URLs.

```json
{
  "article": ["https://example.com/a-news-article", "..."],
  "forum": ["..."],
  "product": ["..."],
  "collection": ["..."],
  "listing": ["..."],
  "documentation": ["..."],
  "service": ["..."]
}
```

Aim for variety in sources. Consider including multilingual / Czech / EU sources alongside English ones, so extraction and classification are exercised beyond a single language and locale.

## Output (intended)

- Per-URL PASS/FAIL with the classified page type and extraction outcome.
- Per-page-type summary tallying passes and failures.
- Non-zero exit code when any URL fails (once implemented).

## Reference

Full specification: [@/prompts/2026-6-24-init/prompt.md](../../prompts/2026-6-24-init/prompt.md) Section 7.
