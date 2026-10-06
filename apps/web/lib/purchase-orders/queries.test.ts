import { describe, expect, it } from "vitest";
import { buildPOsWhere } from "./queries";

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
});
