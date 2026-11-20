import { describe, expect, it } from "vitest";
import {
  emptyJasaLine,
  jasaLinesValid,
  syncJasaWithVendor,
  toWriterSteps,
} from "./WoJasaLines";

describe("WoJasaLines helpers", () => {
  it("syncJasaWithVendor fills empty first row and follows destination when unchanged", () => {
    expect(syncJasaWithVendor([], "", "v2")).toEqual([
      { ...emptyJasaLine("v2"), sequence: 1 },
    ]);
    const followed = syncJasaWithVendor(
      [{ ...emptyJasaLine("v1"), sequence: 1, serviceTypeId: "t1" }],
      "v1",
      "v2",
    );
    expect(followed[0].supplierId).toBe("v2");
    const kept = syncJasaWithVendor(
      [
        { ...emptyJasaLine("other"), sequence: 1, serviceTypeId: "t1" },
        { ...emptyJasaLine("v1"), sequence: 2, serviceTypeId: "t2" },
      ],
      "v1",
      "v2",
    );
    expect(kept[0].supplierId).toBe("other");
  });

  it("jasaLinesValid and toWriterSteps require type + supplier", () => {
    expect(jasaLinesValid([emptyJasaLine("v1")])).toBe(false);
    const ok = [{ ...emptyJasaLine("v1"), serviceTypeId: "t1", stepName: "Jahit", servicePrice: 12_000 }];
    expect(jasaLinesValid(ok)).toBe(true);
    expect(toWriterSteps(ok)).toEqual([
      {
        sequence: 1,
        supplierId: "v1",
        serviceTypeId: "t1",
        stepName: "Jahit",
        servicePrice: 12_000,
        servicePpnIncluded: false,
        qty: undefined,
        notes: undefined,
      },
    ]);
  });
});
