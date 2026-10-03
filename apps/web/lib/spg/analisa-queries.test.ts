import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { analisaSpg } from "./analisa-queries";

/*
 * Analisa penjualan SPG terhadap basis data sungguhan. Yang dijaga: hanya toko
 * SPG itu sendiri yang terbaca (penjualan & barang dicari toko lain tidak ikut),
 * laku dihitung BERSIH dari barang yang dikembalikan pembeli, sisa di rak dari
 * buku stok toko, dan tidak ada rupiah di hasilnya.
 *
 * Jangan pernah dijalankan ke basis data produksi (terowongan :3307 / host VPS).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("analisaSpg — kueri (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const HARI = 86_400_000;
  const sekarang = new Date();
  const lalu = (n: number) => new Date(sekarang.getTime() - n * HARI);

  let uomId = "";
  let spgId = "";
  let tokoId = "";
  let lainId = "";
  let item: Record<string, string> = {};
  let saleIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    spgId = "";
    tokoId = "";
    lainId = "";
    item = {};
    saleIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-ASG-${token}`, nameId: "t", nameEn: "t" } })).id;
    const buat = async (k: string, nama: string, variants: unknown = undefined) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-ASG-${k}-${token}`, nameId: nama, nameEn: nama, type: "FINISHED_GOOD", uomId, ...(variants ? { variants } : {}) },
        })
      ).id;
    item.A = await buat("A", "Kaos ASG", [
      { sku: `TEST-ASG-A-${token}-M`, size: "M" },
      { sku: `TEST-ASG-A-${token}-L`, size: "L" },
    ]);
    item.B = await buat("B", "Kemeja ASG");
    item.C = await buat("C", "Topi ASG");
    spgId = (await prisma.user.create({ data: { email: `test-asg-${token}@example.com`, name: "SPG ASG" } })).id;
    tokoId = (await prisma.store.create({ data: { code: `TEST-ASG-T-${token}`, name: "Toko ASG", address: "x", termsType: "PUTUS" } })).id;
    lainId = (await prisma.store.create({ data: { code: `TEST-ASG-O-${token}`, name: "Toko Lain ASG", address: "x", termsType: "PUTUS" } })).id;

    const am = `TEST-ASG-A-${token}-M`;
    const al = `TEST-ASG-A-${token}-L`;
    let n = 0;
    const jual = async (storeId: string, tanggal: Date, lines: { itemId: string; variantSku: string; qty: number; returnedQty?: number }[]) => {
      n += 1;
      const s = await prisma.spgSale.create({
        data: {
          docNo: `TEST-ASG-${token}-${n}`,
          salesmanId: spgId,
          createdById: spgId,
          storeId,
          subtotal: 987_654,
          total: 987_654,
          cashReceived: 987_654,
          changeGiven: 0,
          createdAt: tanggal,
          lines: {
            create: lines.map((l) => ({ ...l, productName: "x", unitPrice: 123_457, lineTotal: 123_457 * l.qty })),
          },
        },
      });
      saleIds.push(s.id);
    };
    await jual(tokoId, lalu(1), [
      { itemId: item.A, variantSku: am, qty: 5, returnedQty: 1 },
      { itemId: item.B, variantSku: "", qty: 2 },
    ]);
    await jual(tokoId, lalu(40), [{ itemId: item.A, variantSku: al, qty: 3 }]);
    // Toko lain: tidak boleh terbaca sama sekali.
    await jual(lainId, lalu(1), [{ itemId: item.A, variantSku: am, qty: 50 }]);

    const gerak = (storeId: string, itemId: string, variantSku: string, qty: number, kind: "TERIMA" | "JUAL", tanggal: Date) => ({
      storeId,
      itemId,
      variantSku,
      qty,
      kind,
      createdById: spgId,
      createdAt: tanggal,
    });
    await prisma.storeStockMovement.createMany({
      data: [
        gerak(tokoId, item.A, am, 6, "TERIMA", lalu(60)),
        gerak(tokoId, item.A, am, -5, "JUAL", lalu(1)),
        gerak(tokoId, item.B, "", 10, "TERIMA", lalu(60)),
        gerak(tokoId, item.B, "", -2, "JUAL", lalu(1)),
        gerak(tokoId, item.C, "", 4, "TERIMA", lalu(60)),
        gerak(lainId, item.C, "", 99, "TERIMA", lalu(60)),
      ],
    });
    await prisma.lostSale.createMany({
      data: [
        { storeId: tokoId, userId: spgId, itemId: item.A, variantSku: am, description: "kaos m", qty: 2, createdAt: lalu(1) },
        { storeId: lainId, userId: spgId, itemId: null, variantSku: "", description: "Jaket", qty: 9, createdAt: lalu(1) },
      ],
    });
  });

  afterAll(async () => {
    await prisma.lostSale.deleteMany({ where: { storeId: { in: seededIds([tokoId, lainId]) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds([tokoId, lainId]) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(saleIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoId, lainId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(Object.values(item)) } } });
    await prisma.uOM.deleteMany({ where: { id: { in: seededIds([uomId]) } } });
  });

  it("counts only this store's sales, net of shopper returns, against the previous 30 days", async () => {
    const h = await analisaSpg({ id: tokoId, name: "Toko ASG" }, "30h", sekarang);
    expect(h.analisa.totalPcs).toBe(6);
    expect(h.analisa.totalPcsLalu).toBe(3);
    expect(h.analisa.artikel.map((a) => [a.itemId, a.pcs])).toEqual([
      [item.A, 4],
      [item.B, 2],
    ]);
    expect(h.bukuAda).toBe(true);
    expect(h.kosong).toBe(false);
  });

  it("stock cover from the store book, slow movers, and what shoppers asked for", async () => {
    const h = await analisaSpg({ id: tokoId, name: "Toko ASG" }, "30h", sekarang);
    // A: sisa 1, laku 4 dalam 30 hari → ± 7 hari, hampir habis; B: sisa 8, laku 2 → 120 hari.
    expect(h.cukup.baris.map((c) => [c.itemId, c.sisa, c.laku, c.hariCukup, c.hampirHabis])).toEqual([
      [item.A, 1, 4, 7, true],
      [item.B, 8, 2, 120, false],
    ]);
    expect(h.cukup.mintaHampirHabis).toEqual([{ itemId: item.A, variantSku: `TEST-ASG-A-${token}-M`, qty: 1 }]);
    expect(h.lambat.baris.map((l) => [l.itemId, l.sisa])).toEqual([[item.C, 4]]);
    expect(h.dicari.map((x) => [x.keterangan, x.qty, x.itemId])).toEqual([["Kaos ASG — M", 2, item.A]]);
  });

  it("carries no rupiah at all — not this store's, not another store's", async () => {
    const teks = JSON.stringify(await analisaSpg({ id: tokoId, name: "Toko ASG" }, "bulan-ini", sekarang));
    expect(teks).not.toMatch(/987654|123457|"nilai":\d|"total(Nilai)?":\d|Rp/);
    expect(teks).not.toContain("Toko Lain ASG");
  });
});
