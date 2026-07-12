import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../../lib/http-client';
import { PushToError, ValidationError } from '../../lib/errors';
import { Notifications } from '../notifications';

interface Captured {
  url: string;
  init: RequestInit;
}

function mockClient(responder: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const captured = { url, init: init ?? {} };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  const client = new HttpClient('sk_test', { baseUrl: 'https://core.test', fetch: fetchMock });
  return { client, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('Notifications.send', () => {
  test('POSTs /v2/notifications with the input body and Idempotency-Key', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 1, recipients: 2, stats: { success: 2, error: 0 } } }),
    );
    const notifications = new Notifications(client);

    const result = await notifications.send(
      { to: { users: ['u1'] }, notification: { title: 't', body: 'b' } },
      { idempotencyKey: 'idem-1' },
    );

    expect(calls[0].url).toBe('https://core.test/v2/notifications');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      to: { users: ['u1'] },
      notification: { title: 't', body: 'b' },
    });
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
    expect(result).toEqual({ id: 1, recipients: 2, stats: { success: 2, error: 0 } });
  });

  test('surfaces replayed + rateLimit on the returned result', async () => {
    const { client } = mockClient(() =>
      json(
        { data: { id: 1, recipients: 1, stats: { success: 1, error: 0 } } },
        200,
        {
          'idempotency-replayed': 'true',
        },
      ),
    );
    const notifications = new Notifications(client);
    const result = await notifications.send(
      { to: { subscriptions: [1] }, notification: { title: 't', body: 'b' } },
      { idempotencyKey: 'idem-2' },
    );

    expect(result.replayed).toBe(true);
    expect(result.rateLimit).toBeUndefined();
  });

  test('rejects with ValidationError on 422', async () => {
    const { client } = mockClient(() =>
      json(
        { data: null, error: { name: 'validation_error', message: 'bad', details: [{ message: 'to is Required' }] } },
        422,
      ),
    );
    const notifications = new Notifications(client);

    const err = await notifications
      .send({ to: {}, notification: { title: 't', body: 'b' } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual([{ message: 'to is Required' }]);
  });
});

describe('Notifications.batch', () => {
  test('POSTs /v2/notifications/batch wrapping items in { notifications }', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: [
          { id: 1, recipients: 3, stats: { success: 3, error: 0 } },
          { error: { name: 'not_found', message: 'Contact not found' } },
        ],
      }),
    );
    const notifications = new Notifications(client);

    const items = [
      { to: { users: ['u1'] }, notification: { title: 'a', body: 'b' } },
      { to: { users: ['missing'] }, notification: { title: 'a', body: 'b' } },
    ];
    const result = await notifications.batch(items, { idempotencyKey: 'batch-1' });

    expect(JSON.parse(calls[0].init.body as string)).toEqual({ notifications: items });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 1, recipients: 3, stats: { success: 3, error: 0 } });
    expect(result[1]).toHaveProperty('error');
    expect((result[1] as { error: PushToError }).error).toBeInstanceOf(PushToError);
    expect(result.errors()).toEqual([1]);
  });

  test('a fully successful batch has an empty errors() list', async () => {
    const { client } = mockClient(() =>
      json({ data: [{ id: 1, recipients: 1, stats: { success: 1, error: 0 } }] }),
    );
    const notifications = new Notifications(client);
    const result = await notifications.batch([
      { to: { subscriptions: [1] }, notification: { title: 'a', body: 'b' } },
    ]);
    expect(result.errors()).toEqual([]);
  });
});

describe('Notifications.list', () => {
  test('GETs /notifications with page/limit query params and returns { data, page, limit }', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: [
          {
            id: 1,
            created_at: '2026-01-01T00:00:00Z',
            content: { title: 't', message: 'm' },
            link: null,
            scheduled_at: null,
            stats: {
              recipients: 1,
              byStatus: {
                pending: 0,
                failed: 0,
                delivered: 1,
                clicked: 0,
                'auto-dismissed': 0,
                expired: 0,
                ignored: 0,
                closed: 0,
              },
              reached: 1,
              engaged: 0,
            },
          },
        ],
        page: 2,
        limit: 10,
      }),
    );
    const notifications = new Notifications(client);
    const result = await notifications.list({ page: 2, limit: 10 });

    expect(calls[0].url).toBe('https://core.test/notifications?page=2&limit=10');
    expect(calls[0].init.method).toBe('GET');
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.data[0].content).toEqual({ title: 't', message: 'm' });
  });
});
