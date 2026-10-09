import { describe, expect, it } from "vitest";
import { createSupplierTypeSchema, updateSupplierTypeSchema } from "./mutations";

describe("warna jenis pemasok (pilihan pemilik)", () => {
  const dasar = { code: "FABRIC", name: "Fabric" };
  it("hex dinormalkan; kosong/null = otomatis; tidak dikirim = tidak diubah", () => {
    expect(createSupplierTypeSchema.parse({ ...dasar, color: "#2563EB" }).color).toBe("#2563eb");
    expect(createSupplierTypeSchema.parse({ ...dasar, color: "" }).color).toBeNull();
    expect(createSupplierTypeSchema.parse({ ...dasar, color: null }).color).toBeNull();
    expect(updateSupplierTypeSchema.parse({ name: "Kain" })).not.toHaveProperty("color");
  });
  it("selain kode hex 6 digit ditolak", () => {
    for (const color of ["merah", "#abc", "#12345g"]) {
      expect(createSupplierTypeSchema.safeParse({ ...dasar, color }).success).toBe(false);
    }
  });
});
