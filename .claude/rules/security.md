# Security Guidelines

- Treat all fetched/scraped HTML as untrusted: never `eval`, never feed into a templating engine without escaping, sanitize before downstream use
- No secrets in logs — `pino` (TypeScript) and standard `logging` (Python) with redaction filters; never log full request bodies, tokens, or credentials
- Bound resource use: `AbortController` and `p-limit` on the TypeScript side; explicit timeouts on every network request in the live-crawl fetcher (and on Python training I/O)
- Validate input early at every boundary: zod schema in TypeScript; typed/validated input in Python (e.g. dataclasses or explicit checks)
- Respect target sites' robots.txt and Terms of Service; the live-crawl-tester must honor robots.txt and rate-limit every host
- No `.env*` files in the repo — secrets come from the environment, never committed
