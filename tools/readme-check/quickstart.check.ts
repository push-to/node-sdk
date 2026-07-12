// Proof that the README's snippets compile against the SHIPPED public types
// — packages/node/dist/index.d.ts, resolved via this dir's tsconfig `paths`
// map (web-sdk precedent). If the README drifts from the real API, this
// fails to typecheck.
//
// Run (after `bun run build`):
//   bunx tsc --noEmit -p tools/readme-check/tsconfig.json
//
// NOT part of the package build (it lives under tools/, outside packages/node/src).

import { PushTo } from '@push-to/node';
import {
  ValidationError,
  MonthlyQuotaExceededError,
  InsufficientPermissionsError,
  type PushToClientOptions,
  type TargetSelector,
  type Target,
  type InlineCopy,
  type TemplateRef,
  type NotificationContent,
  type Override,
  type IdempotencyOptions,
  type PushToWarning,
} from '@push-to/node';

// README — Quickstart (hello-world, ≤ 3 lines)
async function helloWorld(): Promise<void> {
  const pushto = new PushTo(process.env.PUSHTO_API_KEY!);
  await pushto.broadcasts.send({
    template: 'game-day-kickoff',
    variables: { team: 'KC', opponent: 'BUF' },
  });
}

// README — Configuration
function configuration(apiKey: string): PushTo {
  const options: PushToClientOptions = {
    baseUrl: 'https://api.pushto.ai',
    timeoutMs: 60_000,
    fetch: globalThis.fetch,
    maxRetries: 0,
  };
  return new PushTo(apiKey, options);
}

// README — Idempotency & retries
async function idempotentSend(pushto: PushTo): Promise<void> {
  const options: IdempotencyOptions = { idempotencyKey: 'order-42-shipped' };
  const result = await pushto.notifications.send(
    { to: { users: ['user_123'] }, notification: { title: 'Hi', body: 'There' } },
    options,
  );
  const replayed: boolean | undefined = result.replayed;
  void replayed;
}

// README — Rate limits & quota
async function rateLimitAware(pushto: PushTo): Promise<void> {
  const result = await pushto.notifications.send({
    to: { subscriptions: [1] },
    notification: { title: 'Hi', body: 'There' },
  });
  const rateLimit = result.rateLimit;
  void rateLimit?.remaining;
}

// README — Warnings
async function warningsExample(pushto: PushTo): Promise<void> {
  const result = await pushto.broadcasts.send({
    template: 'game-day-kickoff',
    variables: { team: 'KC' },
  });
  if (result.warnings?.includes('zero_recipients')) {
    // Log/alert.
  }
}

// README — Errors
async function errorHandling(pushto: PushTo): Promise<void> {
  try {
    await pushto.broadcasts.send({ template: 'game-day-kickoff', variables: {} });
  } catch (error) {
    if (error instanceof ValidationError) {
      const details = error.details;
      void details;
    } else if (error instanceof MonthlyQuotaExceededError) {
      const retryAfter = error.retryAfter;
      void retryAfter;
    } else if (error instanceof InsufficientPermissionsError) {
      // Under-scoped key.
    }
  }
}

// README — Typed selectors & content (mirror the edge Zod shapes exactly)
const audienceSelector: TargetSelector = { audience: 'vip' };
const topicSelector: TargetSelector = { topic: 'news' };
const propertySelector: TargetSelector = { property: { name: 'plan', contains: 'pro' } };
const allSelector: TargetSelector = { all: true };
const target: Target = { any: [audienceSelector, topicSelector, propertySelector, allSelector] };
const inlineCopy: InlineCopy = { title: 't', body: 'b', icon: 'https://x.co/i.png', link: 'https://x.co' };
const templateRef: TemplateRef = { template: 'welcome', variables: { name: 'Jane' } };
const notificationContent: NotificationContent = inlineCopy;
const templateContent: NotificationContent = templateRef;
const override: Override = { when: topicSelector, priority: 1, notification: inlineCopy };
const warning: PushToWarning = 'zero_recipients';

// README — pushto.broadcasts.create (inline form)
async function createInlineBroadcast(pushto: PushTo): Promise<void> {
  await pushto.broadcasts.create({
    target,
    default: notificationContent,
    overrides: [override],
    tag: 'promo',
    topic: 'news',
    send: false,
  });
}

// README — pushto.contacts
async function contactsExample(pushto: PushTo): Promise<void> {
  await pushto.contacts.upsert({
    external_id: 'user_123',
    properties: { plan: 'pro' },
    topics: { news: 'subscribed' },
  });
  const contact = await pushto.contacts.get('user_123');
  void contact.subscriptionCount;
  await pushto.contacts.update('user_123', { topics: { news: 'unsubscribed' } });
}

// README — pushto.accounts (reseller)
async function accountsExample(pushto: PushTo): Promise<void> {
  const result = await pushto.accounts.create({ email: 'reseller@example.com' });
  void result.keys.adminKey;
}

// Mark everything used (noUnusedLocals) — this file is a compile-only proof.
void [
  helloWorld,
  configuration,
  idempotentSend,
  rateLimitAware,
  warningsExample,
  errorHandling,
  createInlineBroadcast,
  contactsExample,
  accountsExample,
  templateContent,
  warning,
];
