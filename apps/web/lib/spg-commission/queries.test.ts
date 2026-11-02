import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { konsiReportKey, putusReportKey } from "./payout";
import { getCommissionRecap } from "./queries";

/* Writes rows on the shared test bed — never run against the prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * The recap by PAYOUT month (owner decision 2026-11-01): a consignment cycle locked in November
 * for October sales and a putus store's October checked in November are both paid in November,
 * both at the category rate, each SPG on her own pieces, and both carry October as their sales
 * month. `Item.commissionPerPcs` is set to a figure that would show if anything still read it.
 * Every row is seeded here and removed through `seededId(s)`; the recap is scoped to the seeded
 * stores.
 */
d("getCommissionRecap by payout month (test bed only)", () => {
  const tag = `RKP${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let kategoriId = "";
  let kaosId = "";
  let tokoKonsi = "";
  let tokoPutus = "";
  let ani = "";
  let sari = "";
  let dewi = "";
  let siklusId = "";
  let cekId = "";
  const nota: string[] = [];
  let nomor = 0;

  const toko = () => seededIds([tokoKonsi, tokoPutus].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { code: `K-${tag}`, name: `Kaos ${tag}`, isActive: true } })).id;
    await prisma.spgCommissionRate.create({ data: { itemCategoryId: kategoriId, amountPerPiece: 2_000, effectiveFrom: "2026-01", createdById: "uji" } });
    // Tarif November tidak boleh menyentuh penjualan Oktober yang dicek November.
    await prisma.spgCommissionRate.create({ data: { itemCategoryId: kategoriId, amountPerPiece: 9_000, effectiveFrom: "2026-11", createdById: "uji" } });
    kaosId = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, categoryId: kategoriId, sellingPrice: 50_000, commissionPerPcs: 7_777 },
      })
    ).id;
    tokoKonsi = (await prisma.store.create({ data: { code: `${tag}-K`, name: `Melati ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tokoPutus = (await prisma.store.create({ data: { code: `${tag}-P`, name: `Sinar ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    const orang = async (nama: string, storeId: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    ani = await orang("Ani", tokoKonsi);
    sari = await orang("Sari", tokoKonsi);
    dewi = await orang("Dewi", tokoPutus);

    const jual = async (salesmanId: string, storeId: string, qty: number, waktu: string) => {
      const s = await prisma.spgSale.create({
        data: {
          docNo: `${tag}-${nomor++}`,
          salesmanId,
          storeId,
          subtotal: 0,
          total: 0,
          cashReceived: 0,
          changeGiven: 0,
          createdById: salesmanId,
          createdAt: new Date(waktu),
          lines: { create: [{ itemId: kaosId, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
        },
        select: { id: true },
      });
      nota.push(s.id);
    };
    await jual(ani, tokoKonsi, 20, "2026-10-10T10:00:00+07:00");
    await jual(sari, tokoKonsi, 10, "2026-10-20T10:00:00+07:00");
    await jual(dewi, tokoPutus, 7, "2026-10-15T10:00:00+07:00");

    siklusId = (
      await prisma.consignmentCycle.create({
        data: {
          noKonsi: `${tag}/K`,
          storeId: tokoKonsi,
          periodYear: 2026,
          periodMonth: 10,
          lockedAt: new Date("2026-11-05T10:00:00+07:00"),
          sold: { create: [{ itemId: kaosId, itemName: `Kaos ${tag}`, qty: 30, price: 50_000, amount: 1_500_000, commissionPerPcs: 7_777 }] },
        },
      })
    ).id;
  });

  afterEach(async () => {
    if (cekId) await prisma.spgSalesCheck.deleteMany({ where: { id: seededId(cekId) } });
    cekId = "";
  });

  afterAll(async () => {
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: { in: toko() } } });
    if (siklusId) {
      await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
      await prisma.consignmentCycle.delete({ where: { id: seededId(siklusId) } });
    }
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([ani, sari, dewi].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: toko() } } });
    if (kaosId) await prisma.item.delete({ where: { id: seededId(kaosId) } });
    if (kategoriId) {
      await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: seededId(kategoriId) } });
      await prisma.itemCategory.delete({ where: { id: seededId(kategoriId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const cek = async (checkedAt: string) => {
    cekId = (await prisma.spgSalesCheck.create({ data: { storeId: tokoPutus, period: "2026-10", checkedById: "uji", checkedAt: new Date(checkedAt) } })).id;
  };

  const baris = (recap: Awaited<ReturnType<typeof getCommissionRecap>>) =>
    recap.rows.map((r) => [r.salesmanId, r.pieces, r.net]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it("pays October's konsi cycle locked in November and October's putus month checked in November in November, at the category rate, per SPG", async () => {
    await cek("2026-11-06T09:00:00+07:00");
    const nov = await getCommissionRecap("2026-11", prisma, { storeIds: toko() });
    expect(baris(nov)).toEqual(
      [
        [ani, 20, 40_000],
        [sari, 10, 20_000],
        [dewi, 7, 14_000],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    // Both kinds carry their sales month: the payout's note is "Komisi penjualan Oktober 2026".
    expect(new Set(nov.events.map((e) => [e.yearMonth, e.salesMonth].join("/")))).toEqual(new Set(["2026-11/2026-10"]));
    expect(new Set(nov.events.map((e) => e.ratePerPiece))).toEqual(new Set([2_000]));
    expect(nov.reportDocNos[konsiReportKey(siklusId)]).toBe(`${tag}/K`);
    expect(nov.reportDocNos[putusReportKey(tokoPutus, "2026-10")]).toBe("Penjualan Oktober 2026");

    // The sales month itself pays nothing: October is not when anything was checked.
    expect((await getCommissionRecap("2026-10", prisma, { storeIds: toko() })).rows).toEqual([]);
  });

  it("never reads Item.commissionPerPcs: no figure is a multiple of 7 777", async () => {
    await cek("2026-11-06T09:00:00+07:00");
    const nov = await getCommissionRecap("2026-11", prisma, { storeIds: toko() });
    expect(nov.events.every((e) => e.amount % 7_777 !== 0 || e.amount === 0)).toBe(true);
  });

  it("an unchecked putus month is in no payout month, and re-checking it later moves it there once, never twice", async () => {
    expect((await getCommissionRecap("2026-11", prisma, { storeIds: [tokoPutus] })).rows).toEqual([]);

    await cek("2026-12-01T09:00:00+07:00");
    expect((await getCommissionRecap("2026-11", prisma, { storeIds: [tokoPutus] })).rows).toEqual([]);
    const des = await getCommissionRecap("2026-12", prisma, { storeIds: [tokoPutus] });
    expect(baris(des)).toEqual([[dewi, 7, 14_000]]);
    // October's rate still applies, although December has a different rate in force.
    expect(des.events.map((e) => e.ratePerPiece)).toEqual([2_000]);
  });

  it("an empty store scope reads nothing", async () => {
    await cek("2026-11-06T09:00:00+07:00");
    expect((await getCommissionRecap("2026-11", prisma, { storeIds: [] })).rows).toEqual([]);
  });
});
