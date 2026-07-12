import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../../lib/http-client';
import { Broadcasts } from '../broadcasts';

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Broadcasts.send (preset form)', () => {
  test('always sends { template, variables, send: true } — never mixes in target', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 42, recipients: 100, stats: { success: 100, error: 0 } } }),
    );
    const broadcasts = new Broadcasts(client);

    const result = await broadcasts.send({ template: 'game-day', variables: { team: 'KC' } });

    expect(calls[0].url).toBe('https://core.test/v2/broadcasts');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ template: 'game-day', variables: { team: 'KC' }, send: true });
    expect(body.target).toBeUndefined();
    expect(result).toEqual({ id: 42, recipients: 100, stats: { success: 100, error: 0 } });
  });

  test('defaults variables to {} when omitted', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 1, recipients: 0, stats: { success: 0, error: 0 }, warnings: ['zero_recipients'] } }),
    );
    const broadcasts = new Broadcasts(client);
    const result = await broadcasts.send({ template: 'no-vars' });

    expect(JSON.parse(calls[0].init.body as string).variables).toEqual({});
    expect(result.warnings).toEqual(['zero_recipients']);
  });
});

describe('Broadcasts.create (inline form)', () => {
  test('sends the union target/default/overrides/tag/topic/send body as-is', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 7, status: 'draft' } }),
    );
    const broadcasts = new Broadcasts(client);

    const input = {
      target: { any: [{ audience: 'vip' }, { all: true as const }] },
      default: { title: 't', body: 'b' },
      tag: 'promo',
      send: false,
    };
    const result = await broadcasts.create(input);

    expect(JSON.parse(calls[0].init.body as string)).toEqual(input);
    expect(result).toEqual({ id: 7, status: 'draft' });
  });

  test('a send:true create returns recipients/stats, no status field', async () => {
    const { client } = mockClient(() =>
      json({ data: { id: 8, recipients: 5, stats: { success: 5, error: 0 } } }),
    );
    const broadcasts = new Broadcasts(client);
    const result = await broadcasts.create({
      target: { any: [{ topic: 'news' }] },
      default: { title: 't', body: 'b' },
      send: true,
    });
    expect(result.status).toBeUndefined();
    expect(result.recipients).toBe(5);
  });
});

describe('Broadcasts.sendDraft', () => {
  test('POSTs /v2/broadcasts/:id/send with no body', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 9, recipients: 3, stats: { success: 3, error: 0 } } }),
    );
    const broadcasts = new Broadcasts(client);
    const result = await broadcasts.sendDraft(9, { idempotencyKey: 'draft-key' });

    expect(calls[0].url).toBe('https://core.test/v2/broadcasts/9/send');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'draft-key',
    );
    expect(result.id).toBe(9);
  });
});

describe('Broadcasts.list', () => {
  test('GETs /broadcasts and returns { data, page, limit } with embedded stats', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: [
          {
            id: 1,
            created_at: '2026-01-01T00:00:00Z',
            content: { title: 't', message: 'm' },
            link: null,
            audience_id: 5,
            scheduled_at: null,
            stats: {
              recipients: 10,
              byStatus: {
                pending: 0,
                failed: 0,
                delivered: 8,
                clicked: 2,
                'auto-dismissed': 0,
                expired: 0,
                ignored: 0,
                closed: 0,
              },
              reached: 10,
              engaged: 2,
            },
          },
        ],
        page: 1,
        limit: 20,
      }),
    );
    const broadcasts = new Broadcasts(client);
    const result = await broadcasts.list();

    expect(calls[0].url).toBe('https://core.test/broadcasts');
    expect(result.data[0].audience_id).toBe(5);
    expect(result.data[0].stats.engaged).toBe(2);
  });
});

describe('Broadcasts.presets', () => {
  test('create() POSTs /v2/broadcast-presets', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          name: 'game-day',
          definition: { target: { any: [{ all: true }] }, default: { template: 'x', variables: {} } },
          variables: ['team'],
          targeting_variables: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      }),
    );
    const broadcasts = new Broadcasts(client);
    const result = await broadcasts.presets.create({
      name: 'game-day',
      definition: { target: { any: [{ all: true }] }, default: { title: 't', body: 'b' } },
    });

    expect(calls[0].url).toBe('https://core.test/v2/broadcast-presets');
    expect(result.name).toBe('game-day');
  });

  test('remove() DELETEs /v2/broadcast-presets/:id', async () => {
    const { client, calls } = mockClient(() => new Response(null, { status: 204 }));
    const broadcasts = new Broadcasts(client);
    await broadcasts.presets.remove(5);
    expect(calls[0].url).toBe('https://core.test/v2/broadcast-presets/5');
    expect(calls[0].init.method).toBe('DELETE');
  });
});
