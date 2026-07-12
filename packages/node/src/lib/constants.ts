// Constructor defaults (Contract §2).

/** The customer-api proxy's production origin. */
export const DEFAULT_BASE_URL = 'https://api.pushto.ai';

/** Matches the Vercel `maxDuration`; the proxy aborts upstream ~55s before this fires. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Retries are opt-in — never blind-retry a non-idempotent fan-out (Contract §5.1). */
export const DEFAULT_MAX_RETRIES = 0;

/** `Idempotency-Key`: 1-255 printable ASCII characters (Contract §5.1). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7E]{1,255}$/;
