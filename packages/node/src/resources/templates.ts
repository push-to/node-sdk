// pushto.templates — server-stored copy (Phase 4 Increment C).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { PageParams, PageResult } from '../lib/types';

export interface Template {
  id: number;
  name: string;
  title: string;
  body: string;
  link: string | null;
  icon: string | null;
  /** Auto-derived `{{var}}` slots — never client-supplied. */
  variables: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  title: string;
  body: string;
  link?: string;
  icon?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  title?: string;
  body?: string;
  link?: string;
  icon?: string;
}

export class Templates {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/templates` — returns the template incl. auto-derived `variables[]`. */
  async create(input: CreateTemplateInput): Promise<Template> {
    const { json } = await this.client.request<{ data: Template }>('POST', '/v2/templates', {
      body: input,
    });
    return unwrapData<Template>(json);
  }

  /** `GET /v2/templates` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<Template>> {
    const { json } = await this.client.request<PageResult<Template>>('GET', '/v2/templates', {
      query: { page: params.page, limit: params.limit },
    });
    return toPageResult<Template>(json);
  }

  /** `GET /v2/templates/:id`. */
  async get(id: number): Promise<Template> {
    const { json } = await this.client.request<{ data: Template }>(
      'GET',
      `/v2/templates/${id}`,
    );
    return unwrapData<Template>(json);
  }

  /** `PATCH /v2/templates/:id` — re-derives `variables[]`. */
  async update(id: number, patch: UpdateTemplateInput): Promise<Template> {
    const { json } = await this.client.request<{ data: Template }>(
      'PATCH',
      `/v2/templates/${id}`,
      { body: patch },
    );
    return unwrapData<Template>(json);
  }

  /** `DELETE /v2/templates/:id` — `204`. */
  async remove(id: number): Promise<void> {
    await this.client.request('DELETE', `/v2/templates/${id}`);
  }
}
