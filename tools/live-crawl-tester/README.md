# @htmlwasher/live-crawl-tester

A polite, live-site end-to-end tester for [`trafilatura-alpha`](../../trafilatura-alpha). It fetches real URLs across all 7 page types, runs extraction plus page-type classification over the fetched HTML, and reports PASS/FAIL per URL.

This is a separate workspace package. It is **not** part of the offline `pnpm test` suite because it hits the network.

## Status

Scaffolded, not implemented. `src/index.ts` is a placeholder that logs a notice and exits. The full specification lives in [@/prompts/2026-6-24-init/prompt.md](../../prompts/2026-6-24-init/prompt.md) Section 7.

## What it does

- Fetches real URLs across all 7 page types (article, forum, product, collection, listing, documentation, service).
- Runs `trafilatura-alpha` extraction plus the page-type classifier over each fetched page.
- Reports PASS/FAIL per URL and a summary across page types.

## Not Crawlee / not Playwright

This is a plain HTTP fetcher built on `undici` — it does not use Crawlee, Playwright, or any headless browser. There is no JavaScript rendering; it fetches and processes static HTML only.

## Polite-crawler requirements

The implementation must be a well-behaved citizen of the live web:

- Honor each site's `robots.txt` (via `robots-parser`) before fetching any URL.
- Send a descriptive, identifying User-Agent string.
- Rate-limit to roughly 1 request per second per host.
- Keep concurrency low (at most 2 in-flight requests).
- Apply a request timeout with a small, bounded retry/backoff.
- Cache fetched HTML to disk (under `fixtures/`) so reruns avoid re-hitting the network.

## Configuration

URLs to test live in [`urls.json`](./urls.json), keyed by page type. See [SPEC.md](./SPEC.md) for the config shape.

## Usage

```bash
pnpm run test:live
# or
npm run test:live
```

This hits the network. Populate `urls.json` first.
