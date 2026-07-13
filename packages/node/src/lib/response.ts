// Response-envelope handling (Contract §5.3, §5.6): unwrapping `{ data }`,
// classifying the flat `{ data: null, error }` shape into a typed
// `PushToError`, and surfacing the send-result siblings (`replayed`,
// `rateLimit`, `warnings`) from response headers/body.

import {
  GatewayTimeoutError,
  IdempotencyConflictError,
  InsufficientPermissionsError,
  InvalidIdempotencyKeyError,
  InvalidTokenError,
  MonthlyQuotaExceededError,
  NotFoundError,
  PushToError,
  RateLimitError,
  ValidationError,
  type PushToErrorDetail,
} from './errors';
import type { BatchItemResult, BatchResult, PageResult, RateLimitInfo, SendResult } from './types';

interface WireErrorShape {
  name: string;
  message: string;
  type?: string;
  docsUrl?: string;
  requestId?: string;
  details?: PushToErrorDetail[];
}

/**
 * Extracts the error shape from either JSON body — the standard v1 envelope
 * (`{ data: null, error: {...} }`) or the one documented carve-out: a
 * request with no `Bearer` token at all never reaches the envelope-speaking
 * layer, and instead gets `{ error: "Unauthorized", details: { name,
 * message } }` (Error Reference). Both should be unreachable in practice
 * (the SDK always sends `Authorization: Bearer <apiKey>`), but this stays
 * defensive rather than crashing on an unexpected shape.
 */
function extractErrorShape(json: unknown): WireErrorShape | null {
  if (json === null || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;

  const envelopeError = body.error;
  if (envelopeError !== null && typeof envelopeError === 'object') {
    const e = envelopeError as Record<string, unknown>;
    if (typeof e.name === 'string') {
      return {
        name: e.name,
        message: typeof e.message === 'string' ? e.message : 'Request failed',
        type: typeof e.type === 'string' ? e.type : undefined,
        docsUrl: typeof e.docs_url === 'string' ? e.docs_url : undefined,
        requestId: typeof e.errorId === 'string' ? e.errorId : undefined,
        details: Array.isArray(e.details) ? (e.details as PushToErrorDetail[]) : undefined,
      };
    }
  }

  const details = body.details;
  if (details !== null && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    if (typeof d.name === 'string') {
      return {
        name: d.name,
        message: typeof d.message === 'string' ? d.message : 'Unauthorized',
      };
    }
  }

  return null;
}

/**
 * The catalog's canonical HTTP status per `error.name` (Error Reference /
 * Contract §5.6) — used for a batch item's embedded error object, which has
 * no HTTP status of its own (the whole `POST /v2/notifications/batch` call
 * is itself a single `200`).
 */
const STATUS_BY_ERROR_NAME: Record<string, number> = {
  invalid_token: 401,
  insufficient_permissions: 403,
  not_found: 404,
  validation_error: 422,
  invalid_body: 422,
  invalid_idempotency_key: 400,
  idempotency_conflict: 409,
  concurrent_idempotent_requests: 409,
  monthly_quota_exceeded: 429,
  rate_limit_exceeded: 429,
  gateway_timeout: 504,
  internal_error: 500,
};

function statusForErrorName(name: string): number {
  return STATUS_BY_ERROR_NAME[name] ?? 500;
}

/**
 * Parses `Retry-After` — carried on `429` responses (Contract §5.2). Handles
 * both RFC 7231 forms: delta-seconds and HTTP-date (converted to a
 * non-negative delta from now). An empty/garbage header yields `undefined`
 * (`Number('')` is `0`, which would otherwise read as "retry immediately").
 */
function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return undefined;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return seconds >= 0 ? seconds : undefined;
  const dateMs = Date.parse(raw);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

/**
 * Classifies an error response's JSON body into a typed `PushToError`
 * subclass, keyed on `error.name` (Contract §5.6's catalog table). An
 * unrecognized/unlisted name (or a malformed body) falls back to the base
 * `PushToError`, never throwing a parse error of its own.
 */
export function classifyError(status: number, json: unknown, headers: Headers): PushToError {
  const shape = extractErrorShape(json) ?? {
    name: 'unknown',
    message: `Request failed with status ${status}`,
  };
  const options = {
    statusCode: status,
    type: shape.type,
    docsUrl: shape.docsUrl,
    requestId: shape.requestId,
  };

  switch (shape.name) {
    case 'invalid_token':
      return new InvalidTokenError(shape.message, options);
    case 'insufficient_permissions':
      return new InsufficientPermissionsError(shape.message, options);
    case 'not_found':
      return new NotFoundError(shape.message, options);
    case 'validation_error':
      return new ValidationError(shape.message, { ...options, details: shape.details });
    case 'invalid_idempotency_key':
      return new InvalidIdempotencyKeyError(shape.message, options);
    case 'idempotency_conflict':
    case 'concurrent_idempotent_requests':
      return new IdempotencyConflictError(shape.name, shape.message, options);
    case 'monthly_quota_exceeded':
      return new MonthlyQuotaExceededError(shape.message, {
        ...options,
        retryAfter: parseRetryAfter(headers),
      });
    case 'rate_limit_exceeded':
      return new RateLimitError(shape.message, {
        ...options,
        retryAfter: parseRetryAfter(headers),
      });
    case 'gateway_timeout':
      return new GatewayTimeoutError(shape.message, options);
    default:
      return new PushToError(shape.name, shape.message, options);
  }
}

/** Wraps a `fetch()`-level throw (network failure or our own `timeoutMs` abort). */
export function classifyNetworkError(cause: unknown): PushToError {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return new GatewayTimeoutError('The request timed out before completing.', {
      statusCode: 504,
      cause,
    });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new PushToError('network_error', `Network request failed: ${message}`, { cause });
}

/** IETF rate-limit headers (Contract §5.2) — `undefined` on a replayed response (no headers). */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get('ratelimit-limit');
  const remaining = headers.get('ratelimit-remaining');
  const reset = headers.get('ratelimit-reset');
  if (limit === null || remaining === null || reset === null) return undefined;

  const parsedLimit = Number(limit);
  const parsedRemaining = Number(remaining);
  const parsedReset = Number(reset);
  if (Number.isNaN(parsedLimit) || Number.isNaN(parsedRemaining) || Number.isNaN(parsedReset)) {
    return undefined;
  }
  return { limit: parsedLimit, remaining: parsedRemaining, reset: parsedReset };
}

