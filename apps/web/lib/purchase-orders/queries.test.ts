import { describe, expect, it } from "vitest";
import { buildPOsWhere } from "./queries";
import { overduePOWhere } from "./overdue";

describe("buildPOsWhere status arms", () => {
  it("leaves status unfiltered when neither arm is given", () => {
    expect(buildPOsWhere({}).status).toBeUndefined();
  });

  it("reads an empty statusIn as match-nothing", () => {
    expect(buildPOsWhere({ statusIn: [] }).status).toEqual({ in: [] });
  });

  it("applies both arms instead of letting statusIn overwrite status", () => {
    const where = buildPOsWhere({ status: "SUBMITTED", statusIn: ["PARTIAL"] });
    expect(where.AND).toEqual([{ status: "SUBMITTED" }, { status: { in: ["PARTIAL"] } }]);
  });

  it("keeps an empty statusIn as match-nothing when overdue is also set", () => {
    const where = buildPOsWhere({ overdue: true, statusIn: [] });
    expect(where.status).toEqual({ in: [] });
    expect(where.AND).toEqual([{ status: { in: ["SUBMITTED", "PARTIAL"] } }]);
  });

  it("keeps both status arms when overdue is also set", () => {
    const where = buildPOsWhere({ overdue: true, status: "SUBMITTED", statusIn: ["PARTIAL"] });
    expect(where.AND).toEqual([
      { status: "SUBMITTED" },
      { status: { in: ["PARTIAL"] } },
      { status: { in: ["SUBMITTED", "PARTIAL"] } },
    ]);
  });

  it("counts overdue exactly as the dashboard and menu badge do: DRAFT is never late", () => {
    const where = buildPOsWhere({ overdue: true });
    expect(where.AND).toEqual([{ status: overduePOWhere().status }]);
    expect((where.AND as Array<{ status: { in: string[] } }>)[0].status.in).not.toContain("DRAFT");
  });
});
