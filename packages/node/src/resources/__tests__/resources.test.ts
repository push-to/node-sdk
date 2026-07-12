// Endpoint-mapping coverage for every remaining resource namespace: method,
// path, request body/query, and response unwrap — including the two
// documented envelope carve-outs (`vapidKeys.getPublic()`'s bare body, and
// the `audiences` on-contact routes' bare-array responses).

import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../../lib/http-client';
import { Contacts } from '../contacts';
import { Audiences } from '../audiences';
import { Topics } from '../topics';
import { Templates } from '../templates';
import { Webhooks } from '../webhooks';
import { Accounts } from '../accounts';
import { Subscriptions } from '../subscriptions';
import { Keys } from '../keys';
import { VapidKeys } from '../vapid-keys';
import { InsufficientPermissionsError } from '../../lib/errors';

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

describe('Contacts', () => {
  test('upsert() POSTs /v2/contacts', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          anonymous_id: 'anon',
          customer_id: 'c1',
          created_at: '2026-01-01T00:00:00Z',
          email: null,
          external_id: 'u1',
          image_url: null,
          language: null,
          name: null,
          properties: {},
        },
      }),
    );
    const contacts = new Contacts(client);
    const result = await contacts.upsert({ external_id: 'u1', topics: { news: 'subscribed' } });

    expect(calls[0].url).toBe('https://core.test/v2/contacts');
    expect(calls[0].init.method).toBe('POST');
    expect(result.external_id).toBe('u1');
  });

  test('get() GETs /v2/contacts/:id (URI-encoded) and returns the topic/subscription summary', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          anonymous_id: 'anon',
          customer_id: 'c1',
          created_at: '2026-01-01T00:00:00Z',
          email: null,
          external_id: 'user/with slash',
          image_url: null,
          language: null,
          name: null,
          properties: {},
          topics: [{ name: 'news', state: 'subscribed' }],
          subscriptionCount: 2,
        },
      }),
    );
    const contacts = new Contacts(client);
    const result = await contacts.get('user/with slash');

    expect(calls[0].url).toBe(
      'https://core.test/v2/contacts/user%2Fwith%20slash',
    );
    expect(result.subscriptionCount).toBe(2);
    expect(result.topics).toEqual([{ name: 'news', state: 'subscribed' }]);
  });

  test('update() PATCHes /v2/contacts/:id', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          anonymous_id: 'anon',
          customer_id: 'c1',
          created_at: '2026-01-01T00:00:00Z',
          email: null,
          external_id: 'u1',
          image_url: null,
          language: null,
          name: null,
          properties: { plan: 'pro' },
        },
      }),
    );
    const contacts = new Contacts(client);
    const result = await contacts.update('u1', { properties: { plan: 'pro' } });

    expect(calls[0].url).toBe('https://core.test/v2/contacts/u1');
    expect(calls[0].init.method).toBe('PATCH');
    expect(result.properties).toEqual({ plan: 'pro' });
  });

  test('properties.create() POSTs /v2/contact-properties', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: { id: 1, key: 'favorite_team', value_type: 'string', client_writable: true, created_at: 'now' } }),
    );
    const contacts = new Contacts(client);
    const result = await contacts.properties.create({ key: 'favorite_team', client_writable: true });

    expect(calls[0].url).toBe('https://core.test/v2/contact-properties');
    expect(result.client_writable).toBe(true);
  });
});

describe('Audiences — standard envelope routes', () => {
  test('create() POSTs /audiences', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          name: 'vip',
          description: null,
          meta: null,
          created_at: 'now',
          customer_id: 'c1',
        },
      }),
    );
    const audiences = new Audiences(client);
    const result = await audiences.create({ name: 'vip' });

    expect(calls[0].url).toBe('https://core.test/audiences');
    expect(result.name).toBe('vip');
  });

  test('listAll() GETs /audiences/all and unwraps a bare array under data', async () => {
    const { client, calls } = mockClient(() =>
      json({ data: [{ id: 1, name: 'vip', description: null, meta: null, created_at: 'now', customer_id: 'c1' }] }),
    );
    const audiences = new Audiences(client);
    const result = await audiences.listAll();

    expect(calls[0].url).toBe('https://core.test/audiences/all');
    expect(result).toHaveLength(1);
  });
});

