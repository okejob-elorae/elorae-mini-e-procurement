import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { awalHariWib, ingatkanMutasiMacet, kabarkanKirimanMenunggu } from "./mutasi-pengingat";

/*
 * Pengingat harian terhadap basis data uji. Setiap sapuan DIBATASI ke baris
 * buatan tes (`transferIds`/`storeIds`) — basis datanya dipakai bersama, dan
 * sapuan tanpa batas akan mengingatkan mutasi sungguhan. Teardown lewat id.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `MTP-${Math.random().toString(36).slice(2, 9)}`;
const HARI_MS = 86_400_000;

d("pengingat mutasi & kiriman menunggu (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let asal = "";
  let tujuan = "";
  let spgAsal = "";
  let spgTujuan = "";
  let transferId = "";
  let shipmentId = "";

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (await prisma.item.create({ data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId } })).id;
    asal = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Asal ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tujuan = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Tujuan ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    spgAsal = (await prisma.user.create({ data: { email: `${tag}-a@test.local`.toLowerCase(), name: "SPG asal", assignedStoreId: asal } })).id;
    spgTujuan = (await prisma.user.create({ data: { email: `${tag}-t@test.local`.toLowerCase(), name: "SPG tujuan", assignedStoreId: tujuan } })).id;
    transferId = (
      await prisma.storeTransfer.create({
        data: {
          docNo: `${tag}/00001`,
          fromStoreId: asal,
          toStoreId: tujuan,
          status: "DIKIRIM",
          reason: "uji",
          createdById: spgAsal,
          shippedById: spgAsal,
          shippedAt: new Date(Date.now() - 5 * HARI_MS),
          idempotencyKey: `${tag}-k`,
          lines: { create: [{ itemId, productName: "Kemeja Uji", qty: 2 }] },
        },
      })
    ).id;
    // Kiriman konsinyasi 2 hari lalu ke toko tujuan, belum diterima.
    shipmentId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `${tag}-KRM`,
          storeId: tujuan,
          shippedAt: new Date(Date.now() - 2 * HARI_MS),
          items: { create: [{ itemId, itemName: "Kemeja Uji", qty: 3, price: 0, amount: 0 }] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    const catatan = await prisma.adminNotification.findMany({ where: { category: "STORE_TRANSFER_STALE" }, select: { id: true, metadata: true } });
    const milik = catatan.filter((c) => (c.metadata as { transferId?: string } | null)?.transferId === transferId).map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreTransfer", entityId: seededId(transferId) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Store", entityId: { in: seededIds([asal, tujuan].filter(Boolean)) } } });
    await prisma.storeTransfer.deleteMany({ where: { id: seededId(transferId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgAsal, spgTujuan].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([asal, tujuan].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("flags a transfer stuck past the reminder period once, never twice", async () => {
    expect(await ingatkanMutasiMacet({ transferIds: [transferId] })).toEqual({ dikabarkan: 1 });
    expect(await ingatkanMutasiMacet({ transferIds: [transferId] })).toEqual({ dikabarkan: 0 });
    const catatan = await prisma.adminNotification.findMany({ where: { category: "STORE_TRANSFER_STALE" }, select: { metadata: true } });
    expect(catatan.filter((c) => (c.metadata as { transferId?: string } | null)?.transferId === transferId)).toHaveLength(1);
  });

  it("does not flag a transfer still inside the reminder period", async () => {
    const lebihAwal = new Date(Date.now() - 3 * HARI_MS);
    // Dilihat dari 2 hari sesudah dikirim, belum lewat 3 hari bawaan.
    expect(await ingatkanMutasiMacet({ transferIds: [transferId], sekarang: lebihAwal })).toEqual({ dikabarkan: 0 });
  });

  it("tells a store's SPGs about deliveries waiting over a day — once per store per WIB day", async () => {
    const r1 = await kabarkanKirimanMenunggu({ storeIds: [tujuan, asal] });
    expect(r1).toEqual({ toko: 1, orang: 1 });
    expect(await kabarkanKirimanMenunggu({ storeIds: [tujuan, asal] })).toEqual({ toko: 0, orang: 0 });
    // Hari berikutnya boleh lagi.
    const besok = new Date(awalHariWib(new Date()).getTime() + 30 * 60 * 60 * 1000);
    expect(await kabarkanKirimanMenunggu({ storeIds: [tujuan], sekarang: besok })).toEqual({ toko: 1, orang: 1 });
  });
});
