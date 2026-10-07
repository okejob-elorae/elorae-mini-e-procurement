import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { catatHitunganGudang, catatReturToko } from "./return-writer";
import { batalkanReturSendiri, KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES, pindahkanReturKeToko } from "./koreksi";

/**
 * NRT dari SPG, terhadap basis data sungguhan: nomor TRK buatan sistem, buku
 * stok toko (keluar saat dilapor, dibalik saat ditarik, tidak pernah dihapus),
 * pindah toko ditolak bila buku sudah bergerak, dan hitungan gudang per varian.
 *
 * Pengguna DIPINJAM; setiap penghapusan lewat `seededId()`; id fixture
 * dideklarasikan "" dan direset di awal hook.
 */

/** Lonceng kantor "retur SPG dari toko tanpa pemegang" milik nota uji — dicocokkan di JS lewat metadata. */
async function hapusNotifReturTanpaPemegang(notaIds: string[]) {
  if (notaIds.length === 0) return;
  const catatan = await prisma.adminNotification.findMany({
    where: { category: "RETUR_SPG_TANPA_PEMEGANG" },
    select: { id: true, metadata: true },
  });
  const milikUji = catatan
    .filter((c) => {
      const m = c.metadata as Record<string, unknown> | null;
      return typeof m?.storeReturnId === "string" && notaIds.includes(m.storeReturnId);
    })
    .map((c) => c.id);
  if (milikUji.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
}

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("NRT SPG (test bed only)", () => {
  const tag = `RSPG-${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let spgId = "";
  let gudangId = "";
  let tokoKonsiId = "";
  let tokoPutusId = "";
  let nrtIds: string[] = [];
  let nriIds: string[] = [];

  const hari = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    spgId = "";
    gudangId = "";
    tokoKonsiId = "";
    tokoPutusId = "";
    nrtIds = [];
    nriIds = [];

    const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
    if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
    spgId = orang[0].id;
    gudangId = orang[1].id;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: tag,
          nameId: `Kemeja ${tag}`,
          nameEn: "Shirt",
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          sellingPrice: 80_000,
          variants: [
            { sku: `${tag}-M`, size: "M" },
            { sku: `${tag}-L`, size: "L" },
          ],
        },
      })
    ).id;
    const buatToko = (akhiran: string, termsType: "PUTUS" | "KONSI") =>
      prisma.store.create({
        data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType, marginPercent: 20, isActive: true },
      });
    tokoKonsiId = (await buatToko("K", "KONSI")).id;
    tokoPutusId = (await buatToko("P", "PUTUS")).id;
    // Buku toko konsinyasi sudah dimulai: 5 potong M diterima.
    await prisma.storeStockMovement.create({
      data: { storeId: tokoKonsiId, itemId, variantSku: `${tag}-M`, qty: 5, kind: "TERIMA", createdById: spgId },
    });
  });

  afterEach(async () => {
    if ([...nrtIds, ...nriIds].some(Boolean)) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...nrtIds, ...nriIds].filter(Boolean).map(seededId) } } });
    }
    const notif = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES, message: { contains: tag } },
      select: { id: true },
    });
    if (notif.length) await prisma.adminNotification.deleteMany({ where: { id: { in: notif.map((n) => seededId(n.id)) } } });
    const toko = () => [tokoKonsiId, tokoPutusId].filter(Boolean).map(seededId);
    // Toko uji tanpa pemegang: setiap NRT SPG membunyikan lonceng kantor.
    const notaToko = await prisma.storeReturn.findMany({ where: { storeId: { in: toko() } }, select: { id: true } });
    await hapusNotifReturTanpaPemegang(notaToko.map((n) => n.id));
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: toko() } } });
    await prisma.storeOpname.deleteMany({ where: { storeId: { in: toko() } } });
    await prisma.returnCharge.deleteMany({ where: { storeReturnId: { in: nrtIds.filter(Boolean).map(seededId) } } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: nriIds.filter(Boolean).map(seededId) } } });
    await prisma.storeReturn.deleteMany({ where: { storeId: { in: toko() } } });
    if (itemId) {
      // Baris RUSAK hitungan gudang masuk gudang barang rusak.
      await prisma.damagedStockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (toko().length) await prisma.store.deleteMany({ where: { id: { in: toko() } } });
  });

  const lapor = (opsi: Partial<Parameters<typeof catatReturToko>[0]> = {}) =>
    catatReturToko({
      noNrt: "",
      storeId: tokoKonsiId,
      olehUserId: spgId,
      salesmanId: spgId,
      claimDate: hari("2026-10-01"),
      deliveryMethod: "SALES",
      reportedBySpg: true,
      barisSpg: [
        { itemId, variantSku: `${tag}-M`, qty: 2, condition: "LAYAK" },
        { itemId, variantSku: `${tag}-L`, qty: 1, condition: "RUSAK" },
      ],
      ...opsi,
    });

  const saldo = async (varian: string) =>
    (
      await prisma.storeStockMovement.aggregate({
        where: { storeId: seededId(tokoKonsiId), itemId: seededId(itemId), variantSku: varian },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0;

  it("KONSI: numbers the note TRK, values it from the consignment price, and takes the goods off the store book", async () => {
    const h = await lapor();
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    nrtIds.push(h.id);
    expect(h.noNrt).toMatch(/^TRK\/26\/10\/\d{4}$/);

    const nota = await prisma.storeReturn.findUniqueOrThrow({ where: { id: h.id }, include: { items: true } });
    expect(nota.reportedBySpg).toBe(true);
    // 80.000 / (1 − 20%) = 100.000 per potong × 3 potong.
    expect(Number(nota.claimedAmount)).toBe(300_000);
    expect(nota.items.map((i) => [i.variantSku, i.qty, i.condition]).sort()).toEqual([
      [`${tag}-L`, 1, "RUSAK"],
      [`${tag}-M`, 2, "LAYAK"],
    ]);

    expect(await saldo(`${tag}-M`)).toBe(3);
    expect(await saldo(`${tag}-L`)).toBe(-1);
  });

  it("two SPG notes saved at the same moment get two different TRK numbers", async () => {
    const [a, b] = await Promise.all([lapor({ idempotencyKey: `${tag}-a` }), lapor({ idempotencyKey: `${tag}-b` })]);
    if (!a.ok || !b.ok) throw new Error("gagal");
    nrtIds.push(a.id, b.id);
    expect(a.noNrt).not.toBe(b.noNrt);
  });

  it("a replay with the same key records once and moves the book once", async () => {
    const a = await lapor({ idempotencyKey: `${tag}-k` });
    const b = await lapor({ idempotencyKey: `${tag}-k` });
    if (!a.ok || !b.ok) throw new Error("gagal");
    nrtIds.push(a.id);
    expect(b.id).toBe(a.id);
    expect(await saldo(`${tag}-M`)).toBe(3);
  });

  it("skips the store book for a return dated before the last store opname", async () => {
    await prisma.storeOpname.create({ data: { storeId: tokoKonsiId, countedById: spgId, countedAt: hari("2026-10-05") } });
    const h = await lapor({ claimDate: hari("2026-10-01") });
    if (!h.ok) throw new Error("gagal");
    nrtIds.push(h.id);
    expect(await saldo(`${tag}-M`)).toBe(5);
  });

  it("skips the store book when the store has none yet", async () => {
    const h = await lapor({ storeId: tokoPutusId, noNrt: `${tag}/RT`, claimedAmount: 150_000, photoUrl: "/api/foto/x" });
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    nrtIds.push(h.id);
    const n = await prisma.storeStockMovement.count({ where: { storeId: seededId(tokoPutusId) } });
    expect(n).toBe(0);
    const nota = await prisma.storeReturn.findUniqueOrThrow({ where: { id: h.id } });
    expect(Number(nota.claimedAmount)).toBe(150_000);
  });

  it("withdrawing the note writes a +qty reversal and keeps the original rows", async () => {
    const h = await lapor();
    if (!h.ok) throw new Error("gagal");
    nrtIds.push(h.id);
    const tarik = await batalkanReturSendiri({ storeReturnId: h.id, salesmanId: spgId, alasan: "salah barang" });
    expect(tarik.ok).toBe(true);

    expect(await saldo(`${tag}-M`)).toBe(5);
    expect(await saldo(`${tag}-L`)).toBe(0);
    const baris = await prisma.storeStockMovement.findMany({ where: { refType: "StoreReturn", refId: seededId(h.id) } });
    expect(baris.map((b) => b.qty).sort((x, y) => x - y)).toEqual([-2, -1, 1, 2]);
  });

  it("refuses to move a note that already moved the store book", async () => {
    const h = await lapor();
    if (!h.ok) throw new Error("gagal");
    nrtIds.push(h.id);
    const pindah = await pindahkanReturKeToko({
      storeReturnId: h.id,
      tokoTujuanId: tokoPutusId,
      alasan: "salah toko",
      olehUserId: gudangId,
    });
    expect(pindah).toEqual({ ok: false, alasan: "ADA_BUKU_TOKO" });
    const nota = await prisma.storeReturn.findUniqueOrThrow({ where: { id: h.id } });
    expect(nota.storeId).toBe(tokoKonsiId);
  });

  it("warehouse count per line: LAYAK goes back to its exact variant, RUSAK stays out of sellable stock", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `${tag}-M`, qtyOnHand: 10, reservedQty: 0, avgCost: 40_000, totalValue: 400_000 },
    });
    const h = await lapor();
    if (!h.ok) throw new Error("gagal");
    nrtIds.push(h.id);

    const nri = await catatHitunganGudang({
      storeReturnId: h.id,
      warehouseUserId: gudangId,
      receivedAt: hari("2026-10-02"),
      deliveryMethod: "SALES",
      items: [
        { itemId, variantSku: `${tag}-M`, itemName: "Kemeja M", qty: 2, price: 100_000, condition: "LAYAK" },
        { itemId, variantSku: `${tag}-L`, itemName: "Kemeja L", qty: 1, price: 100_000, condition: "RUSAK" },
      ],
    });
    if (!nri.ok) throw new Error(`gagal: ${nri.alasan}`);
    nriIds.push(nri.id);
    expect(nri.barisStok).toBe(1);

    const m = await prisma.inventoryValue.findUniqueOrThrow({ where: { itemId_variantSku: { itemId, variantSku: `${tag}-M` } } });
    expect(Number(m.qtyOnHand)).toBe(12);
    const l = await prisma.inventoryValue.findFirst({ where: { itemId: seededId(itemId), variantSku: `${tag}-L` } });
    expect(l).toBeNull();
    // …tapi masuk gudang barang rusak, satu gerakan untuk baris NRI-nya.
    const rusak = await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(itemId) } });
    expect(rusak.map((r) => [r.variantSku, r.qty, r.kind])).toEqual([[`${tag}-L`, 1, "MASUK_RETUR"]]);

    const baris = await prisma.warehouseReturnItem.findMany({ where: { warehouseReturnId: seededId(nri.id) } });
    expect(baris.map((b) => [b.variantSku, b.qtyClaim, b.qty, b.condition]).sort()).toEqual([
      [`${tag}-L`, 1, 1, "RUSAK"],
      [`${tag}-M`, 2, 2, "LAYAK"],
    ]);
    const nota = await prisma.storeReturn.findUniqueOrThrow({ where: { id: h.id } });
    expect(nota.status).toBe("COCOK");
  });
});
