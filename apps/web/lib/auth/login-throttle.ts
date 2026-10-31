/**
 * Slows down password guessing on the login form.
 *
 * Five wrong attempts for the same email within ten minutes lock that email
 * for a minute; a successful sign-in clears its record. The counter lives in
 * the server's memory, so it resets on restart and is per process — enough to
 * turn a guessing loop into a crawl on the single VPS container, not a
 * substitute for a shared store if the web app is ever scaled out.
 *
 * Keyed by email alone: the Credentials `authorize` callback has no reliable
 * client address behind the reverse proxy, and an email key also covers a
 * guesser that rotates addresses.
 */

export type ThrottlePolicy = {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
};

export const LOGIN_THROTTLE_POLICY: ThrottlePolicy = {
  maxFailures: 5,
  windowMs: 10 * 60_000,
  lockMs: 60_000,
};

type Entry = { failures: number; windowStart: number; lockedUntil: number };

/** Beyond this many tracked emails, entries whose window and lock have both lapsed are dropped. */
const PRUNE_AT = 5_000;

export function createLoginThrottle(
  policy: ThrottlePolicy = LOGIN_THROTTLE_POLICY,
  now: () => number = Date.now,
) {
  const entries = new Map<string, Entry>();

  function prune(t: number) {
    if (entries.size < PRUNE_AT) return;
    for (const [key, e] of entries) {
      if (e.lockedUntil <= t && t - e.windowStart > policy.windowMs) entries.delete(key);
    }
  }

  return {
    /** Milliseconds until this email may try again; 0 when it is not locked. */
    retryAfterMs(key: string): number {
      const e = entries.get(key);
      if (!e) return 0;
      return Math.max(0, e.lockedUntil - now());
    },

    recordFailure(key: string): void {
      const t = now();
      prune(t);
      let e = entries.get(key);
      if (!e || t - e.windowStart > policy.windowMs) {
        e = { failures: 0, windowStart: t, lockedUntil: e?.lockedUntil ?? 0 };
      }
      e.failures += 1;
      if (e.failures >= policy.maxFailures) {
        e.lockedUntil = t + policy.lockMs;
        e.failures = 0;
        e.windowStart = t;
      }
      entries.set(key, e);
    },

    reset(key: string): void {
      entries.delete(key);
    },
  };
}

export function throttleKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The one throttle the sign-in path uses. */
export const loginThrottle = createLoginThrottle();