describe('Audiences — on-contact routes (documented envelope divergence)', () => {
  test('listForContact() returns a BARE array — no { data } envelope', async () => {
    const { client, calls } = mockClient(() =>
      json([{ id: 1, name: 'vip', description: null, meta: null, created_at: 'now', customer_id: 'c1' }]),
    );
    const audiences = new Audiences(client);
    const result = await audiences.listForContact('u1');

    expect(calls[0].url).toBe('https://core.test/users/u1/audiences');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('vip');
  });

  test('addContact() returns the bare audience_users join row — no { data } envelope', async () => {
    const { client, calls } = mockClient(() =>
      json({ audience_id: 1, user_id: 2, created_at: 'now' }),
    );
    const audiences = new Audiences(client);
    const result = await audiences.addContact('u1', 'vip');

    expect(calls[0].url).toBe('https://core.test/users/u1/audiences/vip');
    expect(calls[0].init.method).toBe('POST');
    expect(result).toEqual({ audience_id: 1, user_id: 2, created_at: 'now' });
  });

  test('addContactBatch() returns a bare array of { audienceName, userId }', async () => {
    const { client, calls } = mockClient(() =>
      json([{ audienceName: 'vip', userId: 'u1' }]),
    );
    const audiences = new Audiences(client);
    const result = await audiences.addContactBatch('u1', ['vip']);

    expect(calls[0].url).toBe('https://core.test/users/u1/audiences/batch');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ audienceNames: ['vip'] });
    expect(result).toEqual([{ audienceName: 'vip', userId: 'u1' }]);
  });

  test('removeContact() DELETEs /users/:userId/audiences/:name', async () => {
    const { client, calls } = mockClient(() => json(true));
    const audiences = new Audiences(client);
    await audiences.removeContact('u1', 'vip');

    expect(calls[0].url).toBe('https://core.test/users/u1/audiences/vip');
    expect(calls[0].init.method).toBe('DELETE');
  });

  test('removeAllForContact() DELETEs /users/:userId/audiences/all', async () => {
    const { client, calls } = mockClient(() => json(true));
    const audiences = new Audiences(client);
    await audiences.removeAllForContact('u1');

    expect(calls[0].url).toBe('https://core.test/users/u1/audiences/all');
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('Topics', () => {
  test('create() POSTs /v2/topics and update() PATCHes /v2/topics/:id', async () => {
    const { client, calls } = mockClient((captured) => {
      if (captured.init.method === 'POST') {
        return json({
          data: { id: 1, name: 'news', default_subscription: 'opt_in', created_at: 'now', updated_at: 'now' },
        });
      }
      return json({
        data: { id: 1, name: 'news', default_subscription: 'opt_out', created_at: 'now', updated_at: 'now' },
      });
    });
    const topics = new Topics(client);

    const created = await topics.create({ name: 'news', default_subscription: 'opt_in' });
    expect(calls[0].url).toBe('https://core.test/v2/topics');
    expect(created.default_subscription).toBe('opt_in');

    const updated = await topics.update(1, { default_subscription: 'opt_out' });
    expect(calls[1].url).toBe('https://core.test/v2/topics/1');
    expect(calls[1].init.method).toBe('PATCH');
    expect(updated.default_subscription).toBe('opt_out');
  });

  test('remove() DELETEs /v2/topics/:id', async () => {
    const { client, calls } = mockClient(() => new Response(null, { status: 204 }));
    const topics = new Topics(client);
    await topics.remove(1);
    expect(calls[0].url).toBe('https://core.test/v2/topics/1');
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('Templates', () => {
  test('create() returns the auto-derived variables[]', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          id: 1,
          name: 'welcome',
          title: 'Hi {{name}}',
          body: 'Welcome!',
          link: null,
          icon: null,
          variables: ['name'],
          created_at: 'now',
          updated_at: 'now',
        },
      }),
    );
    const templates = new Templates(client);
    const result = await templates.create({ name: 'welcome', title: 'Hi {{name}}', body: 'Welcome!' });

    expect(calls[0].url).toBe('https://core.test/v2/templates');
    expect(result.variables).toEqual(['name']);
  });
});

describe('Webhooks', () => {
  test('create() returns the secret ONCE; list() omits it', async () => {
    const { client, calls } = mockClient((captured) => {
      if (captured.init.method === 'POST' && captured.url.endsWith('/webhooks')) {
        return json({
          data: {
            id: 1,
            customer_id: 'c1',
            url: 'https://example.com/hook',
            enabled_events: ['notification.delivered'],
            status: 'enabled',
            created_at: 'now',
            updated_at: 'now',
            secret: 'whsec_abc',
          },
        });
      }
      return json({
        data: [
          {
            id: 1,
            customer_id: 'c1',
            url: 'https://example.com/hook',
            enabled_events: ['notification.delivered'],
            status: 'enabled',
            created_at: 'now',
            updated_at: 'now',
          },
        ],
        page: 1,
        limit: 20,
      });
    });
    const webhooks = new Webhooks(client);

    const created = await webhooks.create({ url: 'https://example.com/hook' });
    expect(calls[0].url).toBe('https://core.test/webhooks');
    expect(created.secret).toBe('whsec_abc');

    const list = await webhooks.list();
    expect(list.data[0]).not.toHaveProperty('secret');
  });

  test('rotateSecret() POSTs /webhooks/:id/rotate-secret', async () => {
    const { client, calls } = mockClient(() => json({ data: { secret: 'whsec_new' } }));
    const webhooks = new Webhooks(client);
    const result = await webhooks.rotateSecret(1);

    expect(calls[0].url).toBe('https://core.test/webhooks/1/rotate-secret');
    expect(result.secret).toBe('whsec_new');
  });
});

describe('Accounts', () => {
  test('create() POSTs /v2/accounts and returns the one-time keys', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: {
          customerId: 'cus_1',
          keys: { sdkKey: 'sdk_1', adminKey: 'admin_1', sendingKey: 'send_1' },
        },
      }),
    );
    const accounts = new Accounts(client);
    const result = await accounts.create({ email: 'reseller@example.com' });

    expect(calls[0].url).toBe('https://core.test/v2/accounts');
    expect(result.keys.adminKey).toBe('admin_1');
  });

  test('a 403 from an under-scoped key maps to InsufficientPermissionsError', async () => {
    const { client } = mockClient(() =>
      json(
        { data: null, error: { name: 'insufficient_permissions', message: 'requires reseller' } },
        403,
      ),
    );
    const accounts = new Accounts(client);
    const err = await accounts.create({ email: 'x@example.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientPermissionsError);
  });
});

