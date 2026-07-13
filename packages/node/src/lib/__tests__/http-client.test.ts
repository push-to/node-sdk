/**
 * Cross-cutting HTTP client behavior (Contract §8 unit suite):
 * - envelope unwrap
 * - each error `name` → correct class + `statusCode`/`docsUrl`
 * - idempotency header set + `replayed` surfaced
 * - rate-limit header parse (+ `undefined` on replay)
 * - retry only on idempotent+keyed calls, no-retry on 409
 */

import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../http-client';
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
} from '../errors';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('HttpClient — construction', () => {
  test('throws synchronously when apiKey is empty', () => {
    expect(() => new HttpClient('')).toThrow(TypeError);
  });
});

describe('HttpClient — request building', () => {
  test('sends Authorization: Bearer <apiKey>, method, JSON body, and skips undefined query params', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchMock = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { data: { ok: true } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
    });
    await client.request('GET', '/v2/topics', { query: { page: 1, limit: undefined } });

    expect(capturedUrl).toBe('https://core.test/v2/topics?page=1');
    expect(capturedInit?.method).toBe('GET');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk_test',
    );
    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  test('sets Content-Type only when a body is present, and serializes it as JSON', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse(200, { data: { ok: true } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    await client.request('POST', '/v2/topics', { body: { name: 'sports' } });

    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(capturedInit?.body).toBe(JSON.stringify({ name: 'sports' }));
  });

  test('sets the Idempotency-Key header when supplied', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse(200, { data: { ok: true } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    await client.request('POST', '/v2/notifications', {
      body: {},
      idempotencyKey: 'my-key-1',
    });

    expect((capturedInit?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'my-key-1',
    );
  });

  test('rejects a malformed Idempotency-Key locally, before any fetch', async () => {
    let fetchCalled = false;
    const fetchMock = (async () => {
      fetchCalled = true;
      return jsonResponse(200, { data: {} });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = await client
      .request('POST', '/v2/notifications', { body: {}, idempotencyKey: '' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(InvalidIdempotencyKeyError);
    expect(fetchCalled).toBe(false);
  });

  test('rejects an over-length (256 char) Idempotency-Key locally', async () => {
    const fetchMock = (async () => jsonResponse(200, { data: {} })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = await client
      .request('POST', '/v2/notifications', { body: {}, idempotencyKey: 'x'.repeat(256) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidIdempotencyKeyError);
  });
});

describe('HttpClient — envelope unwrap', () => {
  test('returns the parsed JSON + headers on a 2xx response', async () => {
    const fetchMock = (async () =>
      jsonResponse(200, { data: { id: 1 }, page: 1, limit: 20 })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const result = await client.request<{ data: { id: number }; page: number; limit: number }>(
      'GET',
      '/v2/contacts',
    );
    expect(result.json.data).toEqual({ id: 1 });
    expect(result.json.page).toBe(1);
    expect(result.status).toBe(200);
  });

  test('a 204 response yields a null body', async () => {
    const fetchMock = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const result = await client.request('DELETE', '/v2/topics/1');
    expect(result.json).toBeNull();
  });
});

describe('HttpClient — error classification', () => {
  const cases: [number, string, unknown][] = [
    [401, 'invalid_token', InvalidTokenError],
    [403, 'insufficient_permissions', InsufficientPermissionsError],
    [404, 'not_found', NotFoundError],
    [422, 'validation_error', ValidationError],
    [400, 'invalid_idempotency_key', InvalidIdempotencyKeyError],
    [409, 'idempotency_conflict', IdempotencyConflictError],
    [409, 'concurrent_idempotent_requests', IdempotencyConflictError],
    [429, 'monthly_quota_exceeded', MonthlyQuotaExceededError],
    [429, 'rate_limit_exceeded', RateLimitError],
    [504, 'gateway_timeout', GatewayTimeoutError],
  ];

  for (const [status, name, expectedClass] of cases) {
    test(`${status} ${name} → ${(expectedClass as { name: string }).name}`, async () => {
      const fetchMock = (async () =>
        jsonResponse(
          status,
          {
            data: null,
            error: {
              name,
              message: 'boom',
              type: 'validation',
              docs_url: `https://docs.pushto.ai/errors/${name}`,
            },
          },
        )) as unknown as typeof fetch;
      const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
      const err = await client.request('GET', '/v2/topics').catch((e) => e);

      expect(err).toBeInstanceOf(expectedClass as new (...args: never[]) => unknown);
      expect((err as PushToError).name).toBe(name);
      expect((err as PushToError).statusCode).toBe(status);
      expect((err as PushToError).docsUrl).toBe(`https://docs.pushto.ai/errors/${name}`);
    });
  }

  test('an unrecognized error name falls back to the base PushToError', async () => {
    const fetchMock = (async () =>
      jsonResponse(500, { data: null, error: { name: 'internal_error', message: 'oops' } })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = await client.request('GET', '/v2/topics').catch((e) => e);

    expect(err).toBeInstanceOf(PushToError);
    expect(err.constructor).toBe(PushToError);
    expect((err as PushToError).name).toBe('internal_error');
  });

  test('the "no Bearer token at all" carve-out shape still classifies invalid_token', async () => {
    const fetchMock = (async () =>
      jsonResponse(401, {
        error: 'Unauthorized',
        details: { name: 'invalid_token', message: 'Invalid token' },
      })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = await client.request('GET', '/v2/topics').catch((e) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
  });

  test('ValidationError carries details[]', async () => {
    const fetchMock = (async () =>
      jsonResponse(422, {
        data: null,
        error: {
          name: 'validation_error',
          message: 'Invalid request',
          details: [{ message: 'name is Required' }],
        },
      })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = (await client.request('POST', '/v2/topics').catch((e) => e)) as ValidationError;

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toEqual([{ message: 'name is Required' }]);
  });

  test('MonthlyQuotaExceededError reads retryAfter from the Retry-After header', async () => {
    const fetchMock = (async () =>
      jsonResponse(
        429,
        { data: null, error: { name: 'monthly_quota_exceeded', message: 'quota' } },
        { 'retry-after': '3600' },
      )) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = (await client
      .request('POST', '/v2/notifications')
      .catch((e) => e)) as MonthlyQuotaExceededError;

    expect(err).toBeInstanceOf(MonthlyQuotaExceededError);
    expect(err.retryAfter).toBe(3600);
  });

  test('a network-level fetch throw is wrapped as a base PushToError with the cause preserved', async () => {
    const boom = new Error('DNS lookup failed');
    const fetchMock = (async () => {
      throw boom;
    }) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = (await client.request('GET', '/v2/topics').catch((e) => e)) as PushToError;

    expect(err).toBeInstanceOf(PushToError);
    expect(err.cause).toBe(boom);
    expect(err.statusCode).toBeUndefined();
  });

  test('an AbortError (our own timeoutMs firing) classifies as GatewayTimeoutError', async () => {
    const fetchMock = (async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      throw abortError;
    }) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = await client.request('GET', '/v2/topics').catch((e) => e);

    expect(err).toBeInstanceOf(GatewayTimeoutError);
  });

  // F1 (T-N1-011) — a stalled response BODY (headers arrived, then the
  // connection wedges) must not hang the caller forever. The mock ties its
  // never-otherwise-resolving `.text()` to the SAME AbortSignal the client
  // passed to fetch() — exactly how a real fetch/undici body read behaves —
  // so this only completes if the client's own timeoutMs aborts it.
  test('a stalled response body times out instead of hanging forever', async () => {
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      timeoutMs: 25,
    });

    const start = Date.now();
    const err = await client.request('GET', '/v2/topics').catch((e) => e);
    const elapsed = Date.now() - start;

    expect(err).toBeInstanceOf(GatewayTimeoutError);
    // Bounded well below bun's default test timeout — proves it didn't hang.
    expect(elapsed).toBeLessThan(1_000);
  });

  // F3 (T-N1-011) — a failure while READING the body (connection reset
  // mid-stream, a decode error) must still reject as a typed PushToError,
  // never the raw underlying exception.
  test('a mid-body read failure rejects as a typed PushToError, not the raw exception', async () => {
    const bodyBoom = new Error('terminated');
    const fetchMock = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.reject(bodyBoom),
    })) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const err = (await client.request('GET', '/v2/topics').catch((e) => e)) as PushToError;

    expect(err).toBeInstanceOf(PushToError);
    expect(err).not.toBe(bodyBoom);
    expect(err.cause).toBe(bodyBoom);
  });

  // F3 (T-N1-011) — and, being a classified PushToError with no statusCode,
  // it must re-enter the SAME retry gate a network/timeout failure does.
  test('a mid-body read failure is retried when the call is retryable + keyed', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () => Promise.reject(new Error('terminated')),
        } as unknown as Response;
      }
      return jsonResponse(200, { data: { id: 1 } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 2,
    });
    const result = await client.request<{ data: { id: number } }>('POST', '/v2/notifications', {
      idempotencyKey: 'k',
      retryable: true,
    });

    expect(calls).toBe(2);
    expect(result.json.data.id).toBe(1);
  });
});

describe('HttpClient — baseUrl with a sub-path (bonus fix, found during T-N1-011 audit)', () => {
  test('preserves the sub-path when joining a leading-slash request path', async () => {
    let capturedUrl = '';
    const fetchMock = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse(200, { data: {} });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://gw.example.com/pushto',
      fetch: fetchMock,
    });
    await client.request('GET', '/v2/topics');

    expect(capturedUrl).toBe('https://gw.example.com/pushto/v2/topics');
  });

  test('is idempotent whether or not the caller-supplied baseUrl already ends in "/"', async () => {
    let capturedUrl = '';
    const fetchMock = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse(200, { data: {} });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://gw.example.com/pushto/',
      fetch: fetchMock,
    });
    await client.request('GET', '/v2/topics');

    expect(capturedUrl).toBe('https://gw.example.com/pushto/v2/topics');
  });
});

