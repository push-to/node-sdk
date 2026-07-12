// pushto.broadcasts.presets — reusable, parameterized send definitions (Post-Program N-3).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, unwrapData } from '../lib/response';
import type { NotificationContent, Override, PageParams, PageResult, Target } from '../lib/types';

/**
 * A preset's stored, UNRESOLVED body — names stay names, `{{slots}}` stay
 * literal (ADR-001 Decision 2). Structurally `CreateV2BroadcastInput` minus
 * `send` (`_shared/schemas.ts`'s `PresetDefinitionSchema`).
 */
export interface BroadcastDefinition {
  target: Target;
  default: NotificationContent;
  overrides?: Override[];
  tag?: string;
  topic?: string;
}

export interface CreatePresetInput {
  name: string;
  definition: BroadcastDefinition;
}

export interface UpdatePresetInput {
  name?: string;
  definition?: BroadcastDefinition;
}

export interface BroadcastPreset {
  id: number;
  name: string;
  definition: BroadcastDefinition;
  /** Auto-derived `{{slots}}` in `default`/`overrides[].notification` — never client-supplied. */
  variables: string[];
  /** Auto-derived `{{slots}}` inside `target`/`topic` — never client-supplied. */
  targeting_variables: string[];
  created_at: string;
  updated_at: string;
}

export class BroadcastPresets {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/broadcast-presets` — auto-derives `variables`/`targeting_variables` from `definition`. */
  async create(input: CreatePresetInput): Promise<BroadcastPreset> {
    const { json } = await this.client.request<{ data: BroadcastPreset }>(
      'POST',
      '/v2/broadcast-presets',
      { body: input },
    );
    return unwrapData<BroadcastPreset>(json);
  }

  /** `GET /v2/broadcast-presets` — paginated. */
  async list(params: PageParams = {}): Promise<PageResult<BroadcastPreset>> {
    const { json } = await this.client.request<PageResult<BroadcastPreset>>(
      'GET',
      '/v2/broadcast-presets',
      { query: { page: params.page, limit: params.limit } },
    );
    return toPageResult<BroadcastPreset>(json);
  }

  /** `GET /v2/broadcast-presets/:id`. */
  async get(id: number): Promise<BroadcastPreset> {
    const { json } = await this.client.request<{ data: BroadcastPreset }>(
      'GET',
      `/v2/broadcast-presets/${id}`,
    );
    return unwrapData<BroadcastPreset>(json);
  }

  /**
   * `PATCH /v2/broadcast-presets/:id` — partial-write: only supplied fields
   * are written; `variables`/`targeting_variables` re-derive only when
   * `definition` is in the patch (N-3 review).
   */
  async update(id: number, patch: UpdatePresetInput): Promise<BroadcastPreset> {
    const { json } = await this.client.request<{ data: BroadcastPreset }>(
      'PATCH',
      `/v2/broadcast-presets/${id}`,
      { body: patch },
    );
    return unwrapData<BroadcastPreset>(json);
  }

  /** `DELETE /v2/broadcast-presets/:id` — `204`. */
  async remove(id: number): Promise<void> {
    await this.client.request('DELETE', `/v2/broadcast-presets/${id}`);
  }
}
