# @markpdf/sdk

Official Node.js / TypeScript SDK for the [markpdf](https://markpdf.tech) API. Works in Node 18+, edge runtimes and (for upload helpers) the browser.

## Install

```bash
npm install @markpdf/sdk
```

## Quickstart

```ts
import { MarkpdfClient } from "@markpdf/sdk";
import { readFile } from "node:fs/promises";

const client = new MarkpdfClient({ apiKey: process.env.MARKPDF_API_KEY });

const data = await readFile("report.pdf");
const markdown = await client.convertFile(data, "report.pdf", { mode: "fast" });
console.log(markdown);
```

## Features

- `convertFile` (raw bytes, `/convert/raw`), `convertFormFile` (browser `File`, `/convert`), `convertFromUrl`, `convertStream`, `pdfIndex`.
- Automatic handling of `202` auto-queued jobs (`autoPoll: true` by default).
- Typed exceptions per HTTP status code (`AuthenticationError`, `RateLimitError`, ...).
- Full TypeScript types, zero runtime dependencies (uses native `fetch`).

Full documentation: https://docs.markpdf.tech
