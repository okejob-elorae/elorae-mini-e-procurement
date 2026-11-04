import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createSupplier, updateSupplier } from "./mutations";

/*
 * SKB pemasok tersimpan lewat penulis pemasok yang asli, dengan jejak
 * `SUPPLIER_SKB_CHANGED` di transaksi yang sama. Basis data uji bersama:
 * teardown lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
let userId = "";
let tipeId = "";
const pemasokIds: string[] = [];

d("SKB pemasok — simpan + jejak (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `skb-mut-${token}@test.local`, name: "Uji SKB pemasok" }, select: { id: true } })).id;
    tipeId = (await prisma.supplierType.create({ data: { code: `TSKBM${token}`, name: "Uji SKB pemasok" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasokIds) } } });
    if (tipeId) await prisma.supplierType.deleteMany({ where: { id: seededId(tipeId) } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("buat ber-SKB, ubah tanggal, lalu hapus — setiap perubahan berjejak; isian tanpa SKB tidak menyentuh SKB", async () => {
    const s = await createSupplier(
      { code: `SSKBM${token}`, name: `Penjahit SKB ${token}`, typeId: tipeId, taxWithholding: "PPH21", skbNumber: "SKB-7/2003", skbValidUntil: "2003-06-30", skbPhotoUrl: null },
      userId,
    );
    pemasokIds.push(s.id);
    expect(s.skbNumber).toBe("SKB-7/2003");
    expect(s.skbValidUntil?.toISOString()).toBe("2003-06-29T17:00:00.000Z");

    await updateSupplier(s.id, { skbNumber: "SKB-7/2003", skbValidUntil: "2003-12-31" }, userId);
    // Formulir lain yang tidak mengirim SKB tidak mengubahnya dan tidak berjejak.
    await updateSupplier(s.id, { name: `Penjahit SKB ${token} (ubah)` }, userId);
    await updateSupplier(s.id, { skbNumber: "" }, userId);
    const akhir = await prisma.supplier.findUnique({ where: { id: s.id }, select: { skbNumber: true, skbValidUntil: true, skbPhotoUrl: true } });
    expect(akhir).toEqual({ skbNumber: null, skbValidUntil: null, skbPhotoUrl: null });

    const jejak = await prisma.auditLog.findMany({ where: { entityId: s.id, action: "SUPPLIER_SKB_CHANGED" }, orderBy: { createdAt: "asc" }, select: { changes: true } });
    expect(jejak.map((j) => j.changes)).toEqual([
      { before: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null }, after: { skbNumber: "SKB-7/2003", skbValidUntil: "2003-06-30", skbPhotoUrl: null } },
      { before: { skbNumber: "SKB-7/2003", skbValidUntil: "2003-06-30", skbPhotoUrl: null }, after: { skbNumber: "SKB-7/2003", skbValidUntil: "2003-12-31", skbPhotoUrl: null } },
      { before: { skbNumber: "SKB-7/2003", skbValidUntil: "2003-12-31", skbPhotoUrl: null }, after: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null } },
    ]);
  });

  it("nomor SKB tanpa tanggal ditolak sebelum ada yang ditulis", async () => {
    await expect(createSupplier({ code: `SSKBN${token}`, name: `Tanpa tanggal ${token}`, typeId: tipeId, skbNumber: "SKB-8" }, userId)).rejects.toThrow(
      "SKB harus punya tanggal berlaku sampai",
    );
    expect(await prisma.supplier.count({ where: { code: `SSKBN${token}` } })).toBe(0);
  });
});
