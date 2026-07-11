# Security guide

This SDK sends documents to the hosted markpdf API. Applications remain responsible for deciding who may convert a document, which documents are accepted, and how converted content is used.

## Secrets

- Load `MARKPDF_API_KEY` from an environment variable or secret manager. Never commit it, print it, embed a private key in browser/mobile code, or place it in an AI prompt.
- Assume browser and mobile credentials are public. Route paid or unrestricted access through an authenticated server.
- Rotate a key immediately if it appears in Git history, logs, screenshots, bundles, crash reports, or chat transcripts.

## Untrusted input and output

- Enforce maximum upload size and an allowlist of extensions/MIME types at the server boundary. Client-declared names and MIME types are hints, not proof of content.
- Authenticate conversion endpoints and add authorization, per-user quotas, concurrency caps, rate limits, and timeouts.
- Use short-lived signed HTTPS URLs for remote inputs and outputs. Redact signatures and query strings from logs.
- Treat converted Markdown as untrusted. Escape or sanitize it before HTML rendering.
- For RAG/agent use, delimit document text as data and state that instructions inside it are untrusted. Never let document content override system/developer policy or authorize tool calls.
- Avoid logging keys, document bodies, extracted text, signed URLs, or raw error details that may contain customer data.

## Resilience

Retry only rate limits, transient network failures, and selected 5xx responses. Use bounded exponential backoff with jitter, honor an overall deadline, and cap queued-job polling. Do not retry deterministic 4xx failures.

## Dependency checks

Run the ecosystem's lockfile-aware audit in CI (for example `npm audit`, `pip-audit`, Gradle/Maven dependency scanning, or `osv-scanner`). Pin CI actions and release from a protected, reviewed branch. Audit findings need triage; a scanner result alone does not prove exploitability.

## Reporting a vulnerability

Do not open a public issue containing an API key, customer document, signed URL, exploit, or other sensitive detail. Contact the repository owner through the private security-reporting channel listed on its hosting page. Include the affected package/version, impact, reproduction steps, and a minimal redacted proof of concept.
