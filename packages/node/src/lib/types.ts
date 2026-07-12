// Shared public types (Contract §3-§5). Kept in their own module so
// resource classes stay thin and consumers get precise IntelliSense.

import type { PushToError } from './errors';

// ── Pagination (Contract §5.3 — "paginated lists return `{ data, page, limit }`") ─

export interface PageParams {
  page?: number;
  limit?: number;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  limit: number;
}

// ── Idempotency & cross-cutting send result shape (Contract §5.1-§5.3) ────────

export interface IdempotencyOptions {
  /** 1-255 printable ASCII chars. Validated locally to fail fast (Contract §5.1). */
  idempotencyKey?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * The N-3 `zero_recipients` signal (Contract §5.5) — a string-literal union
 * so `result.warnings?.includes('zero_recipients')` needs no magic string,
 * while staying open (`string & {}`) for a future additive warning.
 */
export type PushToWarning = 'zero_recipients' | (string & {});

/**
 * Every send method's return value: the unwrapped `data` payload plus two
 * SDK-added siblings surfaced from response headers (Contract §5.1/§5.2).
 * `replayed`/`rateLimit` are optional — a replayed idempotent response omits
 * `ratelimit-*` headers (Known Issues & WIP), and a first-time response has
 * no `Idempotency-Replayed` header at all.
 */
export type SendResult<T> = T & {
  replayed?: boolean;
  rateLimit?: RateLimitInfo;
};

/** One element of a `notifications.batch()` result — success or a typed per-item error. */
export type BatchItemResult<T> = T | { error: PushToError };

/**
 * `notifications.batch()`'s return value: an array positionally aligned to
 * the input (Contract §5.4), carrying the same `replayed`/`rateLimit`
 * siblings as a single send result, plus an `errors()` helper returning the
 * failed indices. A real JS array with extra own properties — iterate/index
 * it exactly like `BatchItemResult<T>[]`.
 */
export type BatchResult<T> = BatchItemResult<T>[] & {
  replayed?: boolean;
  rateLimit?: RateLimitInfo;
  /** The indices of `notifications.batch()` items that failed (an `{ error }` element). */
  errors(): number[];
};

// ── Targeting & content (Contract §4 — mirrors `_shared/schemas.ts` exactly) ──

export type TargetSelector =
  | { audience: string }
  | { topic: string }
  | { property: { name: string; contains: string } }
  | { all: true };

/** A union of 1-25 selectors, deduped by subscription at send time. */
export interface Target {
  any: TargetSelector[];
}

export interface InlineCopy {
  title: string;
  body: string;
  icon?: string;
  link?: string;
}

export interface TemplateRef {
  template: string;
  variables?: Record<string, string>;
}

export type NotificationContent = InlineCopy | TemplateRef;

export interface Override {
  when: TargetSelector;
  priority: number;
  notification: NotificationContent;
}

// ── Topics — state enums (`_shared/schemas.ts`'s `TopicDefaultEnum`/`TopicStateEnum`) ─

export type TopicDefaultSubscription = 'opt_in' | 'opt_out';
export type TopicState = 'subscribed' | 'unsubscribed';

// ── Contact properties — value/type enums (`_shared/schemas.ts`) ──────────────

export type ContactPropertyValueType = 'string' | 'string_array';
export type ContactPropertyValue = string | string[];

// ── Webhooks — event taxonomy (`_shared/webhooks/events.ts`) ──────────────────

export type WebhookEventType =
  | 'notification.delivered'
  | 'notification.clicked'
  | 'notification.bounced';

export type WebhookStatus = 'enabled' | 'disabled';

// ── Delivery stats embedded on Wave 5 list reads (`_shared/track/send-stats.ts`) ─

export type EventStatus =
  | 'pending'
  | 'failed'
  | 'delivered'
  | 'clicked'
  | 'auto-dismissed'
  | 'expired'
  | 'ignored'
  | 'closed';

export type StatusHistogram = Record<EventStatus, number>;

export interface SendStats {
  recipients: number;
  byStatus: StatusHistogram;
  reached: number;
  engaged: number;
}