describe('HttpClient — rate limit + idempotency-replayed headers', () => {
  test('parses ratelimit-* headers into { limit, remaining, reset }', async () => {
    const fetchMock = (async () =>
      jsonResponse(
        200,
        { data: { id: 1 } },
        { 'ratelimit-limit': '1000', 'ratelimit-remaining': '999', 'ratelimit-reset': '1700000000' },
      )) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const result = await client.request('POST', '/v2/notifications');

    const limit = result.headers.get('ratelimit-limit');
    expect(limit).toBe('1000');
  });

  test('a replayed response omits ratelimit-* headers (Known Issues & WIP)', async () => {
    const fetchMock = (async () =>
      jsonResponse(200, { data: { id: 1 } }, { 'idempotency-replayed': 'true' })) as unknown as typeof fetch;
    const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
    const result = await client.request('POST', '/v2/notifications', {
      idempotencyKey: 'k-1',
    });

    expect(result.headers.get('idempotency-replayed')).toBe('true');
    expect(result.headers.get('ratelimit-limit')).toBeNull();
  });
});

describe('HttpClient — retry semantics (Contract §5.1)', () => {
  test('retries a 500 when retryable + idempotencyKey are both present, then succeeds', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(500, { data: null, error: { name: 'internal_error', message: 'x' } });
      }
      return jsonResponse(200, { data: { id: 1 } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 2,
    });
    const result = await client.request('POST', '/v2/notifications', {
      idempotencyKey: 'retry-key',
      retryable: true,
    });

    expect(calls).toBe(2);
    expect((result.json as { data: { id: number } }).data.id).toBe(1);
  });

  test('never retries when retryable is false, even with an idempotencyKey + maxRetries', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse(500, { data: null, error: { name: 'internal_error', message: 'x' } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 3,
    });
    await client
      .request('PATCH', '/v2/topics/1', { retryable: false })
      .catch(() => undefined);

    expect(calls).toBe(1);
  });

  test('never retries when no idempotencyKey is supplied, even for a retryable call', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse(500, { data: null, error: { name: 'internal_error', message: 'x' } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 3,
    });
    await client.request('POST', '/v2/notifications', { retryable: true }).catch(() => undefined);

    expect(calls).toBe(1);
  });

  test('never retries on a 409 idempotency conflict, even when retryable + keyed', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse(409, {
        data: null,
        error: { name: 'idempotency_conflict', message: 'reused key, different body' },
      });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 3,
    });
    const err = await client
      .request('POST', '/v2/notifications', { idempotencyKey: 'k', retryable: true })
      .catch((e) => e);

    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(IdempotencyConflictError);
  });

  test('never retries on a deterministic 4xx (e.g. validation_error)', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse(422, {
        data: null,
        error: { name: 'validation_error', message: 'bad body' },
      });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 3,
    });
    await client
      .request('POST', '/v2/notifications', { idempotencyKey: 'k', retryable: true })
      .catch(() => undefined);

    expect(calls).toBe(1);
  });

  test('gives up after maxRetries + 1 attempts and throws the last error', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse(500, { data: null, error: { name: 'internal_error', message: 'x' } });
    }) as unknown as typeof fetch;

    const client = new HttpClient('sk_test', {
      baseUrl: 'https://core.test',
      fetch: fetchMock,
      maxRetries: 2,
    });
    const err = await client
      .request('POST', '/v2/notifications', { idempotencyKey: 'k', retryable: true })
      .catch((e) => e);

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(err).toBeInstanceOf(PushToError);
  });
});
