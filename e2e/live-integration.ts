/**
 * T-N1-E2E — live-stack integration for @push-to/node (Contract §8).
 *
 * Exercises the BUILT SDK (packages/node/dist) against a real local PushTo
 * core stack — the customer-api proxy on :8081 → Supabase edge functions on
 * :55321 → Postgres on :55322. Every API call below goes through the SDK;
 * psql is used only where the SDK deliberately has no surface (creating
 * subscriptions — browser-registration is excluded from the server SDK) and
 * for DB-state assertions.
 *
 * Scenarios (task #22):
 *   1. Hello-world preset send via SDK-authored templates + preset, with
 *      Idempotency-Key: recipients/stats/rateLimit surfaced; byte-equal
 *      replay on the second call (replayed:true, rateLimit undefined).
 *   2. contacts.upsert → audiences.addContact → broadcasts.create (inline
 *      union) → REAL delivery, decrypted (RFC 8291/8188 aes128gcm).
 *   3. notifications.batch with one bad item → positional partial failure +
 *      the errors() helper.
 *   4. topics.create + contacts.update(id, {topics}) opt-out → a
 *      topic-gated send skips the opted-out contact.
 *   5. A standard (non-admin) key on an admin method →
 *      InsufficientPermissionsError with docsUrl.
 *   6. Zero-recipient preset send → result.warnings ["zero_recipients"].
 *
 * Requires: local stack running (553xx ports), customer-api on :8081, psql
 * on PATH, SIGNUP_INVITE_SECRET exported (from core's
 * apps/supabase-functions/supabase/.env — never printed).
 *
 * Run from e2e/:  bun run live-integration.ts
 */

import { Header, decrypt as eceDecrypt } from '@negrel/http-ece';
import {
  PushTo,
  InsufficientPermissionsError,
} from '../packages/node/dist/index.js';

// ── env + constants ─────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} — export it before running.`);
    process.exit(1);
  }
  return v;
}

const SIGNUP_INVITE_SECRET = requiredEnv('SIGNUP_INVITE_SECRET');
const CUSTOMER_API = 'http://127.0.0.1:8081';
const MOCK_PUSH_PORT = 8899; // distinct from every core smoke (8894/6/7/8)
const MOCK_PUSH_BASE = `http://host.docker.internal:${MOCK_PUSH_PORT}`;

// ── pass/fail bookkeeping ───────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const pass = (m: string) => { passCount++; console.log(`  ✅ PASS: ${m}`); };
const fail = (m: string) => { failCount++; console.error(`  ❌ FAIL: ${m}`); };
const info = (m: string) => console.log(`  ℹ  ${m}`);
const section = (t: string) => console.log(`\n${'─'.repeat(70)}\n${t}\n${'─'.repeat(70)}`);

// ── psql helpers (house pattern; local-dev-only superuser) ──────────────────

function psqlScalar(sql: string): string {
  const proc = Bun.spawnSync(
    ['psql', '-h', '127.0.0.1', '-p', '55322', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' } },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`psql failed: ${proc.stderr.toString()}\nSQL: ${sql}`);
  }
  return proc.stdout.toString().trim();
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ── web-push subscriber crypto (mirrors the core smokes) ────────────────────

type SubscriberKeys = {
  endpoint: string;
  privateKey: CryptoKey;
  uaPublicKeyRaw: Uint8Array;
  authSecretRaw: Uint8Array;
  p256dhB64Url: string;
  authB64Url: string;
};

const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

async function makeSubscriberKeys(endpoint: string): Promise<SubscriberKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const authSecretRaw = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    privateKey: kp.privateKey,
    uaPublicKeyRaw,
    authSecretRaw,
    p256dhB64Url: b64u(uaPublicKeyRaw.buffer as ArrayBuffer),
    authB64Url: b64u(authSecretRaw.buffer as ArrayBuffer),
  };
}

const subscriptionObjectFor = (k: SubscriberKeys) => ({
  endpoint: k.endpoint,
  expirationTime: null,
  keys: { p256dh: k.p256dhB64Url, auth: k.authB64Url },
});

async function hmacSha256(keyBytes: ArrayBuffer, msg: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', key, msg);
}

