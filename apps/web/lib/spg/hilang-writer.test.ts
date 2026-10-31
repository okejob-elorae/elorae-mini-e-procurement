import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Barang hilang terhadap basis data uji: catat manual, keputusan penanggung
 * (CAS + balapan), ubah/batal sebelum ada potongan, tagihan toko (putus manual,
 * konsinyasi lewat siklus), potongan gaji/komisi (batas persen, cicilan,
 * lepas-lalu-potong), tanda potong sales, dan payload HP yang hanya memuat
 * bagian orang itu sendiri.
 *
 * Semua baris milik fixture buatan tes (toko, barang, pengguna berkode acak);
 * teardown hanya lewat id yang diseed (`seededId`/`seededIds`).
 */

const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; judul: string; isi: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string; isi: string; data: Record<string, string> }) => {
    kabar.kirim.push({ userId, jenis: k.jenis, judul: k.judul, isi: k.isi, data: k.data });
  }),
}));

const { buatBarangHilang, putuskanBarangHilang, ubahKeputusanHilang, batalkanBarangHilang, tandaiTokoDitagih, tandaiSalesDipotong } = await import(
  "./hilang-writer"
);
const { potongBebanHilang, lepasPotonganHilang, bebanTerbukaUntukPotong, bebanTerbukaOrang } = await import("./hilang-potong");
const { bebanHilangUntukSiklus, lepasBebanHilangSiklus } = await import("./hilang-tagihan");
const { bebanHilangSaya, daftarHilangKantor, rincianHilangKantor, potonganHilangSalesBulan } = await import("./hilang-queries");
const { runSerializable } = await import("@/lib/db/tx-retry");
const { KATEGORI_NOTIF_HILANG } = await import("./hilang");
const { KUNCI_BARANG_HILANG } = await import("./pengaturan");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `HLG-${Math.random().toString(36).slice(2, 9)}`;