/** `true` when the response carried `Idempotency-Replayed: true` (Contract §5.1). */
export function parseReplayed(headers: Headers): boolean | undefined {
  return headers.get('idempotency-replayed') === 'true' ? true : undefined;
}

/**
 * Unwraps a plain `{ data }` success envelope. A 2xx whose body is empty,
 * non-JSON (`parseJsonSafely` → `null` — e.g. an intermediary's HTML
 * maintenance page), or missing `data` throws a typed `PushToError` —
 * never a raw `TypeError` — preserving errors.ts's contract that every
 * rejection is a `PushToError`.
 */
export function unwrapData<T>(json: unknown): T {
  if (json === null || typeof json !== 'object' || !('data' in json)) {
    throw new PushToError(
      'malformed_response',
      'The server returned a success status but the body was not a { data } envelope — an intermediary (proxy/CDN) may have replaced the response.',
      { statusCode: 200 },
    );
  }
  return (json as { data: T }).data;
}

/** A paginated list response is already `{ data, page, limit }` at the top level. */
export function toPageResult<T>(json: unknown): PageResult<T> {
  const body = json as PageResult<T>;
  return { data: body.data, page: body.page, limit: body.limit };
}

/** Builds a send method's result: the unwrapped `data` object plus header-sourced siblings. */
export function toSendResult<T extends object>(json: unknown, headers: Headers): SendResult<T> {
  const data = unwrapData<T>(json);
  const replayed = parseReplayed(headers);
  const rateLimit = parseRateLimitHeaders(headers);
  return {
    ...data,
    ...(replayed !== undefined ? { replayed } : {}),
    ...(rateLimit !== undefined ? { rateLimit } : {}),
  } as SendResult<T>;
}

/**
 * Builds `notifications.batch()`'s result: the positionally-aligned array
 * (Contract §5.4), with per-item wire error objects promoted to typed
 * `PushToError`s, plus the same header-sourced siblings and an `errors()`
 * helper — all as non-enumerable-safe own properties on the array itself.
 */
export function toBatchResult<T>(json: unknown, headers: Headers): BatchResult<T> {
  const items = unwrapData<(T | { error: Record<string, unknown> })[]>(json);

  const results = items.map((item): BatchItemResult<T> => {
    if (item !== null && typeof item === 'object' && 'error' in item) {
      const errorShape = (item as { error: Record<string, unknown> }).error;
      const name = typeof errorShape.name === 'string' ? errorShape.name : 'unknown';
      return { error: classifyError(statusForErrorName(name), { error: errorShape }, headers) };
    }
    return item as T;
  }) as BatchResult<T>;

  results.errors = () =>
    results.reduce<number[]>((failedIndices, item, index) => {
      if (item !== null && typeof item === 'object' && 'error' in item) {
        failedIndices.push(index);
      }
      return failedIndices;
    }, []);

  const replayed = parseReplayed(headers);
  if (replayed !== undefined) results.replayed = replayed;
  const rateLimit = parseRateLimitHeaders(headers);
  if (rateLimit !== undefined) results.rateLimit = rateLimit;

  return results;
}