async function decryptPushPayload(body: ArrayBuffer, keys: SubscriberKeys): Promise<unknown> {
  // deno-lint-ignore-like: the lib's types are loose; mirror the core smoke.
  const header = (Header as any).fromBytes(body);
  const senderPublicKeyRaw: Uint8Array = header.keyid;
  const senderPublicKey = await crypto.subtle.importKey(
    'raw', senderPublicKeyRaw as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
  const ecdhSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: senderPublicKey } as any, keys.privateKey, 256,
  );
  const prkKey = await hmacSha256(keys.authSecretRaw.buffer as ArrayBuffer, ecdhSecret);
  const encoder = new TextEncoder();
  const keyInfo = new Uint8Array([
    ...encoder.encode('WebPush: info\0'), ...keys.uaPublicKeyRaw, ...senderPublicKeyRaw,
  ]);
  const infoWithCounter = new Uint8Array([...keyInfo, 0x01]);
  const ikm = await hmacSha256(prkKey, infoWithCounter.buffer as ArrayBuffer);
  const plaintext = await (eceDecrypt as any)(body, ikm, header);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ── mock push server ────────────────────────────────────────────────────────

const subscriberRegistry = new Map<string, SubscriberKeys>();
const deliveries = new Map<string, any[]>();

function registerSubscriber(label: string, keys: SubscriberKeys) {
  subscriberRegistry.set(label, keys);
  deliveries.set(label, []);
}

const mockServer = Bun.serve({
  port: MOCK_PUSH_PORT,
  async fetch(req) {
    const buf = await req.arrayBuffer();
    const m = new URL(req.url).pathname.match(/^\/sub\/([^/]+)$/);
    if (m) {
      const keys = subscriberRegistry.get(m[1]);
      if (keys) {
        try {
          deliveries.get(m[1])!.push(await decryptPushPayload(buf, keys));
        } catch (e) {
          console.error(`mock push: decrypt FAILED for "${m[1]}": ${e}`);
        }
      }
    }
    return new Response(null, { status: 201 });
  },
});

// ── tenant provisioning (real /signup) ──────────────────────────────────────

type Tenant = { customerId: string; apiKey: string; adminKey: string };