d("barang hilang — penulis, tagihan, potongan (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let tokoKonsi = "";
  let tokoPutus = "";
  let kantor = "";
  let spgA = "";
  let spgB = "";
  let sales = "";
  let aturanAwal: string | null = null;
  let adaAturanAwal = false;
  let kunciKe = 0;

  const M = () => `${tag}-KAOS-M`;
  const L = () => `${tag}-KAOS-L`;
  const tokoIds = () => seededIds([tokoKonsi, tokoPutus].filter(Boolean));
  const userIds = () => seededIds([kantor, spgA, spgB, sales].filter(Boolean));
  const kunci = () => `${tag}-kunci-${++kunciKe}`;

  const setel = (isi: { dasarNilai: string; maksPotongPersen: number; dariOpname: boolean }) =>
    prisma.systemSetting.upsert({
      where: { key: KUNCI_BARANG_HILANG },
      create: { key: KUNCI_BARANG_HILANG, value: JSON.stringify(isi) },
      update: { value: JSON.stringify(isi) },
    });

  async function buka(
    storeId: string | null,
    baris: { itemId: string; variantSku: string; qty: number }[],
    sekarang?: Date,
  ): Promise<string> {
    const r = await buatBarangHilang({ storeId, baris, catatan: "uji", idempotencyKey: kunci(), userId: kantor, sekarang });
    if (!r.ok) throw new Error(`buka gagal: ${r.kode}`);
    return r.id;
  }

  async function putuskan(
    lossId: string,
    bagian: { bearer: string; bearerUserId?: string | null; amount: number }[],
    lain: { total?: number; catatan?: string; sekarang?: Date; keringananPersen?: unknown } = {},
  ) {
    return putuskanBarangHilang({ lossId, bagian, olehUserId: kantor, ...lain });
  }

  const bagianDari = (lossId: string) => prisma.stockLossShare.findMany({ where: { lossId: seededId(lossId) }, orderBy: { id: "asc" } });

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
    adaAturanAwal = ada !== null;
    aturanAwal = ada?.value ?? null;
    await setel({ dasarNilai: "HARGA_ELORAE", maksPotongPersen: 50, dariOpname: true });

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
    const pengguna = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    kantor = await pengguna("kantor", null);
    sales = await pengguna("sales", null);
    tokoKonsi = (
      await prisma.store.create({
        data: { code: `${tag}-K`, name: `Toko Konsi ${tag}`, address: "uji", termsType: "KONSI", markupPercent: 20, salesmanId: sales },
      })
    ).id;
    tokoPutus = (await prisma.store.create({ data: { code: `${tag}-P`, name: `Toko Putus ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spgA = await pengguna("spg-a", tokoKonsi);
    spgB = await pengguna("spg-b", tokoKonsi);
  });

  beforeEach(() => {
    kabar.kirim = [];
  });

  afterEach(async () => {
    const losses = await prisma.stockLoss.findMany({
      where: { OR: [{ storeId: { in: tokoIds() } }, { createdById: { in: userIds() } }] },
      select: { id: true, shares: { select: { id: true } } },
    });
    const lossIds = losses.map((l) => l.id);
    const shareIds = losses.flatMap((l) => l.shares.map((s) => s.id));
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.lossId === "string" && lossIds.includes(m.lossId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(lossIds) } } });
    await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(shareIds) } } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
  });

  afterAll(async () => {
    if (adaAturanAwal && aturanAwal !== null) {
      await prisma.systemSetting.update({ where: { key: KUNCI_BARANG_HILANG }, data: { value: aturanAwal } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_BARANG_HILANG) } });
    }
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds() } } });
    // Toko lebih dulu: toko konsinyasi menunjuk sales uji sebagai pemegangnya.
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, kemeja].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("catat manual: dinilai harga jual Elorae, baris kembar digabung, idempoten per kunci, catatan kantor + jejak", async () => {
    const k = kunci();
    const r = await buatBarangHilang({
      storeId: tokoKonsi,
      baris: [
        { itemId: kaos, variantSku: M(), qty: 2 },
        { itemId: kemeja, variantSku: "", qty: 1 },
        { itemId: kaos, variantSku: M(), qty: 1 },
      ],
      catatan: "  hilang   di gudang toko ",
      idempotencyKey: k,
      userId: kantor,
    });
    expect(r).toMatchObject({ ok: true, ulang: false });
    if (!r.ok) return;
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id: r.id }, include: { lines: { orderBy: { productName: "asc" } } } });
    expect(loss).toMatchObject({ status: "TERBUKA", source: "MANUAL", totalQty: 4, valueBasis: "HARGA_ELORAE", note: "hilang di gudang toko", storeId: tokoKonsi });
    expect(Number(loss.totalAmount)).toBe(380_000);
    expect(loss.lines.map((l) => [l.variantSku, l.qty, Number(l.unitValue), Number(l.amount)])).toEqual([
      [M(), 3, 100_000, 300_000],
      ["", 1, 80_000, 80_000],
    ]);

    const notif = (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { metadata: true } })).filter(
      (n) => (n.metadata as Record<string, unknown> | null)?.lossId === r.id,
    );
    expect(notif).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "STOCK_LOSS_OPENED" } })).toBe(1);

    // Kiriman ulang dari formulir yang sama: kunci diperiksa paling dulu.
    expect(await buatBarangHilang({ storeId: tokoKonsi, baris: [], catatan: "", idempotencyKey: k, userId: kantor })).toEqual({ ok: true, id: r.id, ulang: true });

    expect(await buatBarangHilang({ storeId: tokoKonsi, baris: [{ itemId: kaos, variantSku: "XX", qty: 1 }], catatan: "a", idempotencyKey: kunci(), userId: kantor })).toEqual({
      ok: false,
      kode: "VARIAN_TIDAK_DIKENAL",
    });
    expect(await buatBarangHilang({ storeId: tokoKonsi, baris: [{ itemId: kemeja, variantSku: M(), qty: 1 }], catatan: "a", idempotencyKey: kunci(), userId: kantor })).toEqual({
      ok: false,
      kode: "VARIAN_TIDAK_DIKENAL",
    });
    expect(await buatBarangHilang({ storeId: tokoKonsi, baris: [{ itemId: kemeja, variantSku: "", qty: 1 }], catatan: " ", idempotencyKey: kunci(), userId: kantor })).toEqual({
      ok: false,
      kode: "ALASAN_WAJIB",
    });
    expect(await buatBarangHilang({ storeId: "tidak-ada", baris: [{ itemId: kemeja, variantSku: "", qty: 1 }], catatan: "a", idempotencyKey: kunci(), userId: kantor })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_DITEMUKAN",
    });
    expect(await buatBarangHilang({ storeId: null, baris: [{ itemId: kemeja, variantSku: "", qty: 0 }], catatan: "a", idempotencyKey: kunci(), userId: kantor })).toEqual({
      ok: false,
      kode: "BARIS_TIDAK_SAH",
    });
  });

  it("putuskan: SPG dibagi + Elorae; bagian Elorae langsung lunas; kabar ke setiap SPG; jumlah harus sama", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    expect(await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 50_000 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAMA" });
    expect(await putuskan(id, [{ bearer: "SPG", bearerUserId: "bukan-orang", amount: 80_000 }])).toEqual({ ok: false, kode: "ORANG_TIDAK_DITEMUKAN" });

    const r = await putuskan(id, [
      { bearer: "SPG", bearerUserId: spgA, amount: 30_000 },
      { bearer: "SPG", bearerUserId: spgB, amount: 30_000 },
      { bearer: "ELORAE", amount: 20_000 },
    ]);
    expect(r).toEqual({ ok: true, id, status: "DITETAPKAN" });
    const bagian = await bagianDari(id);
    const elorae = bagian.find((b) => b.bearer === "ELORAE");
    expect(Number(elorae?.settledAmount)).toBe(20_000);
    expect(elorae?.settledAt).not.toBeNull();
    expect(bagian.filter((b) => b.bearer === "SPG").every((b) => b.settledAt === null && Number(b.settledAmount) === 0)).toBe(true);

    expect(kabar.kirim.map((k) => k.userId).sort()).toEqual([spgA, spgB].sort());
    expect(kabar.kirim.every((k) => k.jenis === "BEBAN_HILANG_DITETAPKAN" && k.data.lossId === id)).toBe(true);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "STOCK_LOSS_DECIDED" } });
    expect((jejak.changes as { before: { status: string }; after: { status: string } }).before.status).toBe("TERBUKA");

    expect(await putuskan(id, [{ bearer: "ELORAE", amount: 80_000 }])).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("balapan: dua keputusan bersamaan — tepat satu yang tercatat", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    const hasil = await Promise.all([
      putuskan(id, [{ bearer: "ELORAE", amount: 80_000 }]),
      putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 80_000 }]),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIPUTUSKAN"]);
    expect(await bagianDari(id)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "STOCK_LOSS_DECIDED" } })).toBe(1);
  });

  it("seluruhnya Elorae → langsung SELESAI; mengubah total butuh alasan; toko wajib untuk bagian toko", async () => {
    const id = await buka(null, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    expect(await putuskan(id, [{ bearer: "TOKO", amount: 80_000 }])).toEqual({ ok: false, kode: "TOKO_WAJIB" });
    expect(await putuskan(id, [{ bearer: "ELORAE", amount: 50_000 }], { total: 50_000 })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await putuskan(id, [{ bearer: "ELORAE", amount: 50_000 }], { total: 50_000, catatan: "separuh ketemu" })).toEqual({ ok: true, id, status: "SELESAI" });
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id } });
    expect(Number(loss.totalAmount)).toBe(50_000);
    expect(loss.decisionNote).toBe("separuh ketemu");
    expect(kabar.kirim).toHaveLength(0);
  });

  it("ubah dan batal: boleh sebelum ada potongan (dengan alasan + kabar), ditolak sesudahnya", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 1 }]);
    await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 100_000 }]);
    kabar.kirim = [];

    expect(await ubahKeputusanHilang({ lossId: id, bagian: [{ bearer: "SALES", bearerUserId: sales, amount: 100_000 }], catatan: "", olehUserId: kantor })).toEqual({
      ok: false,
      kode: "ALASAN_WAJIB",
    });
    expect(
      await ubahKeputusanHilang({ lossId: id, bagian: [{ bearer: "SALES", bearerUserId: sales, amount: 100_000 }], catatan: "ternyata sales yang bawa", olehUserId: kantor }),
    ).toEqual({ ok: true, id, status: "DITETAPKAN" });
    expect((await bagianDari(id)).map((b) => [b.bearer, b.bearerUserId])).toEqual([["SALES", sales]]);
    expect(kabar.kirim.map((k) => [k.userId, k.judul]).sort()).toEqual(
      [
        [sales, "Beban barang hilang diubah"],
        [spgA, "Beban barang hilang dibatalkan"],
      ].sort(),
    );
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "STOCK_LOSS_CHANGED" } });
    expect(jejak.reason).toBe("ternyata sales yang bawa");

    // Kantor menandai sebagian sudah dipotong dari komisi sales → keputusan terkunci.
    expect(await tandaiSalesDipotong({ salesmanId: sales, bulan: "2026-10", jumlah: 10_000, kunci: kunci(), olehUserId: kantor })).toMatchObject({ ok: true, dipotong: 10_000 });
    expect(await ubahKeputusanHilang({ lossId: id, bagian: [{ bearer: "ELORAE", amount: 100_000 }], catatan: "x", olehUserId: kantor })).toEqual({
      ok: false,
      kode: "SUDAH_ADA_POTONGAN",
    });
    expect(await batalkanBarangHilang({ lossId: id, alasan: "x", olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_ADA_POTONGAN" });
    expect((await rincianHilangKantor(id))?.terkunci).toBe(true);
  });

  it("batal: alasan wajib, bagian dihapus, penanggung dikabari, tidak bisa diputuskan lagi", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 80_000 }]);
    kabar.kirim = [];
    expect(await batalkanBarangHilang({ lossId: id, alasan: " ", olehUserId: kantor })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await batalkanBarangHilang({ lossId: id, alasan: "terjual tanpa nota", olehUserId: kantor })).toEqual({ ok: true, id });
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id } });
    expect(loss.status).toBe("DIBATALKAN");
    expect(loss.decisionNote).toBe("terjual tanpa nota");
    expect(await bagianDari(id)).toHaveLength(0);
    expect(kabar.kirim).toEqual([expect.objectContaining({ userId: spgA, judul: "Beban barang hilang dibatalkan" })]);
    expect(await batalkanBarangHilang({ lossId: id, alasan: "lagi", olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
    expect(await putuskan(id, [{ bearer: "ELORAE", amount: 80_000 }])).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
  });

  it("toko putus: kantor menandai sudah ditagih → SELESAI; toko konsinyasi ditolak (lewat siklus)", async () => {
    const id = await buka(tokoPutus, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    await putuskan(id, [{ bearer: "TOKO", amount: 80_000 }]);
    const [share] = await bagianDari(id);
    expect(await tandaiTokoDitagih({ shareId: share.id, catatan: "nota T-1", olehUserId: kantor })).toEqual({ ok: true, lossId: id });
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id } })).status).toBe("SELESAI");
    const ded = await prisma.stockLossDeduction.findMany({ where: { shareId: share.id } });
    expect(ded.map((x) => [x.refType, Number(x.amount)])).toEqual([["TagihanTokoManual", 80_000]]);
    expect(await tandaiTokoDitagih({ shareId: share.id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_LUNAS" });

    const id2 = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    await putuskan(id2, [{ bearer: "TOKO", amount: 80_000 }]);
    const [share2] = await bagianDari(id2);
    expect(await tandaiTokoDitagih({ shareId: share2.id, olehUserId: kantor })).toEqual({ ok: false, kode: "LEWAT_SIKLUS" });
  });

  it("siklus konsinyasi: bagian toko yang dibuka sampai akhir bulan ditagihkan, idempoten, dan dilepas saat kunci dibuka", async () => {
    const siklus = `siklus-${tag}`;
    const sept = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }], new Date("2026-09-15T03:00:00Z"));
    await putuskan(sept, [
      { bearer: "TOKO", amount: 50_000 },
      { bearer: "SPG", bearerUserId: spgA, amount: 30_000 },
    ]);
    const nov = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 1 }], new Date("2026-11-02T03:00:00Z"));
    await putuskan(nov, [{ bearer: "TOKO", amount: 100_000 }]);

    const kunciSiklus = () =>
      runSerializable((tx) =>
        bebanHilangUntukSiklus(tx, { cycleId: siklus, noKonsi: `KONSI-${tag}`, storeId: tokoKonsi, periodYear: 2026, periodMonth: 10, userId: kantor }),
      );
    expect(await kunciSiklus()).toBe(50_000);
    const tokoSept = (await bagianDari(sept)).find((b) => b.bearer === "TOKO");
    expect(tokoSept?.settledAt).not.toBeNull();
    expect(tokoSept?.settleNote).toBe(`Ditagihkan di siklus KONSI-${tag}`);
    // Bagian SPG masih terbuka → catatannya tetap DITETAPKAN.
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id: sept } })).status).toBe("DITETAPKAN");
    // Catatan November belum masuk siklus Oktober.
    expect((await bagianDari(nov))[0].settledAt).toBeNull();

    expect(await kunciSiklus()).toBe(50_000);
    expect(await prisma.stockLossDeduction.count({ where: { refType: "ConsignmentCycle", refId: siklus } })).toBe(1);

    await runSerializable((tx) => lepasBebanHilangSiklus(tx, { cycleId: siklus, noKonsi: `KONSI-${tag}`, userId: kantor }));
    const sesudahLepas = (await bagianDari(sept)).find((b) => b.bearer === "TOKO");
    expect(sesudahLepas?.settledAt).toBeNull();
    expect(Number(sesudahLepas?.settledAmount)).toBe(0);
    expect(await prisma.stockLossDeduction.count({ where: { refType: "ConsignmentCycle", refId: siklus } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sept, action: "STOCK_LOSS_DEDUCTION_RELEASED" } })).toBe(1);
  });

  it("siklus: catatan yang seluruhnya bagian toko menjadi SELESAI, lalu kembali DITETAPKAN saat dilepas", async () => {
    const siklus = `siklus2-${tag}`;
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }], new Date("2026-10-10T03:00:00Z"));
    await putuskan(id, [{ bearer: "TOKO", amount: 80_000 }]);
    const total = await runSerializable((tx) =>
      bebanHilangUntukSiklus(tx, { cycleId: siklus, noKonsi: "K-2", storeId: tokoKonsi, periodYear: 2026, periodMonth: 10, userId: kantor }),
    );
    expect(total).toBe(80_000);
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id } })).status).toBe("SELESAI");
    await runSerializable((tx) => lepasBebanHilangSiklus(tx, { cycleId: siklus, noKonsi: "K-2", userId: kantor }));
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id } })).status).toBe("DITETAPKAN");
  });

  it("potong gaji: batas 50% bruto, terlama dulu, dicicil di dua pembayaran, idempoten per dokumen", async () => {
    const lama = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 3 }]);
    await putuskan(lama, [{ bearer: "SPG", bearerUserId: spgA, amount: 300_000 }], { sekarang: new Date("2026-09-01T03:00:00Z") });
    const baru = await buka(tokoKonsi, [{ itemId: kaos, variantSku: L(), qty: 1 }]);
    await putuskan(baru, [{ bearer: "SPG", bearerUserId: spgA, amount: 100_000 }], { sekarang: new Date("2026-09-05T03:00:00Z") });
    expect(await bebanTerbukaUntukPotong(prisma, spgA)).toBe(400_000);

    const bayar = (bruto: number, ref: string) =>
      runSerializable((tx) => potongBebanHilang(tx, { userId: spgA, bruto, refType: "UjiGaji", refId: `${tag}-${ref}`, createdById: kantor }));

    expect(await bayar(400_000, "g1")).toBe(200_000);
    const [s1] = await bagianDari(lama);
    expect(Number(s1.settledAmount)).toBe(200_000);
    expect(s1.settledAt).toBeNull();
    expect(Number((await bagianDari(baru))[0].settledAmount)).toBe(0);
    // Dokumen pembayaran yang sama tidak memotong dua kali.
    expect(await bayar(400_000, "g1")).toBe(200_000);
    expect(await prisma.stockLossDeduction.count({ where: { refType: "UjiGaji", refId: `${tag}-g1` } })).toBe(1);

    // Pembayaran kedua: batas 300.000 → sisa 100.000 bagian lama, lalu 100.000 bagian baru.
    expect(await bayar(600_000, "g2")).toBe(200_000);
    expect((await bagianDari(lama))[0].settledAt).not.toBeNull();
    expect((await bagianDari(baru))[0].settledAt).not.toBeNull();
    expect((await prisma.stockLoss.findMany({ where: { id: { in: [lama, baru] } }, select: { status: true } })).map((l) => l.status)).toEqual(["SELESAI", "SELESAI"]);
    expect(await bayar(1_000_000, "g3")).toBe(0);
    expect((await bebanTerbukaOrang(spgA)).sisa).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: { in: [lama, baru] }, action: "STOCK_LOSS_DEDUCTED" } })).toBe(3);
  });

  it("lepas lalu potong lagi menghasilkan angka yang sama; lepas idempoten", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 3 }]);
    await putuskan(id, [{ bearer: "SPG", bearerUserId: spgB, amount: 300_000 }]);
    const ref = { refType: "SpgCommission", refId: `${tag}-kom-1` };
    const potong = () => runSerializable((tx) => potongBebanHilang(tx, { userId: spgB, bruto: 200_000, ...ref, createdById: kantor }));

    expect(await potong()).toBe(100_000);
    expect(await runSerializable((tx) => lepasPotonganHilang(tx, { ...ref, userId: kantor }))).toBe(100_000);
    const [s] = await bagianDari(id);
    expect(Number(s.settledAmount)).toBe(0);
    expect(await runSerializable((tx) => lepasPotonganHilang(tx, { ...ref, userId: kantor }))).toBe(0);
    expect(await potong()).toBe(100_000);
    expect(Number((await bagianDari(id))[0].settledAmount)).toBe(100_000);
    const orang = await bebanTerbukaOrang(spgB);
    expect(orang).toMatchObject({ sisa: 200_000, maksPotongPersen: 50 });
    expect(orang.bagian).toEqual([expect.objectContaining({ lossId: id, nilai: 300_000, dipotong: 100_000, sisa: 200_000 })]);
  });

  it("balapan: dua pembayaran bersamaan tidak pernah memotong melebihi bagiannya", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 1 }]);
    await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 100_000 }]);
    const bayar = (ref: string) =>
      runSerializable((tx) => potongBebanHilang(tx, { userId: spgA, bruto: 400_000, refType: "UjiGaji", refId: `${tag}-${ref}`, createdById: kantor }));
    const hasil = await Promise.all([bayar("balap-1"), bayar("balap-2")]);
    expect(hasil.reduce((a, b) => a + b, 0)).toBe(100_000);
    const [s] = await bagianDari(id);
    expect(Number(s.settledAmount)).toBe(100_000);
    const ded = await prisma.stockLossDeduction.findMany({ where: { shareId: s.id } });
    expect(ded.reduce((n, x) => n + Number(x.amount), 0)).toBe(100_000);
  });

  it("batas potongan mengikuti pengaturan", async () => {
    await setel({ dasarNilai: "HARGA_ELORAE", maksPotongPersen: 10, dariOpname: true });
    try {
      const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 3 }]);
      await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 300_000 }]);
      expect(await runSerializable((tx) => potongBebanHilang(tx, { userId: spgA, bruto: 1_000_000, refType: "UjiGaji", refId: `${tag}-p10`, createdById: kantor }))).toBe(
        100_000,
      );
    } finally {
      await setel({ dasarNilai: "HARGA_ELORAE", maksPotongPersen: 50, dariOpname: true });
    }
  });

  it("laporan komisi salesman: sisa, saran, tanda sudah dipotong (idempoten, tidak melebihi sisa)", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }, { itemId: kaos, variantSku: M(), qty: 1 }]);
    await putuskan(id, [{ bearer: "SALES", bearerUserId: sales, amount: 150_000 }], { total: 150_000, catatan: "harga khusus" });
    expect((await potonganHilangSalesBulan([{ salesmanId: sales, komisi: 100_000 }], "2026-10")).per[sales]).toEqual({ sisa: 150_000, dipotongBulanIni: 0, saran: 50_000 });

    const k = kunci();
    expect(await tandaiSalesDipotong({ salesmanId: sales, bulan: "2026-10", jumlah: 50_000, kunci: k, olehUserId: kantor })).toEqual({ ok: true, dipotong: 50_000, ulang: false });
    expect(await tandaiSalesDipotong({ salesmanId: sales, bulan: "2026-10", jumlah: 50_000, kunci: k, olehUserId: kantor })).toEqual({ ok: true, dipotong: 50_000, ulang: true });
    expect(await tandaiSalesDipotong({ salesmanId: sales, bulan: "2026-10", jumlah: 200_000, kunci: kunci(), olehUserId: kantor })).toEqual({ ok: false, kode: "MELEBIHI_SISA" });
    expect(await tandaiSalesDipotong({ salesmanId: sales, bulan: "2026-13", jumlah: 1, kunci: kunci(), olehUserId: kantor })).toEqual({ ok: false, kode: "BULAN_TIDAK_SAH" });
    expect(await tandaiSalesDipotong({ salesmanId: spgA, bulan: "2026-10", jumlah: 1, kunci: kunci(), olehUserId: kantor })).toEqual({ ok: false, kode: "TIDAK_ADA_BEBAN" });
    expect((await potonganHilangSalesBulan([{ salesmanId: sales, komisi: 100_000 }], "2026-10")).per[sales]).toEqual({ sisa: 100_000, dipotongBulanIni: 50_000, saran: 0 });
    expect((await potonganHilangSalesBulan([{ salesmanId: sales, komisi: 100_000 }], "2026-11")).per[sales]).toEqual({ sisa: 100_000, dipotongBulanIni: 0, saran: 50_000 });
  });

  it("HP: hanya bagian orang itu sendiri — tanpa nilai satuan, total, atau bagian orang lain", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 1 }]);
    await putuskan(id, [
      { bearer: "SPG", bearerUserId: spgA, amount: 61_000 },
      { bearer: "SPG", bearerUserId: spgB, amount: 29_000 },
      { bearer: "TOKO", amount: 10_000 },
    ]);
    const milikA = await bebanHilangSaya(spgA);
    expect(milikA).toEqual([
      expect.objectContaining({ toko: `Toko Konsi ${tag}`, nilai: 61_000, dipotong: 0, sisa: 61_000, lunas: false, barang: [{ nama: expect.stringContaining("Kaos Uji"), qty: 1 }] }),
    ]);
    const teks = JSON.stringify(milikA);
    for (const bocor of ["29000", "10000", "100000", "unitValue", "totalAmount", "amount", spgB, "TOKO", "ELORAE"]) expect(teks).not.toContain(bocor);
    expect(await bebanHilangSaya(kantor)).toEqual([]);
  });

  it("keringanan diskon pegawai: server memotong bagian SPG ke bawah ke rupiah utuh, Elorae menanggung selisihnya, tercatat di catatan + jejak + kabar", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kaos, variantSku: M(), qty: 1 }]);
    // Pembagian SEBELUM keringanan; 33.333,33 × 80% = 26.666,664 → 26.666.
    const r = await putuskan(
      id,
      [
        { bearer: "SPG", bearerUserId: spgA, amount: 66_666.67 },
        { bearer: "SPG", bearerUserId: spgB, amount: 33_333.33 },
      ],
      { catatan: "ditanggung SPG", keringananPersen: 20 },
    );
    expect(r).toEqual({ ok: true, id, status: "DITETAPKAN" });
    const bagian = await bagianDari(id);
    expect(bagian.map((b) => [b.bearer, b.bearerUserId, Number(b.amount)]).sort()).toEqual(
      [
        ["ELORAE", null, 20_001],
        ["SPG", spgA, 53_333],
        ["SPG", spgB, 26_666],
      ].sort(),
    );
    expect(bagian.reduce((n, b) => n + Math.round(Number(b.amount) * 100), 0)).toBe(100_000_00);
    const elorae = bagian.find((b) => b.bearer === "ELORAE");
    expect(elorae?.settledAt).not.toBeNull();

    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id } });
    expect(loss.decisionNote).toBe("ditanggung SPG\nKeringanan diskon pegawai 20%: Rp 20.001 ditanggung Elorae.");
    expect(Number(loss.totalAmount)).toBe(100_000);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "STOCK_LOSS_DECIDED" } });
    expect(jejak.reason).toBe(loss.decisionNote);
    expect((jejak.metadata as { keringanan: unknown }).keringanan).toEqual({
      persen: 20,
      diserap: 20_001,
      sebelum: [
        { bearer: "SPG", bearerUserId: spgA, amount: 66_666.67 },
        { bearer: "SPG", bearerUserId: spgB, amount: 33_333.33 },
      ],
      perOrang: [
        { bearer: "SPG", bearerUserId: spgA, sebelum: 66_666.67, sesudah: 53_333 },
        { bearer: "SPG", bearerUserId: spgB, sebelum: 33_333.33, sesudah: 26_666 },
      ],
    });
    expect(kabar.kirim.map((k) => k.userId).sort()).toEqual([spgA, spgB].sort());
    expect(kabar.kirim.every((k) => k.isi.includes("sudah termasuk keringanan diskon pegawai 20%"))).toBe(true);

    // Rincian kantor dan HP membaca keringanan dari jejak keputusan.
    const rincian = await rincianHilangKantor(id);
    expect(rincian?.keringanan).toMatchObject({ persen: 20, diserap: 20_001 });
    expect((await bebanHilangSaya(spgA)).map((b) => [b.nilai, b.keringananPersen])).toEqual([[53_333, 20]]);
    expect(JSON.stringify(await bebanHilangSaya(spgA))).not.toContain("66666");

    // Ubah tanpa keringanan: pembagian penuh, keringanan hilang dari rincian dan HP.
    const ubah = await ubahKeputusanHilang({
      lossId: id,
      bagian: [{ bearer: "SPG", bearerUserId: spgA, amount: 100_000 }],
      catatan: "keringanan dicabut",
      olehUserId: kantor,
    });
    expect(ubah).toEqual({ ok: true, id, status: "DITETAPKAN" });
    expect((await bagianDari(id)).map((b) => [b.bearer, Number(b.amount)])).toEqual([["SPG", 100_000]]);
    expect((await rincianHilangKantor(id))?.keringanan).toBeNull();
    expect((await bebanHilangSaya(spgA)).map((b) => [b.nilai, b.keringananPersen])).toEqual([[100_000, null]]);
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id } })).decisionNote).toBe("keringanan dicabut");
  });

  it("keringanan: digabung ke bagian Elorae yang ada; 0 = tanpa keringanan; ditolak tanpa bagian orang atau persen tidak sah", async () => {
    const id = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    expect(await putuskan(id, [{ bearer: "TOKO", amount: 80_000 }], { keringananPersen: 20 })).toEqual({ ok: false, kode: "KERINGANAN_TANPA_ORANG" });
    for (const salah of [12.5, 101, -1, "20"]) {
      expect(await putuskan(id, [{ bearer: "SPG", bearerUserId: spgA, amount: 80_000 }], { keringananPersen: salah })).toEqual({
        ok: false,
        kode: "KERINGANAN_TIDAK_SAH",
      });
    }
    expect(await prisma.stockLossShare.count({ where: { lossId: seededId(id) } })).toBe(0);

    expect(
      await putuskan(
        id,
        [
          { bearer: "SALES", bearerUserId: sales, amount: 50_000 },
          { bearer: "ELORAE", amount: 30_000 },
        ],
        { keringananPersen: 10 },
      ),
    ).toEqual({ ok: true, id, status: "DITETAPKAN" });
    expect((await bagianDari(id)).map((b) => [b.bearer, Number(b.amount)]).sort()).toEqual(
      [
        ["ELORAE", 35_000],
        ["SALES", 45_000],
      ].sort(),
    );
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id } })).decisionNote).toBe("Keringanan diskon pegawai 10%: Rp 5.000 ditanggung Elorae.");

    // Persen 0 = tanpa keringanan: tidak ada metadata keringanan.
    const id2 = await buka(tokoKonsi, [{ itemId: kemeja, variantSku: "", qty: 1 }]);
    expect(await putuskan(id2, [{ bearer: "SPG", bearerUserId: spgA, amount: 80_000 }], { keringananPersen: 0 })).toMatchObject({ ok: true });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id2, action: "STOCK_LOSS_DECIDED" } });
    expect((jejak.metadata as Record<string, unknown>).keringanan).toBeUndefined();
    expect(Number((await bagianDari(id2))[0].amount)).toBe(80_000);
  });

  it("kantor: daftar tersaring dan rincian membawa bagian, potongan, dan riwayat", async () => {
    const id = await buka(tokoPutus, [{ itemId: kemeja, variantSku: "", qty: 2 }]);
    const daftar = await daftarHilangKantor({ status: "TERBUKA", storeId: tokoPutus, sumber: "MANUAL" });
    expect(daftar.baris.map((b) => b.id)).toEqual([id]);
    expect(daftar.perStatus.TERBUKA).toBe(1);
    expect(daftar.toko.some((t) => t.id === tokoPutus)).toBe(true);
    expect((await daftarHilangKantor({ status: "SELESAI", storeId: tokoPutus, sumber: null })).baris).toHaveLength(0);

    await putuskan(id, [{ bearer: "TOKO", amount: 100_000 }, { bearer: "ELORAE", amount: 60_000 }]);
    const r = await rincianHilangKantor(id);
    expect(r).toMatchObject({ status: "DITETAPKAN", sumber: "MANUAL", totalQty: 2, total: 160_000, nilaiBarang: 160_000, terkunci: false, tautanSumber: null });
    expect(r?.bagian.map((b) => [b.bearer, b.nilai, b.lunas])).toEqual(
      expect.arrayContaining([
        ["TOKO", 100_000, false],
        ["ELORAE", 60_000, true],
      ]),
    );
    expect(r?.riwayat.map((j) => j.action)).toEqual(["STOCK_LOSS_OPENED", "STOCK_LOSS_DECIDED"]);
  });
});
