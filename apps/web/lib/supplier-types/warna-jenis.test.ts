import { afterEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSupplierType, createSupplierTypeSchema, SupplierTypeError, updateSupplierType, updateSupplierTypeSchema } from "./mutations";

describe("warna jenis pemasok = kode Pantone TCX (pilihan pemilik)", () => {
  const dasar = { code: "FABRIC", name: "Fabric" };
  it("kode dinormalkan; kosong/null = otomatis; tidak dikirim = tidak diubah", () => {
    expect(createSupplierTypeSchema.parse({ ...dasar, colorTcx: "19-4052 TCX" }).colorTcx).toBe("19-4052");
    expect(createSupplierTypeSchema.parse({ ...dasar, colorTcx: "" }).colorTcx).toBeNull();
    expect(createSupplierTypeSchema.parse({ ...dasar, colorTcx: null }).colorTcx).toBeNull();
    expect(updateSupplierTypeSchema.parse({ name: "Kain" })).not.toHaveProperty("colorTcx");
  });
  it("selain kode Pantone ditolak — hex dari peramban tidak diterima", () => {
    for (const colorTcx of ["#2563eb", "Classic Blue", "19-405"]) {
      expect(createSupplierTypeSchema.safeParse({ ...dasar, colorTcx }).success).toBe(false);
    }
  });
});

describe("penulis jenis pemasok: hex dari katalog Pantone (basis data sungguhan)", () => {
  const kode = `UJIWARNA${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  let id = "";
  afterEach(async () => {
    await prisma.supplierType.deleteMany({ where: { id: seededId(id) } });
    id = "";
  });

  it("kode Pantone → color = hex katalog; null → otomatis; kode tak dikenal ditolak tanpa mengubah apa pun", async () => {
    id = (await createSupplierType({ code: kode, name: "Uji warna", colorTcx: "19-4052" })).id;
    expect(await prisma.supplierType.findUniqueOrThrow({ where: { id }, select: { color: true, colorTcx: true } })).toEqual({ color: "#0f4c81", colorTcx: "19-4052" });

    await expect(updateSupplierType(id, { colorTcx: "99-9999" })).rejects.toBeInstanceOf(SupplierTypeError);
    expect((await prisma.supplierType.findUniqueOrThrow({ where: { id } })).colorTcx).toBe("19-4052");

    await updateSupplierType(id, { name: "Uji warna 2" });
    expect((await prisma.supplierType.findUniqueOrThrow({ where: { id } })).colorTcx).toBe("19-4052");

    await updateSupplierType(id, { colorTcx: null });
    expect(await prisma.supplierType.findUniqueOrThrow({ where: { id }, select: { color: true, colorTcx: true } })).toEqual({ color: null, colorTcx: null });
  });
});
