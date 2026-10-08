import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { rincianSiklus } from "./queries";

/**
 * Kartu stok di halaman siklus konsinyasi, terhadap basis data sungguhan.
 *
 * Dulu kartu ini menghitung sendiri: SEMUA kiriman sepanjang masa dikurangi
 * terjual BULAN SIKLUS INI saja, dicocokkan lewat NAMA baris. Kiriman per
 * ukuran ("Blus - S") dan terjual per barang ("Blus") jadi dua baris terpisah:
 * yang terjual tampil minus, yang dikirim tidak pernah berkurang (siklus uji
 * KONSI/26/10/0001, 2026-10-08). Sekarang kartu memakai hitungan stok toko
 * yang sama dengan halaman toko (`stokDiToko`).
 *
 *   kirim Juni 2003: S 4, M 4
 *   terjual resmi Juni 2, Juli 2 (dua siklus terkunci)
 *   → stok di toko S 2, M 2 (terjual dibagi sebanding ke ukuran)
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("stok di toko pada rincian siklus (basis data)", () => {
  const tag = `STS${Math.random().toString(36).slice(2, 8)}`;
  const S = `${tag}-S`;
  const M = `${tag}-M`;
  let tokoId = "";
  let uomId = "";
  let barangId = "";
  let kirimId = "";
  let siklusIds: string[] = [];

  beforeEach(async () => {
    tokoId = "";
    uomId = "";
    barangId = "";
    kirimId = "";
    siklusIds = [];
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    barangId = (
      await prisma.item.create({
        data: {
          sku: `${tag}-I`,
          nameId: `${tag} Blus`,
          nameEn: `${tag} Blouse`,
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          variants: [
            { sku: S, size: "S" },
            { sku: M, size: "M" },
          ],
        },
      })
    ).id;
    kirimId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `${tag}/KRM`,
          storeId: tokoId,
          shippedAt: new Date("2003-06-03T03:00:00Z"),
          items: {
            create: [
              { itemId: barangId, variantSku: S, itemName: `${tag} Blus - S`, qty: 4, price: 100000, amount: 400000 },
              { itemId: barangId, variantSku: M, itemName: `${tag} Blus - M`, qty: 4, price: 100000, amount: 400000 },
            ],
          },
        },
      })
    ).id;
    for (const bulan of [6, 7]) {
      const s = await prisma.consignmentCycle.create({
        data: {
          noKonsi: `${tag}/K${bulan}`,
          storeId: tokoId,
          periodYear: 2003,
          periodMonth: bulan,
          lockedAt: new Date(`2003-0${bulan}-28T03:00:00Z`),
          vatApplied: false,
          sold: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 2, price: 100000, amount: 200000 }] },
        },
      });
      siklusIds.push(s.id);
    }
  });

  afterEach(async () => {
    await prisma.consignmentSold.deleteMany({ where: { cycleId: { in: seededIds(siklusIds) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklusIds) } } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: seededId(kirimId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(kirimId) } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  });

  it("per barang × ukuran, terjual semua bulan dikurangkan, tanpa baris nama terpisah", async () => {
    const r = await rincianSiklus(siklusIds[1]);
    expect(r).not.toBeNull();
    expect(r!.stokToko.sumber).toBe("TITIPAN");
    const baris = r!.stokToko.baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, sisa: b.sisa }));
    expect(baris).toHaveLength(2);
    expect(baris).toEqual(
      expect.arrayContaining([
        { itemId: barangId, variantSku: S, sisa: 2 },
        { itemId: barangId, variantSku: M, sisa: 2 },
      ]),
    );
    expect(r!.stokToko.baris.every((b) => b.nama === `${tag} Blus`)).toBe(true);
  });
});
