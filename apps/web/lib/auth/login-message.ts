/*
 * Client-safe: maps a `signIn()` result to the `auth.*` message the login form
 * shows. Kept apart from `login-errors.ts`, which imports next-auth's server
 * error classes and has no business in the browser bundle.
 */

export type LoginMessageKey =
  | "invalidCredentials"
  | "serverUnavailable"
  | "tooManyAttempts"
  | "errorOccurred";

export function loginMessageKey(
  result: { error?: string | null; code?: string | null } | undefined | null,
): LoginMessageKey | null {
  if (!result?.error) return null;
  if (result.code === "rate_limited") return "tooManyAttempts";
  if (result.code === "unavailable") return "serverUnavailable";
  if (result.error === "CredentialsSignin") return "invalidCredentials";
  // Anything else is a server-side failure (next-auth reports an error thrown
  // from `authorize` as "Configuration"); retyping the password won't fix it.
  return "serverUnavailable";
}

export type GreetingKey = "morning" | "midday" | "afternoon" | "evening";

/** Greeting by the WIB clock, whatever zone the browser or server runs in. */
export function greetingKey(now: Date = new Date()): GreetingKey {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(now),
  );
  if (hour >= 4 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "midday";
  if (hour >= 15 && hour < 18) return "afternoon";
  return "evening";
}
