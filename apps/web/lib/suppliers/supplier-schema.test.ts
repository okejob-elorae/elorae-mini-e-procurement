import { describe, expect, it } from "vitest";
import { supplierSchema, supplierUpdateSchema } from "./mutations";

const base = { name: "Supplier A", typeId: "type-1" };

describe("supplier payment terms", () => {
  it("accepts whole days and blank", () => {
    expect(supplierSchema.parse({ ...base, paymentTermsDays: 30 }).paymentTermsDays).toBe(30);
    expect(supplierSchema.parse({ ...base, paymentTermsDays: "" }).paymentTermsDays).toBeNull();
    expect(supplierSchema.parse(base).paymentTermsDays).toBeUndefined();
  });

  it.each([-1, 1.5, 366])("create refuses %s", (v) => {
    expect(supplierSchema.safeParse({ ...base, paymentTermsDays: v }).success).toBe(false);
  });

  it.each([-1, 1.5, 366])("update refuses %s", (v) => {
    expect(supplierUpdateSchema.safeParse({ paymentTermsDays: v }).success).toBe(false);
  });

  it("update can clear terms with null", () => {
    expect(supplierUpdateSchema.parse({ paymentTermsDays: null }).paymentTermsDays).toBeNull();
  });
});
