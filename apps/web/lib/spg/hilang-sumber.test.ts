import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KATEGORI_NOTIF_HILANG } from "./hilang";
import { bukaHilangDariMutasi, bukaHilangDariOpname, bukaHilangDariPenerimaan, catatHilangDariOpname } from "./hilang-sumber";
import { KUNCI_BARANG_HILANG } from "./pengaturan";

/*
 * Pembuka catatan barang hilang dari dokumen sumber, terhadap basis data uji:
 * opname toko konsinyasi (hanya baris kurang, toko putus dilewati, saklar
 * `dariOpname`), mutasi yang diputuskan HILANG (dipasang pada toko asal),
 * kiriman yang diterima kurang (baris ketik bernilai nol, tanda terima mutasi
 * diabaikan), dasar nilai HPP (toleran null/"") dan ECERAN, serta idempotensi.
 *
 * Dokumen sumber ditulis langsung (bukan lewat penulisnya) supaya yang diuji
 * hanya pembukanya. Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `HLS-${Math.random().toString(36).slice(2, 9)}`;

d("barang hilang — dari dokumen sumber (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let tokoKonsi = "";
  let tokoPutus = "";
  let spg = "";
  let aturanAwal: string | null = null;
  let adaAturanAwal = false;
  const opname: string[] = [];
  const terima: string[] = [];
  const mutasi: string[] = [];

  const M = () => `${tag}-KAOS-M`;
  const L = () => `${tag}-KAOS-L`;
  const tokoIds = () => seededIds([tokoKonsi, tokoPutus].filter(Boolean));
  const itemIds = () => seededIds([kaos, kemeja].filter(Boolean));

  const setel = (dasarNilai: string, dariOpname = true) =>
    prisma.systemSetting.upsert({
      where: { key: KUNCI_BARANG_HILANG },
      create: { key: KUNCI_BARANG_HILANG, value: JSON.stringify({ dasarNilai, maksPotongPersen: 50, dariOpname }) },
      update: { value: JSON.stringify({ dasarNilai, maksPotongPersen: 50, dariOpname }) },
    });

  async function buatOpname(storeId: string, baris: { itemId: string; variantSku: string; productName: string; qtySystem: number; qtyCounted: number }[]) {
    const o = await prisma.storeOpname.create({ data: { storeId, countedById: spg, lines: { create: baris } }, select: { id: true } });
    opname.push(o.id);
    return o.id;
  }

  async function buatTerima(
    storeId: string,
    sourceType: string,
    sourceId: string,
    baris: { itemId: string | null; variantSku: string; productName: string; qtySent: number; qtyReceived: number }[],
  ) {
    const r = await prisma.storeReceipt.create({
      data: { storeId, sourceType, sourceId, sourceDocNo: `DOK-${sourceId.slice(-6)}`, receivedById: spg, lines: { create: baris } },
      select: { id: true },
    });
    terima.push(r.id);
    return r.id;
  }

  const muatLoss = (id: string) => prisma.stockLoss.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { productName: "asc" } } } });

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
    adaAturanAwal = ada !== null;
    aturanAwal = ada?.value ?? null;
    await setel("HARGA_ELORAE");

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 100_000,
          variants: [
            { sku: M(), size: "M" },
            { sku: L(), size: "L" },
          ],
        },
      })
    ).id;
    kemeja = (
      await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 80_000 } })
    ).id;
    tokoKonsi = (
      await prisma.store.create({ data: { code: `${tag}-K`, name: `Toko Konsi ${tag}`, address: "uji", termsType: "KONSI", marginPercent: 20 } })
    ).id;
    tokoPutus = (await prisma.store.create({ data: { code: `${tag}-P`, name: `Toko Putus ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoKonsi } })).id;
    // HPP: per varian untuk M, baris gabungan (null) untuk barang kaos, "" untuk kemeja.
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaos, variantSku: M(), avgCost: 40_000 },
        { itemId: kaos, variantSku: null, avgCost: 35_000 },
        { itemId: kemeja, variantSku: "", avgCost: 30_000 },
      ],
    });
  });

  afterEach(async () => {
    await setel("HARGA_ELORAE");
    const losses = await prisma.stockLoss.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const lossIds = losses.map((l) => l.id);
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.lossId === "string" && lossIds.includes(m.lossId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(lossIds) } } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
    await prisma.storeReceiptLine.deleteMany({ where: { receiptId: { in: seededIds([...terima]) } } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds([...terima]) } } });
    await prisma.storeTransferLine.deleteMany({ where: { transferId: { in: seededIds([...mutasi]) } } });
    await prisma.storeTransfer.deleteMany({ where: { id: { in: seededIds([...mutasi]) } } });
    await prisma.storeOpnameLine.deleteMany({ where: { opnameId: { in: seededIds([...opname]) } } });
    await prisma.storeOpname.deleteMany({ where: { id: { in: seededIds([...opname]) } } });
    terima.length = 0;
    mutasi.length = 0;
    opname.length = 0;
  });

  afterAll(async () => {
    if (adaAturanAwal && aturanAwal !== null) {
      await prisma.systemSetting.update({ where: { key: KUNCI_BARANG_HILANG }, data: { value: aturanAwal } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_BARANG_HILANG) } });
    }
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("opname toko konsinyasi: hanya baris yang kurang, dinilai harga jual Elorae, idempoten per opname", async () => {
    const id = await buatOpname(tokoKonsi, [
      { itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qtySystem: 5, qtyCounted: 3 },
      { itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 2, qtyCounted: 4 },
      { itemId: kaos, variantSku: L(), productName: "Kaos Uji — L", qtySystem: 1, qtyCounted: 1 },
    ]);
    const r = await bukaHilangDariOpname(id, spg);
    expect(r).toMatchObject({ ok: true, ulang: false });
    if (!r.ok) return;
    const loss = await muatLoss(r.id);
    expect(loss).toMatchObject({ source: "OPNAME", sourceId: id, storeId: tokoKonsi, totalQty: 2, status: "TERBUKA", createdById: spg, idempotencyKey: `opname:${id}` });
    expect(Number(loss.totalAmount)).toBe(200_000);
    expect(loss.lines.map((l) => [l.variantSku, l.qty, Number(l.unitValue)])).toEqual([[M(), 2, 100_000]]);
    expect(await bukaHilangDariOpname(id, spg)).toEqual({ ok: true, id: r.id, ulang: true });

    const lengkap = await buatOpname(tokoKonsi, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 2, qtyCounted: 2 }]);
    expect(await bukaHilangDariOpname(lengkap, spg)).toEqual({ ok: false, kode: "TANPA_BARIS" });
  });

  it("opname toko putus dilewati; saklar dariOpname mati mematikan semuanya", async () => {
    const putus = await buatOpname(tokoPutus, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 5, qtyCounted: 1 }]);
    expect(await bukaHilangDariOpname(putus, spg)).toEqual({ ok: false, kode: "BUKAN_KONSINYASI" });
    await setel("HARGA_ELORAE", false);
    const konsi = await buatOpname(tokoKonsi, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 5, qtyCounted: 1 }]);
    expect(await bukaHilangDariOpname(konsi, spg)).toEqual({ ok: false, kode: "DIMATIKAN" });
    expect(await bukaHilangDariOpname("tidak-ada", spg)).toEqual({ ok: false, kode: "DIMATIKAN" });
    await setel("HARGA_ELORAE", true);
    expect(await bukaHilangDariOpname("tidak-ada", spg)).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });

  it("dasar HPP toleran baris persediaan per varian / null / kosong; dasar ECERAN menaikkan margin konsinyasi", async () => {
    await setel("HPP");
    const o1 = await buatOpname(tokoKonsi, [
      { itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qtySystem: 1, qtyCounted: 0 },
      { itemId: kaos, variantSku: L(), productName: "Kaos Uji — L", qtySystem: 1, qtyCounted: 0 },
      { itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 1, qtyCounted: 0 },
    ]);
    const r1 = await bukaHilangDariOpname(o1, spg);
    if (!r1.ok) throw new Error("gagal");
    const l1 = await muatLoss(r1.id);
    expect(l1.valueBasis).toBe("HPP");
    expect(Object.fromEntries(l1.lines.map((l) => [l.productName, Number(l.unitValue)]))).toEqual({
      "Kaos Uji — M": 40_000,
      // L tidak punya baris sendiri → baris gabungan barang itu.
      "Kaos Uji — L": 35_000,
      "Kemeja Uji": 30_000,
    });

    await setel("ECERAN");
    const o2 = await buatOpname(tokoKonsi, [{ itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qtySystem: 1, qtyCounted: 0 }]);
    const r2 = await bukaHilangDariOpname(o2, spg);
    if (!r2.ok) throw new Error("gagal");
    expect(Number((await muatLoss(r2.id)).totalAmount)).toBe(125_000);
  });

  it("mutasi diputuskan HILANG: baris yang tiba kurang, dipasang pada toko asal; selain HILANG ditolak", async () => {
    const t = await prisma.storeTransfer.create({
      data: {
        docNo: `MTS-${tag}`,
        fromStoreId: tokoKonsi,
        toStoreId: tokoPutus,
        status: "DITERIMA",
        reason: "uji",
        createdById: spg,
        selisihStatus: "TERBUKA",
        idempotencyKey: `${tag}-mutasi`,
        lines: { create: [{ itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qty: 5 }] },
      },
      select: { id: true },
    });
    mutasi.push(t.id);
    await buatTerima(tokoPutus, "MUTASI", t.id, [{ itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qtySent: 5, qtyReceived: 3 }]);

    expect(await bukaHilangDariMutasi(t.id, spg)).toEqual({ ok: false, kode: "BUKAN_HILANG" });
    await prisma.storeTransfer.update({ where: { id: t.id }, data: { selisihStatus: "HILANG" } });
    const r = await bukaHilangDariMutasi(t.id, spg);
    if (!r.ok) throw new Error("gagal");
    const loss = await muatLoss(r.id);
    expect(loss).toMatchObject({ source: "MUTASI", sourceId: t.id, sourceDocNo: `MTS-${tag}`, storeId: tokoKonsi, totalQty: 2, idempotencyKey: `mutasi:${t.id}` });
    expect(Number(loss.totalAmount)).toBe(200_000);
    expect(await bukaHilangDariMutasi(t.id, spg)).toEqual({ ok: true, id: r.id, ulang: true });
  });

  it("kiriman diterima kurang: baris ketik bernilai nol; tanda terima mutasi dan kiriman lengkap dilewati", async () => {
    const r1 = await buatTerima(tokoKonsi, "KONSI_SHIPMENT", `${tag}-kirim-1`, [
      { itemId: null, variantSku: "", productName: "Kaos ketik tangan", qtySent: 4, qtyReceived: 1 },
      { itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySent: 2, qtyReceived: 1 },
      { itemId: kaos, variantSku: M(), productName: "Kaos Uji — M", qtySent: 2, qtyReceived: 2 },
    ]);
    const h = await bukaHilangDariPenerimaan(r1, spg);
    if (!h.ok) throw new Error("gagal");
    const loss = await muatLoss(h.id);
    expect(loss).toMatchObject({ source: "PENERIMAAN", sourceId: r1, storeId: tokoKonsi, totalQty: 4, idempotencyKey: `penerimaan:${r1}` });
    expect(loss.lines.map((l) => [l.itemId, l.qty, Number(l.amount)])).toEqual([
      [null, 3, 0],
      [kemeja, 1, 80_000],
    ]);
    expect(Number(loss.totalAmount)).toBe(80_000);
    const notif = (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { message: true, metadata: true } })).find(
      (n) => (n.metadata as Record<string, unknown> | null)?.lossId === h.id,
    );
    expect(notif?.message).toContain("1 baris belum bernilai");

    const dariMutasi = await buatTerima(tokoKonsi, "MUTASI", `${tag}-mts-x`, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySent: 3, qtyReceived: 1 }]);
    expect(await bukaHilangDariPenerimaan(dariMutasi, spg)).toEqual({ ok: false, kode: "SUMBER_MUTASI" });
    const lengkap = await buatTerima(tokoKonsi, "KONSI_ORDER", `${tag}-order-1`, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySent: 3, qtyReceived: 3 }]);
    expect(await bukaHilangDariPenerimaan(lengkap, spg)).toEqual({ ok: false, kode: "TANPA_BARIS" });
  });

  it("kait publik tidak melakukan apa pun di bawah VITEST (pemanggilnya tidak menunggu)", async () => {
    const id = await buatOpname(tokoKonsi, [{ itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qtySystem: 3, qtyCounted: 0 }]);
    await expect(catatHilangDariOpname(id, spg)).resolves.toBeUndefined();
    expect(await prisma.stockLoss.count({ where: { idempotencyKey: `opname:${id}` } })).toBe(0);
  });
});
