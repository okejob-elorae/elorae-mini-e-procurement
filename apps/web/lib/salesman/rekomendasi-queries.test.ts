import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kueri rekomendasi terhadap basis data uji: bahan formulir (saran isi ulang
 * dari penyerapan, ukuran dari master + stok gudang), daftar dan rincian untuk
 * salesman pembuat dan SPG toko tujuan. Yang dipasak: TIDAK ADA harga di
 * payload mana pun (dicek pada JSON terserialisasi), dan rincian hanya untuk
 * pemiliknya.
 *
 * Semua baris milik fixture buatan tes pada tahun lampau yang acak; teardown
 * hanya lewat id yang diseed.
 */

vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { REKOMENDASI_MASUK: "REKOMENDASI_MASUK", REKOMENDASI_DIJAWAB: "REKOMENDASI_DIJAWAB" },
  kabariPengguna: vi.fn(async () => {}),
}));

const { buatRekomendasi, terimaRekomendasi } = await import("./rekomendasi");
const { bahanFormRekomendasi, daftarRekomendasiSaya, daftarRekomendasiSpg, rincianRekomendasiSaya, rincianRekomendasiSpg } = await import(
  "./rekomendasi-queries"
);

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const TAHUN = 2004 + Math.floor(Math.random() * 16);
const tgl = (bulan: number, hari: number) => new Date(`${TAHUN}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}T10:00:00+07:00`);
const HARI_INI = tgl(6, 15);
const HARGA = 98_765;
const KATA_HARGA = /"(price|harga|sellingPrice|unitPrice|lineTotal|total|nilai)"/i;

