import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { capaianRinciOrang, capaianRinciSpg, targetSaya } from "./target-rinci-queries";
import { rentangBulanWib, TANPA_KATEGORI } from "./target-rinci";

/*
 * Capaian target SPG terhadap basis data uji. Yang dipasak: capaian SPG SAMA
 * PERSIS dengan jumlah baris nota penjualannya sendiri pada bulan itu, BERSIH
 * dari retur pembeli (qty − returnedQty, senilai harga barisnya) — dihitung di
 * sini langsung dari baris notanya, bukan lewat fungsi yang diuji. Termasuk
 * nota di luar bulan, sesudah hari ini, dan milik SPG lain.
 *
 * Semua baris milik pengguna buatan tes pada bulan lampau yang acak; teardown
 * hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const TAHUN = acak(2003, 2019);
const BL = acak(2, 11);
const BULAN = `${TAHUN}-${String(BL).padStart(2, "0")}`;
const tgl = (hari: number, jam = "10:00", bulan = BULAN) => new Date(`${bulan}-${String(hari).padStart(2, "0")}T${jam}:00+07:00`);
const HARI_INI = tgl(20, "20:00");
const sen = (n: number) => Math.round(n * 100);

d("target rinci — capaian SPG dari nota penjualannya (test bed only)", () => {
  let uomId = "";
  let tokoId = "";
  let spgA = "";
  let spgB = "";
  let katA = "";
  let katB = "";
  let i1 = "";
  let i2 = "";
  let i3 = "";
  let notaIds: string[] = [];
  let targetIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    tokoId = "";
    spgA = "";
    spgB = "";
    katA = "";
    katB = "";
    i1 = "";
    i2 = "";
    i3 = "";
    notaIds = [];
    targetIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-TRS-${token}`, nameId: "t", nameEn: "t" } })).id;
    katA = (await prisma.itemCategory.create({ data: { code: `TRS-A-${token}`, name: `Kaos ${token}` } })).id;
    katB = (await prisma.itemCategory.create({ data: { code: `TRS-B-${token}`, name: `Kemeja ${token}` } })).id;
    const barang = async (k: string, categoryId: string | null) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-TRS-${k}-${token}`, nameId: `Barang ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId, categoryId },
        })
      ).id;
    i1 = await barang("1", katA);
    i2 = await barang("2", katB);
    i3 = await barang("3", null);
    tokoId = (
      await prisma.store.create({ data: { code: `TST-TRS-${token}`, name: "Toko TRS", address: "x", termsType: "KONSI" } })
    ).id;
    spgA = (await prisma.user.create({ data: { email: `trs-a-${token}@test.local`, name: `SPG A ${token}`, assignedStoreId: tokoId } })).id;
    spgB = (await prisma.user.create({ data: { email: `trs-b-${token}@test.local`, name: `SPG B ${token}`, assignedStoreId: tokoId } })).id;

    let n = 0;
    type Baris = { itemId: string; qty: number; unitPrice: number; returnedQty?: number };
    const nota = async (salesmanId: string, createdAt: Date, baris: Baris[]) => {
      n += 1;
      const total = baris.reduce((s, b) => s + b.qty * b.unitPrice, 0);
      const r = await prisma.spgSale.create({
        data: {
          docNo: `TEST-TRS-${token}-${n}`,
          salesmanId,
          storeId: tokoId,
          subtotal: total,
          total,
          cashReceived: total,
          changeGiven: 0,
          createdById: salesmanId,
          createdAt,
          lines: {
            create: baris.map((b) => ({
              itemId: b.itemId,
              productName: "x",
              qty: b.qty,
              unitPrice: b.unitPrice,
              lineTotal: b.qty * b.unitPrice,
              returnedQty: b.returnedQty ?? 0,
            })),
          },
        },
      });
      notaIds.push(r.id);
    };

    // SPG A, dalam bulan: dua nota, satu dengan retur pembeli sebagian.
    await nota(spgA, tgl(3), [
      { itemId: i1, qty: 3, unitPrice: 85_000, returnedQty: 1 },
      { itemId: i2, qty: 1, unitPrice: 149_999.99 },
    ]);
    await nota(spgA, tgl(12), [
      { itemId: i3, qty: 2, unitPrice: 33_333.33 },
      // Retur seluruhnya: tidak tersisa apa pun dari baris ini.
      { itemId: i2, qty: 1, unitPrice: 150_000, returnedQty: 1 },
    ]);
    // 00.30 WIB tanggal 1 (masih tanggal terakhir bulan lalu menurut UTC): termasuk.
    await nota(spgA, tgl(1, "00:30"), [{ itemId: i1, qty: 1, unitPrice: 90_000 }]);
    // Sesudah hari ini dan bulan lalu: tidak termasuk.
    await nota(spgA, tgl(25), [{ itemId: i1, qty: 5, unitPrice: 85_000 }]);
    await nota(spgA, new Date(new Date(`${BULAN}-01T00:00:00+07:00`).getTime() - 30 * 60_000), [
      { itemId: i1, qty: 4, unitPrice: 85_000 },
    ]);
    // SPG B di toko yang sama: terpisah.
    await nota(spgB, tgl(5), [{ itemId: i1, qty: 7, unitPrice: 85_000, returnedQty: 2 }]);

    targetIds = [
      (
        await prisma.salesTarget.create({
          data: { salesmanId: spgA, month: BULAN, scope: "KATEGORI", refId: katA, measure: "PCS", value: 10, createdById: spgA },
        })
      ).id,
      (
        await prisma.salesTarget.create({
          data: { salesmanId: spgA, month: BULAN, scope: "BARANG", refId: i2, measure: "NILAI", value: 300_000, createdById: spgA },
        })
      ).id,
    ];
  });

  afterAll(async () => {
    await prisma.salesTarget.deleteMany({ where: { id: { in: seededIds(targetIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2, i3].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([katA, katB].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  /** Jumlah bersih baris nota SPG pada rentang beranda, dihitung langsung dari baris notanya. */
  async function bersihDariBaris(spgId: string) {
    const r = rentangBulanWib(BULAN, HARI_INI)!;
    const baris = await prisma.spgSaleLine.findMany({
      where: { spgSale: { salesmanId: seededId(spgId), createdAt: { gte: r.awal, lt: r.akhir } } },
      select: { qty: true, unitPrice: true, returnedQty: true, item: { select: { categoryId: true } } },
    });
    let nilaiSen = 0;
    let pcs = 0;
    const perKategori = new Map<string, number>();
    for (const b of baris) {
      const bersih = b.qty - b.returnedQty;
      const v = sen(Number(b.unitPrice) * bersih);
      nilaiSen += v;
      pcs += bersih;
      const k = b.item.categoryId ?? TANPA_KATEGORI;
      perKategori.set(k, (perKategori.get(k) ?? 0) + bersih);
    }
    return { nilaiSen, pcs, perKategori };
  }

  it("capaian SPG = jumlah baris notanya sendiri pada bulan itu, bersih dari retur pembeli", async () => {
    const c = (await capaianRinciSpg([spgA], BULAN, HARI_INI)).get(spgA)!;
    const harap = await bersihDariBaris(spgA);

    // Dihitung tangan: (3−1)×85.000 + 149.999,99 + 2×33.333,33 + 0 + 90.000.
    expect(harap.nilaiSen).toBe(sen(170_000 + 149_999.99 + 66_666.66 + 90_000));
    expect(sen(c.total)).toBe(harap.nilaiSen);
    expect(sen(c.kanal.spg)).toBe(harap.nilaiSen);
    expect(c.kanal).toMatchObject({ putus: 0, konsi: 0, van: 0 });

    const perKategoriSen = Object.values(c.kategori).reduce((n, x) => n + sen(x.nilai), 0);
    expect(perKategoriSen).toBe(harap.nilaiSen);
    const pcs = Object.values(c.kategori).reduce((n, x) => n + x.pcs, 0);
    expect(pcs).toBe(harap.pcs);
    for (const [k, p] of harap.perKategori) expect(c.kategori[k]?.pcs ?? 0).toBe(p);

    expect(c.kategori[katA]).toEqual({ nilai: 260_000, pcs: 3 });
    expect(c.kategori[katB]).toEqual({ nilai: 149_999.99, pcs: 1 });
    expect(c.kategori[TANPA_KATEGORI]).toEqual({ nilai: 66_666.66, pcs: 2 });
    expect(c.barangKonsi).toEqual({});
  });

  it("SPG lain di toko yang sama terpisah; campuran sales+SPG memakai sumber masing-masing", async () => {
    const peta = await capaianRinciOrang({ salesmanIds: [], spgIds: [spgA, spgB] }, BULAN, HARI_INI);
    expect(peta.get(spgB)).toMatchObject({ total: 425_000, kategori: { [katA]: { nilai: 425_000, pcs: 5 } } });
    expect(sen(peta.get(spgA)!.total)).toBe((await bersihDariBaris(spgA)).nilaiSen);
    expect(sen(peta.get(spgB)!.total)).toBe((await bersihDariBaris(spgB)).nilaiSen);
  });

  it("dilihat sesudah bulannya lewat: nota tanggal 25 ikut", async () => {
    const nanti = tgl(15, "10:00", `${TAHUN}-${String(BL + 1).padStart(2, "0")}`);
    const c = (await capaianRinciSpg([spgA], BULAN, nanti)).get(spgA)!;
    expect(sen(c.total)).toBe((await bersihDariBaris(spgA)).nilaiSen + sen(5 * 85_000));
  });

  it("targetSaya untuk SPG: capaian dari notanya, target barang rupiah tidak ditandai 'tanpa konsinyasi'", async () => {
    const r = await targetSaya(spgA, BULAN, HARI_INI, { spg: true });
    const kat = r.baris.find((b) => b.scope === "KATEGORI")!;
    expect(kat.kemajuan).toMatchObject({ target: 10, capai: 3, kurang: 7 });
    const brg = r.baris.find((b) => b.scope === "BARANG")!;
    expect(brg.tanpaKonsi).toBe(false);
    expect(brg.kemajuan).toMatchObject({ target: 300_000, capai: 149_999.99 });
    // Tanpa tanda SPG, orang yang sama dibaca sebagai sales: tidak punya penjualan sales.
    expect((await targetSaya(spgA, BULAN, HARI_INI)).capaian.total).toBe(0);
  });
});
