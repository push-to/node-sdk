// pushto.notifications — transactional & batch send (Contract §3).

import type { HttpClient } from '../lib/http-client';
import { toBatchResult, toPageResult, toSendResult } from '../lib/response';
import type {
  BatchResult,
  IdempotencyOptions,
  NotificationContent,
  PageParams,
  PageResult,
  SendResult,
  SendStats,
} from '../lib/types';

export interface NotificationTarget {
  /** External (contact) ids. Combined with `subscriptions`, 1-100 total. */
  users?: string[];
  /** Subscription ids. Combined with `users`, 1-100 total. */
  subscriptions?: number[];
}

export interface SendNotificationInput {
  to: NotificationTarget;
  notification: NotificationContent;
  /** Gates the resolved targets to this topic's opted-in contacts. */
  topic?: string;
}

export interface NotificationSendData {
  id: number;
  /** Deduped resolved recipient count — an unresolved target is silently skipped, not an error. */
  recipients: number;
  stats: { success: number; error: number };
}

export interface NotificationListItem {
  id: number;
  created_at: string;
  /** The persisted, rendered copy — note `message`, not `body` (the DB column name). */
  content: { title: string; message: string };
  link: string | null;
  scheduled_at: string | null;
  stats: SendStats;
}

export class Notifications {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/notifications` — send to explicit `to.users`/`to.subscriptions`. */
  async send(
    input: SendNotificationInput,
    options: IdempotencyOptions = {},
  ): Promise<SendResult<NotificationSendData>> {
    const { json, headers } = await this.client.request<{ data: NotificationSendData }>(
      'POST',
      '/v2/notifications',
      { body: input, idempotencyKey: options.idempotencyKey, retryable: true },
    );
    return toSendResult<NotificationSendData>(json, headers);
  }

  /** `POST /v2/notifications/batch` — up to 100 distinct per-recipient sends, one Idempotency-Key for the whole array. */
  async batch(
    items: SendNotificationInput[],
    options: IdempotencyOptions = {},
  ): Promise<BatchResult<NotificationSendData>> {
    const { json, headers } = await this.client.request(
      'POST',
      '/v2/notifications/batch',
      { body: { notifications: items }, idempotencyKey: options.idempotencyKey, retryable: true },
    );
    return toBatchResult<NotificationSendData>(json, headers);
  }

  /** `GET /notifications` — send history (Wave 5 dashboard read, v1 path). */
  async list(params: PageParams = {}): Promise<PageResult<NotificationListItem>> {
    const { json } = await this.client.request<PageResult<NotificationListItem>>(
      'GET',
      '/notifications',
      { query: { page: params.page, limit: params.limit } },
    );
    return toPageResult<NotificationListItem>(json);
  }
}
