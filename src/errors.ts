export class MarkpdfError extends Error {
  statusCode?: number;
  detail?: unknown;

  constructor(message: string, statusCode?: number, detail?: unknown) {
    super(message);
    this.name = "MarkpdfError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class BadRequestError extends MarkpdfError {}
export class AuthenticationError extends MarkpdfError {}
export class ForbiddenError extends MarkpdfError {}
export class PayloadTooLargeError extends MarkpdfError {}
export class UnsupportedFormatError extends MarkpdfError {}
export class UnprocessableEntityError extends MarkpdfError {}
export class RateLimitError extends MarkpdfError {}
export class ConversionError extends MarkpdfError {}
export class JobFailedError extends MarkpdfError {}

const STATUS_TO_ERROR: Record<number, new (message: string, statusCode?: number, detail?: unknown) => MarkpdfError> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: ForbiddenError,
  413: PayloadTooLargeError,
  415: UnsupportedFormatError,
  422: UnprocessableEntityError,
  429: RateLimitError,
  500: ConversionError,
};

export function errorForStatus(statusCode: number, detail: unknown): MarkpdfError {
  const ErrorClass = STATUS_TO_ERROR[statusCode] ?? MarkpdfError;
  const message =
    detail && typeof detail === "object" && "detail" in (detail as Record<string, unknown>)
      ? String((detail as Record<string, unknown>).detail)
      : typeof detail === "string"
        ? detail
        : `HTTP ${statusCode}`;
  return new ErrorClass(message, statusCode, detail);
}
