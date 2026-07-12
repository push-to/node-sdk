// pushto.topics — preference categories (Phase 4 Increment D).
//
// `POST /v2/topics/preferences` (the browser possession-proof write) is
// deliberately EXCLUDED — servers set opt-state via
// `contacts.update(id, { topics })` instead (Contract §1).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { PageParams, PageResult, TopicDefaultSubscription } from '../lib/types';

export interface Topic {
  id: number;
  name: string;
  default_subscription: TopicDefaultSubscription;
  created_at: string;
  updated_at: string;
}

export interface CreateTopicInput {
  name: string;
  default_subscription?: TopicDefaultSubscription;
}

export interface UpdateTopicInput {
  /** `name` has no update path — only `default_subscription` is mutable. */
  default_subscription?: TopicDefaultSubscription;
}

export class Topics {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/topics`. */
  async create(input: CreateTopicInput): Promise<Topic> {
    const { json } = await this.client.request<{ data: Topic }>('POST', '/v2/topics', {
      body: input,
    });
    return unwrapData<Topic>(json);
  }

  /** `GET /v2/topics` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<Topic>> {
    const { json } = await this.client.request<PageResult<Topic>>('GET', '/v2/topics', {
      query: { page: params.page, limit: params.limit },
    });
    return toPageResult<Topic>(json);
  }

  /** `PATCH /v2/topics/:id` — `{ default_subscription? }` only. */
  async update(id: number, patch: UpdateTopicInput): Promise<Topic> {
    const { json } = await this.client.request<{ data: Topic }>('PATCH', `/v2/topics/${id}`, {
      body: patch,
    });
    return unwrapData<Topic>(json);
  }

  /** `DELETE /v2/topics/:id` — `204`. `contact_topics` rows cascade-delete. */
  async remove(id: number): Promise<void> {
    await this.client.request('DELETE', `/v2/topics/${id}`);
  }
}
