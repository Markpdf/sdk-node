export type InputFormat = "auto" | "pdf" | "docx" | "csv" | "txt" | "html" | "xlsx" | "pptx" | "zip";
export type Mode = "fast" | "ultra_fast" | "balanced" | "quality" | "auto";
export type Engine = "auto" | "pymupdf" | "pdf_oxide";
export type ResponseFormat = "markdown" | "json";
export type OutputEncoding = "identity" | "gzip" | "zstd";
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface ConvertOptions {
  inputFormat?: InputFormat;
  mode?: Mode;
  engine?: Engine;
  clean?: boolean;
  ocr?: boolean;
  imageOcr?: boolean;
  hybridOcr?: boolean;
  responseFormat?: ResponseFormat;
  slim?: boolean;
  /** 1-based page ranges, PDF only. Example: "1,3,5-10". */
  pages?: string;
  /** Pre-signed PUT URL. If set, the API uploads the Markdown there (BYOS). */
  outputUrl?: string;
  outputEncoding?: OutputEncoding;
  /** Pre-signed HEAD URL to short-circuit on a cache hit. */
  outputHeadUrl?: string;
  /** Auto-poll `/jobs/{id}` when the API returns 202. Default true. */
  autoPoll?: boolean;
  pollIntervalMs?: number;
}

export interface StreamOptions {
  filename?: string;
  inputFormat?: InputFormat;
  mode?: Mode;
  clean?: boolean;
  slim?: boolean;
}

export interface JsonResult {
  filename: string;
  input_format: string;
  markdown: string;
  engine: string;
  size_bytes: number;
  markdown_bytes: number;
  token_saved_estimate?: number;
  timings: Record<string, number>;
}

export interface Job {
  job_id: string;
  status: JobStatus;
  body?: string | JsonResult;
  error?: string;
  created_at?: number;
  started_at?: number;
  completed_at?: number;
  failed_at?: number;
  http_status?: number;
}

export type ConvertResult = string | JsonResult | Job;

export interface PdfIndexResult {
  ok: boolean;
  filename: string;
  [key: string]: unknown;
}