async function signupTenant(tag: string): Promise<Tenant> {
  const res = await fetch(`${CUSTOMER_API}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SIGNUP_INVITE_SECRET}` },
    body: JSON.stringify({ email: `n1-e2e-${tag}-${Date.now()}@test.pushto.ai`, name: `N1 e2e ${tag}` }),
  });
  if (res.status !== 201) throw new Error(`signup failed for ${tag}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { customerId: json.data.customerId, apiKey: json.data.keys.apiKey, adminKey: json.data.keys.adminKey };
}

/** Attach a real (mock-push) subscription to a contact created via the SDK. */
function attachSubscription(customerId: string, externalId: string, keys: SubscriberKeys): number {
  const userId = psqlScalar(
    `select id from public.users where customer_id = ${sqlStr(customerId)} and external_id = ${sqlStr(externalId)};`,
  );
  if (!userId) throw new Error(`no users row for external_id=${externalId}`);
  return parseInt(psqlScalar(
    `insert into public.subscriptions (customer_id, user_id, subscription_object) values (${sqlStr(customerId)}, ${userId}, ${sqlStr(JSON.stringify(subscriptionObjectFor(keys)))}::jsonb) returning id;`,
  ), 10);
}

const cleanupTenants: string[] = [];
function cleanup() {
  for (const cid of cleanupTenants) {
    try {
      psqlScalar(`delete from public.customers where id = ${sqlStr(cid)};`); // cascades
    } catch (e) {
      console.error(`cleanup failed for tenant: ${e}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

try {
  section('SETUP — provision tenant A (admin + standard keys) via /signup');
  const tenantA = await signupTenant('tA');
  cleanupTenants.push(tenantA.customerId);
  const admin = new PushTo(tenantA.adminKey, { baseUrl: CUSTOMER_API });
  const standard = new PushTo(tenantA.apiKey, { baseUrl: CUSTOMER_API });
  info('tenant A provisioned; SDK clients constructed (admin + standard)');

  // Shared seed: two contacts with real mock-push subscriptions.
  await admin.contacts.upsert({ external_id: 'fan-1' });
  await admin.contacts.upsert({ external_id: 'fan-2' });
  const fan1Keys = await makeSubscriberKeys(`${MOCK_PUSH_BASE}/sub/fan-1`);
  const fan2Keys = await makeSubscriberKeys(`${MOCK_PUSH_BASE}/sub/fan-2`);
  registerSubscriber('fan-1', fan1Keys);
  registerSubscriber('fan-2', fan2Keys);
  const fan1SubId = attachSubscription(tenantA.customerId, 'fan-1', fan1Keys);
  attachSubscription(tenantA.customerId, 'fan-2', fan2Keys);
  await admin.contacts.update('fan-1', { properties: { favorite_teams: ['KC'] } });
  info(`contacts fan-1 (KC fan, sub ${fan1SubId}) + fan-2 seeded with live mock-push subscriptions`);

  // ── 1. hello-world preset send + idempotent replay ────────────────────────
  section('1 — hello-world: SDK-authored template + preset, send with Idempotency-Key, replay');
  await admin.templates.create({
    name: 'kickoff-team',
    title: '🏈 {{team}} kick off vs {{opp}}!',
    body: 'Tap for the live thread.',
  });
  const preset = await admin.broadcasts.presets.create({
    name: 'game-day-kickoff',
    definition: {
      target: { any: [{ property: { name: 'favorite_teams', contains: '{{team}}' } }] },
      default: { template: 'kickoff-team', variables: { team: '{{team}}', opp: '{{opponent}}' } },
      tag: 'game:{{game_id}}',
    },
  });
  if ([...preset.variables].sort().join(',') === 'game_id,opponent,team') {
    pass(`preset authored via SDK; derived variables = [${preset.variables}]`);
  } else {
    fail(`unexpected derived variables: [${preset.variables}]`);
  }

  const idemKey = `e2e-game/${Date.now()}`;
  const send1 = await admin.broadcasts.send(
    { template: 'game-day-kickoff', variables: { team: 'KC', opponent: 'BUF', game_id: 'KC-BUF' } },
    { idempotencyKey: idemKey },
  );
  if (send1.recipients === 1 && send1.stats?.success === 1) pass(`preset send → recipients:1 (fan-1 only), stats.success:1`);
  else fail(`preset send unexpected result: ${JSON.stringify(send1)}`);
  if (!send1.replayed) pass('first send not marked replayed');
  else fail('first send unexpectedly marked replayed');
  if (send1.rateLimit && typeof send1.rateLimit.remaining === 'number') {
    pass(`rateLimit surfaced: limit=${send1.rateLimit.limit} remaining=${send1.rateLimit.remaining}`);
  } else {
    info(`rateLimit absent on first send (tenant has no monthly_send_limit — headers only emitted when quota configured): ${JSON.stringify(send1.rateLimit)}`);
    psqlScalar(`update public.customers set monthly_send_limit = 1000 where id = ${sqlStr(tenantA.customerId)};`);
    info('set monthly_send_limit=1000 for the remaining scenarios');
  }

  const send2 = await admin.broadcasts.send(
    { template: 'game-day-kickoff', variables: { team: 'KC', opponent: 'BUF', game_id: 'KC-BUF' } },
    { idempotencyKey: idemKey },
  );
  if (send2.replayed === true) pass('second identical send → replayed: true');
  else fail(`second send not marked replayed: ${JSON.stringify(send2)}`);
  if (send2.id === send1.id && send2.recipients === send1.recipients) pass('replay body matches original (same id/recipients)');
  else fail(`replay body differs: ${JSON.stringify(send2)} vs ${JSON.stringify(send1)}`);
  if (send2.rateLimit === undefined) pass('replay drops ratelimit-* headers → rateLimit undefined (documented limitation)');
  else fail(`expected undefined rateLimit on replay, got ${JSON.stringify(send2.rateLimit)}`);

  await Bun.sleep(300);
  const fan1Pushes = deliveries.get('fan-1')!;
  if (fan1Pushes.length === 1) pass('exactly ONE decrypted delivery to fan-1 despite two send calls (no double fan-out)');
  else fail(`fan-1 deliveries = ${fan1Pushes.length}, expected 1`);
  const title1 = (fan1Pushes[0] as any)?.title ?? (fan1Pushes[0] as any)?.notification?.title;
  if (String(title1).includes('KC')) pass(`two-layer render proven: decrypted title "${title1}"`);
  else fail(`decrypted title missing substituted team: ${JSON.stringify(fan1Pushes[0])}`);

  // ── 2. inline union broadcast via audiences → real delivery ───────────────
  section('2 — contacts.upsert → audiences.addContact → broadcasts.create inline union → delivery');
  const aud = await admin.audiences.create({ name: 'e2e-vips' });
  await admin.audiences.addContact('fan-2', 'e2e-vips');
  const inline = await admin.broadcasts.create({
    target: { any: [{ audience: 'e2e-vips' }] },
    default: { title: 'VIP hello', body: 'inline union' },
    send: true,
  });
  if (inline.recipients === 1) pass(`inline union send → recipients:1 (fan-2 via audience ${aud.id})`);
  else fail(`inline send unexpected: ${JSON.stringify(inline)}`);
  await Bun.sleep(300);
  const fan2Pushes = deliveries.get('fan-2')!;
  const t2 = (fan2Pushes[0] as any)?.title ?? (fan2Pushes[0] as any)?.notification?.title;
  if (fan2Pushes.length === 1 && String(t2).includes('VIP')) pass(`fan-2 received 1 decrypted push, title "${t2}"`);
  else fail(`fan-2 deliveries wrong: n=${fan2Pushes.length} first=${JSON.stringify(fan2Pushes[0])}`);

  // ── 3. batch positional partial failure ───────────────────────────────────
  section('3 — notifications.batch: one good item, one bad → positional partial failure');
  const batch = await admin.notifications.batch([
    { to: { users: ['fan-1'] }, notification: { title: 'batch ok', body: 'good item' } },
    { to: { users: ['fan-1'] }, notification: { template: 'no-such-template', variables: {} } },
  ]);
  const first = batch[0];
  const second = batch[1];
  if (first && !('error' in first)) pass('batch[0] succeeded positionally');
  else fail(`batch[0] unexpected: ${JSON.stringify(first)}`);
  if (second && 'error' in second) pass(`batch[1] failed positionally (${(second as any).error?.name})`);
  else fail(`batch[1] unexpected: ${JSON.stringify(second)}`);
  const errs = batch.errors();
  if (errs.length === 1 && errs[0] === 1) pass(`errors() helper → exactly the failed index: ${JSON.stringify(errs)}`);
  else fail(`errors() helper unexpected: ${JSON.stringify(errs)}`);

  // ── 4. topic-gated send skips an opted-out contact ────────────────────────
  section('4 — topics.create + contacts.update opt-out → topic-gated send skips');
  await admin.topics.create({ name: 'news', default_subscription: 'opt_out' }); // subscribed-until-opt-out
  await admin.contacts.update('fan-1', { topics: { news: 'unsubscribed' } });
  const fan1Before = deliveries.get('fan-1')!.length; // scenario 1 preset + scenario 3 batch item both delivered here
  const gated = await admin.broadcasts.create({
    target: { any: [{ all: true }] },
    topic: 'news',
    default: { title: 'news gated', body: 'only subscribed contacts' },
    send: true,
  });
  if (gated.recipients === 1) pass('topic-gated all-send → recipients:1 (fan-2 only; opted-out fan-1 skipped)');
  else fail(`gated send unexpected recipients: ${JSON.stringify(gated)}`);
  await Bun.sleep(300);
  const fan1After = deliveries.get('fan-1')!.length;
  if (fan1After === fan1Before) pass(`fan-1 delivery count unchanged at ${fan1After} (no gated push arrived)`);
  else fail(`fan-1 received the gated push: ${fan1Before} → ${fan1After}`);

  // ── 5. 403 typed error on an admin method with a standard key ─────────────
  section('5 — standard key on an admin method → InsufficientPermissionsError');
  try {
    await standard.templates.create({ name: 'nope', title: 't', body: 'b' });
    fail('standard-key templates.create unexpectedly succeeded');
  } catch (e) {
    if (e instanceof InsufficientPermissionsError) {
      pass(`typed InsufficientPermissionsError thrown (status ${(e as any).statusCode})`);
      if ((e as any).docsUrl) pass(`docsUrl carried: ${(e as any).docsUrl}`);
      else fail('docsUrl missing on the 403 error');
    } else {
      fail(`wrong error type: ${(e as any)?.constructor?.name} ${(e as any)?.message}`);
    }
  }

  // ── 6. zero-recipient preset send → warnings ──────────────────────────────
  section('6 — zero-recipient preset send → warnings: ["zero_recipients"]');
  const zero = await admin.broadcasts.send(
    { template: 'game-day-kickoff', variables: { team: 'ZZZ', opponent: 'YYY', game_id: 'none' } },
  );
  if (zero.recipients === 0 && Array.isArray(zero.warnings) && zero.warnings.includes('zero_recipients')) {
    pass(`zero-recipient send → 200, recipients:0, warnings:${JSON.stringify(zero.warnings)}`);
  } else {
    fail(`zero-recipient send unexpected: ${JSON.stringify(zero)}`);
  }

  section('RESULTS SUMMARY');
  console.log(`  ✅ Passed: ${passCount}\n  ❌ Failed: ${failCount}`);
  console.log(failCount === 0 ? '\n  🎉 All T-N1-E2E checks PASS.' : '\n  ⚠️  FAILURES above.');
} finally {
  section('Cleanup');
  cleanup();
  mockServer.stop(true);
  info('Tenant cleanup complete.');
}

process.exit(failCount === 0 ? 0 : 1);
