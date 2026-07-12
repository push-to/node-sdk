// pushto.contacts — contact management (Contract §3). Concept: contacts vs
// subscriptions — see docs/Notes/Contact vs Subscription.md.
//
// The two possession-proof, browser-facing writes (`POST
// /v2/topics/preferences`, `POST /v2/contacts/properties`) are deliberately
// EXCLUDED — they belong to `@push-to/web`. A server sets the same state
// through `update(id, { properties, topics })` instead (Contract §1).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { PageParams, PageResult, TopicState } from '../lib/types';
import { ContactProperties } from './contact-properties';

export interface Contact {
  id: number;
  anonymous_id: string;
  customer_id: string | null;
  created_at: string;
  email: string | null;
  external_id: string | null;
  image_url: string | null;
  language: string | null;
  name: string | null;
  properties: Record<string, unknown>;
}

export interface ContactTopicSummary {
  name: string;
  /** This contact's EFFECTIVE opt-state: an explicit row if present, else the topic's own `default_subscription`. */
  state?: TopicState;
}

export interface ContactWithSummary extends Contact {
  topics: ContactTopicSummary[];
  /** Device count only — never the raw subscription rows. */
  subscriptionCount: number;
}

export interface UpsertContactInput {
  external_id: string;
  /** Shallow-merged into the contact's existing `properties`. */
  properties?: Record<string, unknown>;
  /** `{ <topic name>: state }` — every name resolved (and 422'd on unknown) BEFORE any write. */
  topics?: Record<string, TopicState>;
}

export interface PatchContactInput {
  properties?: Record<string, unknown>;
  topics?: Record<string, TopicState>;
}

export class Contacts {
  readonly properties: ContactProperties;

  constructor(private readonly client: HttpClient) {
    this.properties = new ContactProperties(client);
  }

  /** `POST /v2/contacts` — upsert by `external_id` (create on first sight, update on repeat). */
  async upsert(input: UpsertContactInput): Promise<Contact> {
    const { json } = await this.client.request<{ data: Contact }>('POST', '/v2/contacts', {
      body: input,
    });
    return unwrapData<Contact>(json);
  }

  /** `GET /v2/contacts` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<Contact>> {
    const { json } = await this.client.request<PageResult<Contact>>('GET', '/v2/contacts', {
      query: { page: params.page, limit: params.limit },
    });
    return toPageResult<Contact>(json);
  }

  /** `GET /v2/contacts/:id` — `:id` = `external_id`; includes topic opt-state + `subscriptionCount`. */
  async get(externalId: string): Promise<ContactWithSummary> {
    const { json } = await this.client.request<{ data: ContactWithSummary }>(
      'GET',
      `/v2/contacts/${encodeURIComponent(externalId)}`,
    );
    return unwrapData<ContactWithSummary>(json);
  }

  /**
   * `PATCH /v2/contacts/:id` — the admin broker path: shallow-merges
   * `properties` and/or sets topic opt-state. This is the server-side way
   * to set what the browser SDK does via the excluded possession-proof
   * endpoint.
   */
  async update(externalId: string, patch: PatchContactInput): Promise<Contact> {
    const { json } = await this.client.request<{ data: Contact }>(
      'PATCH',
      `/v2/contacts/${encodeURIComponent(externalId)}`,
      { body: patch },
    );
    return unwrapData<Contact>(json);
  }
}
