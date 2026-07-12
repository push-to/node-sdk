// pushto.broadcasts — audience/union sends (Contract §3).

import type { HttpClient } from '../lib/http-client';
import { toPageResult, toSendResult } from '../lib/response';
import type {
  IdempotencyOptions,
  NotificationContent,
  Override,
  PageParams,
  PageResult,
  PushToWarning,
  SendResult,
  SendStats,
  Target,
} from '../lib/types';
import { BroadcastPresets } from './broadcast-presets';

export interface BroadcastSendInput {
  template: string;
  variables?: Record<string, string>;
}

export interface CreateBroadcastInput {
  target: Target;
  default: NotificationContent;
  overrides?: Override[];
  tag?: string;
  /** Delivery GATE — distinct from a `{topic}` selector inside `target.any`. */
  topic?: string;
  /** `false` (default) creates a draft; `true` creates AND fans out in one call. */
  send?: boolean;
}

export interface BroadcastSendData {
  id: number;
  recipients: number;
  stats: { success: number; error: number };
  /** `['zero_recipients']` on a preset send resolving to 0 recipients (a `200`, not an error). */
  warnings?: PushToWarning[];
}

export interface BroadcastCreateData {
  id: number;
  /** Present (`'draft'`) only when `send` was `false`/omitted. */
  status?: 'draft';
  /** Present only when `send: true`. */
  recipients?: number;
  stats?: { success: number; error: number };
  warnings?: PushToWarning[];
}

export interface BroadcastListItem {
  id: number;
  created_at: string;
  /** The persisted, rendered copy — note `message`, not `body` (the DB column name). */
  content: { title: string; message: string };
  link: string | null;
  audience_id: number | null;
  scheduled_at: string | null;
  stats: SendStats;
}

export class Broadcasts {
  readonly presets: BroadcastPresets;

  constructor(private readonly client: HttpClient) {
    this.presets = new BroadcastPresets(client);
  }

  /**
   * `POST /v2/broadcasts` (preset form) — the headline N-3 send. Always
   * fans out (`send: true`); use `presets.create`/`update` to author the
   * reusable definition first.
   */
  async send(
    input: BroadcastSendInput,
    options: IdempotencyOptions = {},
  ): Promise<SendResult<BroadcastSendData>> {
    const { json, headers } = await this.client.request<{ data: BroadcastSendData }>(
      'POST',
      '/v2/broadcasts',
      {
        body: { template: input.template, variables: input.variables ?? {}, send: true },
        idempotencyKey: options.idempotencyKey,
        retryable: true,
      },
    );
    return toSendResult<BroadcastSendData>(json, headers);
  }

  /**
   * `POST /v2/broadcasts` (inline form) — union `target.any` + `overrides[]`
   * + optional `tag`/`topic` gate. `send: false` (default) creates a draft;
   * `send: true` creates AND fans out in the same call. Never sends
   * `{ template, target }` together — the edge `422`s that.
   */
  async create(
    input: CreateBroadcastInput,
    options: IdempotencyOptions = {},
  ): Promise<SendResult<BroadcastCreateData>> {
    const { json, headers } = await this.client.request<{ data: BroadcastCreateData }>(
      'POST',
      '/v2/broadcasts',
      { body: input, idempotencyKey: options.idempotencyKey, retryable: true },
    );
    return toSendResult<BroadcastCreateData>(json, headers);
  }

  /** `POST /v2/broadcasts/:id/send` — fans out a `send: false` draft. */
  async sendDraft(
    id: number,
    options: IdempotencyOptions = {},
  ): Promise<SendResult<BroadcastSendData>> {
    const { json, headers } = await this.client.request<{ data: BroadcastSendData }>(
      'POST',
      `/v2/broadcasts/${id}/send`,
      { idempotencyKey: options.idempotencyKey, retryable: true },
    );
    return toSendResult<BroadcastSendData>(json, headers);
  }

  /** `GET /broadcasts` — broadcast history (Wave 5 dashboard read, v1 path). */
  async list(params: PageParams = {}): Promise<PageResult<BroadcastListItem>> {
    const { json } = await this.client.request<PageResult<BroadcastListItem>>(
      'GET',
      '/broadcasts',
      { query: { page: params.page, limit: params.limit } },
    );
    return toPageResult<BroadcastListItem>(json);
  }
}
