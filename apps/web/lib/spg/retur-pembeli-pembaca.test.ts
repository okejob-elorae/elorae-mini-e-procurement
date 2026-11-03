import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { spgSaleMovements } from "@/lib/spg-commission/laporan-queries";
import { wibYearMonth } from "@/lib/spg-commission/month";
import { bahanLaporanSpg } from "@/lib/konsinyasi/laporan-spg";
import { promoEloraeSiklus } from "@/lib/konsinyasi/promo-elorae-queries";
import { hitungPromoElorae } from "@/lib/konsinyasi/promo-elorae";
import { hariIniWib } from "@/lib/tanggal-isian";
import { gerakLakuBersih, jumlahLakuBersihSejak, returRusakLaku } from "./laku-bersih";
import { bahanTutupHari } from "./tutup-hari-queries";
import { barisReturPembeliUntukRetur, rusakPembeliUntukSpg } from "./gudang-rusak-queries";
import { jumlahReturPembeliMenunggu } from "./retur-pembeli-queries";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/**
 * Setiap pembaca yang MENGHITUNG retur pembeli hanya menghitung yang DISETUJUI
 * (`returPembeliBerlaku`), terhadap basis data uji. Satu nota 6 potong di satu
 * toko konsinyasi, empat laporan di bulan yang sama:
 *
 * - R1 DISETUJUI (status dan `decidedAt` ditulis eksplisit, seperti persetujuan),
 *   uangnya dikembalikan hari ini: 1 LAYAK (dengan baris buku RETUR_PEMBELI
 *   seperti yang ditulis persetujuan) + 1 RUSAK. `returnedQty` nota = 2.
 * - R2 MENUNGGU, uangnya telanjur dikembalikan hari ini: 1 RUSAK + 1 LAYAK.
 * - R3 DITOLAK tanpa uang dikembalikan: 1 RUSAK.
 * - R4 DIBATALKAN (ditarik SPG): 1 LAYAK.
 * - R5 ditulis TANPA status: isian bawaan kolomnya MENUNGGU (gagal-aman).
 *
 * Kalau satu pembaca ikut menghitung R2–R4, angkanya berubah: setiap angka di
 * bawah adalah angka "hanya R1". Pembaca dipanggil dengan cakupan toko uji
 * saja (tidak ada sapuan seluruh basis data). Penghapusan lewat `seededId()`.
 */
