import { errorForStatus, JobFailedError } from "./errors.js";
import type {
  ConvertOptions,
  ConvertResult,
  Job,
  JsonResult,
  PdfIndexResult,
  StreamOptions,
} from "./types.js";

export interface MarkpdfClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch). Useful for Node <18 polyfills. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.markpdf.tech";

function buildQuery(options: ConvertOptions & { filename?: string }): string {
  const params = new URLSearchParams();
  const map: Record<string, unknown> = {
    filename: options.filename,
    input_format: options.inputFormat ?? "auto",
    mode: options.mode ?? "fast",
    engine: options.engine ?? "auto",
    clean: options.clean ?? true,
    ocr: options.ocr ?? false,
    image_ocr: options.imageOcr ?? false,
    hybrid_ocr: options.hybridOcr ?? false,
    response_format: options.responseFormat ?? "markdown",
    slim: options.slim ?? false,
    pages: options.pages,
    output_url: options.outputUrl,
    output_encoding: options.outputUrl ? (options.outputEncoding ?? "identity") : undefined,
    output_head_url: options.outputHeadUrl,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return params.toString();
}

async function parseConversionResponse(res: Response): Promise<ConvertResult> {
  if (res.status === 202) {
    return (await res.json()) as Job;
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status >= 400) {
    const detail = contentType.includes("application/json") ? await res.json() : await res.text();
    throw errorForStatus(res.status, detail);
  }
  if (contentType.includes("application/json")) {
    return (await res.json()) as JsonResult;
  }
  return res.text();
}

/**
 * Client for the markpdf (Flash PDF to Markdown) API.
 *
 * ```ts
 * const client = new MarkpdfClient({ apiKey: process.env.MARKPDF_API_KEY });
 * const markdown = await client.convertFile(buffer, "report.pdf", { mode: "fast" });
 * ```
 */
export class MarkpdfClient {
  /** Configured API key. Exposed read-only for wrapper SDKs (e.g. @markpdf/react) that need to build raw requests. */
  readonly apiKey: string;
  /** Configured base URL, trailing slash stripped. */
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MarkpdfClientOptions = {}) {
    const apiKey = options.apiKey ?? (typeof process !== "undefined" ? process.env?.MARKPDF_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("Missing API key. Pass { apiKey } or set MARKPDF_API_KEY.");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available. Pass { fetch } explicitly.");
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "x-api-key": this.apiKey, ...extra };
  }

  private async maybePoll(result: ConvertResult, options: ConvertOptions): Promise<ConvertResult> {
    const autoPoll = options.autoPoll ?? true;
    if (autoPoll && typeof result === "object" && result !== null && "job_id" in result) {
      return this.waitForJob((result as Job).job_id, { pollIntervalMs: options.pollIntervalMs });
    }
    return result;
  }

  /** Upload raw bytes via `POST /convert/raw` (fastest path, no multipart overhead). */
  async convertFile(
    data: Blob | Uint8Array | ArrayBuffer,
    filename: string,
    options: ConvertOptions & { contentType?: string } = {},
  ): Promise<ConvertResult> {
    const query = buildQuery({ ...options, filename });
    const res = await this.fetchImpl(`${this.baseUrl}/convert/raw?${query}`, {
      method: "POST",
      headers: this.headers({ "content-type": options.contentType ?? "application/octet-stream" }),
      body: data as BodyInit,
    });
    const result = await parseConversionResponse(res);
    return this.maybePoll(result, options);
  }

  /** Upload a `File`/`Blob` via `POST /convert` (multipart/form-data). Useful for `<input type="file">`. */
  async convertFormFile(file: File | Blob, options: ConvertOptions & { filename?: string } = {}): Promise<ConvertResult> {
    const form = new FormData();
    const filename = options.filename ?? (file instanceof File ? file.name : "document");
    form.append("file", file, filename);
    const query = buildQuery(options);
    const res = await this.fetchImpl(`${this.baseUrl}/convert?${query}`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    const result = await parseConversionResponse(res);
    return this.maybePoll(result, options);
  }

  /** Convert a document the API fetches itself from a pre-signed URL via `POST /convert/from-url`. */
  async convertFromUrl(url: string, filename?: string, options: ConvertOptions = {}): Promise<ConvertResult> {
    const body = {
      url,
      filename,
      input_format: options.inputFormat ?? "auto",
      mode: options.mode ?? "fast",
      engine: options.engine ?? "auto",
      clean: options.clean ?? true,
      ocr: options.ocr ?? false,
      image_ocr: options.imageOcr ?? false,
      hybrid_ocr: options.hybridOcr ?? false,
      response_format: options.responseFormat ?? "markdown",
      slim: options.slim ?? false,
      pages: options.pages,
      output_url: options.outputUrl,
      output_encoding: options.outputUrl ? (options.outputEncoding ?? "identity") : undefined,
      output_head_url: options.outputHeadUrl,
    };
    const res = await this.fetchImpl(`${this.baseUrl}/convert/from-url`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const result = await parseConversionResponse(res);
    return this.maybePoll(result, options);
  }

  /**
   * Stream a conversion progressively. Pass exactly one of `data` (local bytes,
   * uses `/convert/stream`) or `url` (remote file, uses `/convert/stream-from-url`).
   */
  async *convertStream(
    source: { data: Blob | Uint8Array | ArrayBuffer; filename: string } | { url: string; filename?: string },
    options: StreamOptions = {},
  ): AsyncIterable<string> {
    const params = new URLSearchParams();
    if (options.filename) params.set("filename", options.filename);
    params.set("input_format", options.inputFormat ?? "auto");
    params.set("mode", options.mode ?? "fast");
    params.set("clean", String(options.clean ?? true));
    params.set("slim", String(options.slim ?? false));

    let res: Response;
    if ("data" in source) {
      params.set("filename", source.filename);
      res = await this.fetchImpl(`${this.baseUrl}/convert/stream?${params.toString()}`, {
        method: "POST",
        headers: this.headers(),
        body: source.data as BodyInit,
      });
    } else {
      res = await this.fetchImpl(`${this.baseUrl}/convert/stream-from-url`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          url: source.url,
          filename: source.filename,
          input_format: options.inputFormat ?? "auto",
          mode: options.mode ?? "fast",
          clean: options.clean ?? true,
          slim: options.slim ?? false,
        }),
      });
    }

    if (res.status >= 400) {
      const contentType = res.headers.get("content-type") ?? "";
      const detail = contentType.includes("application/json") ? await res.json() : await res.text();
      throw errorForStatus(res.status, detail);
    }
    if (!res.body) {
      yield await res.text();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  }

  /** Fetch a compact structural index of a PDF (`POST /pdf/index`) without converting it. */
  async pdfIndex(url: string, filename?: string): Promise<PdfIndexResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/pdf/index`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ url, filename }),
    });
    if (res.status >= 400) {
      throw errorForStatus(res.status, await res.json().catch(() => ({})));
    }
    return res.json();
  }

  /** Poll the status of an auto-queued conversion (`GET /jobs/{id}`). */
  async getJob(jobId: string): Promise<Job> {
    const res = await this.fetchImpl(`${this.baseUrl}/jobs/${jobId}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status >= 400) {
      throw errorForStatus(res.status, await res.json().catch(() => ({})));
    }
    return res.json();
  }

  /** Block until a queued job reaches `completed` or `failed`. */
  async waitForJob(jobId: string, options: { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<Job> {
    const pollIntervalMs = options.pollIntervalMs ?? 5000;
    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : undefined;
    while (true) {
      const job = await this.getJob(jobId);
      if (job.status === "completed") return job;
      if (job.status === "failed") throw new JobFailedError(job.error ?? "Job failed", undefined, job);
      if (deadline && Date.now() >= deadline) {
        throw new Error(`Job ${jobId} did not finish within ${options.timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
