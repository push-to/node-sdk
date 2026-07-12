// Typed error catalog (Contract §5.6). Every method rejects with one of
// these — never a raw fetch/DOM exception. Unlike @push-to/web (which keys
// its typed errors on a separate SDK-local `.code`), the base class here
// overrides the native `Error.name` with the WIRE `error.name` value
// (e.g. `'invalid_token'`) — the Contract's base-field list (`{ name;
// type?; docsUrl?; statusCode; requestId?; message }`) mirrors the wire
// envelope's own error object field-for-field, so `err.name` is branchable
// exactly like the raw API's `error.name` documented in the Error
// Reference, while `instanceof InvalidTokenError` gives the typed
// ergonomic path.

/** One entry per invalid field — only present on `ValidationError` (422). */
export interface PushToErrorDetail {
  message: string;
  [key: string]: unknown;
}

export interface PushToErrorOptions {
  /** HTTP status of the response this error was built from, when known. */
  statusCode?: number;
  /** Coarse category from the edge catalog (`authentication`/`validation`/…). */
  type?: string;
  /** Resolvable link into the Error Reference for this `name`. */
  docsUrl?: string;
  /** `error.errorId` — present on `500`/`504` responses. Quote it in support requests. */
  requestId?: string;
  /** The underlying cause (a caught fetch/network error), preserved for debugging. */
  cause?: unknown;
}

/** Base class for every error the SDK throws. `.name` is the wire `error.name`. */
export class PushToError extends Error {
  readonly statusCode?: number;
  readonly type?: string;
  readonly docsUrl?: string;
  readonly requestId?: string;

  constructor(name: string, message: string, options: PushToErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    // Keep `instanceof` working across subclasses regardless of transpile target.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = name;
    this.statusCode = options.statusCode;
    this.type = options.type;
    this.docsUrl = options.docsUrl;
    this.requestId = options.requestId;
  }
}

/** 401 — missing, malformed, or rejected API key. */
export class InvalidTokenError extends PushToError {
  constructor(message: string, options: PushToErrorOptions = {}) {
    super('invalid_token', message, { statusCode: 401, ...options });
  }
}

/** 403 — the key is valid but lacks the route's required permission (`admin`/`sending`/`reseller`). */
export class InsufficientPermissionsError extends PushToError {
  constructor(message: string, options: PushToErrorOptions = {}) {
    super('insufficient_permissions', message, { statusCode: 403, ...options });
  }
}

/** 404 — unknown path/resource, or an opaque ownership miss. */
export class NotFoundError extends PushToError {
  constructor(message: string, options: PushToErrorOptions = {}) {
    super('not_found', message, { statusCode: 404, ...options });
  }
}

/** 400/422 — request body failed edge-side Zod validation. Carries `details[]`. */
export class ValidationError extends PushToError {
  readonly details?: PushToErrorDetail[];

  constructor(
    message: string,
    options: PushToErrorOptions & { details?: PushToErrorDetail[] } = {},
  ) {
    super('validation_error', message, { statusCode: 422, ...options });
    this.details = options.details;
  }
}

/** 400 — the local `Idempotency-Key` charset/length check (or the edge's own) failed. */
export class InvalidIdempotencyKeyError extends PushToError {
  constructor(message: string, options: PushToErrorOptions = {}) {
    super('invalid_idempotency_key', message, { statusCode: 400, ...options });
  }
}

/**
 * 409 — either `idempotency_conflict` (same key, different body) or
 * `concurrent_idempotent_requests` (same key, still in flight). Both wire
 * names map to this one class; the actual name is preserved on `.name`.
 */
export class IdempotencyConflictError extends PushToError {
  constructor(
    name: 'idempotency_conflict' | 'concurrent_idempotent_requests',
    message: string,
    options: PushToErrorOptions = {},
  ) {
    super(name, message, { statusCode: 409, ...options });
  }
}

/** 429 — the tenant's per-month send quota is exhausted. Carries `retryAfter` (seconds). */
export class MonthlyQuotaExceededError extends PushToError {
  readonly retryAfter?: number;

  constructor(message: string, options: PushToErrorOptions & { retryAfter?: number } = {}) {
    super('monthly_quota_exceeded', message, { statusCode: 429, ...options });
    this.retryAfter = options.retryAfter;
  }
}

/** 429 — reserved for an optional future short-window cap. Not emitted today; mapped defensively. */
export class RateLimitError extends PushToError {
  readonly retryAfter?: number;

  constructor(message: string, options: PushToErrorOptions & { retryAfter?: number } = {}) {
    super('rate_limit_exceeded', message, { statusCode: 429, ...options });
    this.retryAfter = options.retryAfter;
  }
}

/** 504 — the proxy's own upstream timeout, or a client-side request timeout (`timeoutMs`). */
export class GatewayTimeoutError extends PushToError {
  constructor(message: string, options: PushToErrorOptions = {}) {
    super('gateway_timeout', message, { statusCode: 504, ...options });
  }
}

/** True for a locally-classified error the SDK considers safe to retry (network/5xx/timeout). */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof PushToError) {
    return error.statusCode === undefined || error.statusCode >= 500;
  }
  return false;
}
