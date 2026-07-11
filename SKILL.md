---
name: markpdf-nodejs
description: Best practices for @markpdf/sdk (Node.js/TypeScript). Use when writing code that imports "@markpdf/sdk" — method choice, error handling/retry, streaming, API key safety, edge runtime usage.
---

# Best practices — @markpdf/sdk (Node.js / TypeScript)

## Choosing the right method

| Situation | Method |
|---|---|
| Bytes in memory / `Buffer` | `convertFile(data, filename)` → `/convert/raw`, the fast path |
| Browser `File`/`Blob` (`<input type="file">`) | `convertFormFile(file)` → `/convert` multipart |
| Document already in storage (S3/R2/self-hosted) | `convertFromUrl(url)` — no raw-upload limit |
| Progressive feedback on large documents | `convertStream(...)` — `for await (const chunk of ...)` |

## Error handling and retry

```ts
import { RateLimitError, ConversionError, MarkpdfError } from "@markpdf/sdk";

try {
  const result = await client.convertFile(data, filename);
} catch (err) {
  if (err instanceof RateLimitError) {
    await sleep(backoffMs);
    // retry
  } else if (err instanceof ConversionError) {
    // retry with mode: "balanced"
  } else if (err instanceof MarkpdfError) {
    console.error(err.statusCode, err.message);
    throw err;
  } else {
    throw err; // network/transport error, not an API error
  }
}
```

- Only retry `RateLimitError` (429) and 5xx with exponential backoff. 4xx (other than 429) won't be fixed by retrying.
- `MarkpdfError` is the base — use `instanceof` with the specific subclass when the flow needs to differ, don't compare `err.statusCode === 429` by hand when `RateLimitError` already exists.

## Runtime and environment

- Works on Node 18+, edge runtimes (Vercel Edge, Cloudflare Workers) and the browser — uses native `fetch`, no polyfills.
- On runtimes without global `fetch` (Node <18), pass `{ fetch: myFetchPolyfill }` to the constructor instead of assuming it exists.
- **Never** instantiate `MarkpdfClient` with the API key in a component that renders in the browser if the key must stay private — use `@markpdf/nextjs` or proxy through your own backend.

## Performance

- `mode: "fast"` (default) for the general case. Only escalate to `"balanced"`/`"quality"` if output quality warrants it.
- `slim: true` cuts tokens if the Markdown is fed to an LLM.
- For many parallel conversions, use `Promise.all`/`Promise.allSettled` — the client doesn't serialize requests internally.

## Resources

- Docs: https://docs.markpdf.tech/docs/sdks/nodejs
- See `AGENTS.md` in this folder for the exact API surface.
