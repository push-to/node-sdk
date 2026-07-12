// pushto.audiences — segments/grouping (Contract §3, §7.1 RATIFIED naming).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { PageParams, PageResult } from '../lib/types';

export interface Audience {
  id: number;
  name: string;
  description: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  customer_id: string;
}

export interface CreateAudienceInput {
  name: string;
  description?: string;
}

export interface UpdateAudienceInput {
  name?: string;
  description?: string;
}

/** The raw `audience_users` join row `addContact` inserts. */
export interface AudienceUserLink {
  audience_id: number;
  user_id: number;
  created_at: string;
}

export interface AudienceBatchLinkResult {
  audienceName: string;
  userId: string;
}

export class Audiences {
  constructor(private readonly client: HttpClient) {}

  /** `POST /audiences`. */
  async create(input: CreateAudienceInput): Promise<Audience> {
    const { json } = await this.client.request<{ data: Audience }>('POST', '/audiences', {
      body: input,
    });
    return unwrapData<Audience>(json);
  }

  /** `GET /audiences` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<Audience>> {
    const { json } = await this.client.request<PageResult<Audience>>('GET', '/audiences', {
      query: { page: params.page, limit: params.limit },
    });
    return toPageResult<Audience>(json);
  }

  /** `GET /audiences/all` — every audience for the tenant, unpaginated. */
  async listAll(): Promise<Audience[]> {
    const { json } = await this.client.request<{ data: Audience[] }>('GET', '/audiences/all');
    return unwrapData<Audience[]>(json);
  }

  /** `GET /audiences/:audienceId`. */
  async get(audienceId: number): Promise<Audience> {
    const { json } = await this.client.request<{ data: Audience }>(
      'GET',
      `/audiences/${audienceId}`,
    );
    return unwrapData<Audience>(json);
  }

  /** `PATCH /audiences/:audienceId`. */
  async update(audienceId: number, patch: UpdateAudienceInput): Promise<Audience> {
    const { json } = await this.client.request<{ data: Audience }>(
      'PATCH',
      `/audiences/${audienceId}`,
      { body: patch },
    );
    return unwrapData<Audience>(json);
  }

  /** `DELETE /audiences/:audienceId`. */
  async remove(audienceId: number): Promise<void> {
    await this.client.request('DELETE', `/audiences/${audienceId}`);
  }

  /**
   * `GET /users/:userId/audiences` — `:userId` = `external_id`.
   *
   * Deviation flagged for edge-functions-engineer: unlike every other list
   * route in this API, this edge handler returns a BARE array (no `{ data
   * }` envelope, no `page`/`limit`) and never reads `page`/`limit` from the
   * query string at all — the underlying `DatabaseClient.listAudiencesForUser`
   * accepts them, but `users/controllers/list-audiences-controller.ts` never
   * passes them through. `params` is still accepted here (frozen contract
   * surface, and the query string is harmless to send) but has NO EFFECT
   * server-side today — every audience for the contact is always returned.
   */
  async listForContact(externalId: string, params: PageParams = {}): Promise<Audience[]> {
    const { json } = await this.client.request<Audience[]>(
      'GET',
      `/users/${encodeURIComponent(externalId)}/audiences`,
      { query: { page: params.page, limit: params.limit } },
    );
    return json;
  }

  /**
   * `POST /users/:userId/audiences/:audienceName`.
   *
   * Deviation flagged for edge-functions-engineer: this route returns the
   * raw `audience_users` join row, NOT the `{ data }` envelope. An unknown
   * `externalId`/`audienceName` also throws a plain `Error` edge-side,
   * which `withRequest`'s catch-all turns into an opaque `500
   * internal_error` — not the `404 not_found` you'd expect (unlike every
   * other unknown-resource path in this API).
   */
  async addContact(externalId: string, audienceName: string): Promise<AudienceUserLink> {
    const { json } = await this.client.request<AudienceUserLink>(
      'POST',
      `/users/${encodeURIComponent(externalId)}/audiences/${encodeURIComponent(audienceName)}`,
    );
    return json;
  }

  /** `POST /users/:userId/audiences/batch` — bare array, no `{ data }` envelope. */
  async addContactBatch(
    externalId: string,
    audienceNames: string[],
  ): Promise<AudienceBatchLinkResult[]> {
    const { json } = await this.client.request<AudienceBatchLinkResult[]>(
      'POST',
      `/users/${encodeURIComponent(externalId)}/audiences/batch`,
      { body: { audienceNames } },
    );
    return json;
  }

  /** `DELETE /users/:userId/audiences/:audienceName` — bare `true`, no `{ data }` envelope. */
  async removeContact(externalId: string, audienceName: string): Promise<void> {
    await this.client.request(
      'DELETE',
      `/users/${encodeURIComponent(externalId)}/audiences/${encodeURIComponent(audienceName)}`,
    );
  }

  /** `DELETE /users/:userId/audiences/all` — bare `true`, no `{ data }` envelope. */
  async removeAllForContact(externalId: string): Promise<void> {
    await this.client.request(
      'DELETE',
      `/users/${encodeURIComponent(externalId)}/audiences/all`,
    );
  }
}
