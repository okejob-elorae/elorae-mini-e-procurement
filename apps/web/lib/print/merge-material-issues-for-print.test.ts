import { describe, expect, it } from "vitest";
import { mergeMaterialIssuesForPrint } from "./merge-material-issues-for-print";

const labels = {
  fabric: "Fabric",
  accessories: "Accessories",
  mixed: "Fabric + Accessories",
};

describe("mergeMaterialIssuesForPrint", () => {
  it("returns null for an empty list", () => {
    expect(mergeMaterialIssuesForPrint([], labels)).toBeNull();
  });

  it("keeps a single issue and maps its type label", () => {
    const merged = mergeMaterialIssuesForPrint(
      [
        {
          docNumber: "ISS/1",
          issueType: "FABRIC",
          issuedAt: "2026-10-14T00:00:00.000Z",
          woDocNumber: "WO/1",
          vendorName: "CMT",
          lines: [{ itemName: "Cotton", qty: 10, uomCode: "M" }],
        },
      ],
      labels
    );
    expect(merged).toMatchObject({
      docNumber: "ISS/1",
      issueType: "Fabric",
      woDocNumber: "WO/1",
      vendorName: "CMT",
      lines: [{ itemName: "Cotton", qty: 10, uomCode: "M" }],
    });
  });

  it("joins docs, uses mixed type, fabric-then-accessories order", () => {
    const merged = mergeMaterialIssuesForPrint(
      [
        {
          docNumber: "ISS/A",
          issueType: "ACCESSORIES",
          issuedAt: "2026-10-15T00:00:00.000Z",
          woDocNumber: "WO/1",
          vendorName: "CMT",
          lines: [{ itemName: "Zip", qty: 2, uomCode: "PCS" }],
        },
        {
          docNumber: "ISS/F",
          issueType: "FABRIC",
          issuedAt: "2026-10-16T00:00:00.000Z",
          woDocNumber: "WO/1",
          vendorName: "CMT",
          lines: [{ itemName: "Cotton", qty: 10, uomCode: "M" }],
        },
      ],
      labels
    );
    expect(merged?.docNumber).toBe("ISS/F, ISS/A");
    expect(merged?.issueType).toBe("Fabric + Accessories");
    expect(merged?.lines.map((l) => l.itemName)).toEqual(["Cotton", "Zip"]);
    expect(merged?.issuedAt).toBe("2026-10-15T00:00:00.000Z");
  });
});
