// pushto.subscriptions — read-only ops. Registration (`POST /subscriptions`)
// is a browser act — excluded, per Contract §3.

import type { HttpClient } from '../lib/http-client';
import { toPageResult } from '../lib/response';
import type { PageParams, PageResult } from '../lib/types';

/** The safe projection — never `subscription_object` (the push credential). */
export interface SubscriptionListItem {
  id: number;
  channel: 'extension' | 'website';
  created_at: string;
  context: { url?: string } | null;
  users: {
    external_id: string | null;
    email: string | null;
    name: string | null;
  };
}

export class Subscriptions {
  constructor(private readonly client: HttpClient) {}

  /** `GET /subscriptions` — paginated, safe projection (Wave 5 dashboard read). */
  async list(params: PageParams = {}): Promise<PageResult<SubscriptionListItem>> {
    const { json } = await this.client.request<PageResult<SubscriptionListItem>>(
      'GET',
      '/subscriptions',
      { query: { page: params.page, limit: params.limit } },
    );
    return toPageResult<SubscriptionListItem>(json);
  }
}
