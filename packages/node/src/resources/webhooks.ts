// pushto.webhooks — outbound delivery events (Phase 4 Increment A).
// v1 paths — no `/v2` prefix.

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { PageParams, PageResult, WebhookEventType, WebhookStatus } from '../lib/types';

/** The safe projection — `secret_id` is never selected (Security Ruling 1). */
export interface Webhook {
  id: number;
  customer_id: string;
  url: string;
  enabled_events: WebhookEventType[];
  status: WebhookStatus;
  created_at: string;
  updated_at: string;
}

/** Only present on `create`/`rotateSecret` — the plaintext `whsec_` secret, returned exactly once. */
export interface WebhookWithSecret extends Webhook {
  secret: string;
}

export interface CreateWebhookEndpointInput {
  url: string;
  enabledEvents?: WebhookEventType[];
}

export interface UpdateWebhookEndpointInput {
  url?: string;
  enabledEvents?: WebhookEventType[];
  status?: WebhookStatus;
}

export class Webhooks {
  constructor(private readonly client: HttpClient) {}

  /** `POST /webhooks` — returns the `whsec_` secret ONCE. */
  async create(input: CreateWebhookEndpointInput): Promise<WebhookWithSecret> {
    const { json } = await this.client.request<{ data: WebhookWithSecret }>(
      'POST',
      '/webhooks',
      { body: input },
    );
    return unwrapData<WebhookWithSecret>(json);
  }

  /** `GET /webhooks` — paginated, `secret` omitted. */
  async list(params: PageParams = {}): Promise<PageResult<Webhook>> {
    const { json } = await this.client.request<PageResult<Webhook>>('GET', '/webhooks', {
      query: { page: params.page, limit: params.limit },
    });
    return toPageResult<Webhook>(json);
  }

  /** `GET /webhooks/:id` — `secret` omitted. */
  async get(id: number): Promise<Webhook> {
    const { json } = await this.client.request<{ data: Webhook }>('GET', `/webhooks/${id}`);
    return unwrapData<Webhook>(json);
  }

  /** `PATCH /webhooks/:id`. */
  async update(id: number, patch: UpdateWebhookEndpointInput): Promise<Webhook> {
    const { json } = await this.client.request<{ data: Webhook }>(
      'PATCH',
      `/webhooks/${id}`,
      { body: patch },
    );
    return unwrapData<Webhook>(json);
  }

  /** `DELETE /webhooks/:id` — `204`. */
  async remove(id: number): Promise<void> {
    await this.client.request('DELETE', `/webhooks/${id}`);
  }

  /** `POST /webhooks/:id/rotate-secret` — returns the new `whsec_` secret ONCE; overwrites in place (no grace window). */
  async rotateSecret(id: number): Promise<{ secret: string }> {
    const { json } = await this.client.request<{ data: { secret: string } }>(
      'POST',
      `/webhooks/${id}/rotate-secret`,
    );
    return unwrapData<{ secret: string }>(json);
  }
}
