# Uploads, downloads, databases, S3 and R2

This guide describes a production architecture for large or sensitive document conversions. Adapt the examples to the framework and cloud provider used by your application.

## Recommended data flow

1. Authenticate the user before accepting work.
2. Validate filename, declared type and size at the application boundary.
3. Generate a random object key owned by the authenticated tenant; never use a raw user filename as the key.
4. Give the client a short-lived presigned `PUT` URL and upload directly to a private S3/R2 bucket.
5. Store only object metadata and conversion state in the database.
6. Give markpdf a short-lived signed input URL through `convertFromUrl`.
7. For large output, pass a signed `outputUrl` so markpdf writes Markdown directly to storage.
8. Update the database using an idempotent worker or webhook/polling process.
9. Authorize every download, then return a short-lived signed `GET` URL or stream the object through the application.
10. Delete expired uploads, abandoned multipart parts and temporary results with bucket lifecycle rules.

Direct-to-object-storage uploads avoid buffering large documents in application memory, reduce server bandwidth, and work better with serverless request-size/time limits.

## Private bucket defaults

- Disable public access and public listings.
- Enable TLS-only access.
- Encrypt objects at rest (provider-managed encryption is normally sufficient; use KMS only when its operational cost is justified).
- Keep separate buckets or prefixes for inputs, outputs and quarantine.
- Scope application credentials to the exact bucket/prefix and actions required. The browser receives presigned operations, never permanent S3/R2 credentials.
- Use CORS allowlists containing exact production origins and only required methods/headers.
- Prefer random keys such as `tenant/{tenantId}/documents/{uuid}/input.pdf`.
- Keep the original filename in sanitized metadata/database fields, not as an authorization mechanism.

## Presigned URL rules

Use short expirations: usually 5-15 minutes for upload and download, and only long enough for markpdf to fetch/write an object. Bind uploads to an exact key, method and content type/length where the provider supports it.

Do not store complete presigned URLs in the database. Store bucket, key, version/etag and expiry metadata; create a fresh URL after authorization. Query strings contain credentials and must be redacted from logs, traces, analytics and error reports.

For S3, use multipart upload for large documents and abort incomplete uploads. For R2, use its S3-compatible API with the account endpoint; do not assume every AWS-only feature is available. Keep provider-specific signing in your backend adapter.

## Database model

A compact PostgreSQL-style model:

```sql
create table document_conversions (
  id uuid primary key,
  tenant_id uuid not null,
  requested_by uuid not null,
  status text not null check (status in ('uploading','queued','processing','completed','failed','expired')),
  input_bucket text not null,
  input_key text not null,
  input_etag text,
  input_bytes bigint,
  input_sha256 text,
  output_bucket text,
  output_key text,
  output_etag text,
  options_hash text not null,
  provider_job_id text,
  error_code text,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  unique (tenant_id, input_sha256, options_hash)
);

create index document_conversions_tenant_created
  on document_conversions (tenant_id, created_at desc);

create index document_conversions_active_jobs
  on document_conversions (status, updated_at)
  where status in ('queued', 'processing');

create index document_conversions_expiry
  on document_conversions (expires_at)
  where status <> 'expired';
```

The deduplication constraint reuses a result only within the same tenant and for identical normalized conversion options. If SHA-256 cannot be known before upload, insert the upload row first and fill/deduplicate after object verification.

Keep Markdown in S3/R2, not in a frequently queried relational row. Large text values increase database storage, backups, replication traffic and cache pressure. Store a short preview only when the product genuinely needs it.

## Idempotency and state transitions

Create a server-generated conversion ID and use it as the idempotency key for the application. Update state conditionally so retries cannot move a completed job backwards:

```sql
update document_conversions
set status = 'processing', updated_at = now()
where id = $1 and tenant_id = $2 and status = 'queued';
```

Workers should claim jobs with `FOR UPDATE SKIP LOCKED` or a durable queue. Cap attempts, record a stable error code, and send exhausted jobs to a dead-letter workflow. Use jittered backoff for `429`, transient network errors and selected `5xx` responses; never retry deterministic validation failures.

## Cache keys

Build `options_hash` from a canonical serialization of every option that affects output: input format, mode, engine, OCR flags, cleaning, slim mode, page selection, response format and converter/API version. Sort keys, normalize omitted defaults, then hash. A cache key that ignores pages or OCR can return the wrong document.

Use the input object's verified checksum rather than filename, URL or ETag alone. Multipart S3 ETags are not always MD5 hashes; R2/provider behavior may also differ.

## Safe downloads

Authorize tenant and document ownership before signing or streaming. Use attachment responses with a sanitized filename and:

```http
Content-Disposition: attachment
Content-Type: text/markdown; charset=utf-8
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Content-Security-Policy: default-src 'none'; sandbox
Referrer-Policy: no-referrer
```

Use public caching only for intentionally public, immutable outputs. For private downloads, a CDN cache key must not accidentally ignore tenant authorization or signed query parameters.

## AI and RAG safety

Converted Markdown is untrusted document content. Delimit it separately from trusted instructions, label embedded instructions as data, and require independent policy checks before tool calls, URL fetches, code execution or disclosure. Preserve source object/version, page ranges and conversion options as provenance. Scan uploads when required by your threat model and quarantine suspicious documents before downstream use.

## Operational checklist

Track upload bytes, conversion latency, queue time, status counts, retry count, cache hit rate, storage bytes, egress and per-tenant usage. Alert on repeated authorization failures, unusual upload volume, stale processing rows and lifecycle deletion failures. Never attach document text or credential-bearing URLs to telemetry.
