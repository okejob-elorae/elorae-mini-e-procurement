import { describe, it, expect } from "vitest";
import { MAX_COUNT_SESSION_MS, resolveLineCountMoment } from "./count-moment";

const MIN = 60 * 1000;
const T = Date.UTC(2026, 9, 7, 3, 0, 0);

describe("resolveLineCountMoment", () => {
  it("cancels a device clock running ten minutes slow", () => {
    /* Counted at server time T−40min, which the slow device read as T−50min; sent at T, which it read as T−10min. */
    const moment = resolveLineCountMoment({ countedAtMs: T - 50 * MIN, clientSentAtMs: T - 10 * MIN, receivedAtMs: T, lowerBound: null });
    expect(moment?.getTime()).toBe(T - 40 * MIN);
  });

  it("cancels a device clock running fast just the same", () => {
    const moment = resolveLineCountMoment({ countedAtMs: T - 25 * MIN, clientSentAtMs: T + 5 * MIN, receivedAtMs: T, lowerBound: null });
    expect(moment?.getTime()).toBe(T - 30 * MIN);
  });

  for (const bad of [Number.NaN, Infinity, -Infinity, "1759800000000", null, undefined, {}]) {
    it(`returns null for a countedAtMs of ${String(bad)}`, () => {
      expect(resolveLineCountMoment({ countedAtMs: bad, clientSentAtMs: T, receivedAtMs: T, lowerBound: null })).toBeNull();
    });

    it(`returns null for a clientSentAtMs of ${String(bad)}`, () => {
      expect(resolveLineCountMoment({ countedAtMs: T - MIN, clientSentAtMs: bad, receivedAtMs: T, lowerBound: null })).toBeNull();
    });
  }

  it("clamps a corrected moment after the server's receive instant to that instant", () => {
    /* A row edited after the device says it sent the request — only a clock jump does that. */
    const moment = resolveLineCountMoment({ countedAtMs: T + 3 * MIN, clientSentAtMs: T, receivedAtMs: T, lowerBound: null });
    expect(moment?.getTime()).toBe(T);
  });

  it("clamps a corrected moment before the lower bound to the lower bound", () => {
    const lowerBound = new Date(T - 2 * 60 * MIN);
    const moment = resolveLineCountMoment({ countedAtMs: T - 5 * 60 * MIN, clientSentAtMs: T, receivedAtMs: T, lowerBound });
    expect(moment?.getTime()).toBe(lowerBound.getTime());
  });

  it("clamps a corrected moment older than one counting session to the session floor", () => {
    const moment = resolveLineCountMoment({ countedAtMs: T - 3 * MAX_COUNT_SESSION_MS, clientSentAtMs: T, receivedAtMs: T, lowerBound: null });
    expect(moment?.getTime()).toBe(T - MAX_COUNT_SESSION_MS);
  });

  it("takes the later of the lower bound and the session floor", () => {
    const lowerBound = new Date(T - 2 * MAX_COUNT_SESSION_MS);
    const moment = resolveLineCountMoment({ countedAtMs: T - 3 * MAX_COUNT_SESSION_MS, clientSentAtMs: T, receivedAtMs: T, lowerBound });
    expect(moment?.getTime()).toBe(T - MAX_COUNT_SESSION_MS);
  });

  it("lets the receive instant win when the lower bound lies after it", () => {
    const moment = resolveLineCountMoment({ countedAtMs: T - MIN, clientSentAtMs: T, receivedAtMs: T, lowerBound: new Date(T + MIN) });
    expect(moment?.getTime()).toBe(T);
  });

  it("ignores an invalid lower bound rather than poisoning the result", () => {
    const moment = resolveLineCountMoment({ countedAtMs: T - MIN, clientSentAtMs: T, receivedAtMs: T, lowerBound: new Date(Number.NaN) });
    expect(moment?.getTime()).toBe(T - MIN);
  });
});
