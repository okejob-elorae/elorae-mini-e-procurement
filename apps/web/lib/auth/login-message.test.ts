import { describe, expect, it } from "vitest";
import { greetingKey, loginMessageKey } from "./login-message";

describe("loginMessageKey", () => {
  it("no error means no message", () => {
    expect(loginMessageKey({ error: undefined, code: undefined })).toBeNull();
    expect(loginMessageKey(undefined)).toBeNull();
  });

  it("a wrong password reads as wrong credentials", () => {
    expect(loginMessageKey({ error: "CredentialsSignin", code: "credentials" })).toBe("invalidCredentials");
  });

  it("tells a server outage apart from a wrong password", () => {
    expect(loginMessageKey({ error: "CredentialsSignin", code: "unavailable" })).toBe("serverUnavailable");
    expect(loginMessageKey({ error: "Configuration" })).toBe("serverUnavailable");
  });

  it("reports the attempt limit", () => {
    expect(loginMessageKey({ error: "CredentialsSignin", code: "rate_limited" })).toBe("tooManyAttempts");
  });
});

describe("greetingKey (WIB clock)", () => {
  // Instants given in UTC; WIB is UTC+7.
  it.each([
    ["2026-09-28T00:30:00Z", "morning"], // 07:30 WIB
    ["2026-09-28T05:00:00Z", "midday"], // 12:00 WIB
    ["2026-09-28T09:00:00Z", "afternoon"], // 16:00 WIB
    ["2026-09-28T13:00:00Z", "evening"], // 20:00 WIB
    ["2026-09-27T20:30:00Z", "evening"], // 03:30 WIB
  ] as const)("%s → %s", (iso, key) => {
    expect(greetingKey(new Date(iso))).toBe(key);
  });
});
