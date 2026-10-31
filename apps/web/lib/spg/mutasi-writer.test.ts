import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kirimanMenunggu } from "./kiriman";
import { KUNCI_ATURAN_MUTASI, bulanWib } from "./mutasi-aturan";
import {
  ajukanMutasi,
  alihkanTujuanMutasi,
  batalkanMutasi,
  kirimMutasi,
  putuskanSelisihMutasi,
  setujuiMutasi,
  terimaMutasiKantor,
  tolakMutasi,
} from "./mutasi-writer";
import { terimaKiriman } from "./stok-writer";
import { stokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import { rincianSiklus } from "@/lib/konsinyasi/queries";

/*
 * Mutasi antar toko terhadap basis data uji. Semua baris milik fixture buatan
 * tes (toko, barang, pengguna berkode acak); teardown hanya lewat id yang
 * diseed (`seededId`/`seededIds`), tidak pernah lewat awalan atau rentang tanggal.
 *
 * Pengaturan `spg.mutasi` dipotret di awal dan dikembalikan persis di akhir —
 * basis datanya dipakai bersama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `MTS-${Math.random().toString(36).slice(2, 9)}`;
const HARI_MS = 86_400_000;

d("mutasi antar toko — penulis (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let asal = "";
  let tujuan = "";
  let tujuanSepi = "";
  let tokoPutus = "";
  let tokoKosong = "";
  let spgAsal = "";
  let spgAsal2 = "";
  let spgTujuan = "";
  let spgTujuan2 = "";
  let spgKosong = "";
  let spgDiam = "";
  let kantor = "";
  const kunjungan: string[] = [];
  const siklus: string[] = [];
  let setelanAwal: string | null = null;
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  const tokoIds = () => seededIds([asal, tujuan, tujuanSepi, tokoPutus, tokoKosong].filter(Boolean));
  const userIds = () => seededIds([spgAsal, spgAsal2, spgTujuan, spgTujuan2, spgKosong, spgDiam, kantor].filter(Boolean));
  const itemIds = () => seededIds([kaos, kemeja].filter(Boolean));

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_MUTASI }, select: { value: true } });
    setelanAwal = ada?.value ?? null;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          variants: [
            { sku: `${tag}-KAOS-M`, size: "M" },
            { sku: `${tag}-KAOS-L`, size: "L" },
          ],
        },
      })
    ).id;
    kemeja = (await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId } })).id;

    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    asal = await toko("ASAL", "KONSI");
    tujuan = await toko("TUJUAN", "KONSI");
    tujuanSepi = await toko("SEPI", "KONSI");
    tokoPutus = await toko("PUTUS", "PUTUS");
    tokoKosong = await toko("KOSONG", "KONSI");

    const pengguna = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    spgAsal = await pengguna("spg-asal", asal);
    spgAsal2 = await pengguna("spg-asal2", asal);
    spgTujuan = await pengguna("spg-tujuan", tujuan);
    spgTujuan2 = await pengguna("spg-tujuan2", tujuan);
    spgKosong = await pengguna("spg-kosong", tokoKosong);
    spgDiam = await pengguna("spg-diam", asal);
    kantor = await pengguna("kantor", null);

    const masuk = async (storeId: string, userId: string) =>
      kunjungan.push((await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: -6.2, checkinLng: 106.8 } })).id);
    await masuk(asal, spgAsal);
    await masuk(asal, spgAsal2);
    await masuk(tujuan, spgTujuan);
    await masuk(tujuan, spgTujuan2);
    await masuk(tokoKosong, spgKosong);
  });

  beforeEach(async () => {
    // Aturan bawaan secara terang — tes yang butuh lain menimpanya sendiri.
    await aturan({});
    // Buku toko asal dimulai dengan opname: kaos M 10, kemeja 5. Toko tujuan
    // juga sudah berbuku; toko sepi dan toko kosong belum.
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: asal, itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 10, kind: "OPNAME", createdById: spgAsal },
        { storeId: asal, itemId: kemeja, variantSku: "", qty: 5, kind: "OPNAME", createdById: spgAsal },
        { storeId: tujuan, itemId: kemeja, variantSku: "", qty: 1, kind: "OPNAME", createdById: spgTujuan },
      ],
    });
  });

  afterEach(async () => {
    const dok = await prisma.storeTransfer.findMany({
      where: { OR: [{ fromStoreId: { in: tokoIds() } }, { toStoreId: { in: tokoIds() } }] },
      select: { id: true },
    });
    const ids = dok.map((x) => x.id);
    // Catatan kantor dicocokkan di JS lewat `metadata.transferId` — penyaringan
    // jalur JSON tidak andal di semua adaptor — lalu dihapus per id.
    const catatan = await prisma.adminNotification.findMany({
      where: { category: { startsWith: "STORE_TRANSFER_" } },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.transferId === "string" && ids.includes(m.transferId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreTransfer", entityId: { in: seededIds(ids) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeReceipt.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeTransfer.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklus) } } });
    siklus.length = 0;
  });

  afterAll(async () => {
    if (setelanAwal === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_ATURAN_MUTASI) } });
    else await prisma.systemSetting.update({ where: { key: KUNCI_ATURAN_MUTASI }, data: { value: setelanAwal } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(kunjungan) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function aturan(ubah: Record<string, unknown>) {
    const nilai = JSON.stringify({
      aktif: true,
      aturan: { KONSI_KONSI: "SETUJU", KONSI_PUTUS: "TOLAK", PUTUS_KONSI: "TOLAK", PUTUS_PUTUS: "TOLAK" },
      saldo: "PERINGATAN",
      tujuanTanpaSpg: true,
      hariPengingat: 3,
      ...ubah,
    });
    await prisma.systemSetting.upsert({ where: { key: KUNCI_ATURAN_MUTASI }, create: { key: KUNCI_ATURAN_MUTASI, value: nilai }, update: { value: nilai } });
  }

  const saldo = async (storeId: string, itemId: string, variantSku: string) =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId, itemId, variantSku }, _sum: { qty: true } }))._sum.qty ?? 0;

  const ajukan = (ubah: Partial<Parameters<typeof ajukanMutasi>[0]> = {}) =>
    ajukanMutasi({
      userId: spgAsal,
      fromStoreId: asal,
      toStoreId: tujuan,
      alasan: "Stok di sana habis",
      baris: [
        { itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 3 },
        { itemId: kemeja, variantSku: "", qty: 2 },
      ],
      idempotencyKey: kunci(),
      ...ubah,
    });

  /** Mutasi yang sudah disetujui dan dikirim. */
  async function dikirim(ubah: Partial<Parameters<typeof ajukanMutasi>[0]> = {}) {
    const a = await ajukan(ubah);
    if (!a.ok) throw new Error(`ajukan gagal: ${a.kode}`);
    expect((await setujuiMutasi({ transferId: a.id, olehUserId: kantor })).ok).toBe(true);
    const k = await kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal });
    if (!k.ok) throw new Error(`kirim gagal: ${k.kode}`);
    return a;
  }

  const barisTransfer = (id: string) =>
    prisma.storeTransferLine.findMany({ where: { transferId: id }, orderBy: { productName: "asc" }, select: { id: true, itemId: true, qty: true } });

  // ─── Mengajukan ────────────────────────────────────────────────────────────

  it("records a proposal with server-built names and a MTS/<year>/NNNNN number, and tells the approvers", async () => {
    const a = await ajukan();
    expect(a).toMatchObject({ ok: true, status: "DIAJUKAN", ulang: false, kurangSaldo: [] });
    if (!a.ok) return;
    expect(a.docNo).toMatch(/^MTS\/\d{4}\/\d{5}$/);
    const baris = await prisma.storeTransferLine.findMany({ where: { transferId: a.id }, orderBy: { productName: "asc" } });
    expect(baris.map((b) => b.productName)).toEqual(["Kaos Uji — size: M", "Kemeja Uji"]);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "StoreTransfer", entityId: a.id } });
    expect(jejak.map((j) => j.action)).toEqual(["STORE_TRANSFER_PROPOSED"]);
    const catatan = await prisma.adminNotification.findMany({ where: { category: "STORE_TRANSFER_PROPOSED" }, select: { metadata: true } });
    expect(catatan.some((c) => (c.metadata as { transferId?: string } | null)?.transferId === a.id)).toBe(true);
    // Mengajukan tidak menggerakkan stok.
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(10);
  });

  it("returns the existing document for a replayed key, and refuses the key for anyone else", async () => {
    const k = kunci();
    const a = await ajukan({ idempotencyKey: k });
    const b = await ajukan({ idempotencyKey: k, baris: [{ itemId: kemeja, variantSku: "", qty: 1 }] });
    expect(b).toMatchObject({ ok: true, ulang: true });
    if (a.ok && b.ok) expect(b.id).toBe(a.id);
    expect(await ajukan({ idempotencyKey: k, userId: spgAsal2 })).toEqual({ ok: false, kode: "KUNCI_DIPAKAI" });
  });

  it("refuses without a check-in, without a stock book, to the same store, and in a refused direction", async () => {
    expect(await ajukan({ userId: spgDiam })).toEqual({ ok: false, kode: "TANPA_KUNJUNGAN" });
    expect(await ajukan({ userId: spgKosong, fromStoreId: tokoKosong })).toEqual({ ok: false, kode: "BUKU_BELUM_DIMULAI" });
    expect(await ajukan({ toStoreId: asal })).toEqual({ ok: false, kode: "TUJUAN_SAMA" });
    expect(await ajukan({ toStoreId: tokoPutus })).toEqual({ ok: false, kode: "ARAH_DITOLAK" });
    expect(await ajukan({ alasan: "  " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await ajukan({ baris: [{ itemId: kaos, variantSku: "BUKAN-VARIAN", qty: 1 }] })).toEqual({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
  });

  it("warns (default) or refuses (TOLAK) a quantity above the book balance, counting other unsent transfers", async () => {
    const pertama = await ajukan({ baris: [{ itemId: kemeja, variantSku: "", qty: 4 }] });
    expect(pertama).toMatchObject({ ok: true, kurangSaldo: [] });
    // 5 di buku, 4 sudah dijanjikan ke mutasi pertama → tersedia 1.
    const kedua = await ajukan({ baris: [{ itemId: kemeja, variantSku: "", qty: 2 }] });
    expect(kedua).toMatchObject({ ok: true, kurangSaldo: [{ itemId: kemeja, qty: 2, tersedia: 1, productName: "Kemeja Uji" }] });

    await aturan({ saldo: "TOLAK" });
    expect(await ajukan({ baris: [{ itemId: kemeja, variantSku: "", qty: 2 }] })).toMatchObject({ ok: false, kode: "SALDO_KURANG" });
  });

  it("skips the approval step for a LANGSUNG direction, and refuses everything when switched off", async () => {
    await aturan({ aturan: { KONSI_KONSI: "LANGSUNG", KONSI_PUTUS: "TOLAK", PUTUS_KONSI: "TOLAK", PUTUS_PUTUS: "TOLAK" } });
    expect(await ajukan()).toMatchObject({ ok: true, status: "DISETUJUI" });
    await aturan({ aktif: false });
    expect(await ajukan()).toEqual({ ok: false, kode: "MUTASI_NONAKTIF" });
  });

  // ─── Keputusan & pengiriman ────────────────────────────────────────────────

  it("requires a reason to reject, and nobody ships before approval", async () => {
    const a = await ajukan();
    if (!a.ok) throw new Error("ajukan");
    expect(await kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal })).toEqual({ ok: false, kode: "BELUM_DISETUJUI" });
    expect(await tolakMutasi({ transferId: a.id, olehUserId: kantor, alasan: "" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await setujuiMutasi({ transferId: a.id, olehUserId: spgAsal })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    expect(await tolakMutasi({ transferId: a.id, olehUserId: kantor, alasan: "Toko tujuan tutup" })).toMatchObject({ ok: true, status: "DITOLAK" });
    expect(await setujuiMutasi({ transferId: a.id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("ships out of the source book as MUTASI_KELUAR, once, and a replay by the same SPG writes nothing", async () => {
    const a = await dikirim();
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(7);
    expect(await saldo(asal, kemeja, "")).toBe(3);
    const ulang = await kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal });
    expect(ulang).toMatchObject({ ok: true, ulang: true });
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(7);
    const keluar = await prisma.storeStockMovement.findMany({ where: { refType: "StoreTransfer", refId: a.id } });
    expect(keluar.every((g) => g.kind === "MUTASI_KELUAR" && g.qty < 0)).toBe(true);
    // Stok gudang utama tidak tersentuh.
    expect(await prisma.inventoryValue.count({ where: { itemId: { in: itemIds() } } })).toBe(0);
  });

  it("refuses an SPG shipment while the source store's consignment cycle for this month is locked", async () => {
    const a = await ajukan();
    if (!a.ok) throw new Error("ajukan");
    await setujuiMutasi({ transferId: a.id, olehUserId: kantor });
    const { tahun, bulan } = bulanWib(new Date());
    siklus.push(
      (
        await prisma.consignmentCycle.create({
          data: { noKonsi: `${tag}-K1`, storeId: asal, periodYear: tahun, periodMonth: bulan, lockedAt: new Date(), lockedById: kantor },
        })
      ).id,
    );
    expect(await kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal })).toEqual({
      ok: false,
      kode: "SIKLUS_TERKUNCI",
      noKonsi: [`${tag}-K1`],
    });
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(10);
  });

  // ─── Menerima ──────────────────────────────────────────────────────────────

  it("shows the transfer as waiting at the destination and receives it as MUTASI_MASUK; a shortfall opens a discrepancy", async () => {
    const a = await dikirim();
    const menunggu = await kirimanMenunggu(tujuan);
    const k = menunggu.find((x) => x.sourceType === "MUTASI" && x.sourceId === a.id);
    expect(k?.lines.map((l) => l.qty).sort()).toEqual([2, 3]);

    const baris = await barisTransfer(a.id);
    const r = await terimaKiriman({
      storeId: tujuan,
      userId: spgTujuan,
      sourceType: "MUTASI",
      sourceId: a.id,
      // kaos 3 dikirim, 2 diterima; kemeja 2 dikirim, 2 diterima.
      diterima: baris.map((b) => ({ lineId: b.id, qtyReceived: b.itemId === kaos ? 2 : 2 })),
    });
    expect(r.ok).toBe(true);
    const m = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id } });
    expect(m).toMatchObject({ status: "DITERIMA", selisihStatus: "TERBUKA" });
    expect(await saldo(tujuan, kaos, `${tag}-KAOS-M`)).toBe(2);
    expect(await saldo(tujuan, kemeja, "")).toBe(3);
    const masuk = await prisma.storeStockMovement.findMany({ where: { storeId: tujuan, kind: "MUTASI_MASUK" } });
    expect(masuk).toHaveLength(2);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "StoreTransfer", entityId: a.id }, orderBy: { createdAt: "asc" } });
    expect(jejak.map((j) => j.action)).toContain("STORE_TRANSFER_RECEIVED");
    expect((await kirimanMenunggu(tujuan)).some((x) => x.sourceId === a.id)).toBe(false);

    // Kantor: yang kurang ternyata masih di toko asal.
    expect(await putuskanSelisihMutasi({ transferId: a.id, olehUserId: kantor, keputusan: "KEMBALI", catatan: "" })).toEqual({
      ok: false,
      kode: "ALASAN_WAJIB",
    });
    expect(await putuskanSelisihMutasi({ transferId: a.id, olehUserId: kantor, keputusan: "KEMBALI", catatan: "Tertinggal di gudang belakang" })).toMatchObject({
      ok: true,
    });
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(8);
    expect((await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id } })).selisihStatus).toBe("KEMBALI");
    expect(await putuskanSelisihMutasi({ transferId: a.id, olehUserId: kantor, keputusan: "HILANG", catatan: "x" })).toEqual({
      ok: false,
      kode: "TIDAK_ADA_SELISIH",
    });
  });

  it("refuses receiving more than was sent — those pieces never left any book", async () => {
    const a = await dikirim();
    const baris = await barisTransfer(a.id);
    const r = await terimaKiriman({
      storeId: tujuan,
      userId: spgTujuan,
      sourceType: "MUTASI",
      sourceId: a.id,
      diterima: baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty + 1 })),
    });
    expect(r).toEqual({ ok: false, alasan: "LEBIH_DARI_DIKIRIM" });
    expect((await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DIKIRIM");
  });

  it("lets the SPG cancel before shipping; an office cancel after shipping returns the goods to the source", async () => {
    const a = await ajukan();
    if (!a.ok) throw new Error("ajukan");
    expect(await batalkanMutasi({ transferId: a.id, olehUserId: spgAsal2, sebagai: "SPG", storeId: asal })).toMatchObject({
      ok: true,
      status: "DIBATALKAN",
    });

    const b = await dikirim();
    expect(await batalkanMutasi({ transferId: b.id, olehUserId: spgAsal, sebagai: "SPG", storeId: asal })).toEqual({
      ok: false,
      kode: "SUDAH_DIPUTUSKAN",
    });
    expect(await batalkanMutasi({ transferId: b.id, olehUserId: kantor, sebagai: "KANTOR" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await batalkanMutasi({ transferId: b.id, olehUserId: kantor, sebagai: "KANTOR", alasan: "Salah tujuan" })).toMatchObject({
      ok: true,
      status: "DIKEMBALIKAN",
    });
    expect((await kirimanMenunggu(tujuan)).some((x) => x.sourceId === b.id)).toBe(false);
    const kembali = (await kirimanMenunggu(asal)).find((x) => x.sourceType === "MUTASI_KEMBALI" && x.sourceId === b.id);
    expect(kembali).toBeTruthy();

    const baris = await barisTransfer(b.id);
    const r = await terimaKiriman({
      storeId: asal,
      userId: spgAsal,
      sourceType: "MUTASI_KEMBALI",
      sourceId: b.id,
      diterima: baris.map((x) => ({ lineId: x.id, qtyReceived: x.qty })),
    });
    expect(r.ok).toBe(true);
    expect(await saldo(asal, kaos, `${tag}-KAOS-M`)).toBe(10);
    expect(await saldo(asal, kemeja, "")).toBe(5);
  });

  it("redirects a shipment in transit; a store without an SPG or a stock book is received by the office with no book row", async () => {
    const a = await dikirim();
    expect(await alihkanTujuanMutasi({ transferId: a.id, olehUserId: kantor, toStoreId: tokoPutus, alasan: "x" })).toEqual({
      ok: false,
      kode: "ARAH_DITOLAK",
    });
    expect(await alihkanTujuanMutasi({ transferId: a.id, olehUserId: kantor, toStoreId: tujuanSepi, alasan: "Toko tujuan tutup renovasi" })).toMatchObject({
      ok: true,
    });
    expect((await kirimanMenunggu(tujuan)).some((x) => x.sourceId === a.id)).toBe(false);
    const catatan = await prisma.adminNotification.findMany({ where: { category: "STORE_TRANSFER_TO_RECEIVE" }, select: { metadata: true } });
    expect(catatan.some((c) => (c.metadata as { transferId?: string } | null)?.transferId === a.id)).toBe(true);

    const baris = await barisTransfer(a.id);
    const r = await terimaMutasiKantor({
      transferId: a.id,
      olehUserId: kantor,
      sumber: "MUTASI",
      diterima: baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty })),
    });
    expect(r.ok).toBe(true);
    expect(await prisma.storeStockMovement.count({ where: { storeId: tujuanSepi } })).toBe(0);
    expect(await prisma.storeReceipt.count({ where: { storeId: tujuanSepi, sourceType: "MUTASI", sourceId: a.id } })).toBe(1);
    expect((await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DITERIMA");

    // Toko tanpa buku membaca stoknya dari titipan — mutasi yang diterima ikut.
    const stok = await stokDiToko(tujuanSepi);
    expect(stok.source).toBe("TITIPAN");
    expect(stok.baris.map((b) => [b.itemId, b.variantSku, b.qty]).sort()).toEqual(
      [
        [kaos, `${tag}-KAOS-M`, 3],
        [kemeja, "", 2],
      ].sort(),
    );
    // Angka titipan siklus konsinyasi: masuk di tujuan, keluar (bertanda minus) di asal.
    const { tahun, bulan } = bulanWib(new Date());
    const siklusTujuan = (
      await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}-S1`, storeId: tujuanSepi, periodYear: tahun, periodMonth: bulan } })
    ).id;
    const siklusAsal = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}-S2`, storeId: asal, periodYear: tahun, periodMonth: bulan } })).id;
    siklus.push(siklusTujuan, siklusAsal);
    const titipanTujuan = (await rincianSiklus(siklusTujuan))?.titipan ?? [];
    expect(titipanTujuan.find((x) => x.itemName === "Kaos Uji")?.sisa).toBe(3);
    const titipanAsal = (await rincianSiklus(siklusAsal))?.titipan ?? [];
    expect(titipanAsal.find((x) => x.itemName === "Kaos Uji")?.sisa).toBe(-3);
  });

  it("keeps the office out while the destination's SPG can still receive, until the reminder period passes", async () => {
    const a = await dikirim();
    const baris = await barisTransfer(a.id);
    const diterima = baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty }));
    expect(await terimaMutasiKantor({ transferId: a.id, olehUserId: kantor, sumber: "MUTASI", diterima })).toEqual({
      ok: false,
      alasan: "MASIH_DITUNGGU_SPG",
    });
    const nanti = new Date(Date.now() + 4 * HARI_MS);
    const r = await terimaMutasiKantor({ transferId: a.id, olehUserId: kantor, sumber: "MUTASI", diterima, sekarang: nanti });
    expect(r.ok).toBe(true);
    // Toko tujuan sudah berbuku → penerimaan kantor menulis baris buku.
    expect(await saldo(tujuan, kemeja, "")).toBe(3);
  });

  it("refuses an SPG receipt in a locked consignment month; the office may proceed after confirming, and it is logged", async () => {
    const a = await dikirim();
    const { tahun, bulan } = bulanWib(new Date());
    siklus.push(
      (
        await prisma.consignmentCycle.create({
          data: { noKonsi: `${tag}-K2`, storeId: tujuan, periodYear: tahun, periodMonth: bulan, lockedAt: new Date(), lockedById: kantor },
        })
      ).id,
    );
    const baris = await barisTransfer(a.id);
    const diterima = baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty }));
    expect(await terimaKiriman({ storeId: tujuan, userId: spgTujuan, sourceType: "MUTASI", sourceId: a.id, diterima })).toEqual({
      ok: false,
      alasan: "SIKLUS_TERKUNCI",
      noKonsi: [`${tag}-K2`],
    });
    const nanti = new Date(Date.now() + 4 * HARI_MS);
    // Bulan WIB "nanti" mungkin sudah lain — siklusnya dibuat untuk bulan yang sama dengan `nanti`.
    const b2 = bulanWib(nanti);
    if (b2.bulan !== bulan || b2.tahun !== tahun) {
      siklus.push(
        (
          await prisma.consignmentCycle.create({
            data: { noKonsi: `${tag}-K3`, storeId: tujuan, periodYear: b2.tahun, periodMonth: b2.bulan, lockedAt: new Date(), lockedById: kantor },
          })
        ).id,
      );
    }
    expect(await terimaMutasiKantor({ transferId: a.id, olehUserId: kantor, sumber: "MUTASI", diterima, sekarang: nanti })).toMatchObject({
      ok: false,
      alasan: "SIKLUS_TERKUNCI",
    });
    const r = await terimaMutasiKantor({ transferId: a.id, olehUserId: kantor, sumber: "MUTASI", diterima, sekarang: nanti, setujuSiklusTerkunci: true });
    expect(r.ok).toBe(true);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "StoreTransfer", entityId: a.id, action: "STORE_TRANSFER_RECEIVED" } });
    expect((jejak.metadata as { siklusTerkunci?: string[]; olehKantor?: boolean }).siklusTerkunci?.length).toBeGreaterThan(0);
    expect((jejak.metadata as { olehKantor?: boolean }).olehKantor).toBe(true);
  });

  // ─── Balapan ───────────────────────────────────────────────────────────────

  it("balapan: SPG ships exactly while the office cancels — only one wins, and the book matches the winner", async () => {
    for (let putaran = 0; putaran < 6; putaran += 1) {
      const a = await ajukan();
      if (!a.ok) throw new Error("ajukan");
      await setujuiMutasi({ transferId: a.id, olehUserId: kantor });
      const [kirim, batal] = await Promise.all([
        kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal }),
        batalkanMutasi({ transferId: a.id, olehUserId: kantor, sebagai: "KANTOR", alasan: "Tidak jadi" }),
      ]);
      const akhir = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id } });
      const keluar = await prisma.storeStockMovement.count({ where: { refType: "StoreTransfer", refId: a.id, kind: "MUTASI_KELUAR" } });
      if (kirim.ok && batal.ok) {
        // Kantor membatalkan SESUDAH kiriman tercatat: barang kembali, bukan hilang.
        expect(akhir.status).toBe("DIKEMBALIKAN");
        expect(keluar).toBe(2);
      } else {
        expect([kirim.ok, batal.ok].filter(Boolean)).toHaveLength(1);
        expect(akhir.status).toBe(kirim.ok ? "DIKIRIM" : "DIBATALKAN");
        expect(keluar).toBe(kirim.ok ? 2 : 0);
      }
    }
  });

  it("balapan: two SPGs receive the same transfer at once — one receipt, one set of book rows", async () => {
    for (let putaran = 0; putaran < 4; putaran += 1) {
      const a = await dikirim({ baris: [{ itemId: kemeja, variantSku: "", qty: 1 }] });
      const baris = await barisTransfer(a.id);
      const diterima = baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty }));
      const hasil = await Promise.all([
        terimaKiriman({ storeId: tujuan, userId: spgTujuan, sourceType: "MUTASI", sourceId: a.id, diterima }),
        terimaKiriman({ storeId: tujuan, userId: spgTujuan2, sourceType: "MUTASI", sourceId: a.id, diterima }),
      ]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      const kalah = hasil.find((h) => !h.ok);
      expect(kalah && !kalah.ok ? kalah.alasan : null).toBe("SUDAH_DITERIMA");
      expect(await prisma.storeReceipt.count({ where: { sourceType: "MUTASI", sourceId: a.id } })).toBe(1);
      expect(await prisma.storeStockMovement.count({ where: { storeId: tujuan, kind: "MUTASI_MASUK", refType: "StoreReceipt" } })).toBe(putaran + 1);
    }
  });
});
