// The internal HTTP transport every resource namespace calls through.
// Owns: URL/header construction, the `timeoutMs` AbortController, JSON
// parsing, error classification, and the opt-in idempotent-retry loop
// (Contract §2, §5.1).

import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, IDEMPOTENCY_KEY_PATTERN } from './constants';
import { InvalidIdempotencyKeyError, isRetryableError, type PushToError } from './errors';
import { classifyError, classifyNetworkError } from './response';

export interface PushToClientOptions {
  /** Default `https://api.pushto.ai` — the customer-api proxy origin. */
  baseUrl?: string;
  /** Default `60_000` — matches the Vercel `maxDuration`; the proxy aborts upstream ~55s before this fires. */
  timeoutMs?: number;
  /** Injectable for tests/edge runtimes. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Default `0`. Retries apply ONLY to calls that accept an idempotency key AND received one. */
  maxRetries?: number;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** Marks a call as eligible for the opt-in retry loop (send methods only — Contract §5.1). */
  retryable?: boolean;
}

export interface RawResponse<T> {
  json: T;
  headers: Headers;
  status: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Capped exponential backoff with jitter. Not part of the frozen contract — a boring, typed default. */
function backoffDelayMs(attempt: number): number {
  const base = 200 * 2 ** (attempt - 1);
  const jitter = Math.random() * 100;
  return Math.min(base + jitter, 2_000);
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body on a non-2xx response (e.g. an upstream proxy/edge
    // failure that never reached the envelope-speaking layer) — surfaced as
    // an `unknown` PushToError by classifyError's `extractErrorShape` miss,
    // never a raw parse crash.
    return null;
  }
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(apiKey: string, options: PushToClientOptions = {}) {
    if (!apiKey) {
      throw new TypeError('PushTo: apiKey is required.');
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const injectedFetch = options.fetch ?? globalThis.fetch;
    if (!injectedFetch) {
      throw new TypeError(
        'PushTo: no global fetch found. Pass { fetch } explicitly for this runtime.',
      );
    }
    this.fetchImpl = injectedFetch;
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<RawResponse<T>> {
    if (options.idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(
        'Idempotency-Key must be 1-255 printable ASCII characters.',
      );
    }

    const url = this.buildUrl(path, options.query);
    const canRetry = Boolean(options.retryable && options.idempotencyKey && this.maxRetries > 0);
    const maxAttempts = canRetry ? this.maxRetries + 1 : 1;

    let lastError: PushToError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelayMs(attempt));
      }

      let error: PushToError;
      try {
        return await this.attempt<T>(method, url, options);
      } catch (thrown) {
        error = thrown as PushToError;
      }

      const isLastAttempt = attempt === maxAttempts - 1;
      if (!canRetry || isLastAttempt || !isRetryableError(error)) {
        throw error;
      }
      lastError = error;
    }

    // Unreachable in practice (the loop above always returns or throws), but
    // keeps the function's return type honest without a non-null assertion.
    throw lastError ?? classifyNetworkError(new Error('Request failed for an unknown reason.'));
  }

  private async attempt<T>(
    method: HttpMethod,
    url: string,
    options: RequestOptions,
  ): Promise<RawResponse<T>> {
    // F1 fix (T-N1-011): the SAME AbortController/timeout must guard the
    // ENTIRE attempt — connect+headers AND the body-read that follows —
    // not just the initial fetch() call. `clearTimeout` used to run in a
    // `finally` attached only to the fetch() try/catch, so a response
    // whose HEADERS arrived (fetch() resolves) but whose BODY then stalled
    // (a slow/wedged connection) hung `response.text()` forever with no
    // timeout protection at all: the caller's promise never settled.
    // Holding the controller/timeout open across `parseJsonSafely` too
    // means a stalled body read gets aborted by the same deadline, and
    // fetch's Fetch-spec-mandated behavior rejects the in-flight body read
    // with the same AbortError the initial connect phase would produce.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.buildHeaders(options),
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (cause) {
        throw classifyNetworkError(cause);
      }

      // F3 fix (T-N1-011): a failure while READING the body (connection
      // reset mid-stream, the abort above firing during the read, a
      // decode error) used to propagate as a raw, unwrapped exception —
      // escaping both the "every method rejects with a typed PushToError"
      // contract AND the retry loop (`isRetryableError` only recognizes
      // `PushToError` instances, so a raw error silently disabled retry
      // even when the call was idempotent+keyed+retryable).
      let json: unknown;
      try {
        json = await parseJsonSafely(response);
      } catch (cause) {
        throw classifyNetworkError(cause);
      }

      if (!response.ok) {
        throw classifyError(response.status, json, response.headers);
      }
      return { json: json as T, headers: response.headers, status: response.status };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    // Bonus fix (found during T-N1-011's audit, not one of the ten named
    // findings): a leading-slash `path` resolved against a `baseUrl` that
    // itself has a sub-path (e.g. a self-hosted proxy at
    // "https://gw.example.com/pushto") silently DROPPED that sub-path —
    // WHATWG URL resolution treats a leading "/" as absolute-path,
    // replacing the base's entire path rather than appending to it.
    // Stripping the path's leading slash and ensuring the base ends in
    // "/" makes this a proper relative-append for every baseUrl shape,
    // while leaving the documented default (`https://api.pushto.ai`, no
    // sub-path) unaffected.
    const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, normalizedBase);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    return headers;
  }
}
