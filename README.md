# @push-to/node

<div align="center"><strong>PushTo Node SDK</strong></div>
<div align="center">The server-side admin SDK for <a href="https://pushto.ai">PushTo</a> — a typed, 1:1 wrapper over the frozen PushTo v2 REST surface.<br />Zero runtime dependencies. Dual ESM+CJS. Node ≥ 18.</div>
<br />

## Introduction

`@push-to/node` carries an **admin** (or `sending`, or `reseller`) key server-side and calls the
broker-trusted PushTo API surface — sending notifications and broadcasts, managing contacts,
audiences, topics, templates, webhooks, and reseller sub-accounts. It is **not** the browser SDK:
the two possession-proof, standard-key, browser-facing endpoints belong to
[`@push-to/web`](https://github.com/push-to/web-sdk) instead. A server sets the same state through
the admin path: `pushto.contacts.update(id, { properties, topics })`.

Every method wraps exactly one PushTo REST endpoint — no business logic, no synthetic endpoints.
See [Concepts](#concepts) for the contact/subscription/topic/audience model.

## Install

```sh
npm install @push-to/node
# or
pnpm add @push-to/node
# or
yarn add @push-to/node
```

## Quickstart

```typescript
import { PushTo } from '@push-to/node';

const pushto = new PushTo(process.env.PUSHTO_API_KEY!);
await pushto.broadcasts.send({ template: 'game-day-kickoff', variables: { team: 'KC', opponent: 'BUF' } });
```

## Configuration

```typescript
import { PushTo } from '@push-to/node';

const pushto = new PushTo(apiKey, {
  baseUrl: 'https://api.pushto.ai', // default — the customer-api proxy origin
  timeoutMs: 60_000,                // default — matches the Vercel maxDuration; the proxy aborts ~55s before this fires
  fetch: myFetchImpl,               // injectable for tests/edge runtimes; defaults to the global fetch
  maxRetries: 0,                    // default — retries apply ONLY to idempotent calls (see Idempotency & retries)
});
```

`apiKey` is sent as `Authorization: Bearer <apiKey>`. The SDK never inspects the key tier — the
edge enforces `admin`/`sending`/`reseller` and rejects an under-scoped key with a typed
`InsufficientPermissionsError` (403).

**Runtime:** Node ≥ 18. The SDK relies on the built-in global `fetch`/`AbortController` — **zero
runtime dependencies**, no `node-fetch` shim. The `fetch` option covers older runtimes, Deno/Bun,
and test mocking.

## API reference

Response bodies are unwrapped from the `{ data }` envelope — every method below returns the
payload directly. Paginated lists return `{ data, page, limit }`.

### `pushto.notifications` — transactional & batch send

| Method | Endpoint | Notes |
| --- | --- | --- |
| `send(input, { idempotencyKey? })` | `POST /v2/notifications` | `to.{users,subscriptions}` ≤ 100 combined; inline **or** `{ template, variables }` copy |
| `batch(items, { idempotencyKey? })` | `POST /v2/notifications/batch` | ≤ 100 items; per-index partial failure; one key covers the whole array |
| `list({ page?, limit? })` | `GET /notifications` | Send history |

### `pushto.broadcasts` — audience/union sends

| Method | Endpoint | Notes |
| --- | --- | --- |
| `send({ template, variables }, { idempotencyKey? })` | `POST /v2/broadcasts` (preset form) | **The headline** — always fans out; returns `{ id, recipients, stats, warnings? }` |
| `create(definition, { idempotencyKey? })` | `POST /v2/broadcasts` (inline form) | Union `target.any` + `overrides[]` + `tag` + `topic` gate; `send: false` (default) → draft, `send: true` → fan-out |
| `sendDraft(id, { idempotencyKey? })` | `POST /v2/broadcasts/:id/send` | Fans out a `send: false` draft |
| `list({ page?, limit? })` | `GET /broadcasts` | Broadcast history |
| `presets.create(input)` | `POST /v2/broadcast-presets` | Authors a reusable, parameterized definition |
| `presets.list({ page?, limit? })` | `GET /v2/broadcast-presets` | |
| `presets.get(id)` | `GET /v2/broadcast-presets/:id` | |
| `presets.update(id, patch)` | `PATCH /v2/broadcast-presets/:id` | Partial-write — only supplied fields are written |
| `presets.remove(id)` | `DELETE /v2/broadcast-presets/:id` | |

`broadcasts.send()`/`broadcasts.create()` never mix `{ template, target }` in the same body — the
SDK disambiguates the two body shapes for you.

> [!WARNING]
> **The two-`template`-fields footgun.** `broadcasts.send({ template, variables })`'s top-level
> `template` names a **preset** (authored via `presets.create`). The unrelated, nested
> `default.template` / `overrides[].notification.template` you pass to `broadcasts.create()` (as
> part of a `TemplateRef`) names a **copy template** instead (authored via `pushto.templates`).
> Same field name, different nesting level, completely disjoint schemas — don't confuse a preset
> name for a copy-template name or vice versa.

### `pushto.contacts` — contact management

| Method | Endpoint | Notes |
| --- | --- | --- |
| `upsert(input)` | `POST /v2/contacts` | By `external_id`; optional `properties`, `topics: {name: state}` |
| `list({ page?, limit? })` | `GET /v2/contacts` | |
| `get(externalId)` | `GET /v2/contacts/:id` | Includes properties + per-topic opt-state + `subscriptionCount` |
| `update(externalId, patch)` | `PATCH /v2/contacts/:id` | Admin broker path: shallow-merges `properties` and/or sets `topics` |
| `properties.list()` | `GET /v2/contact-properties` | The tenant's client-writable property allowlist |
| `properties.create(input)` | `POST /v2/contact-properties` | `{ key, value_type?, client_writable? }` |
| `properties.update(id, patch)` | `PATCH /v2/contact-properties/:id` | |
| `properties.remove(id)` | `DELETE /v2/contact-properties/:id` | |

### `pushto.audiences` — segments/grouping

| Method | Endpoint | Notes |
| --- | --- | --- |
| `create(input)` | `POST /audiences` | |
| `list({ page?, limit? })` | `GET /audiences` | |
| `listAll()` | `GET /audiences/all` | Every audience, unpaginated |
| `get(audienceId)` | `GET /audiences/:audienceId` | |
| `update(audienceId, patch)` | `PATCH /audiences/:audienceId` | |
| `remove(audienceId)` | `DELETE /audiences/:audienceId` | |
| `listForContact(externalId)` | `GET /users/:userId/audiences` | See note below |
| `addContact(externalId, audienceName)` | `POST /users/:userId/audiences/:audienceName` | See note below |
| `addContactBatch(externalId, audienceNames[])` | `POST /users/:userId/audiences/batch` | |
| `removeContact(externalId, audienceName)` | `DELETE /users/:userId/audiences/:audienceName` | |
| `removeAllForContact(externalId)` | `DELETE /users/:userId/audiences/all` | |

> [!NOTE]
> The five "on-contact" routes above (`listForContact`/`addContact`/`addContactBatch`/
> `removeContact`/`removeAllForContact`) are a **documented deviation** from this API's usual
> `{ data }` envelope — they return their payload bare (see [Known deviations](#known-deviations-from-the-documented-contract)).
> `listForContact`'s `{ page?, limit? }` parameter is accepted for forward-compatibility but has
> **no effect today** — the edge route always returns every audience for the contact.

### `pushto.topics` — preference categories

`create`/`list`/`update(id, patch)`/`remove(id)` → `POST|GET /v2/topics`, `PATCH|DELETE /v2/topics/:id`.
Servers set a contact's opt-state via `contacts.update(id, { topics })` — the possession-proof
browser write is intentionally not exposed here.

### `pushto.templates` — server-stored copy

`create`/`list`/`get(id)`/`update(id, patch)`/`remove(id)` → `POST|GET /v2/templates`,
`GET|PATCH|DELETE /v2/templates/:id`. Auto-derived `{{var}}` slots are surfaced as `variables`.

### `pushto.webhooks` — outbound delivery events

`create`/`list`/`get(id)`/`update(id, patch)`/`remove(id)` → `/webhooks[/:id]`;
`rotateSecret(id)` → `POST /webhooks/:id/rotate-secret`. `create`/`rotateSecret` return the
`whsec_` secret **exactly once** — `list`/`get` omit it.

### `pushto.accounts` — reseller provisioning

`create(input)` → `POST /v2/accounts`. **Requires a `reseller` key**; mints a sub-tenant + key set
(`{ customerId, keys: { sdkKey, adminKey, sendingKey } }`), returned once.

### `pushto.subscriptions` / `pushto.keys` / `pushto.vapidKeys` — read-only

- `subscriptions.list({ page?, limit? })` → `GET /subscriptions` (safe projection, never the raw
  push credential).
- `keys.list()` → `GET /keys` (masked Unkey metadata — never plaintext).
- `vapidKeys.getPublic()` → `GET /vapid-keys` — primarily a browser concern; included for
  completeness. Registration (`POST /subscriptions`) is a browser act and is not exposed here.

## Typed selectors & content

Selector/content shapes mirror the edge's Zod schemas 1:1, so targeting mistakes are caught at
compile time:

```typescript
type TargetSelector =
  | { audience: string }
  | { topic: string }
  | { property: { name: string; contains: string } }
  | { all: true };

interface Target { any: TargetSelector[] } // 1-25 selectors, deduped by subscription

interface InlineCopy { title: string; body: string; icon?: string; link?: string }
interface TemplateRef { template: string; variables?: Record<string, string> }
type NotificationContent = InlineCopy | TemplateRef;

interface Override {
  when: TargetSelector;
  priority: number;
  notification: NotificationContent;
}
```

The SDK does **not** re-validate beyond types — the edge is the authority (`.strict()`,
`.min`/`.max`, fail-closed). Types catch the common mistakes at author time; the edge catches the
rest with a `ValidationError`.

## Idempotency & retries

```typescript
await pushto.notifications.send(
  { to: { users: ['user_123'] }, notification: { title: 'Hi', body: 'There' } },
  { idempotencyKey: 'order-42-shipped' },
);
```

- Send methods (`notifications.send`/`batch`, `broadcasts.send`/`create`/`sendDraft`) accept
  `{ idempotencyKey?: string }` → sent as the `Idempotency-Key` header (1-255 printable ASCII
  characters; the SDK validates locally and throws `InvalidIdempotencyKeyError` before any network
  call on an invalid key).
- A replayed response is surfaced as `result.replayed === true`.
- **Retries (`maxRetries > 0`) apply ONLY to methods that accept an idempotency key AND only when
  one is supplied** — the SDK never blind-retries a non-idempotent fan-out. On a `409`
  (`idempotency_conflict`/`concurrent_idempotent_requests`), the SDK never retries — that status
  means the same key was reused with a different body (a caller bug), and it throws
  `IdempotencyConflictError` immediately.

## Rate limits & quota

Every send response's IETF headers parse into `result.rateLimit?: { limit, remaining, reset }`. A
`429 monthly_quota_exceeded` throws `MonthlyQuotaExceededError` carrying `retryAfter` (seconds).
**Known limitation:** a replayed idempotent response omits the `ratelimit-*` headers, so
`result.rateLimit` may be `undefined` on a replay — the SDK types it optional for exactly this
reason.

## Warnings

A successful send can carry non-fatal warnings alongside its data. Today, only
`POST /v2/broadcasts` (the preset form) emits one: `data.warnings: ['zero_recipients']` when a
preset/union resolves to **zero recipients** — a legitimate `200`, not an error:

```typescript
const result = await pushto.broadcasts.send({ template: 'game-day-kickoff', variables: { team: 'KC' } });
if (result.warnings?.includes('zero_recipients')) {
  // Log/alert — a zero-recipient send from a game-day preset is worth surfacing loudly.
}
```

`result.warnings` is typed on every send result (including `notifications.send`/`batch`) for
forward-compatibility, even though only broadcasts emit one today. The SDK never throws on a
warning.

## Errors

Every method rejects with a typed `PushToError` subclass — never a raw `fetch` exception.
`err.name` is the wire's machine-readable `error.name` (branch on it exactly like the raw API);
`instanceof` gives the typed ergonomic path:

| Error class | `.name` | HTTP | Notes |
| --- | --- | --- | --- |
| `InvalidTokenError` | `invalid_token` | 401 | Missing, malformed, or rejected API key |
| `InsufficientPermissionsError` | `insufficient_permissions` | 403 | Key is valid but lacks the route's required permission |
| `NotFoundError` | `not_found` | 404 | Unknown path/resource, or an opaque ownership miss |
| `ValidationError` | `validation_error` | 400/422 | Carries `details[]`, one entry per invalid field |
| `InvalidIdempotencyKeyError` | `invalid_idempotency_key` | 400 | Malformed `Idempotency-Key` |
| `IdempotencyConflictError` | `idempotency_conflict` \| `concurrent_idempotent_requests` | 409 | Same key, different body / still in flight |
| `MonthlyQuotaExceededError` | `monthly_quota_exceeded` | 429 | Carries `retryAfter` (seconds) |
| `RateLimitError` | `rate_limit_exceeded` | 429 | Reserved, not emitted today |
| `GatewayTimeoutError` | `gateway_timeout` | 504 | The proxy's own upstream timeout, or the SDK's own `timeoutMs` firing |
| `PushToError` (base) | varies | 5xx/other | Unknown/unexpected — `err.name` still carries the wire code when available |

```typescript
import { ValidationError, MonthlyQuotaExceededError } from '@push-to/node';

try {
  await pushto.broadcasts.send({ template: 'game-day-kickoff', variables: {} });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.details); // [{ message: '...' }]
  } else if (error instanceof MonthlyQuotaExceededError) {
    console.error('retry after', error.retryAfter, 'seconds');
  }
}
```

`error.type` and `error.docsUrl` (when present) pass straight through from the edge catalog, so you
can link a caller to the docs without hardcoding a URL.

## Concepts

A **contact** is a person (`external_id`), a **subscription** is one of their devices/browsers, a
**topic** is an opt-in/opt-out preference category, and an **audience** is a named group used for
targeting. The full contact/subscription/segment/topic model — including why registration does
**not** require an `external_id` and how a contact can outlive any single subscription — is defined
in the PushTo core repo's
[Contact vs Subscription](https://github.com/push-to/core/blob/main/docs/Data%20Model/Contact%20vs%20Subscription.md)
note.

## Known deviations from the documented contract

Flagged here (and in code comments on `pushto.audiences`) for transparency, not hidden — these are
real edge-layer quirks the SDK wraps faithfully rather than papering over:

1. **`listForContact`/`addContact`/`addContactBatch`/`removeContact`/`removeAllForContact`** return
   their payload **without** the standard `{ data }` envelope (a bare array/object/boolean). Every
   other route in this API follows the enveloped contract; these five do not. The SDK still
   returns the correctly-typed payload — you never see the envelope difference from the outside.
2. **`listForContact`'s pagination is a no-op.** The edge route accepts `page`/`limit` in this
   SDK's types (forward-compatible with the frozen contract) but the underlying handler never
   reads them from the query string — every audience for the contact is always returned.
3. **`addContact`/`removeContact` can surface a `500 internal_error`** (rather than `404
   not_found`) for an unknown `externalId`/`audienceName` — the edge handler throws a plain `Error`
   for that case today, which the framework's catch-all turns into an opaque 500.

## Build

```sh
bun install
bun run build
# → packages/node/dist/index.{js,cjs,d.ts,d.cts}
```

## Release / publishing

Releases run on `main` via [semantic-release](https://github.com/semantic-release/semantic-release)
+ npm **OIDC trusted publishing** (no `NPM_TOKEN`). Commit with
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch,
`feat!:`/`BREAKING CHANGE:` → major).

> [!WARNING]
> **Human TODO before the first release:** register the npmjs.com **trusted publisher** for
> `@push-to/node`, pointing at `push-to/node-sdk` + `.github/workflows/release.yml`, **under the
> `@push-to` org (owner `cesarwbr`) — never `@pushto`** (a separate account; a first publish there
> fails masked-404 on authz). This also needs a one-time **manual OTP bootstrap** before the
> trusted publisher can be registered — a human step, not something the pipeline can self-provision.

## License

MIT
