// Type-level contract suite (Contract §8): asserts the SHIPPED public types
// — packages/node/dist/index.d.ts — match the edge Zod shapes 1:1 for
// selectors, content unions, and the typed error catalog. Uses TypeScript's
// native `// @ts-expect-error` directive for negative cases (no `tsd`
// dependency needed — see README's "Build" section / web-sdk's
// readme-check precedent for the same pattern).
//
// Run (after `bun run build`):
//   bunx tsc --noEmit -p tools/type-contract-check/tsconfig.json

import {
  GatewayTimeoutError,
  IdempotencyConflictError,
  InsufficientPermissionsError,
  InvalidIdempotencyKeyError,
  InvalidTokenError,
  MonthlyQuotaExceededError,
  NotFoundError,
  PushToError,
  RateLimitError,
  ValidationError,
  type BatchResult,
  type InlineCopy,
  type NotificationContent,
  type Override,
  type PushToWarning,
  type SendResult,
  type Target,
  type TargetSelector,
  type TemplateRef,
} from '@push-to/node';

// ── §4 — TargetSelector: exactly the 4 kinds, each `.strict()` edge-side ───

const audienceSelector: TargetSelector = { audience: 'vip' };
const topicSelector: TargetSelector = { topic: 'news' };
const propertySelector: TargetSelector = { property: { name: 'plan', contains: 'pro' } };
const allSelector: TargetSelector = { all: true };

// A wrong value type on a known selector key is caught (TS can't catch
// COMBINING two selector kinds in one object here — `TargetSelector` has no
// shared discriminant tag across its 4 members, and TS's excess-property
// check for object literals is per-property-across-the-union, not
// per-member — a known, documented TS limitation for non-discriminated
// unions. That combination is still caught at RUNTIME: each branch is
// `.strict()` edge-side (Contract §4), so a mixed body 422s. Types catch
// the common mistakes at author time; the edge catches the rest.
// @ts-expect-error - `audience` must be a string, not a number
const invalidSelectorValue: TargetSelector = { audience: 123 };

// `all` must be the literal `true`, not `boolean`.
// @ts-expect-error - `all` is `literal(true)`, not a general boolean
const invalidAllSelector: TargetSelector = { all: false };

const target: Target = { any: [audienceSelector, topicSelector, propertySelector, allSelector] };

// ── §4 — NotificationContent: InlineCopy | TemplateRef (mutually exclusive) ─

const inlineCopy: InlineCopy = { title: 't', body: 'b' };
const templateRef: TemplateRef = { template: 'welcome' };
const asInline: NotificationContent = inlineCopy;
const asTemplate: NotificationContent = templateRef;

// `InlineCopy` requires BOTH `title` and `body` — a partial object is
// rejected (same "no shared discriminant" caveat as above applies to
// combining `title`+`template` in one literal; that combination is caught
// edge-side by the disjoint `.strict()` schemas, per Contract §4).
// @ts-expect-error - InlineCopy requires `body`, not just `title`
const invalidContent: NotificationContent = { title: 't' };

const override: Override = { when: topicSelector, priority: 1, notification: inlineCopy };

// ── §5.5 — PushToWarning: an open string-literal union, `'zero_recipients'` first ─

const knownWarning: PushToWarning = 'zero_recipients';
// Open for forward-compat — a future additive warning name must still be assignable.
const futureWarning: PushToWarning = 'some_future_warning';

// ── §5.6 — the typed error catalog: every subclass extends PushToError ─────

const errors: PushToError[] = [
  new InvalidTokenError('x'),
  new InsufficientPermissionsError('x'),
  new NotFoundError('x'),
  new ValidationError('x'),
  new InvalidIdempotencyKeyError('x'),
  new IdempotencyConflictError('idempotency_conflict', 'x'),
  new MonthlyQuotaExceededError('x'),
  new RateLimitError('x'),
  new GatewayTimeoutError('x'),
  new PushToError('unknown', 'x'),
];

// `.details` is ONLY on ValidationError, not the base class or a sibling.
const validationError = new ValidationError('x', { details: [{ message: 'bad' }] });
const details: Array<{ message: string }> | undefined = validationError.details;

// @ts-expect-error - `.details` does not exist on the base PushToError
const baseHasNoDetails = new PushToError('unknown', 'x').details;

// `.retryAfter` is ONLY on MonthlyQuotaExceededError/RateLimitError.
const quotaError = new MonthlyQuotaExceededError('x', { retryAfter: 60 });
const retryAfter: number | undefined = quotaError.retryAfter;

// @ts-expect-error - `.retryAfter` does not exist on NotFoundError
const notFoundHasNoRetryAfter = new NotFoundError('x').retryAfter;

// IdempotencyConflictError's constructor requires the actual wire name —
// it cannot be constructed with an unrelated error name.
// @ts-expect-error - IdempotencyConflictError only accepts its two documented wire names
const invalidConflictError = new IdempotencyConflictError('not_found', 'x');

// ── §5.1/§5.3/§5.4 — send/batch result shapes carry the optional siblings ──

interface Data {
  id: number;
}

const sendResult: SendResult<Data> = { id: 1, replayed: true, rateLimit: { limit: 1, remaining: 1, reset: 1 } };
const sendResultWithoutSiblings: SendResult<Data> = { id: 1 };

const batchResult = [{ id: 1 }, { error: new NotFoundError('x') }] as unknown as BatchResult<Data>;
const failedIndices: number[] = batchResult.errors();

// Mark every declaration used (avoids an unrelated "declared but never read"
// diagnostic obscuring the intentional @ts-expect-error assertions above).
void [
  target,
  override,
  asInline,
  asTemplate,
  knownWarning,
  futureWarning,
  errors,
  details,
  retryAfter,
  sendResult,
  sendResultWithoutSiblings,
  failedIndices,
  invalidSelectorValue,
  invalidAllSelector,
  invalidContent,
  baseHasNoDetails,
  notFoundHasNoRetryAfter,
  invalidConflictError,
];
