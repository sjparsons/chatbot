import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

export type GatewayErrorCode =
  | "refusal"
  | "aborted"
  | "timeout"
  | "rate_limit"
  | "overloaded"
  | "auth"
  | "invalid_request"
  | "upstream"
  | "unknown";

/**
 * Codes where the same request might succeed against a different model.
 * `auth` and `invalid_request` are ours to fix, and a `refusal` is a decision
 * rather than a failure — retrying any of them just burns time.
 */
const RETRYABLE = new Set<GatewayErrorCode>([
  "timeout",
  "rate_limit",
  "overloaded",
  "upstream",
]);

export interface GatewayErrorOptions {
  retryable?: boolean;
  status?: number;
  model?: string;
  cause?: unknown;
}

/**
 * One error type across every provider, so callers branch on `code` rather
 * than on whatever the SDK happened to throw.
 */
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  /** Whether trying a different model could plausibly succeed. */
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly model: string | undefined;

  constructor(
    code: GatewayErrorCode,
    message: string,
    options: GatewayErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GatewayError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.status = options.status;
    this.model = options.model;
  }
}

/**
 * Translates whatever the provider SDK threw into a `GatewayError`.
 *
 * Order matters: `APIConnectionTimeoutError` extends `APIConnectionError`,
 * which extends `APIError`, so the specific classes have to be tested first.
 */
export function mapProviderError(error: unknown, model: string): GatewayError {
  if (error instanceof GatewayError) return error;

  const at = { model, cause: error };

  if (error instanceof APIUserAbortError) {
    return new GatewayError("aborted", "request aborted", at);
  }

  // A caller-supplied AbortSignal can surface as a DOMException rather than
  // the SDK's own class, depending on where the abort lands.
  if (error instanceof Error && error.name === "AbortError") {
    return new GatewayError("aborted", "request aborted", at);
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new GatewayError("timeout", "provider request timed out", at);
  }

  if (error instanceof APIConnectionError) {
    return new GatewayError(
      "upstream",
      `could not reach the provider: ${error.message}`,
      at,
    );
  }

  if (error instanceof RateLimitError) {
    return new GatewayError("rate_limit", "provider rate limit exceeded", {
      ...at,
      status: error.status,
    });
  }

  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return new GatewayError("auth", "provider rejected the credentials", {
      ...at,
      status: error.status,
    });
  }

  // 404 is almost always a bad model id, which is a config bug on our side.
  if (error instanceof BadRequestError || error instanceof NotFoundError) {
    return new GatewayError("invalid_request", error.message, {
      ...at,
      status: error.status,
    });
  }

  if (error instanceof InternalServerError) {
    // 529 is the provider telling us it is overloaded, not that it broke.
    const code = error.status === 529 ? "overloaded" : "upstream";
    return new GatewayError(code, `provider error (${error.status})`, {
      ...at,
      status: error.status,
    });
  }

  if (error instanceof APIError) {
    return new GatewayError("upstream", error.message, {
      ...at,
      status: error.status,
    });
  }

  return new GatewayError(
    "unknown",
    error instanceof Error ? error.message : String(error),
    at,
  );
}
