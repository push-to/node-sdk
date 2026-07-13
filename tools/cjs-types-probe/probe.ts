// T-N1-011 F2 — pins the CJS-consumer packaging regression: typed CJS
// consumers used to hit TS1479 ("The current file is a CommonJS module
// ... the referenced file is an ECMAScript module and cannot be imported
// with 'require'") because packages/node/package.json's "exports" map had
// a single flat "types" condition (pointing at the ESM dist/index.d.ts)
// shared across BOTH the "import" and "require" branches — so under
// `moduleResolution: "node16"`, a `require()`-based consumer resolved
// straight to an ESM-flavored declaration file and TS correctly refused.
//
// This package has no "type" field, so it defaults to CommonJS — this
// file's `import` is synthesized as a `require()` call by TS under
// node16 resolution, exactly like a real strict-CJS TypeScript consumer.
// `@push-to/node` is a genuine `workspace:*` dependency here (resolved
// through the real node_modules symlink + package.json "exports", NOT a
// tsconfig `paths` override) — this is the only way to actually exercise
// the exports map's conditional resolution, not just its shipped .d.ts
// content.
//
// Run (after `bun install` + `bun run build`):
//   bunx tsc --noEmit -p tools/cjs-types-probe/tsconfig.json
import { PushTo } from '@push-to/node';

const pushto = new PushTo('sk_test');
void pushto.notifications;
