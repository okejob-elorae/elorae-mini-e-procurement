import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Mutasi antar toko dari antrean HP (diajukan / ditandai dikirim tanpa sinyal),
 * terhadap basis data uji: kunci kiriman diperiksa PALING DULU (kiriman ulang —
 * juga yang bersamaan — tidak pernah menggandakan mutasi atau buku stok),
 * pekerjaan bertanggal waktu tangkapnya, kunjungannya boleh sudah check-out,
 * barang yang sudah dihitung opname yang lebih baru tidak dikurangi lagi, dan
 * mutasi yang sementara itu berubah ditolak dengan kode yang menyebut sebabnya.
 *
 * Kait sesudah transaksi (titip pesan, barang hilang) ditirukan. Semua baris
 * milik fixture bertag acak; teardown hanya lewat id yang diseed
 * (`seededId`/`seededIds`). Pengaturan `spg.mutasi` dipotret dan dikembalikan.
 */

vi.mock("./titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => undefined) }));
vi.mock("./hilang-sumber", () => ({
  catatHilangDariOpname: vi.fn(async () => undefined),
  catatHilangDariPenerimaan: vi.fn(async () => undefined),
  catatHilangDariMutasi: vi.fn(async () => undefined),
}));

const { ajukanMutasi, batalkanMutasi, kirimMutasi, setujuiMutasi, tolakMutasi } = await import("./mutasi-writer");
const { terimaKiriman } = await import("./stok-writer");
const { KUNCI_ATURAN_MUTASI, bulanWib } = await import("./mutasi-aturan");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `MTL-${Math.random().toString(36).slice(2, 9)}`;
const JAM = 3_600_000;
const HARI = 24 * JAM;

d("mutasi antar toko dari antrean HP (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let asal = "";
  let tujuan = "";
  let spgAsal = "";
  let spgAsal2 = "";
  let spgTujuan = "";
  let kantor = "";
  /** Kunjungan SPG asal yang sudah check-out — antrean HP terikat ke sini. */
  let kunjunganTutup = "";
  /** Kunjungan SPG asal kedua (masih terbuka). */
  let kunjunganAsal2 = "";
  /** Kunjungan SPG tujuan — bukan milik SPG asal. */
  let kunjunganTujuan = "";
  const kunjungan: string[] = [];
  const siklus: string[] = [];
  let setelanAwal: string | null = null;
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  const tokoIds = () => seededIds([asal, tujuan].filter(Boolean));
  const userIds = () => seededIds([spgAsal, spgAsal2, spgTujuan, kantor].filter(Boolean));
  const itemIds = () => seededIds([kaos, kemeja].filter(Boolean));
  const kaosM = () => `${tag}-KAOS-M`;

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_MUTASI }, select: { value: true } });
    setelanAwal = ada?.value ?? null;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Luring",
          nameEn: "Offline tee",
          type: "FINISHED_GOOD",
          uomId,
          variants: [{ sku: `${tag}-KAOS-M`, size: "M" }],
        },
      })
    ).id;
    kemeja = (await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Luring", nameEn: "Offline shirt", type: "FINISHED_GOOD", uomId } })).id;

    const toko = async (kode: string) =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    asal = await toko("ASAL");
    tujuan = await toko("TUJUAN");

    const pengguna = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    spgAsal = await pengguna("spg-asal", asal);
    spgAsal2 = await pengguna("spg-asal2", asal);
    spgTujuan = await pengguna("spg-tujuan", tujuan);
    kantor = await pengguna("kantor", null);

    const masuk = async (storeId: string, userId: string, checkoutAt: Date | null) => {
      const id = (
        await prisma.storeVisit.create({
          data: { storeId, userId, checkinLat: -6.2, checkinLng: 106.8, checkinAt: new Date(Date.now() - 6 * JAM), checkoutAt },
        })
      ).id;
      kunjungan.push(id);
      return id;
    };
    // SPG asal: satu kunjungan terbuka (jalur dengan sinyal) dan satu yang sudah check-out (antrean HP).
    await masuk(asal, spgAsal, null);
    kunjunganTutup = await masuk(asal, spgAsal, new Date(Date.now() - 30 * 60_000));
    kunjunganAsal2 = await masuk(asal, spgAsal2, null);
    kunjunganTujuan = await masuk(tujuan, spgTujuan, null);
  });

  beforeEach(async () => {
    await aturan({});
    // Buku toko asal dimulai 5 jam lalu: kaos M 10, kemeja 5.
    const awal = new Date(Date.now() - 5 * JAM);
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: asal, itemId: kaos, variantSku: kaosM(), qty: 10, kind: "OPNAME", createdById: spgAsal, createdAt: awal },
        { storeId: asal, itemId: kemeja, variantSku: "", qty: 5, kind: "OPNAME", createdById: spgAsal, createdAt: awal },
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
    await prisma.storeOpname.deleteMany({ where: { storeId: { in: tokoIds() } } });
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

  const saldo = async (itemId: string, variantSku: string) =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId: asal, itemId, variantSku }, _sum: { qty: true } }))._sum.qty ?? 0;

  const keluar = (transferId: string) =>
    prisma.storeStockMovement.findMany({
      where: { refType: "StoreTransfer", refId: transferId, kind: "MUTASI_KELUAR" },
      select: { itemId: true, qty: true, createdAt: true },
      orderBy: { qty: "asc" },
    });

  const barisBaku = () => [
    { itemId: kaos, variantSku: kaosM(), qty: 3 },
    { itemId: kemeja, variantSku: "", qty: 2 },
  ];

  /** Ajuan dari antrean HP: terikat kunjungan yang sudah check-out, bertanggal `waktu`. */
  const ajukanLuring = (ubah: Partial<Parameters<typeof ajukanMutasi>[0]> = {}) =>
    ajukanMutasi({
      userId: spgAsal,
      fromStoreId: asal,
      toStoreId: tujuan,
      alasan: "Stok di sana habis",
      baris: barisBaku(),
      idempotencyKey: kunci(),
      kunjunganId: kunjunganTutup,
      waktuTangkap: new Date(Date.now() - 2 * JAM),
      ...ubah,
    });

  /** Mutasi yang sudah disetujui kantor (diajukan dengan sinyal). */
  async function disetujui(): Promise<{ id: string; docNo: string }> {
    const a = await ajukanMutasi({
      userId: spgAsal,
      fromStoreId: asal,
      toStoreId: tujuan,
      alasan: "Pindah rak",
      baris: barisBaku(),
      idempotencyKey: kunci(),
    });
    if (!a.ok) throw new Error(`ajukan gagal: ${a.kode}`);
    const s = await setujuiMutasi({ transferId: a.id, olehUserId: kantor });
    if (!s.ok) throw new Error(`setujui gagal: ${s.kode}`);
    return { id: a.id, docNo: a.docNo };
  }

  /** Tanda dikirim dari antrean HP. */
  const kirimLuring = (transferId: string, ubah: Partial<Parameters<typeof kirimMutasi>[0]> = {}) =>
    kirimMutasi({
      transferId,
      userId: spgAsal,
      storeId: asal,
      idempotencyKey: kunci(),
      kunjunganId: kunjunganTutup,
      waktuTangkap: new Date(Date.now() - JAM),
      ...ubah,
    });

  // ─── Mengajukan dari antrean ────────────────────────────────────────────────

  it("records a queued request at its capture time on a checked-out visit, and a resend returns the same transfer", async () => {
    const waktu = new Date(Date.now() - 2 * JAM);
    const k = kunci();
    const a = await ajukanLuring({ idempotencyKey: k, waktuTangkap: waktu });
    expect(a).toMatchObject({ ok: true, status: "DIAJUKAN", ulang: false });
    if (!a.ok) return;
    const m = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: a.id }, select: { createdAt: true, idempotencyKey: true } });
    expect(m).toEqual({ createdAt: waktu, idempotencyKey: k });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "StoreTransfer", entityId: a.id }, select: { metadata: true } });
    expect(jejak.metadata).toMatchObject({ luring: true, waktuTangkap: waktu.toISOString() });

    // Jawaban hilang di jalan → antrean mengirim ulang: mutasi yang sama, tanpa dokumen kedua.
    expect(await ajukanLuring({ idempotencyKey: k, waktuTangkap: waktu })).toMatchObject({ ok: true, id: a.id, ulang: true });
    // Kunci diperiksa PALING DULU: antrean yang kini terlalu tua tetap terbaca berhasil.
    expect(await ajukanLuring({ idempotencyKey: k, waktuTangkap: new Date(Date.now() - 20 * HARI) })).toMatchObject({ ok: true, id: a.id, ulang: true });
    expect(await prisma.storeTransfer.count({ where: { idempotencyKey: k } })).toBe(1);
    // Mengajukan tidak menggerakkan stok.
    expect(await saldo(kaos, kaosM())).toBe(10);
  });

  it("refuses a queued request that is too old, or bound to a visit that is not the SPG's own at that store", async () => {
    expect(await ajukanLuring({ waktuTangkap: new Date(Date.now() - 20 * HARI) })).toEqual({ ok: false, kode: "WAKTU_TIDAK_VALID" });
    expect(await ajukanLuring({ kunjunganId: kunjunganTujuan })).toEqual({ ok: false, kode: "TANPA_KUNJUNGAN" });
    expect(await ajukanLuring({ kunjunganId: kunjunganAsal2 })).toEqual({ ok: false, kode: "TANPA_KUNJUNGAN" });
    expect(await prisma.storeTransfer.count({ where: { fromStoreId: asal } })).toBe(0);
  });

  it("two sends of the same queued request at the same moment record one transfer, and both are told so", async () => {
    const k = kunci();
    const hasil = await Promise.all([ajukanLuring({ idempotencyKey: k }), ajukanLuring({ idempotencyKey: k })]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(new Set(hasil.map((h) => (h.ok ? h.id : ""))).size).toBe(1);
    expect(hasil.filter((h) => h.ok && !h.ulang)).toHaveLength(1);
    expect(await prisma.storeTransfer.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it("judges a queued request's balance as of its capture time (saldo TOLAK), not after later sales", async () => {
    await aturan({ saldo: "TOLAK" });
    // Kemeja 5 di buku 5 jam lalu; 4 terjual SESUDAH ajuan (1 jam lalu).
    await prisma.storeStockMovement.create({
      data: { storeId: asal, itemId: kemeja, variantSku: "", qty: -4, kind: "JUAL", createdById: spgAsal, createdAt: new Date(Date.now() - JAM) },
    });
    const baris = [{ itemId: kemeja, variantSku: "", qty: 3 }];
    expect(await ajukanLuring({ baris, waktuTangkap: new Date(Date.now() - 2 * JAM) })).toMatchObject({ ok: true, kurangSaldo: [] });
    // Diajukan dengan sinyal sekarang: saldonya 1 — ditolak, dengan nama barangnya.
    const sekarang = await ajukanMutasi({ userId: spgAsal, fromStoreId: asal, toStoreId: tujuan, alasan: "x", baris, idempotencyKey: kunci() });
    expect(sekarang).toMatchObject({ ok: false, kode: "SALDO_KURANG", kurang: [{ itemId: kemeja, productName: "Kemeja Luring" }] });
  });

  // ─── Ditandai dikirim dari antrean ─────────────────────────────────────────

  it("ships a queued mark at its capture time; a resend of the same mark is ok even after the transfer was received", async () => {
    const m = await disetujui();
    const waktu = new Date(Date.now() - JAM);
    const k = kunci();
    expect(await kirimLuring(m.id, { idempotencyKey: k, waktuTangkap: waktu })).toMatchObject({ ok: true, status: "DIKIRIM", ulang: false });
    const t = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: m.id }, select: { status: true, shippedAt: true, shippedById: true } });
    expect(t).toEqual({ status: "DIKIRIM", shippedAt: waktu, shippedById: spgAsal });
    expect((await keluar(m.id)).map((g) => g.createdAt.getTime())).toEqual([waktu.getTime(), waktu.getTime()]);
    expect(await saldo(kaos, kaosM())).toBe(7);
    expect(await saldo(kemeja, "")).toBe(3);
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "StoreTransfer", entityId: m.id, action: "STORE_TRANSFER_SHIPPED" },
      select: { metadata: true },
    });
    expect(jejak.metadata).toMatchObject({ kunciKirim: k, luring: true, dilewatiOpname: 0 });

    // Toko tujuan menerimanya; lalu antrean HP mengirim ulang tanda yang sama.
    const baris = await prisma.storeTransferLine.findMany({ where: { transferId: m.id }, select: { id: true, qty: true } });
    const r = await terimaKiriman({
      storeId: tujuan,
      userId: spgTujuan,
      sourceType: "MUTASI",
      sourceId: m.id,
      diterima: baris.map((b) => ({ lineId: b.id, qtyReceived: b.qty })),
    });
    expect(r.ok).toBe(true);
    expect(await kirimLuring(m.id, { idempotencyKey: k, waktuTangkap: new Date(Date.now() - 20 * HARI) })).toMatchObject({
      ok: true,
      status: "DITERIMA",
      ulang: true,
    });
    expect(await keluar(m.id)).toHaveLength(2);
    expect(await saldo(kaos, kaosM())).toBe(7);
  });

  it("a queued mark with another key from the SPG who already shipped it is accepted without writing anything", async () => {
    const m = await disetujui();
    // Ditandai dengan sinyal (kunjungan terbuka) …
    expect(await kirimMutasi({ transferId: m.id, userId: spgAsal, storeId: asal, idempotencyKey: kunci() })).toMatchObject({ ok: true, ulang: false });
    // … lalu tanda kedua dari antrean HP yang sama (kunci lain).
    expect(await kirimLuring(m.id)).toMatchObject({ ok: true, status: "DIKIRIM", ulang: true });
    expect(await keluar(m.id)).toHaveLength(2);
  });

  it("two sends of the same queued mark at the same moment move the book once", async () => {
    const m = await disetujui();
    const k = kunci();
    const hasil = await Promise.all([kirimLuring(m.id, { idempotencyKey: k }), kirimLuring(m.id, { idempotencyKey: k })]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(hasil.filter((h) => h.ok && !h.ulang)).toHaveLength(1);
    expect(await keluar(m.id)).toHaveLength(2);
    expect(await saldo(kemeja, "")).toBe(3);
  });

  it("two SPGs marking the same transfer shipped at the same moment: one wins, the other is told it was already shipped", async () => {
    const m = await disetujui();
    const hasil = await Promise.all([
      kirimLuring(m.id),
      kirimLuring(m.id, { userId: spgAsal2, kunjunganId: kunjunganAsal2 }),
    ]);
    const menang = hasil.filter((h) => h.ok);
    expect(menang).toHaveLength(1);
    expect(menang[0]).toMatchObject({ ulang: false });
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIKIRIM" }]);
    expect(await keluar(m.id)).toHaveLength(2);
    expect(await saldo(kaos, kaosM())).toBe(7);
  });

  it("goods counted by a store opname newer than the ship time get no MUTASI_KELUAR row", async () => {
    const m = await disetujui();
    // Rak dihitung 1 jam lalu — SESUDAH barang ditandai dikirim (2 jam lalu) — dan hanya kaos yang dihitung.
    await prisma.storeOpname.create({
      data: {
        storeId: asal,
        countedById: spgAsal,
        countedAt: new Date(Date.now() - JAM),
        lines: { create: [{ itemId: kaos, variantSku: kaosM(), productName: "Kaos Luring — M", qtySystem: 10, qtyCounted: 7 }] },
      },
    });
    const r = await kirimLuring(m.id, { waktuTangkap: new Date(Date.now() - 2 * JAM) });
    expect(r).toMatchObject({ ok: true, status: "DIKIRIM" });
    expect((await keluar(m.id)).map((g) => g.itemId)).toEqual([kemeja]);
    // Opname itu sudah tanpa kaos ini: bukunya tidak dikurangi lagi.
    expect(await saldo(kaos, kaosM())).toBe(10);
    expect(await saldo(kemeja, "")).toBe(3);
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "StoreTransfer", entityId: m.id, action: "STORE_TRANSFER_SHIPPED" },
      select: { metadata: true },
    });
    expect(jejak.metadata).toMatchObject({ dilewatiOpname: 1 });
  });

  it("an opname OLDER than the ship time does not stop the book row", async () => {
    const m = await disetujui();
    await prisma.storeOpname.create({
      data: {
        storeId: asal,
        countedById: spgAsal,
        countedAt: new Date(Date.now() - 3 * JAM),
        lines: { create: [{ itemId: kaos, variantSku: kaosM(), productName: "Kaos Luring — M", qtySystem: 10, qtyCounted: 10 }] },
      },
    });
    expect(await kirimLuring(m.id, { waktuTangkap: new Date(Date.now() - 2 * JAM) })).toMatchObject({ ok: true });
    expect(await keluar(m.id)).toHaveLength(2);
    expect(await saldo(kaos, kaosM())).toBe(7);
  });

  it("stops a queued mark with a reason that says what happened meanwhile, and moves no stock", async () => {
    // Ditolak kantor.
    const a = await ajukanMutasi({ userId: spgAsal, fromStoreId: asal, toStoreId: tujuan, alasan: "x", baris: barisBaku(), idempotencyKey: kunci() });
    if (!a.ok) throw new Error("ajukan");
    expect(await kirimLuring(a.id)).toEqual({ ok: false, kode: "BELUM_DISETUJUI" });
    await tolakMutasi({ transferId: a.id, olehUserId: kantor, alasan: "Toko tujuan tutup" });
    expect(await kirimLuring(a.id)).toEqual({ ok: false, kode: "MUTASI_DITOLAK" });
    // Dengan sinyal, kode lamanya tetap.
    expect(await kirimMutasi({ transferId: a.id, userId: spgAsal, storeId: asal })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });

    // Dibatalkan sebelum tandanya sampai.
    const b = await disetujui();
    expect((await batalkanMutasi({ transferId: b.id, olehUserId: spgAsal, sebagai: "SPG", storeId: asal })).ok).toBe(true);
    expect(await kirimLuring(b.id)).toEqual({ ok: false, kode: "MUTASI_DIBATALKAN" });

    // Siklus konsinyasi bulan tanda itu sudah dikunci.
    const c = await disetujui();
    const waktu = new Date(Date.now() - JAM);
    const { tahun, bulan } = bulanWib(waktu);
    siklus.push(
      (
        await prisma.consignmentCycle.create({
          data: { noKonsi: `${tag}-K1`, storeId: asal, periodYear: tahun, periodMonth: bulan, lockedAt: new Date(), lockedById: kantor },
        })
      ).id,
    );
    expect(await kirimLuring(c.id, { waktuTangkap: waktu })).toEqual({ ok: false, kode: "SIKLUS_TERKUNCI", noKonsi: [`${tag}-K1`] });

    // Terlalu lama tertahan.
    expect(await kirimLuring(c.id, { waktuTangkap: new Date(Date.now() - 20 * HARI) })).toEqual({ ok: false, kode: "WAKTU_TIDAK_VALID" });

    expect(await saldo(kaos, kaosM())).toBe(10);
    expect(await saldo(kemeja, "")).toBe(5);
    expect(await prisma.storeStockMovement.count({ where: { storeId: asal, kind: "MUTASI_KELUAR" } })).toBe(0);
  });

  it("refuses a queued mark bound to someone else's visit", async () => {
    const m = await disetujui();
    expect(await kirimLuring(m.id, { kunjunganId: kunjunganAsal2 })).toEqual({ ok: false, kode: "TANPA_KUNJUNGAN" });
    expect(await kirimLuring(m.id, { kunjunganId: kunjunganTujuan })).toEqual({ ok: false, kode: "TANPA_KUNJUNGAN" });
    expect(await keluar(m.id)).toHaveLength(0);
  });
});
