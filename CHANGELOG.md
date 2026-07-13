## [0.1.2](https://github.com/push-to/node-sdk/compare/v0.1.1...v0.1.2) (2026-07-13)

### Documentation

* README — rateLimit is also undefined for tenants with no monthly send limit ([3ecf48b](https://github.com/push-to/node-sdk/commit/3ecf48b921e45ac948ae23ad855442ed263944b9))

## [0.1.1](https://github.com/push-to/node-sdk/compare/v0.1.0...v0.1.1) (2026-07-13)

### Bug Fixes

* CJS consumers hit TS1479 — exports map never routed require to d.cts ([39f9522](https://github.com/push-to/node-sdk/commit/39f95229930479fffd6769b4482808c411a77ceb))
* stalled/mid-body reads could hang callers or escape the typed-error contract ([d422c9c](https://github.com/push-to/node-sdk/commit/d422c9cf5c63ef67fb2cf12b7f50f16077a8c14b))
* typed malformed-envelope errors, Retry-After honored, warnings typed, parse edges ([ccced19](https://github.com/push-to/node-sdk/commit/ccced19ee8637ed367e7260c36726bd24c47410c))

## [0.1.0](https://github.com/push-to/node-sdk/compare/v0.0.0...v0.1.0) (2026-07-12)

### Features

* add all resource namespaces and the public barrel export ([f83f985](https://github.com/push-to/node-sdk/commit/f83f9853205741a4d48bfa55f4fe4a730d60814d))
* implement @push-to/node core client ([0f60abf](https://github.com/push-to/node-sdk/commit/0f60abf1e80f744ae1b4d69b744327dc25fae160))

### Documentation

* add README and compile-proof type/README checks ([2c5cd09](https://github.com/push-to/node-sdk/commit/2c5cd090152d81c88519aa18e8c29f9f20351e8d))
* link the core repo's Contact vs Subscription note + the template-field footgun ([f2725ac](https://github.com/push-to/node-sdk/commit/f2725ac5fa9772e213ba0308de41442e9914840e))
