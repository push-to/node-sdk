// pushto.contacts.properties — the tenant's client-writable property
// definitions allowlist (Post-Program N-2, ADR-002).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { ContactPropertyValueType, PageParams, PageResult } from '../lib/types';

export interface ContactPropertyDefinition {
  id: number;
  key: string;
  value_type: ContactPropertyValueType;
  client_writable: boolean;
  created_at: string;
}

export interface CreateContactPropertyDefinitionInput {
  key: string;
  /** Default `'string_array'` (the migration's default-deny default) when omitted. */
  value_type?: ContactPropertyValueType;
  /** Default `false` when omitted — this endpoint is the only way to opt a key IN. */
  client_writable?: boolean;
}

export interface UpdateContactPropertyDefinitionInput {
  value_type?: ContactPropertyValueType;
  client_writable?: boolean;
}

export class ContactProperties {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/contact-properties` — declares a `key` client-writable (or not). */
  async create(input: CreateContactPropertyDefinitionInput): Promise<ContactPropertyDefinition> {
    const { json } = await this.client.request<{ data: ContactPropertyDefinition }>(
      'POST',
      '/v2/contact-properties',
      { body: input },
    );
    return unwrapData<ContactPropertyDefinition>(json);
  }

  /** `GET /v2/contact-properties` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<ContactPropertyDefinition>> {
    const { json } = await this.client.request<PageResult<ContactPropertyDefinition>>(
      'GET',
      '/v2/contact-properties',
      { query: { page: params.page, limit: params.limit } },
    );
    return toPageResult<ContactPropertyDefinition>(json);
  }

  /** `PATCH /v2/contact-properties/:id` — `value_type`/`client_writable` only; `key` has no update path. */
  async update(
    id: number,
    patch: UpdateContactPropertyDefinitionInput,
  ): Promise<ContactPropertyDefinition> {
    const { json } = await this.client.request<{ data: ContactPropertyDefinition }>(
      'PATCH',
      `/v2/contact-properties/${id}`,
      { body: patch },
    );
    return unwrapData<ContactPropertyDefinition>(json);
  }

  /** `DELETE /v2/contact-properties/:id` — removes an allowlist row only, never a contact's `properties`. */
  async remove(id: number): Promise<void> {
    await this.client.request('DELETE', `/v2/contact-properties/${id}`);
  }
}