d("kueri rekomendasi (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let spg = "";
  let spgLain = "";
  let kaos = "";
  let tokoK = "";
  let tokoLain = "";
  let sku = "";
  let gerakIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    sales = "";
    salesLain = "";
    spg = "";
    spgLain = "";
    kaos = "";
    tokoK = "";
    tokoLain = "";
    gerakIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-RKQ-${token}`, nameId: "t", nameEn: "t" } })).id;
    sku = `TEST-RKQ-${token}`;
    kaos = (
      await prisma.item.create({
        data: {
          sku,
          nameId: "Kaos RKQ",
          nameEn: "Tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: HARGA,
          variants: [
            { sku: `${sku}-HTM-M`, size: "M", color: "Hitam" },
            { sku: `${sku}-HTM-L`, size: "L", color: "Hitam" },
          ],
        },
      })
    ).id;
    await prisma.inventoryValue.create({ data: { itemId: kaos, variantSku: `${sku}-HTM-M`, qtyOnHand: 50, reservedQty: 0, avgCost: 0, totalValue: 0 } });
    const orang = async (n: string, assignedStoreId?: string) =>
      (await prisma.user.create({ data: { email: `rkq-${n}-${token}@test.local`, name: `${n} ${token}`, assignedStoreId } })).id;
    sales = await orang("sales");
    salesLain = await orang("sales2");
    const toko = async (k: string, salesmanId: string) =>
      (
        await prisma.store.create({
          data: { code: `TEST-RKQ-${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType: "KONSI", salesmanId, phone: "0812-3456-7890" },
        })
      ).id;
    tokoK = await toko("K", sales);
    tokoLain = await toko("L", salesLain);
    spg = await orang("spg", tokoK);
    spgLain = await orang("spg2", tokoLain);

    // Buku toko: M cepat dan hampir habis, L normal.
    const gerak = async (variantSku: string, qty: number, kind: string, createdAt: Date) => {
      gerakIds.push((await prisma.storeStockMovement.create({ data: { storeId: tokoK, itemId: kaos, variantSku, qty, kind: kind as never, createdById: spg, createdAt } })).id);
    };
    await gerak(`${sku}-HTM-M`, 10, "TERIMA", tgl(4, 3));
    await gerak(`${sku}-HTM-L`, 10, "TERIMA", tgl(4, 3));
    await gerak(`${sku}-HTM-M`, -9, "JUAL", tgl(5, 1));
    await gerak(`${sku}-HTM-L`, -3, "JUAL", tgl(5, 1));
  });

  afterAll(async () => {
    const rek = await prisma.storeRecommendation.findMany({ where: { storeId: { in: seededIds([tokoK, tokoLain].filter(Boolean)) } }, select: { id: true } });
    const ids = rek.map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreRecommendation", entityId: { in: seededIds(ids) } } });
    await prisma.storeRecommendation.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoK, tokoLain].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain, spg, spgLain].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("bahan formulir: isi ulang dari penyerapan dengan jumlah saran per ukuran; tanpa harga apa pun", async () => {
    const b = (await bahanFormRekomendasi(tokoK, sales, 3, HARI_INI))!;
    expect(b).toMatchObject({ toko: { id: tokoK, jenis: "KONSI" }, boleh: true, sumber: "BUKU_TOKO" });
    const k = b.kandidat[0];
    expect(k).toMatchObject({ itemId: kaos, alasan: "LAKU_DI_SINI", info: { kode: "ISI_ULANG", laku: 12, sisa: 8 } });
    expect(k.baris.map((x) => x.variantSku)).toEqual([`${sku}-HTM-M`, `${sku}-HTM-L`]);
    expect(k.baris[0]).toMatchObject({ label: "Hitam · M", laku: 9, sisa: 1 });
    expect(k.baris[0].qtyAwal).toBeGreaterThan(0);
    expect(k.baris[1]).toMatchObject({ label: "Hitam · L", qtyAwal: 0, laku: 3, sisa: 7 });

    const json = JSON.stringify(b);
    expect(json).not.toContain(String(HARGA));
    expect(json).not.toMatch(KATA_HARGA);

    expect((await bahanFormRekomendasi(tokoK, salesLain, 3, HARI_INI))!.boleh).toBe(false);
  });

  it("daftar & rincian salesman: hanya miliknya, WhatsApp ke nomor toko tanpa harga; SPG: hanya tokonya", async () => {
    const r = await buatRekomendasi({
      salesmanId: sales,
      storeId: tokoK,
      baris: [{ itemId: kaos, variantSku: `${sku}-HTM-M`, qty: 8, alasan: "LAKU_DI_SINI" }],
      catatan: "Rak depan",
      idempotencyKey: `rkq-${token}-1`,
    });
    if (!r.ok) throw new Error(r.kode);

    const daftar = await daftarRekomendasiSaya(sales, "SEMUA");
    expect(daftar.baris.find((x) => x.id === r.id)).toMatchObject({ toko: `Toko K ${token}`, status: "TERKIRIM", baris: 1, pcs: 8 });
    expect(daftar.jumlah.TERKIRIM).toBeGreaterThanOrEqual(1);
    expect((await daftarRekomendasiSaya(sales, "SELESAI")).baris.find((x) => x.id === r.id)).toBeUndefined();

    const rinci = (await rincianRekomendasiSaya(r.id, sales))!;
    expect(rinci).toMatchObject({
      status: "TERKIRIM",
      catatan: "Rak depan",
      toko: { id: tokoK, jenis: "KONSI", adaSpg: true },
      totalPcs: 8,
      bolehBatal: true,
      bolehTandaiSetuju: false,
      bolehPesan: false,
    });
    expect(rinci.baris[0]).toMatchObject({ productName: "Kaos RKQ — Hitam · M", qty: 8, alasan: "LAKU_DI_SINI" });
    expect(rinci.wa?.adaNomor).toBe(true);
    expect(rinci.wa?.tautan.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const teks = decodeURIComponent(rinci.wa!.tautan.split("?text=")[1]);
    expect(teks).toContain("Kaos RKQ — Hitam · M × 8");
    expect(teks).not.toMatch(/rp/i);
    expect(await rincianRekomendasiSaya(r.id, salesLain)).toBeNull();

    const spgDaftar = await daftarRekomendasiSpg(tokoK);
    expect(spgDaftar.menunggu).toBe(1);
    expect(spgDaftar.baris[0]).toMatchObject({ id: r.id, orang: `sales ${token}` });
    const spgRinci = (await rincianRekomendasiSpg(r.id, tokoK))!;
    expect(spgRinci).toMatchObject({ bolehJawab: true, pembuat: `sales ${token}` });
    expect(await rincianRekomendasiSpg(r.id, tokoLain)).toBeNull();
    for (const payload of [daftar, rinci, spgDaftar, spgRinci]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(String(HARGA));
      expect(json).not.toMatch(KATA_HARGA);
    }

    await terimaRekomendasi({ recommendationId: r.id, userId: spg, storeIdTetap: tokoK, catatan: "Ok" });
    const sesudah = (await rincianRekomendasiSaya(r.id, sales))!;
    expect(sesudah).toMatchObject({ status: "DITERIMA", bolehPesan: true, jawaban: { oleh: `spg ${token}`, catatan: "Ok" } });
    expect((await rincianRekomendasiSpg(r.id, tokoK))!.bolehJawab).toBe(false);
  });
});
