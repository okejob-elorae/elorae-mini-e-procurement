import { describe, expect, it } from "vitest";
import { createLoginThrottle, throttleKey } from "./login-throttle";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const policy = { maxFailures: 3, windowMs: 60_000, lockMs: 10_000 };

describe("login throttle", () => {
  it("locks an email after the limit and releases it when the lock runs out", () => {
    const c = clock();
    const th = createLoginThrottle(policy, c.now);
    th.recordFailure("a@x.id");
    th.recordFailure("a@x.id");
    expect(th.retryAfterMs("a@x.id")).toBe(0);
    th.recordFailure("a@x.id");
    expect(th.retryAfterMs("a@x.id")).toBe(10_000);
    c.advance(4_000);
    expect(th.retryAfterMs("a@x.id")).toBe(6_000);
    c.advance(6_000);
    expect(th.retryAfterMs("a@x.id")).toBe(0);
  });

  it("forgets failures older than the window", () => {
    const c = clock();
    const th = createLoginThrottle(policy, c.now);
    th.recordFailure("a@x.id");
    th.recordFailure("a@x.id");
    c.advance(61_000);
    th.recordFailure("a@x.id");
    expect(th.retryAfterMs("a@x.id")).toBe(0);
  });

  it("a successful sign-in clears the record", () => {
    const c = clock();
    const th = createLoginThrottle(policy, c.now);
    th.recordFailure("a@x.id");
    th.recordFailure("a@x.id");
    th.reset("a@x.id");
    th.recordFailure("a@x.id");
    th.recordFailure("a@x.id");
    expect(th.retryAfterMs("a@x.id")).toBe(0);
  });

  it("keeps emails separate", () => {
    const c = clock();
    const th = createLoginThrottle(policy, c.now);
    for (let i = 0; i < 3; i++) th.recordFailure("a@x.id");
    expect(th.retryAfterMs("a@x.id")).toBeGreaterThan(0);
    expect(th.retryAfterMs("b@x.id")).toBe(0);
  });

  it("keys ignore case and surrounding spaces", () => {
    expect(throttleKey("  Admin@Elorae.COM ")).toBe("admin@elorae.com");
  });
});
