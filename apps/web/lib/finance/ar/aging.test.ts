import { describe, it, expect } from "vitest";
import { daysOverdue, agingBucket, AGING_BUCKETS } from "./aging";

const due = new Date("2026-03-01T00:00:00.000+07:00");
const on = (iso: string) => new Date(iso);

describe("daysOverdue", () => {
  it("is zero on the due date itself", () => {
    expect(daysOverdue(due, on("2026-03-01T23:59:00.000+07:00"))).toBe(0);
  });

  it("is negative before the due date", () => {
    expect(daysOverdue(due, on("2026-02-27T08:00:00.000+07:00"))).toBe(-2);
  });

  it("counts whole days past due", () => {
    expect(daysOverdue(due, on("2026-03-15T08:00:00.000+07:00"))).toBe(14);
  });
});

describe("agingBucket", () => {
  it("buckets a not-yet-due receivable as CURRENT", () => {
    expect(agingBucket(due, on("2026-02-01T08:00:00.000+07:00"))).toBe("CURRENT");
  });

  it("treats the due date itself as CURRENT, not overdue", () => {
    expect(agingBucket(due, on("2026-03-01T23:59:00.000+07:00"))).toBe("CURRENT");
  });

  it("moves to D1_30 on the first day past due", () => {
    expect(agingBucket(due, on("2026-03-02T00:01:00.000+07:00"))).toBe("D1_30");
  });

  it("keeps day 30 in D1_30", () => {
    expect(agingBucket(due, on("2026-03-31T08:00:00.000+07:00"))).toBe("D1_30");
  });

  it("moves to D31_60 on day 31", () => {
    expect(agingBucket(due, on("2026-04-01T08:00:00.000+07:00"))).toBe("D31_60");
  });

  it("keeps day 120 in D91_120", () => {
    expect(agingBucket(due, on("2026-06-29T08:00:00.000+07:00"))).toBe("D91_120");
  });

  it("moves to D120_PLUS on day 121", () => {
    expect(agingBucket(due, on("2026-06-30T08:00:00.000+07:00"))).toBe("D120_PLUS");
  });
});

describe("AGING_BUCKETS", () => {
  it("lists all six buckets oldest-last", () => {
    expect(AGING_BUCKETS).toEqual(["CURRENT", "D1_30", "D31_60", "D61_90", "D91_120", "D120_PLUS"]);
  });
});