d("pembaca retur pembeli hanya menghitung yang disetujui (test bed only)", () => {
  const tag = `RPP-${Math.random().toString(36).slice(2, 8)}`;
  const varian = `${tag}-M`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let spgId = "";
  let saleId = "";
  let lineId = "";
  let cycleId = "";
  const rusak: Record<"R1" | "R2" | "R3", string> = { R1: "", R2: "", R3: "" };
  const bulan = wibYearMonth(new Date());
  const [tahun, nomorBulan] = bulan.split("-").map(Number);

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50_000, variants: [{ sku: varian, size: "M" }] },
      })
    ).id;
    storeId = (
      await prisma.store.create({ data: { code: `${tag}-A`, name: `${tag} A`, address: "uji", termsType: "KONSI", markupPercent: 20, isActive: true } })
    ).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: storeId } })).id;

    const sale = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/SPG/1`,
        salesmanId: spgId,
        storeId,
        subtotal: 300_000,
        total: 270_000,
        cashReceived: 270_000,
        changeGiven: 0,
        createdById: spgId,
        lines: {
          create: [
            { itemId, variantSku: varian, productName: `Kaos ${tag} — M`, qty: 6, unitPrice: 50_000, lineTotal: 270_000, discount: 30_000, storeDiscount: 0, returnedQty: 2 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    saleId = sale.id;
    lineId = sale.lines[0].id;
    await prisma.storeStockMovement.create({
      data: { storeId, itemId, variantSku: varian, qty: -6, kind: "JUAL", refType: "SpgSale", refId: saleId, createdById: spgId },
    });

    const sekarang = new Date();
    const retur = async (
      kunci: string,
      status: "DISETUJUI" | "MENUNGGU" | "DITOLAK" | "DIBATALKAN" | null,
      baris: ("LAYAK" | "RUSAK")[],
      tambahan: { refundedAt?: Date; decidedAt?: Date } = {},
    ) =>
      prisma.spgSaleReturn.create({
        data: {
          spgSaleId: saleId,
          storeId,
          createdById: spgId,
          reason: `uji ${kunci}`,
          idempotencyKey: `${tag}-${kunci}`,
          ...(status ? { status } : {}),
          ...tambahan,
          lines: { create: baris.map((condition) => ({ spgSaleLineId: lineId, itemId, variantSku: varian, qty: 1, condition })) },
        },
        select: { id: true, lines: { select: { id: true, condition: true } } },
      });
    const r1 = await retur("r1", "DISETUJUI", ["LAYAK", "RUSAK"], { decidedAt: sekarang, refundedAt: sekarang });
    // Yang ditulis persetujuan untuk barang LAYAK: kembali ke rak.
    await prisma.storeStockMovement.create({
      data: { storeId, itemId, variantSku: varian, qty: 1, kind: "RETUR_PEMBELI", refType: "SpgSaleReturn", refId: r1.id, createdById: spgId },
    });
    const r2 = await retur("r2", "MENUNGGU", ["RUSAK", "LAYAK"], { refundedAt: sekarang });
    const r3 = await retur("r3", "DITOLAK", ["RUSAK"], { decidedAt: sekarang });
    await retur("r4", "DIBATALKAN", ["LAYAK"], { decidedAt: sekarang });
    await retur("r5", null, ["LAYAK"]);
    rusak.R1 = r1.lines.find((l) => l.condition === "RUSAK")!.id;
    rusak.R2 = r2.lines.find((l) => l.condition === "RUSAK")!.id;
    rusak.R3 = r3.lines.find((l) => l.condition === "RUSAK")!.id;

    cycleId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}-K`, storeId, periodYear: tahun, periodMonth: nomorBulan } })).id;
  });

  afterAll(async () => {
    if (cycleId) await prisma.consignmentCycle.delete({ where: { id: seededId(cycleId) } });
    if (storeId) await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(storeId) } });
    if (saleId) {
      await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: seededId(saleId) } });
      await prisma.spgSale.delete({ where: { id: seededId(saleId) } });
    }
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId].filter(Boolean)) } } });
    if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
  });

  it("a row written without a status is a pending report, never an approved one without effects", async () => {
    const r5 = await prisma.spgSaleReturn.findUniqueOrThrow({ where: { idempotencyKey: `${tag}-r5` } });
    expect([r5.status, r5.decidedAt, r5.decidedById]).toEqual(["MENUNGGU", null, null]);
  });

  it("SPG commission movements: 6 sold, only the approved 2 returned", async () => {
    const m = (await spgSaleMovements(prisma, [storeId], bulan)).get(storeId) ?? [];
    expect(m.filter((x) => x.qty > 0).reduce((s, x) => s + x.qty, 0)).toBe(6);
    expect(m.filter((x) => x.qty < 0).reduce((s, x) => s + x.qty, 0)).toBe(-2);
  });

  it("konsi SPG report bahan: net 4 of the item", async () => {
    expect(await bahanLaporanSpg(cycleId)).toEqual([{ itemId, itemName: `Kaos ${tag}`, qty: 4 }]);
  });

  it("promo Elorae: only the approved pieces give back their share, in the window and in the cumulative 'returned before'", async () => {
    const jual = { qty: 6, discount: 30_000, storeDiscount: 0 };
    const harap = hitungPromoElorae({
      jual: [jual],
      kembali: [
        { ...jual, qtySebelum: 0, qtyKembali: 1 },
        { ...jual, qtySebelum: 1, qtyKembali: 1 },
      ],
    });
    expect(await promoEloraeSiklus(prisma, { storeId, periodYear: tahun, periodMonth: nomorBulan })).toEqual(harap);
  });

  it("laku bersih: the approved damaged piece only; a pending, rejected or withdrawn return still reads as sold", async () => {
    const r = await returRusakLaku([{ storeId }]);
    expect(r.map((x) => [x.lineId, x.qty])).toEqual([[rusak.R1, 1]]);
    const gerak = await gerakLakuBersih([{ storeId }]);
    // JUAL −6, RETUR_PEMBELI +1, rusak R1 +1 → laku 4.
    expect(-gerak.reduce((s, g) => s + g.qty, 0)).toBe(4);
    const sejak = new Date(Date.now() - 24 * 3_600_000);
    const jumlah = await jumlahLakuBersihSejak([storeId], sejak);
    expect(jumlah.get(storeId)?.get(`${itemId}::${varian}`)).toBe(-4);
  });

  it("day close: approved returns refunded today reduce net sales; money refunded before approval is carried separately", async () => {
    const bahan = await bahanTutupHari(storeId, hariIniWib());
    expect(bahan?.retur.reduce((s, r) => s + r.qty, 0)).toBe(2);
    // R2 (menunggu, uang telanjur kembali hari ini) — R3 ditolak tanpa uang tidak ikut, R5 belum dikembalikan.
    expect(bahan?.potongUangKembaliBelumBerlaku).toBe(2);
  });

  it("damaged goods from shoppers: only the approved return can be sent back to the warehouse", async () => {
    expect((await rusakPembeliUntukSpg(storeId)).map((r) => r.id)).toEqual([rusak.R1]);
    expect((await barisReturPembeliUntukRetur(storeId, [rusak.R1, rusak.R2, rusak.R3])).map((r) => r.id)).toEqual([rusak.R1]);
  });

  it("the Beranda count includes the MENUNGGU reports", async () => {
    expect(await jumlahReturPembeliMenunggu()).toBeGreaterThanOrEqual(2);
  });
});
