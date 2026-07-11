# @markpdf/sdk

Official Node.js / TypeScript SDK for the [markpdf](https://markpdf.tech) API — convert PDF, DOCX, XLSX, PPTX, CSV, HTML and TXT into clean, LLM-ready Markdown.

markpdf is an HTTP conversion service built for speed and for feeding AI pipelines: a `fast` mode tuned for agents and RAG, `balanced`/`quality` modes when you need a stronger parse, an optional OCR path for scanned documents, and a compact structural index (`pdfIndex`) so an agent can navigate a huge PDF and pick which pages to convert instead of paying to convert it whole.

This package is a thin, fully-typed wrapper around that HTTP API. It is built directly on native `fetch` (works in Node 18+, Vercel Edge, Cloudflare Workers, and the browser for the upload helpers) and has **zero runtime dependencies** — no axios, no undici, no form-data polyfill. It does no conversion locally: all the PDF/OCR/Markdown work happens server-side, so this SDK stays tiny. It also does not manage retries, caching, or queuing beyond the optional job auto-poll described below — those are left to the caller.

## Table of contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Why markpdf](#why-markpdf)
- [Method reference](#method-reference)
- [Conversion options](#conversion-options)
- [Streaming](#streaming)
- [Error handling](#error-handling)
- [Auto-queued jobs (202)](#auto-queued-jobs-202)
- [Runtime notes](#runtime-notes)
- [Development](#development)
- [License](#license)

## Install

```bash
npm install @markpdf/sdk
```

Requires Node.js 18 or later (for native `fetch`), or any runtime/browser that provides a global `fetch`.

## Quickstart

```ts
import { MarkpdfClient } from "@markpdf/sdk";
import { readFile } from "node:fs/promises";

const client = new MarkpdfClient({ apiKey: process.env.MARKPDF_API_KEY });

const data = await readFile("report.pdf");
const markdown = await client.convertFile(data, "report.pdf", { mode: "fast" });
console.log(markdown);
```

By default the constructor reads `MARKPDF_API_KEY` from the environment, so you can also just do:

```ts
const client = new MarkpdfClient(); // picks up MARKPDF_API_KEY
```

## Why markpdf

- **Fast by default.** `mode: "fast"` (the default) is tuned for throughput — the right choice for agents and pipelines that just need clean text. `balanced` and `quality` trade speed for a stronger parse; `ultra_fast` and `auto` are also available.
- **No wasted tokens.** `slim: true` strips repeated headers/footers before the Markdown reaches your LLM, cutting the token count of the output.
- **Cheap navigation of huge PDFs.** `pdfIndex()` returns a compact structural map of a PDF (in a few KB) without converting it, so a RAG agent can pick exactly which `pages` to convert instead of paying to convert (and tokenize) the whole document.
- **Bring your own storage (BYOS).** `outputUrl` lets the API `PUT` the converted Markdown straight to your own pre-signed S3/R2/self-hosted URL instead of returning it inline — useful for very large outputs. Pair it with `outputHeadUrl` to let the API short-circuit the conversion on a cache hit.
- **Transparent auto-queue.** If the service is at capacity, a conversion request returns HTTP `202` with a `job_id` instead of failing outright. By default this SDK polls `/jobs/{id}` for you (`autoPoll: true`) and returns the final result once the job completes — you don't have to handle the 202 case yourself unless you want to.

## Method reference

All methods are on `MarkpdfClient`, sourced from `src/client.ts`:

| Method | Endpoint | Use for |
|---|---|---|
| `convertFile(data, filename, options?)` | `POST /convert/raw` | Bytes already in memory (`Buffer`/`Uint8Array`/`ArrayBuffer`/`Blob`) — the fastest path, no multipart overhead |
| `convertFormFile(file, options?)` | `POST /convert` | Browser `File`/`Blob`, e.g. from `<input type="file">` (multipart/form-data) |
| `convertFromUrl(url, filename?, options?)` | `POST /convert/from-url` | Document already in storage (S3/R2/Supabase/self-hosted) — the server downloads it itself, no raw-upload size limit |
| `convertStream(source, options?)` | `POST /convert/stream` or `/convert/stream-from-url` | Progressive Markdown output as an `AsyncIterable<string>`, for large documents. `source` is either `{ data, filename }` or `{ url, filename? }` |
| `pdfIndex(url, filename?)` | `POST /pdf/index` | Compact structural map of a PDF, without converting it |
| `getJob(jobId)` | `GET /jobs/{id}` | Fetch the current status of an auto-queued (202) conversion |
| `waitForJob(jobId, options?)` | `GET /jobs/{id}` (polled) | Block until a queued job reaches `completed` or `failed` |

`apiKey` and `baseUrl` are exposed as **public readonly** properties on the client (not private), so wrapper SDKs (`@markpdf/react`, `@markpdf/svelte`, etc.) can build raw requests without duplicating the key.

## Conversion options

`convertFile`, `convertFormFile`, and `convertFromUrl` all accept the same `ConvertOptions` (defined in `src/types.ts`). Field names are camelCase; the SDK translates them to the API's snake_case query/body params internally:

```ts
await client.convertFile(data, "report.pdf", {
  inputFormat: "auto",       // auto | pdf | docx | csv | txt | html | xlsx | pptx | zip
  mode: "fast",              // fast | ultra_fast | balanced | quality | auto
  engine: "auto",            // auto | pymupdf | pdf_oxide
  clean: true,                // strip repeated headers/footers and control chars
  ocr: false,                 // OCR in balanced mode, for scanned PDFs
  imageOcr: false,            // OCR only image regions, not the whole page
  hybridOcr: false,           // full-page OCR only on pages with no native text
  responseFormat: "markdown", // markdown | json
  slim: false,                // cut tokens further before handing text to an LLM
  pages: undefined,           // e.g. "1,3,5-10" — PDF only
  outputUrl: undefined,       // pre-signed PUT URL to upload the result to your own storage (BYOS)
  outputEncoding: "identity", // identity | gzip | zstd — only sent when outputUrl is set
  outputHeadUrl: undefined,   // pre-signed HEAD URL to short-circuit on a cache hit
  autoPoll: true,             // transparently wait out a 202 auto-queue
  pollIntervalMs: 5000,       // polling interval used by autoPoll / waitForJob
});
```

`responseFormat: "json"` returns a `JsonResult` (`{ filename, input_format, markdown, engine, size_bytes, markdown_bytes, token_saved_estimate?, timings }`) instead of a plain Markdown string. Because `ConvertResult` is a union (`string | JsonResult | Job`), narrow it before use, e.g. `typeof result === "string"` or `"markdown" in result`.

`convertStream` takes a smaller `StreamOptions` (`filename`, `inputFormat`, `mode`, `clean`, `slim`) — it doesn't support `outputUrl`/`autoPoll` since it streams the response directly.

## Streaming

```ts
for await (const chunk of client.convertStream({ data, filename: "report.pdf" }, { mode: "fast" })) {
  process.stdout.write(chunk);
}
```

Or stream a remote file by URL instead of local bytes:

```ts
for await (const chunk of client.convertStream({ url: "https://storage.example.com/signed/report.pdf" })) {
  process.stdout.write(chunk);
}
```

## Error handling

Every non-2xx response raises a typed exception, all inheriting from `MarkpdfError` (with `.statusCode` and `.detail`), defined in `src/errors.ts`:

```ts
import { MarkpdfClient, MarkpdfError, RateLimitError, ConversionError } from "@markpdf/sdk";

const client = new MarkpdfClient();

try {
  const markdown = await client.convertFile(data, "report.pdf");
} catch (err) {
  if (err instanceof RateLimitError) {
    // back off and retry
  } else if (err instanceof ConversionError) {
    // retry with mode: "balanced"
  } else if (err instanceof MarkpdfError) {
    console.error(`Conversion failed (${err.statusCode}): ${err.message}`);
  } else {
    throw err; // network/transport error, not an API error
  }
}
```

| Exception | HTTP status | Meaning |
|---|---|---|
| `BadRequestError` | 400 | Malformed body or URL |
| `AuthenticationError` | 401 | Missing/invalid API key |
| `ForbiddenError` | 403 | Unauthorized access or disallowed URL host |
| `PayloadTooLargeError` | 413 | Document too large / too many pages |
| `UnsupportedFormatError` | 415 | Unsupported format or `Content-Encoding` |
| `UnprocessableEntityError` | 422 | Missing required parameters |
| `RateLimitError` | 429 | Too many requests — retry with backoff |
| `ConversionError` | 500 | Conversion failed — try another `mode` |
| `JobFailedError` | — | An auto-queued job (202) ended with `status: "failed"` |

Only retry `RateLimitError` and 5xx errors with exponential backoff; other 4xx errors won't be fixed by retrying.

## Auto-queued jobs (202)

When the service is at capacity, a conversion request can return HTTP `202` with a `job_id` instead of a completed result. **This SDK auto-polls by default**: every `convertFile`/`convertFormFile`/`convertFromUrl` call has `autoPoll: true` by default, so a 202 response is transparently followed by polling `GET /jobs/{id}` (via `waitForJob`) until the job reaches `completed` or `failed`, and the method's promise only resolves once you have the final result. `convertStream` does not go through this path since it streams the response body directly.

To handle the queue yourself instead, pass `autoPoll: false` and use `getJob`/`waitForJob` directly:

```ts
const result = await client.convertFile(data, "report.pdf", { autoPoll: false });

if (typeof result === "string" || "markdown" in result) {
  // completed immediately
  console.log(result);
} else {
  // result is a Job — poll or wait manually
  const job = await client.waitForJob(result.job_id, { pollIntervalMs: 5000, timeoutMs: 120_000 });
  console.log(job.body);
}
```

`waitForJob` throws `JobFailedError` if the job ends with `status: "failed"`, and a plain `Error` if `timeoutMs` elapses before the job finishes.

## Runtime notes

- Works on Node 18+, edge runtimes (Vercel Edge, Cloudflare Workers) and the browser — all built on native `fetch`, with no polyfills bundled.
- On a runtime without a global `fetch` (e.g. Node <18), pass `{ fetch: myFetchPolyfill }` to the `MarkpdfClient` constructor instead of assuming one exists.
- `convertFormFile` is meant for the browser (`File`/`Blob` from an `<input>`). In Node.js, with data already in memory, use `convertFile` with a `Buffer`/`Uint8Array` instead.
- Never hardcode the API key in code that runs in the browser. If the project is Next.js, use `@markpdf/nextjs` to keep the key server-side.
- For many parallel conversions, use `Promise.all`/`Promise.allSettled` — the client does not serialize or queue requests internally.

## Development

```bash
npm install
npm run build   # tsup src/index.ts --format esm,cjs --dts -> dist/ (esm+cjs+d.ts)
npm test        # vitest run
npm run lint    # tsc --noEmit
```

See `AGENTS.md` and `SKILL.md` in this repo for guidance aimed at AI coding agents working with this SDK, and https://docs.markpdf.tech/docs/sdks/nodejs for the full public docs.

## License

MIT

## Security and AI-agent checklist

- Keep private keys in environment variables or a secret manager; browser code cannot keep them secret.
- Validate upload size/type at your application boundary and protect public routes with authentication, per-user quotas, rate limits and deadlines.
- Use short-lived signed HTTPS URLs and redact their query strings from logs.
- Treat converted Markdown as untrusted data: escape it before HTML rendering and prevent prompt-injection content from overriding agent policy or authorizing tools.
- Retry only `429`, transient network errors and selected `5xx` responses with bounded exponential backoff and jitter.

For implementation constraints and exact public methods, read [`AGENTS.md`](./AGENTS.md) and [`SKILL.md`](./SKILL.md). The full operational checklist is in [`SECURITY.md`](./SECURITY.md).

## S3/R2 uploads, downloads and database optimization

For production workloads, upload large files directly from the client to a private S3 or Cloudflare R2 bucket with a short-lived presigned `PUT` URL. Then call this SDK's URL-conversion method so the application server never buffers the full document. Large Markdown results can be written straight back to object storage with the SDK's output URL option where supported.

Recommended flow:

1. Authenticate and authorize the user.
2. Create a database row with a server-generated conversion ID and `uploading` status.
3. Generate a random tenant-scoped object key and a short-lived presigned upload URL.
4. Upload directly to private storage and verify object size/checksum server-side.
5. Reuse a completed conversion only when tenant, input SHA-256 and canonical options hash all match.
6. Convert from a signed input URL; use a signed output URL for large results.
7. Store status and object metadata in the database, while keeping large Markdown bodies in S3/R2.
8. Authorize downloads and return a short-lived signed `GET` URL or a hardened attachment response.
9. Expire temporary objects, abandoned multipart uploads and stale database rows automatically.

Do not use filenames, object URLs or multipart ETags as content identity. Use a verified checksum, normalize every output-affecting conversion option into the cache key, and isolate deduplication by tenant. Keep database indexes focused on tenant history, active jobs and expiry cleanup.

See [`STORAGE.md`](./STORAGE.md) for the full SQL model, partial indexes, idempotent state transitions, cache-key rules, S3/R2 permissions, CORS, multipart uploads, lifecycle policies, secure download headers and AI/RAG protections.