describe('Subscriptions', () => {
  test('list() GETs /subscriptions with the safe projection', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: [
          {
            id: 1,
            channel: 'website',
            created_at: 'now',
            context: { url: 'https://example.com' },
            users: { external_id: 'u1', email: null, name: null },
          },
        ],
        page: 1,
        limit: 20,
      }),
    );
    const subscriptions = new Subscriptions(client);
    const result = await subscriptions.list();

    expect(calls[0].url).toBe('https://core.test/subscriptions');
    expect(result.data[0]).not.toHaveProperty('subscription_object');
  });
});

describe('Keys', () => {
  test('list() GETs /keys and unwraps the masked metadata array', async () => {
    const { client, calls } = mockClient(() =>
      json({
        data: [{ role: 'admin', start: 'sk_abc', createdAt: 'now', enabled: true }],
      }),
    );
    const keys = new Keys(client);
    const result = await keys.list();

    expect(calls[0].url).toBe('https://core.test/keys');
    expect(result[0].role).toBe('admin');
  });
});

describe('VapidKeys', () => {
  test('getPublic() GETs /vapid-keys and does NOT unwrap a { data } envelope', async () => {
    const { client, calls } = mockClient(() => json({ publicVapidKey: 'BAbc123' }));
    const vapidKeys = new VapidKeys(client);
    const result = await vapidKeys.getPublic();

    expect(calls[0].url).toBe('https://core.test/vapid-keys');
    expect(result).toEqual({ publicVapidKey: 'BAbc123' });
  });
});
