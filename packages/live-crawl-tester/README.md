# @htmlwasher/live-crawl-tester

An OPTIONAL, OUT-OF-BRIEF scaffold for a hypothetical polite, live-site end-to-end tester for [`htmlwasher`](../htmlwasher). If implemented, it would fetch real URLs across all 7 page types, run extraction plus page-type classification over the fetched HTML, and report PASS/FAIL per URL.

This is a separate workspace package. It is **not** part of the offline `pnpm test` suite because it would hit the network. The brief's delivered E2E tester is the OFFLINE [`packages/wash-corpus-tester`](../wash-corpus-tester) (Phase 8 / Section 7) — not this package.

## Status

Out-of-brief, not implemented. `src/index.ts` is a placeholder that logs a notice and exits. The build brief does not ask for a network fetcher in this repo; the offline E2E deliverable is [`packages/wash-corpus-tester`](../wash-corpus-tester). See [@/prompts/2026-6-24-init/prompt.md](../../prompts/2026-6-24-init/prompt.md) Section 7 and Phase 8.

## What it does

- Fetches real URLs across all 7 page types (article, forum, product, collection, listing, documentation, service).
- Runs `htmlwasher` extraction plus the page-type classifier over each fetched page.
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
