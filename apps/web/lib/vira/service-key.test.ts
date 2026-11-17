import { afterEach, describe, expect, it, vi } from "vitest";
import { checkServiceKey } from "./service-key";

const KEY = "test-vira-service-key-0123456789abcdef";

describe("checkServiceKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("correct key → true", () => {
    vi.stubEnv("VIRA_SERVICE_KEY", KEY);
    expect(checkServiceKey(KEY)).toBe(true);
  });

  it("wrong key, empty string, null and undefined → false", () => {
    vi.stubEnv("VIRA_SERVICE_KEY", KEY);
    expect(checkServiceKey(`${KEY}x`)).toBe(false);
    expect(checkServiceKey("wrong-key-wrong-key-wrong-key-wrong")).toBe(false);
    expect(checkServiceKey("")).toBe(false);
    expect(checkServiceKey(null)).toBe(false);
    expect(checkServiceKey(undefined)).toBe(false);
  });

  it("a key with extra whitespace → false (the header value is not trimmed)", () => {
    vi.stubEnv("VIRA_SERVICE_KEY", KEY);
    expect(checkServiceKey(` ${KEY}`)).toBe(false);
    expect(checkServiceKey(`${KEY} `)).toBe(false);
    expect(checkServiceKey(`${KEY}\n`)).toBe(false);
  });

  it("env unset → false even when the header is set", () => {
    vi.stubEnv("VIRA_SERVICE_KEY", "");
    expect(checkServiceKey(KEY)).toBe(false);
    expect(checkServiceKey("")).toBe(false);
  });

  it("env set to a 31-char value → false for any header", () => {
    const short = "a".repeat(31);
    vi.stubEnv("VIRA_SERVICE_KEY", short);
    expect(checkServiceKey(short)).toBe(false);
    expect(checkServiceKey(KEY)).toBe(false);
    expect(checkServiceKey("")).toBe(false);
  });
});
