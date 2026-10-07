import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { lakuKonsiSalesman, lakuKonsiSatuSalesman } from "./penjualan-konsi-queries";
import { penjualanSalesman } from "./queries";

/*
 * Omzet konsinyasi salesman = barang LAKU di toko konsinyasi, pada harga yang
 * Elorae terima — terhadap basis data sungguhan. Transfer konsi yang disetujui
 * sengaja bernilai besar (999.999) supaya kalau ikut terhitung, angkanya
 * langsung terlihat.
 *
 * Bulan acak jauh di masa lalu; teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const TAHUN = acak(2004, 2019);
const BL = acak(3, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const BULAN = `${TAHUN}-${pad(BL)}`;
const BULAN_LALU = `${TAHUN}-${pad(BL - 1)}`;
const tgl = (hari: number, jam = "10:00", bulan = BULAN) => new Date(`${bulan}-${pad(hari)}T${jam}:00+07:00`);
const AWAL_BULAN_LALU = new Date(`${BULAN_LALU}-01T00:00:00+07:00`);
const AWAL_BULAN = new Date(`${BULAN}-01T00:00:00+07:00`);
const SEKARANG = new Date(`${TAHUN + 1}-01-15T10:00:00+07:00`);
const akhirBulan = (bulan: string) => {
  const [th, bl] = bulan.split("-").map(Number);
  const berikut = bl === 12 ? `${th + 1}-01` : `${th}-${pad(bl + 1)}`;
  return new Date(new Date(`${berikut}-01T00:00:00+07:00`).getTime() - 1);
};

d("omzet konsinyasi = barang laku di toko (test bed only)", () => {
  let uomId = "";
  let i1 = "";
  let i2 = "";
  let salesA = "";
  let salesB = "";
  let tokoIds: string[] = [];
  let orderIds: string[] = [];
  let gerakIds: string[] = [];
  let siklusIds: string[] = [];
  let jejakIds: string[] = [];
  const toko: Record<string, string> = {};

  beforeAll(async () => {
    uomId = "";
    i1 = "";
    i2 = "";
    salesA = "";
    salesB = "";
    tokoIds = [];
    orderIds = [];
    gerakIds = [];
    siklusIds = [];
    jejakIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PKQ-${token}`, nameId: "t", nameEn: "t" } })).id;
    const barang = async (k: string, sellingPrice: number) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-PKQ-${k}-${token}`, nameId: `Barang PKQ ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId, sellingPrice },
        })
      ).id;
    i1 = await barang("1", 70_000);
    i2 = await barang("2", 80_000);
    salesA = (await prisma.user.create({ data: { email: `pkq-a-${token}@test.local`, name: `Sales A ${token}` } })).id;
    salesB = (await prisma.user.create({ data: { email: `pkq-b-${token}@test.local`, name: `Sales B ${token}` } })).id;

    // Kode toko TANPA awalan "TEST-" (spec lain menghapus toko berawalan itu).
    const buatToko = async (k: string, termsType: "PUTUS" | "KONSI", salesmanId: string | null, marginPercent: number | null) => {
      const id = (
        await prisma.store.create({
          data: { code: `PKQ-${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType, salesmanId, marginPercent },
        })
      ).id;
      tokoIds.push(id);
      toko[k] = id;
      return id;
    };
    await buatToko("BUKU", "KONSI", salesA, 25);
    await buatToko("TITIP", "KONSI", null, 20);
    await buatToko("LAIN", "KONSI", salesB, 25);
    await buatToko("NOHARGA", "KONSI", salesA, 25);
    await buatToko("PUTUS", "PUTUS", salesA, null);
    await buatToko("TRANSISI", "KONSI", salesA, null);
    // ROTASI: dipegang A sampai tanggal 12, sesudahnya B (pemegang sekarang).
    await buatToko("ROTASI", "KONSI", salesB, null);
    // ROTASI_TEKS: sama, pindah tanggal 16 — jejaknya tersimpan sebagai TEKS JSON.
    await buatToko("ROTASI_TEKS", "KONSI", salesB, null);
    jejakIds.push(
      (
        await prisma.auditLog.create({
          data: {
            userId: salesA,
            action: "STORE_SALESMAN_CHANGED",
            entityType: "Store",
            entityId: toko.ROTASI_TEKS,
            changes: JSON.stringify({ before: { salesmanId: salesA }, after: { salesmanId: salesB } }),
            createdAt: tgl(16),
          },
        })
      ).id,
    );
    jejakIds.push(
      (
        await prisma.auditLog.create({
          data: {
            userId: salesA,
            action: "STORE_SALESMAN_CHANGED",
            entityType: "Store",
            entityId: toko.ROTASI,
            changes: { before: { salesmanId: salesA }, after: { salesmanId: salesB } },
            createdAt: tgl(12),
          },
        })
      ).id,
    );

    let n = 0;
    const konsi = async (storeId: string, salesmanId: string, approvedAt: Date, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `TEST-PKQ-${token}-${n}`,
          storeId,
          salesmanId,
          orderType: "KONSI",
          status: "APPROVED",
          approvedAt,
          subtotal: 999_999,
          total: 999_999,
          lines: { create: lines as never },
        },
      });
      orderIds.push(o.id);
    };
    // Toko BUKU dipegang A; transfer disetujui dikirim B. Harga di toko 100.000 → Elorae terima 75.000.
    await konsi(toko.BUKU, salesB, tgl(2), [{ itemId: i1, variantSku: "S", productName: "A", qty: 10, unitPrice: 100_000, lineTotal: 1_000_000 }]);
    // Toko TITIP tanpa pemegang: transfer lama oleh B, transfer terakhir oleh A → milik A. 100.000 margin 20% → 80.000.
    await konsi(toko.TITIP, salesB, tgl(3, "10:00", BULAN_LALU), [{ itemId: i2, productName: "B", qty: 5, unitPrice: 100_000, lineTotal: 500_000 }]);
    await konsi(toko.TITIP, salesA, tgl(4, "10:00", BULAN_LALU), [{ itemId: i2, productName: "B", qty: 5, unitPrice: 100_000, lineTotal: 500_000 }]);
    // Toko LAIN dipegang B; A pernah mengirim ke sana — lakunya tetap milik B.
    await konsi(toko.LAIN, salesA, tgl(2), [{ itemId: i1, productName: "A", qty: 4, unitPrice: 100_000, lineTotal: 400_000 }]);
    // Toko TRANSISI: margin kosong → harga di toko dipakai apa adanya (60.000).
    await konsi(toko.TRANSISI, salesA, tgl(2, "10:00", BULAN_LALU), [{ itemId: i1, productName: "A", qty: 9, unitPrice: 60_000, lineTotal: 540_000 }]);
    await konsi(toko.ROTASI, salesA, tgl(1), [{ itemId: i1, productName: "A", qty: 5, unitPrice: 50_000, lineTotal: 250_000 }]);
    // Dikirim B: tanpa jejak yang terbaca, lakunya jatuh ke B (pengirim/pemegang sekarang).
    await konsi(toko.ROTASI_TEKS, salesB, tgl(1), [{ itemId: i2, productName: "B", qty: 3, unitPrice: 30_000, lineTotal: 90_000 }]);

    const gerak = async (storeId: string, itemId: string, variantSku: string, qty: number, kind: "TERIMA" | "JUAL" | "RETUR_PEMBELI", createdAt: Date) => {
      const g = await prisma.storeStockMovement.create({ data: { storeId, itemId, variantSku, qty, kind, createdById: salesA, createdAt } });
      gerakIds.push(g.id);
    };
    // BUKU: S laku 3, kembali 1 → 2; M laku 2 (tanpa harga ukuran itu → harga barang terbaru 75.000). TERIMA tidak dihitung.
    await gerak(toko.BUKU, i1, "S", 10, "TERIMA", tgl(2));
    await gerak(toko.BUKU, i1, "S", -3, "JUAL", tgl(10));
    await gerak(toko.BUKU, i1, "M", -2, "JUAL", tgl(12));
    await gerak(toko.BUKU, i1, "S", 1, "RETUR_PEMBELI", tgl(13));
    // LAIN (milik B): 1 laku.
    await gerak(toko.LAIN, i1, "", -1, "JUAL", tgl(11));
    // NOHARGA: belum pernah dikirim berharga → harga jual Elorae 80.000.
    await gerak(toko.NOHARGA, i2, "", -1, "JUAL", tgl(14));
    // PUTUS ber-SPG: barangnya sudah milik toko — bukan omzet konsi.
    await gerak(toko.PUTUS, i1, "", -7, "JUAL", tgl(14));
    // TRANSISI: buku dimulai bulan ini; JUAL 2 bulan ini.
    await gerak(toko.TRANSISI, i1, "", -2, "JUAL", tgl(9));
    // ROTASI: laku sebelum pindah milik A, sesudahnya milik B.
    await gerak(toko.ROTASI, i1, "", -1, "JUAL", tgl(10, "11:00"));
    await gerak(toko.ROTASI, i1, "", -2, "JUAL", tgl(14));
    // ROTASI_TEKS: laku tanggal 13, sebelum pindah → milik A.
    await gerak(toko.ROTASI_TEKS, i2, "", -1, "JUAL", tgl(13));

    const siklus = async (storeId: string, bulan: string, locked: boolean, sold: { itemId: string; qty: number }[]) => {
      const [th, bl] = bulan.split("-").map(Number);
      const c = await prisma.consignmentCycle.create({
        data: { noKonsi: `TEST-PKQ-K-${token}-${siklusIds.length}`, storeId, periodYear: th, periodMonth: bl, lockedAt: locked ? tgl(1) : null },
      });
      siklusIds.push(c.id);
      if (sold.length) {
        await prisma.consignmentSold.createMany({
          data: sold.map((s) => ({ cycleId: c.id, itemId: s.itemId, itemName: "x", qty: s.qty, price: 1, amount: s.qty })),
        });
      }
    };
    // TITIP: laporan resmi bulan lalu 3 pcs (dikunci); bulan ini belum dikunci → belum ada laku.
    await siklus(toko.TITIP, BULAN_LALU, true, [{ itemId: i2, qty: 3 }]);
    await siklus(toko.TITIP, BULAN, false, [{ itemId: i2, qty: 50 }]);
    // TRANSISI: bulan lalu (sebelum buku) 4 pcs dipakai; bulan ini (buku sudah ada) 6 pcs TIDAK.
    await siklus(toko.TRANSISI, BULAN_LALU, true, [{ itemId: i1, qty: 4 }]);
    await siklus(toko.TRANSISI, BULAN, true, [{ itemId: i1, qty: 6 }]);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(jejakIds) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklusIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesA, salesB].filter(Boolean)) } } });
  });

  it("buku toko: JUAL bersih retur pembeli, harga Elorae per ukuran, milik pemegang toko", async () => {
    const a = (await lakuKonsiSalesman([salesA], AWAL_BULAN, { sekarang: SEKARANG })).get(salesA)!;
    const buku = a.filter((b) => b.storeId === toko.BUKU);
    expect(buku.map((b) => [b.variantSku, b.pcs, b.nilai])).toEqual([
      ["S", 3, 225_000],
      ["M", 2, 150_000],
      ["S", -1, -75_000],
    ]);
  });

  it("rotasi toko: laku sebelum pindah tetap milik pemegang lama", async () => {
    const peta = await lakuKonsiSalesman([salesA, salesB], AWAL_BULAN, { sekarang: SEKARANG });
    expect(peta.get(salesA)!.filter((b) => b.storeId === toko.ROTASI).map((b) => [b.pcs, b.nilai])).toEqual([[1, 50_000]]);
    expect(peta.get(salesB)!.filter((b) => b.storeId === toko.ROTASI).map((b) => [b.pcs, b.nilai])).toEqual([[2, 100_000]]);
  });

  it("jejak pindah pemegang yang terbaca sebagai teks JSON tetap dipakai", async () => {
    const peta = await lakuKonsiSalesman([salesA, salesB], AWAL_BULAN, { sekarang: SEKARANG });
    expect(peta.get(salesA)!.filter((b) => b.storeId === toko.ROTASI_TEKS).map((b) => [b.pcs, b.nilai])).toEqual([[1, 30_000]]);
    expect(peta.get(salesB)!.some((b) => b.storeId === toko.ROTASI_TEKS)).toBe(false);
  });

  it("toko tanpa harga kiriman jatuh ke harga jual Elorae; toko putus tidak dihitung", async () => {
    const a = (await lakuKonsiSalesman([salesA], AWAL_BULAN, { sekarang: SEKARANG })).get(salesA)!;
    expect(a.filter((b) => b.storeId === toko.NOHARGA).map((b) => b.nilai)).toEqual([80_000]);
    expect(a.some((b) => b.storeId === toko.PUTUS)).toBe(false);
    expect(a.some((b) => b.storeId === toko.LAIN)).toBe(false);
  });

  it("laporan resmi: hanya siklus terkunci, sebelum buku dimulai, di akhir bulannya; toko tanpa pemegang milik pengirim terakhir", async () => {
    const peta = await lakuKonsiSalesman([salesA, salesB], AWAL_BULAN_LALU, { sekarang: SEKARANG });
    const a = peta.get(salesA)!;
    expect(a.filter((b) => b.storeId === toko.TITIP)).toEqual([
      { tanggal: akhirBulan(BULAN_LALU), storeId: toko.TITIP, itemId: i2, variantSku: "", pcs: 3, nilai: 240_000 },
    ]);
    expect(a.filter((b) => b.storeId === toko.TRANSISI).map((b) => [b.pcs, b.nilai])).toEqual([
      [4, 240_000],
      [2, 120_000],
    ]);
    expect(peta.get(salesB)!.map((b) => [b.storeId, b.pcs, b.nilai])).toEqual([
      [toko.LAIN, 1, 75_000],
      [toko.ROTASI, 2, 100_000],
    ]);
  });

  it("rentang: batas atas eksklusif; satu salesman sama dengan banyak", async () => {
    const satu = await lakuKonsiSatuSalesman(salesA, AWAL_BULAN, { sebelum: tgl(12), sekarang: SEKARANG });
    expect(satu.map((b) => [b.storeId, b.pcs])).toEqual([
      [toko.TRANSISI, 2],
      [toko.BUKU, 3],
      [toko.ROTASI, 1],
    ]);
    expect(await lakuKonsiSatuSalesman("", AWAL_BULAN)).toEqual([]);
  });

  it("penjualanSalesman: baris konsi = laku (bukan transfer 999.999)", async () => {
    const jual = await penjualanSalesman(salesA, AWAL_BULAN);
    const konsi = jual.filter((b) => b.jenis === "konsi");
    // BUKU 225.000 + 150.000 − 75.000, NOHARGA 80.000, TRANSISI 120.000, ROTASI sebelum pindah 50.000,
    // ROTASI_TEKS sebelum pindah 30.000.
    expect(konsi.reduce((n, b) => n + b.nilai, 0)).toBe(580_000);
    expect(JSON.stringify(jual)).not.toContain("999999");
  });
});
