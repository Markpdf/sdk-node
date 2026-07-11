# AGENTS.md — @markpdf/sdk (Node.js / TypeScript)

Guidance for AI agents generating or modifying code that uses this SDK.

## What this is

TypeScript client for the markpdf HTTP API (`https://api.markpdf.tech`). Pure HTTP wrapper over native `fetch` — zero runtime dependencies. Works in Node 18+, edge runtimes (Vercel Edge, Cloudflare Workers) and the browser (for the upload methods).

## Layout

```
src/
  client.ts   # MarkpdfClient class — ALL logic lives here
  types.ts    # types: ConvertOptions, ConvertResult, Job, JsonResult, string enums
  errors.ts   # MarkpdfError hierarchy + errorForStatus()
  index.ts    # public re-exports — ALWAYS import from "@markpdf/sdk", not src/*
```

## Public surface

`MarkpdfClient`:
- `convertFile(data, filename, options)` → `POST /convert/raw` (raw bytes, fast path)
- `convertFormFile(file, options)` → `POST /convert` (multipart, for browser `File`/`Blob`)
- `convertFromUrl(url, filename, options)` → `POST /convert/from-url`
- `convertStream(source, options)` → `AsyncIterable<string>`, `POST /convert/stream[-from-url]`
- `pdfIndex(url, filename)` → `Promise<PdfIndexResult>`
- `getJob(jobId)` / `waitForJob(jobId, options)` → `Promise<Job>`

`apiKey` and `baseUrl` are **public readonly** properties on the client (not private) — on purpose, so wrapper SDKs (`@markpdf/react`, `@markpdf/svelte`) can build raw requests (e.g. `XMLHttpRequest` for upload progress) without duplicating the key.

## Rules when generating code with this SDK

1. **Always camelCase** in options (`inputFormat`, `imageOcr`, `outputUrl`), even though the HTTP API uses snake_case — `buildQuery()` handles the conversion internally.
2. **Don't invent options.** See `ConvertOptions` in `types.ts` for the exhaustive list.
3. **`ConvertResult` is a union:** `string | JsonResult | Job`. Check with `typeof result === "string"` or `"markdown" in result` before assuming the type.
4. **Catch `MarkpdfError`** (and its subclasses: `AuthenticationError`, `RateLimitError`, etc), not generic `fetch` errors.
5. **`convertFormFile` is for the browser** (`File`/`Blob` from an `<input>`). For Node.js with in-memory data, use `convertFile` with a `Buffer`/`Uint8Array`.
6. **Never hardcode the API key in code that runs in the browser.** If the project is Next.js, use `@markpdf/nextjs` to keep it server-side.

## Commands

```bash
npm install
npm run build   # tsup, emits dist/ esm+cjs+d.ts
npm test        # vitest
npm run lint     # tsc --noEmit
```

## Full reference

Public docs: https://docs.markpdf.tech/docs/sdks/nodejs
