import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { recordSpgSale } from "./sale-writer";
import {
  batalkanPenolakanReturPembeli,
  catatReturPembeli,
  catatUangDikembalikan,
  kembaliPerNota,
  notaUntukKembali,
  putuskanBarangReturPembeli,
  rapikanBarisReturPembeli,
  setujuiReturPembeli,
  tarikReturPembeli,
  tolakReturPembeli,
} from "./retur-pembeli";
import { barangDisisihkan, returPembeliSaya, rincianReturPembeliKantor } from "./retur-pembeli-queries";
import { wibYearMonth } from "@/lib/spg-commission/month";
import { catatBebanDipotong, catatPengembalianBebanDibayar, ubahBesarBebanSpg } from "./beban-spg-writer";
import { folderFotoReturPembeli } from "./foto-retur-pembeli-kunci";
import { urlFotoReturPembeli } from "./foto-retur-pembeli";
import { JEJAK } from "@/lib/receivables/jejak";
import { KATEGORI_NOTIF_RETUR_PEMBELI } from "./retur-pembeli-status";
import { qtyDitahanBebanPerBaris, qtyMenungguPerBaris } from "./retur-pembeli-berlaku";

describe("rapikanBarisReturPembeli", () => {
  it("merges the same sale line + condition and drops zero quantities", () => {
    expect(
      rapikanBarisReturPembeli([
        { saleLineId: "a", qty: 1 },
        { saleLineId: "a", qty: 2, condition: "LAYAK" },
        { saleLineId: "a", qty: 1, condition: "RUSAK" },
        { saleLineId: "b", qty: 0 },
      ]),
    ).toEqual({
      ok: true,
      baris: [
        { saleLineId: "a", qty: 3, condition: "LAYAK" },
        { saleLineId: "a", qty: 1, condition: "RUSAK" },
      ],
    });
  });

  it("refuses fractional or negative quantities, and an empty list", () => {
    expect(rapikanBarisReturPembeli([{ saleLineId: "a", qty: 1.5 }])).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisReturPembeli([{ saleLineId: "a", qty: -1 }])).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisReturPembeli([])).toEqual({ ok: false, alasan: "TANPA_BARIS" });
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Terhadap basis data sungguhan: lapor → putuskan. Melapor (foto barang +
 * jawaban uang) tidak mengubah apa pun; menyetujui menerapkan buku stok toko,
 * `returnedQty`, `SalesHistory`, dan jejak sekali; menolak tanpa uang dan
 * menarik tidak menerapkan apa pun; menolak padahal uangnya sudah dikembalikan
 * membuat SATU beban SPG; pembatalan penolakan (P82) dan keputusan barang (P79)
 * membuka laporan yang dibebankan; penjaga sisa, uang, dan keputusan di bawah
 * balapan. SPG DIPINJAM; dua pengguna kantor dibuat tes ini.
 * Penghapusan hanya lewat `seededId()`/`seededIds()`.
 */
d("retur pembeli: lapor lalu putuskan (test bed only)", () => {
  const tag = `RPB-${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let spgId = "";
  let lainId = "";
  let kantorA = "";
  let kantorB = "";
  let storeId = "";
  let tokoLainId = "";
  let saleIds: string[] = [];
  let returIds: string[] = [];
  let debtIds: string[] = [];

  beforeAll(async () => {
    kantorA = "";
    kantorB = "";
    const buat = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    kantorA = await buat("kantor-a");
    kantorB = await buat("kantor-b");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([kantorA, kantorB].filter(Boolean)) } } });
  });

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    spgId = "";
    lainId = "";
    storeId = "";
    tokoLainId = "";
    saleIds = [];
    returIds = [];
    debtIds = [];

    const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
    if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
    spgId = orang[0].id;
    lainId = orang[1].id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: tag,
          nameId: `Kaos ${tag}`,
          nameEn: "Tee",
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          sellingPrice: 50_000,
          variants: [{ sku: `${tag}-M`, size: "M" }],
        },
      })
    ).id;
    const buat = (akhiran: string) =>
      prisma.store.create({ data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType: "KONSI", markupPercent: 20, isActive: true } });
    storeId = (await buat("A")).id;
    tokoLainId = (await buat("B")).id;
  });

  afterEach(async () => {
    const retur = () => returIds.filter(Boolean);
    if (retur().length) {
      // Beban SPG laporan uji (dicari dari laporannya) pergi lebih dulu, dengan potongan dan jejaknya.
      const beban = (await prisma.spgCharge.findMany({ where: { sourceId: { in: seededIds(retur()) } }, select: { id: true } })).map((c) => c.id);
      if (beban.length) {
        await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(beban) } } });
        await prisma.spgChargeDeduction.deleteMany({ where: { chargeId: { in: seededIds(beban) } } });
        await prisma.spgCharge.deleteMany({ where: { id: { in: seededIds(beban) } } });
      }
      if (debtIds.length) await prisma.spgDebt.deleteMany({ where: { id: { in: seededIds(debtIds.filter(Boolean)) } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(retur()) } } });
      // Lonceng kantor laporan uji — dicocokkan di JS lewat metadata (jalur JSON tidak andal lintas adaptor).
      const lonceng = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RETUR_PEMBELI }, select: { id: true, metadata: true } });
      const milikUji = lonceng
        .filter((n) => {
          const m = n.metadata as Record<string, unknown> | null;
          return typeof m?.returnId === "string" && retur().includes(m.returnId);
        })
        .map((n) => n.id);
      await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    }
    const toko = () => [storeId, tokoLainId].filter(Boolean).map(seededId);
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: toko() } } });
    await prisma.storeOpname.deleteMany({ where: { storeId: { in: toko() } } });
    // Kedua toko konsinyasi: nota menggerakkan kartu stok toko (`StoreStock` + buku stok). Baris itu
    // pergi lebih dulu: Restrict tiruan menolak menghapus barang dan toko yang masih dirujuknya.
    await prisma.storeStock.deleteMany({ where: { storeId: { in: toko() } } });
    const nota = () => saleIds.filter(Boolean).map(seededId);
    if (nota().length) {
      await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: nota() } } });
      await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: nota() } }, select: { id: true } })).map((x) => x.id) } } });
      await prisma.spgSale.deleteMany({ where: { id: { in: nota() } } });
    }
    if (itemId) {
      await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (toko().length) await prisma.store.deleteMany({ where: { id: { in: toko() } } });
  });

  async function jual(qty: number) {
    const h = await recordSpgSale({ salesmanId: spgId, storeId, lines: [{ itemId, variantSku: `${tag}-M`, qty }] });
    if (!h.ok) throw new Error(`jual gagal: ${h.code}`);
    saleIds.push(h.spgSaleId);
    const line = await prisma.spgSaleLine.findFirstOrThrow({ where: { spgSaleId: seededId(h.spgSaleId) } });
    return { saleId: h.spgSaleId, docNo: h.docNo, lineId: line.id };
  }

  type Baris = { saleLineId: string; qty: number; condition?: "LAYAK" | "RUSAK" };
  /** Kunci R2 foto laporan berkunci `kunci` di toko `toko` — bentuk yang ditulis rute unggah. */
  const foto = (kunci: string, jenis: "barang" | "struk", toko = storeId) => `${folderFotoReturPembeli(toko, `${tag}-${kunci}`)}/${jenis}.jpg`;
  type Uang = { uangSudah?: boolean | null; fotoBarangKey?: string | null; fotoStrukKey?: string | null; waktuTangkap?: Date | null };
  const lapor = (saleId: string, baris: Baris[], kunci: string, userId = spgId, toko = storeId, uang: Uang = {}) =>
    catatReturPembeli({
      spgSaleId: saleId,
      storeId: toko,
      userId,
      baris,
      alasan: "ukuran tidak pas",
      idempotencyKey: `${tag}-${kunci}`,
      fotoBarangKey: uang.fotoBarangKey === undefined ? foto(kunci, "barang", toko) : uang.fotoBarangKey,
      uangSudahDikembalikan: uang.uangSudah === undefined ? false : uang.uangSudah,
      fotoStrukKey: uang.fotoStrukKey === undefined ? (uang.uangSudah ? foto(kunci, "struk", toko) : null) : uang.fotoStrukKey,
      waktuTangkap: uang.waktuTangkap ?? null,
    }).then((h) => {
      if (h.ok && !returIds.includes(h.returnId)) returIds.push(h.returnId);
      return h;
    });
  const kunciLaporan = async (id: string) => (await prisma.spgSaleReturn.findUniqueOrThrow({ where: { id: seededId(id) } })).idempotencyKey;
  const strukUntuk = async (id: string) => `${folderFotoReturPembeli(storeId, await kunciLaporan(id))}/struk.jpg`;
  const uangKembali = async (id: string, opsi: { key?: string; waktuTangkap?: Date | null; userId?: string } = {}) =>
    catatUangDikembalikan({
      returnId: id,
      userId: opsi.userId ?? spgId,
      storeId,
      fotoStrukKey: opsi.key ?? (await strukUntuk(id)),
      waktuTangkap: opsi.waktuTangkap ?? null,
    });
  const bebanDari = (id: string) => prisma.spgCharge.findUnique({ where: { source_sourceId: { source: "RETUR_PEMBELI", sourceId: seededId(id) } } });
  const jumlahBeban = async (id: string) => Number((await bebanDari(id))!.amount);
  /** Harga bersih per potong baris nota (total baris ÷ qty) — dasar beban (P81). Harga toko konsi dihitung penjual. */
  const hargaPotong = async (lineId: string) => {
    const l = await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    return Number(l.lineTotal) / l.qty;
  };
  const bulat2 = (n: number) => Math.round(n * 100) / 100;
  /** Potong beban penuh dari satu "pembayaran" uji (rujukan bayaran palsu, tanpa baris gaji sungguhan). */
  const lunasiDariBayaran = async (chargeId: string, jumlah: number) =>
    runSerializable((tx) =>
      catatBebanDipotong(tx, {
        olehUserId: kantorA,
        waktu: new Date(),
        bulanBayar: "2026-11",
        potong: [{ chargeId, jumlah, dariKomisi: jumlah, dariGaji: 0, paidRefType: "SpgCommission", paidRefId: `${tag}-bayar-${chargeId}` }],
      }),
    );
  const idDari = (h: Awaited<ReturnType<typeof lapor>>) => {
    if (!h.ok) throw new Error(`lapor gagal: ${h.alasan}`);
    return h.returnId;
  };
  const setujui = (returnId: string, oleh = kantorA) => setujuiReturPembeli({ returnId, olehUserId: oleh });
  const tolak = (returnId: string, alasan = "barang tidak sesuai nota", oleh = kantorA) => tolakReturPembeli({ returnId, olehUserId: oleh, alasan });
  const tarik = (returnId: string, alasan = "salah catat", userId = spgId, toko = storeId) => tarikReturPembeli({ returnId, userId, storeId: toko, alasan });

  const returnedQty = async (lineId: string) => (await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: seededId(lineId) } })).returnedQty;
  /** Potong baris nota yang sudah terhitung — kembali + menunggu + ditahan beban, lewat pembaca penulisnya sendiri. */
  const potongTerhitung = async (lineId: string) => {
    const [menunggu, ditahan] = await Promise.all([qtyMenungguPerBaris(prisma, [seededId(lineId)]), qtyDitahanBebanPerBaris(prisma, [seededId(lineId)])]);
    return (await returnedQty(lineId)) + (menunggu.get(lineId) ?? 0) + (ditahan.get(lineId) ?? 0);
  };
  const bukuRetur = () =>
    prisma.storeStockMovement.findMany({ where: { storeId: seededId(storeId), kind: "RETUR_PEMBELI" }, orderBy: { createdAt: "asc" } });
  const riwayat = async (docNo: string) => {
    const sh = await prisma.salesHistory.findFirstOrThrow({ where: { channel: "OFFLINE", orderId: docNo } });
    return [sh.quantity, sh.returnedQuantity, sh.netQuantity];
  };
  const laporan = (id: string) => prisma.spgSaleReturn.findUniqueOrThrow({ where: { id: seededId(id) } });
  const jejak = (id: string) => prisma.auditLog.findMany({ where: { entityId: seededId(id) }, orderBy: { createdAt: "asc" } });
  const lonceng = async (id: string) =>
    (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RETUR_PEMBELI }, select: { metadata: true } })).filter(
      (n) => (n.metadata as Record<string, unknown> | null)?.returnId === id,
    );

  it("reporting changes nothing: the report is MENUNGGU; stock book, returnedQty and SalesHistory stay as sold", async () => {
    const n = await jual(3);
    const id = idDari(
      await lapor(
        n.saleId,
        [
          { saleLineId: n.lineId, qty: 1, condition: "LAYAK" },
          { saleLineId: n.lineId, qty: 1, condition: "RUSAK" },
        ],
        "a",
      ),
    );

    const r = await laporan(id);
    expect(r.status).toBe("MENUNGGU");
    expect([r.decidedAt, r.decidedById, r.rejectReason]).toEqual([null, null, null]);
    expect(await returnedQty(n.lineId)).toBe(0);
    expect(await prisma.storeStockMovement.count({ where: { refType: "SpgSaleReturn", refId: seededId(id) } })).toBe(0);
    expect(await riwayat(n.docNo)).toEqual([3, 0, 3]);

    expect((await jejak(id)).map((x) => x.action)).toEqual([JEJAK.RETUR_PEMBELI_DILAPORKAN]);
    const l = await lonceng(id);
    expect(l).toHaveLength(1);
    expect(l[0].metadata).toMatchObject({ returnId: id, spgSaleId: n.saleId, storeId, pcs: 2 });
  });

  it("approval applies everything once, dated at the report: returnedQty, RETUR_PEMBELI for sellable goods only, SalesHistory, audit", async () => {
    const n = await jual(3);
    const id = idDari(
      await lapor(
        n.saleId,
        [
          { saleLineId: n.lineId, qty: 1, condition: "LAYAK" },
          { saleLineId: n.lineId, qty: 1, condition: "RUSAK" },
        ],
        "a",
      ),
    );
    const dilaporkan = (await laporan(id)).createdAt;
    await tunda(20);

    expect(await setujui(id)).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, status: "DISETUJUI" });
    const r = await laporan(id);
    expect(r.status).toBe("DISETUJUI");
    expect(r.decidedById).toBe(kantorA);
    expect(r.decidedAt).not.toBeNull();
    expect(await returnedQty(n.lineId)).toBe(2);
    const buku = await bukuRetur();
    expect(buku.map((b) => [b.qty, b.variantSku])).toEqual([[1, `${tag}-M`]]);
    // Bertanggal saat DILAPORKAN, bukan saat disetujui; atas nama SPG pelapornya.
    expect(buku[0].createdAt.getTime()).toBe(dilaporkan.getTime());
    expect(buku[0].createdById).toBe(spgId);
    expect(await riwayat(n.docNo)).toEqual([3, 2, 1]);
    const setuju = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_DISETUJUI);
    expect(setuju).toHaveLength(1);
    expect(setuju[0].changes).toMatchObject({
      before: { status: "MENUNGGU", returnedQty: { [n.lineId]: 0 } },
      after: { status: "DISETUJUI", returnedQty: { [n.lineId]: 2 } },
    });
    expect(setuju[0].metadata).toMatchObject({ bukuDitulis: 1, uangSudahDikembalikan: false });

    // Persetujuan kedua tidak menerapkan apa pun.
    expect(await setujui(id, kantorB)).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await returnedQty(n.lineId)).toBe(2);
    expect(await bukuRetur()).toHaveLength(1);
    expect(await riwayat(n.docNo)).toEqual([3, 2, 1]);
  });

  it("rejecting needs a reason and applies nothing; the pieces become reportable again", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "a"));
    expect(await tolak(id, "   ")).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await tolak(id, "x".repeat(501))).toEqual({ ok: false, alasan: "ALASAN_TERLALU_PANJANG" });
    expect((await laporan(id)).status).toBe("MENUNGGU");

    expect(await tolak(id, "pembeli tidak membawa barangnya")).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, status: "DITOLAK" });
    const r = await laporan(id);
    expect([r.status, r.rejectReason, r.decidedById]).toEqual(["DITOLAK", "pembeli tidak membawa barangnya", kantorA]);
    expect(await returnedQty(n.lineId)).toBe(0);
    expect(await bukuRetur()).toHaveLength(0);
    expect(await riwayat(n.docNo)).toEqual([2, 0, 2]);
    const tolakan = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_DITOLAK);
    expect(tolakan).toHaveLength(1);
    expect(tolakan[0].reason).toBe("pembeli tidak membawa barangnya");

    // Ditolak itu final; potongnya lepas lagi.
    expect(await setujui(id)).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect((await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "b")).ok).toBe(true);
  });

  it("pending pieces count against what is left: the same pieces cannot be reported twice", async () => {
    const n = await jual(2);
    const a = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "a"));
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "b")).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect((await tolak(a)).ok).toBe(true);
    expect((await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "c")).ok).toBe(true);
  });

  it("race: two phones reporting the same line at once cannot both exceed what was sold", async () => {
    const n = await jual(3);
    const [a, b] = await Promise.all([
      lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "a"),
      lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "b"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    const menunggu = await prisma.spgSaleReturnLine.aggregate({
      where: { spgSaleLineId: seededId(n.lineId), saleReturn: { status: "MENUNGGU" } },
      _sum: { qty: true },
    });
    expect(menunggu._sum.qty).toBe(2);
    expect(await returnedQty(n.lineId)).toBe(0);
  });

  it("race: approve vs reject of the same report — exactly one wins, effects exist iff approval won", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "a"));
    // Tolak lebih pendek: dimulai sedikit belakangan supaya tidak selalu menang lebih dulu.
    const [s, t] = await Promise.all([setujui(id, kantorA), tunda(5).then(() => tolak(id, "dobel", kantorB))]);
    expect([s.ok, t.ok].filter(Boolean)).toHaveLength(1);
    expect([s, t].find((x) => !x.ok)).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    const putusan = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_DISETUJUI || x.action === JEJAK.RETUR_PEMBELI_DITOLAK);
    expect(putusan).toHaveLength(1);
    if (s.ok) {
      expect((await laporan(id)).status).toBe("DISETUJUI");
      expect(await returnedQty(n.lineId)).toBe(1);
      expect(await bukuRetur()).toHaveLength(1);
      expect(await riwayat(n.docNo)).toEqual([3, 1, 2]);
    } else {
      expect((await laporan(id)).status).toBe("DITOLAK");
      expect(await returnedQty(n.lineId)).toBe(0);
      expect(await bukuRetur()).toHaveLength(0);
      expect(await riwayat(n.docNo)).toEqual([3, 0, 3]);
    }
  });

  it("race: two office users approving at once apply the effects once", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2, condition: "LAYAK" }], "a"));
    const [a, b] = await Promise.all([setujui(id, kantorA), setujui(id, kantorB)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await returnedQty(n.lineId)).toBe(2);
    expect((await bukuRetur()).map((x) => x.qty)).toEqual([2]);
    expect(await riwayat(n.docNo)).toEqual([3, 2, 1]);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_DISETUJUI)).toHaveLength(1);
  });

  it("race: approve vs the SPG withdrawing — one wins, effects exist iff approval won", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "a"));
    const [s, w] = await Promise.all([setujui(id), tunda(5).then(() => tarik(id))]);
    expect([s.ok, w.ok].filter(Boolean)).toHaveLength(1);
    const r = await laporan(id);
    if (s.ok) {
      expect(r.status).toBe("DISETUJUI");
      expect(await returnedQty(n.lineId)).toBe(1);
      expect(await bukuRetur()).toHaveLength(1);
    } else {
      expect(r.status).toBe("DIBATALKAN");
      expect(await returnedQty(n.lineId)).toBe(0);
      expect(await bukuRetur()).toHaveLength(0);
    }
  });

  it("withdraw: only the reporter, at her store, while pending, with a reason — audited, then final", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "a"));
    expect(await tarik(id, "salah", lainId)).toEqual({ ok: false, alasan: "BUKAN_MILIK" });
    expect(await tarik(id, "salah", spgId, tokoLainId)).toEqual({ ok: false, alasan: "BUKAN_MILIK" });
    expect(await tarik(id, " ")).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await tarik(id, "salah pilih nota")).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, status: "DIBATALKAN" });
    const r = await laporan(id);
    expect([r.status, r.decidedById, r.rejectReason]).toEqual(["DIBATALKAN", spgId, "salah pilih nota"]);
    const ditarik = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_DITARIK);
    expect(ditarik).toHaveLength(1);
    expect(ditarik[0].metadata).toMatchObject({ olehSpg: true });
    expect(await setujui(id)).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await tarik(id, "lagi")).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await returnedQty(n.lineId)).toBe(0);
  });

  it("nobody decides a report they made themselves; an unknown report is not found", async () => {
    const n = await jual(1);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "a"));
    expect(await setujui(id, spgId)).toEqual({ ok: false, alasan: "PELAPOR_SAMA" });
    expect(await tolak(id, "tidak", spgId)).toEqual({ ok: false, alasan: "PELAPOR_SAMA" });
    expect((await laporan(id)).status).toBe("MENUNGGU");
    expect(await setujuiReturPembeli({ returnId: `${tag}-tidak-ada`, olehUserId: kantorA })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
  });

  it("approval re-checks what can still come back and writes nothing when it no longer fits", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "a"));
    // Tulisan jendela penerapan (image lama) menaikkan returnedQty langsung sampai habis.
    await prisma.spgSaleLine.update({ where: { id: seededId(n.lineId) }, data: { returnedQty: 2 } });
    expect(await setujui(id)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect((await laporan(id)).status).toBe("MENUNGGU");
    expect(await returnedQty(n.lineId)).toBe(2);
    expect(await bukuRetur()).toHaveLength(0);
  });

  it("a replay with the same key returns the same report and rings no second bell; another user's key is refused", async () => {
    const n = await jual(1);
    const a = await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k");
    const b = await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k");
    expect(a).toEqual(b);
    const id = idDari(a);
    expect(await lonceng(id)).toHaveLength(1);
    expect(await prisma.spgSaleReturn.count({ where: { spgSaleId: seededId(n.saleId) } })).toBe(1);
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k", lainId)).toEqual({ ok: false, alasan: "KUNCI_DIPAKAI" });
    // Kiriman ulang sesudah diputuskan tetap "sudah sampai" — antrean HP membuangnya.
    expect((await tolak(id)).ok).toBe(true);
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k")).toEqual({ ok: true, returnId: id });
  });

  it("only the SPG's own sale at her own store can be reported, and a reason is required", async () => {
    const n = await jual(2);
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "x", lainId)).toEqual({ ok: false, alasan: "NOTA_TIDAK_DITEMUKAN" });
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "y", spgId, tokoLainId)).toEqual({ ok: false, alasan: "NOTA_TIDAK_DITEMUKAN" });
    expect(
      await catatReturPembeli({ spgSaleId: n.saleId, storeId, userId: spgId, baris: [{ saleLineId: n.lineId, qty: 1 }], alasan: " ", idempotencyKey: `${tag}-r` }),
    ).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
  });

  it("P12: approval books every sellable piece even when a store count ran after the report — set-aside goods were never on the shelf", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "a"));
    const dilaporkan = (await laporan(id)).createdAt;
    const dihitung = new Date(dilaporkan.getTime() + 60_000);
    // Opname toko SESUDAH dilaporkan: barangnya disisihkan, jadi tidak dihitung di rak.
    await prisma.storeOpname.create({
      data: {
        storeId,
        countedById: spgId,
        countedAt: dihitung,
        lines: { create: [{ itemId, variantSku: `${tag}-M`, productName: `Kaos ${tag}`, qtySystem: 0, qtyCounted: 0, countedAt: dihitung }] },
      },
    });
    expect((await setujui(id)).ok).toBe(true);
    const buku = await bukuRetur();
    expect(buku.map((b) => b.qty)).toEqual([1]);
    expect(buku[0].createdAt.getTime()).toBe(dilaporkan.getTime());
    const setuju = (await jejak(id)).find((x) => x.action === JEJAK.RETUR_PEMBELI_DISETUJUI);
    expect(setuju?.metadata).toMatchObject({ bukuDitulis: 1 });
    expect(await returnedQty(n.lineId)).toBe(1);
    expect(await riwayat(n.docNo)).toEqual([2, 1, 1]);
  });

  it("reads: the phone sees approved, pending and what is left — no prices; the office sees every report with its status", async () => {
    const n = await jual(4);
    const disetujui = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "RUSAK" }], "a"));
    expect((await setujui(disetujui)).ok).toBe(true);
    const menunggu = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "b"));

    const hp = await notaUntukKembali(n.saleId, spgId, storeId);
    expect(hp?.baris).toEqual([expect.objectContaining({ saleLineId: n.lineId, qty: 4, returnedQty: 1, menunggu: 2, sisa: 1 })]);
    expect(hp?.menungguTotal).toBe(2);
    expect(JSON.stringify(hp)).not.toMatch(/price|Price|"total"|lineTotal|discount/);
    expect(await notaUntukKembali(n.saleId, lainId, storeId)).toBeNull();

    const kantor = await kembaliPerNota(n.saleId);
    expect(kantor.perBaris[0]).toMatchObject({ qty: 4, returnedQty: 1, menunggu: 2 });
    expect(kantor.riwayat.map((r) => [r.id, r.status])).toEqual([
      [disetujui, "DISETUJUI"],
      [menunggu, "MENUNGGU"],
    ]);
    expect(kantor.riwayat[0]).toMatchObject({ alasan: "ukuran tidak pas", uang: "SILAKAN_KEMBALIKAN" });
    expect(kantor.riwayat[0].diputuskanOleh).not.toBeNull();
    expect(kantor.riwayat[0].diputuskanPada).not.toBeNull();
    expect(kantor.riwayat[1]).toMatchObject({ diputuskanOleh: null, diputuskanPada: null, uang: "MENUNGGU_BELUM" });

    const saya = await returPembeliSaya(spgId, storeId);
    expect(saya.map((r) => [r.id, r.status, r.bisaDitarik, r.bisaCatatUangKembali, r.uang])).toEqual([
      [menunggu, "MENUNGGU", true, true, "MENUNGGU_BELUM"],
      [disetujui, "DISETUJUI", false, true, "SILAKAN_KEMBALIKAN"],
    ]);
    expect(JSON.stringify(saya)).not.toMatch(/price|Price|total|lineTotal|nilai|discount|jumlah|amount|sisa/);
    expect(await returPembeliSaya(spgId, tokoLainId)).toEqual([]);
  });

  it("a row written without a status is a pending report (fail-safe default), never approved without its effects", async () => {
    const n = await jual(2);
    const lama = await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: n.saleId,
        storeId,
        createdById: spgId,
        reason: "tanpa status",
        idempotencyKey: `${tag}-tanpa-status`,
        lines: { create: [{ spgSaleLineId: n.lineId, itemId, variantSku: `${tag}-M`, qty: 1, condition: "RUSAK" }] },
      },
    });
    returIds.push(lama.id);
    expect([lama.status, lama.decidedAt]).toEqual(["MENUNGGU", null]);
    expect(await returnedQty(n.lineId)).toBe(0);
    expect((await kembaliPerNota(n.saleId)).riwayat[0]).toMatchObject({ status: "MENUNGGU", uang: "MENUNGGU_BELUM" });
  });

  /* ------------------------------------------------------ foto dan uang (P14, P77) */

  it("reporting needs the goods photo of THIS report at THIS store, and a money answer; 'Sudah' needs the slip", async () => {
    const n = await jual(3);
    const b = [{ saleLineId: n.lineId, qty: 1 }];
    expect(await lapor(n.saleId, b, "f1", spgId, storeId, { fotoBarangKey: null })).toEqual({ ok: false, alasan: "FOTO_BARANG_WAJIB" });
    // Foto toko lain, laporan lain, atau foto struk di tempat foto barang.
    expect(await lapor(n.saleId, b, "f2", spgId, storeId, { fotoBarangKey: foto("f2", "barang", tokoLainId) })).toEqual({ ok: false, alasan: "FOTO_BARANG_WAJIB" });
    expect(await lapor(n.saleId, b, "f3", spgId, storeId, { fotoBarangKey: foto("lain", "barang") })).toEqual({ ok: false, alasan: "FOTO_BARANG_WAJIB" });
    expect(await lapor(n.saleId, b, "f4", spgId, storeId, { fotoBarangKey: foto("f4", "struk") })).toEqual({ ok: false, alasan: "FOTO_BARANG_WAJIB" });
    expect(await lapor(n.saleId, b, "f5", spgId, storeId, { uangSudah: null })).toEqual({ ok: false, alasan: "JAWABAN_UANG_WAJIB" });
    expect(await lapor(n.saleId, b, "f6", spgId, storeId, { uangSudah: true, fotoStrukKey: null })).toEqual({ ok: false, alasan: "FOTO_STRUK_WAJIB" });
    expect(await lapor(n.saleId, b, "f7", spgId, storeId, { uangSudah: true, fotoStrukKey: foto("f7", "barang") })).toEqual({ ok: false, alasan: "FOTO_STRUK_WAJIB" });
    expect(await prisma.spgSaleReturn.count({ where: { spgSaleId: seededId(n.saleId) } })).toBe(0);

    const id = idDari(await lapor(n.saleId, b, "f8", spgId, storeId, { uangSudah: true }));
    const r = await laporan(id);
    expect(r.goodsPhotoR2Key).toBe(foto("f8", "barang"));
    expect(r.refundSlipR2Key).toBe(foto("f8", "struk"));
    expect(r.refundedAt?.getTime()).toBe(r.createdAt.getTime());
    const l = await lonceng(id);
    expect(l[0].metadata).toMatchObject({ uangSudahDikembalikan: true });
    // Sudah tercatat dikembalikan: SPG tidak bisa lagi menarik laporannya (kantor yang memutuskan).
    expect(await tarik(id)).toEqual({ ok: false, alasan: "UANG_SUDAH_DIKEMBALIKAN" });
  });

  it("a replay is recognised BEFORE the photo and money checks", async () => {
    const n = await jual(1);
    const a = await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "rp");
    const b = await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "rp", spgId, storeId, { fotoBarangKey: null, uangSudah: null });
    expect(b).toEqual(a);
  });

  it("an offline 'Sudah' is stamped at the capture time, never before the sale", async () => {
    const n = await jual(1);
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: seededId(n.saleId) } });
    const sebelumNota = new Date(nota.createdAt.getTime() - 3_600_000);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "lu", spgId, storeId, { uangSudah: true, waktuTangkap: sebelumNota }));
    const r = await laporan(id);
    expect(r.createdAt.getTime()).toBe(nota.createdAt.getTime());
    expect(r.refundedAt?.getTime()).toBe(nota.createdAt.getTime());
  });

  /* ---------------------------------------------------------- uang dikembalikan */

  it("refund step: only the reporter at her store; MENUNGGU (rings the office) or DISETUJUI; slip of this report only", async () => {
    const n = await jual(3);
    const tunggu = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "u1"));
    expect(await uangKembali(tunggu, { userId: lainId })).toEqual({ ok: false, alasan: "BUKAN_MILIK" });
    expect(await uangKembali(tunggu, { key: foto("u1", "barang") })).toEqual({ ok: false, alasan: "FOTO_STRUK_WAJIB" });
    expect(await uangKembali(tunggu, { key: foto("lain", "struk") })).toEqual({ ok: false, alasan: "FOTO_STRUK_WAJIB" });
    expect((await uangKembali(tunggu)).ok).toBe(true);
    expect((await lonceng(tunggu)).length).toBe(2);
    const dicatat = (await jejak(tunggu)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    expect(dicatat).toHaveLength(1);
    // Kunci yang sama → ulang; kunci lain → sudah dicatat.
    expect(await uangKembali(tunggu)).toMatchObject({ ok: true, ulang: true });
    expect(await uangKembali(tunggu, { key: `${folderFotoReturPembeli(storeId, await kunciLaporan(tunggu))}/struk.png` })).toEqual({ ok: false, alasan: "SUDAH_DICATAT" });

    const setuju = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "u2"));
    expect((await setujui(setuju)).ok).toBe(true);
    const disetujui = await laporan(setuju);
    expect((await uangKembali(setuju)).ok).toBe(true);
    const r = await laporan(setuju);
    expect(r.refundedAt!.getTime()).toBeGreaterThanOrEqual(disetujui.decidedAt!.getTime());

    const ditarik = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "u3"));
    expect((await tarik(ditarik)).ok).toBe(true);
    expect(await uangKembali(ditarik)).toEqual({ ok: false, alasan: "TIDAK_DISETUJUI" });
  });

  /* --------------------------------------------------------------- tolak (P83, P78, P81) */

  it("P83: rejection without a refund creates no charge and releases the pieces", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "t1"));
    expect((await tolak(id)).ok).toBe(true);
    expect(await bebanDari(id)).toBeNull();
    expect((await laporan(id)).refundMarkedById).toBeNull();
    expect((await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "t2")).ok).toBe(true);
  });

  it("P13/P81: rejecting a refunded report creates ONE charge = the net nota price, audited, and holds the pieces", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "c1", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const c = await bebanDari(id);
    expect(c).not.toBeNull();
    const harga = bulat2(2 * (await hargaPotong(n.lineId)));
    expect([Number(c!.computedAmount), Number(c!.amount), c!.status, c!.spgUserId, c!.storeId]).toEqual([harga, harga, "TERBUKA", spgId, storeId]);
    expect(c!.sourceKind).toBe("KONSI");
    expect(c!.spgSaleId).toBe(n.saleId);
    expect((await jejak(c!.id)).map((x) => x.action)).toEqual([JEJAK.BEBAN_SPG_DIBUAT]);
    const tolakan = (await jejak(id)).find((x) => x.action === JEJAK.RETUR_PEMBELI_DITOLAK);
    expect(tolakan?.metadata).toMatchObject({ beban: { chargeId: c!.id, jumlah: harga } });
    // Potongnya ditahan: tidak bisa dilaporkan ulang, dan tampil sebagai disisihkan.
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "c2")).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect((await notaUntukKembali(n.saleId, spgId, storeId))?.baris[0]).toMatchObject({ ditahan: 2, sisa: 1 });
    expect((await barangDisisihkan(storeId)).map((b) => [b.qty, b.tanda])).toEqual([[2, "TUNGGU_KEPUTUSAN"]]);
  });

  it("P78: the office marks 'money was refunded after all' with a reason; refundedAt stays empty", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "m1"));
    expect(await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "toko melapor", uangTernyataDikembalikan: true, alasanUangKembali: " " })).toEqual({
      ok: false,
      alasan: "ALASAN_UANG_KEMBALI_WAJIB",
    });
    expect(
      (await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "tidak sesuai", uangTernyataDikembalikan: true, alasanUangKembali: "toko melapor" })).ok,
    ).toBe(true);
    const r = await laporan(id);
    expect([r.refundedAt, r.refundMarkedById, r.refundMarkReason]).toEqual([null, kantorA, "toko melapor"]);
    expect(await jumlahBeban(id)).toBe(bulat2(await hargaPotong(n.lineId)));
    const tolakan = (await jejak(id)).find((x) => x.action === JEJAK.RETUR_PEMBELI_DITOLAK);
    expect(tolakan?.changes).toMatchObject({ after: { refundMarkedById: kantorA, refundMarkReason: "toko melapor" } });
  });

  it("P81: a slip amount needs a reason when it differs; the computed amount needs none", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "s1", spgId, storeId, { uangSudah: true }));
    expect(await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "x", besarBeban: 12_345 })).toEqual({ ok: false, alasan: "ALASAN_BESAR_BEBAN_WAJIB" });
    expect(await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "x", besarBeban: 0 })).toEqual({ ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" });
    expect((await laporan(id)).status).toBe("MENUNGGU");
    expect((await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "x", besarBeban: 12_345, alasanBesarBeban: "struk kasir" })).ok).toBe(true);
    const c = (await bebanDari(id))!;
    expect([Number(c.computedAmount), Number(c.amount), c.amountReason]).toEqual([bulat2(await hargaPotong(n.lineId)), 12_345, "struk kasir"]);
  });

  it("P13a: a refund captured on the phone BEFORE a no-refund rejection, arriving after it, becomes ONE charge — audited, belled, pieces held", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2, condition: "LAYAK" }], "o1"));
    const tangkap = new Date();
    await tunda(20);
    expect((await tolak(id)).ok).toBe(true);
    const ditolak = await laporan(id);
    expect(tangkap.getTime()).toBeLessThan(ditolak.decidedAt!.getTime());
    expect(await bebanDari(id)).toBeNull();
    // Kantor menolak tanpa uang: HP menawarkan pencatatan uangnya (P13) — tidak bisa ditarik lagi.
    expect((await returPembeliSaya(spgId, storeId)).find((x) => x.id === id)).toMatchObject({ bisaCatatUangKembali: true, bisaDitarik: false });

    expect(await uangKembali(id, { waktuTangkap: tangkap })).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, ulang: false });
    const r = await laporan(id);
    expect([r.status, r.refundedAt?.getTime(), r.refundSlipR2Key]).toEqual(["DITOLAK", tangkap.getTime(), await strukUntuk(id)]);
    const c = (await bebanDari(id))!;
    const harga = bulat2(2 * (await hargaPotong(n.lineId)));
    expect([Number(c.computedAmount), Number(c.amount), c.amountReason, c.status, c.spgUserId, c.createdById]).toEqual([harga, harga, null, "TERBUKA", spgId, spgId]);
    expect((await jejak(c.id)).map((x) => x.action)).toEqual([JEJAK.BEBAN_SPG_DIBUAT]);
    const dicatat = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    expect(dicatat).toHaveLength(1);
    expect(dicatat[0].metadata).toMatchObject({ status: "DITOLAK", luring: true, beban: { chargeId: c.id, jumlah: harga } });
    expect((await lonceng(id)).map((x) => x.metadata)).toContainEqual(expect.objectContaining({ returnId: id, chargeId: c.id, uangSudahDikembalikan: true }));
    // Potongnya kini ditahan beban: tidak bisa dilaporkan ulang, dan tampil disisihkan.
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "o1b")).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect((await barangDisisihkan(storeId)).map((b) => [b.qty, b.tanda])).toEqual([[2, "TUNGGU_KEPUTUSAN"]]);
    expect((await returPembeliSaya(spgId, storeId)).find((x) => x.id === id)).toMatchObject({ uang: "DIBEBANKAN", beban: "TERBUKA", bisaCatatUangKembali: false });

    // Ulangan dari antrean: sudah tercatat, tanpa beban kedua.
    expect(await uangKembali(id, { waktuTangkap: tangkap })).toMatchObject({ ok: true, ulang: true });
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
    // Ditolak lalu ditarik kembali lewat P82 tetap mungkin: bebannya belum dipotong.
    expect((await batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorB, alasan: "keliru" })).ok).toBe(true);
  });

  it("P13: a refund made AFTER the rejection is recorded at that time and charged to the SPG", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o1c"));
    expect((await tolak(id)).ok).toBe(true);
    const ditolak = await laporan(id);
    await tunda(20);
    expect((await uangKembali(id)).ok).toBe(true);
    const r = await laporan(id);
    expect(r.status).toBe("DITOLAK");
    expect(r.refundedAt!.getTime()).toBeGreaterThan(ditolak.decidedAt!.getTime());
    expect(await jumlahBeban(id)).toBe(bulat2(await hargaPotong(n.lineId)));
  });

  it("a rejected report whose released pieces were reported again refuses the refund (POTONG_SUDAH_DILAPORKAN_ULANG), records nothing and bells the office", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "o1d"));
    expect((await tolak(id)).ok).toBe(true);
    // Potongnya lepas lagi (P83) dan dilaporkan di laporan baru.
    idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "o1e"));
    expect((await returPembeliSaya(spgId, storeId)).find((x) => x.id === id)?.bisaCatatUangKembali).toBe(false);

    expect(await uangKembali(id)).toEqual({ ok: false, alasan: "POTONG_SUDAH_DILAPORKAN_ULANG" });
    const r = await laporan(id);
    expect([r.status, r.refundedAt, r.refundSlipR2Key]).toEqual(["DITOLAK", null, null]);
    expect(await bebanDari(id)).toBeNull();
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(0);
    expect((await lonceng(id)).map((x) => x.metadata)).toContainEqual(expect.objectContaining({ returnId: id, tidakTercatat: true }));
    // Foto yang dirujuk lonceng itu terbuka di rincian kantor laporan ini — dan hanya di laporan ini.
    const url = urlFotoReturPembeli({ storeId, key: await strukUntuk(id) }, "struk");
    const rincian = (await rincianReturPembeliKantor(id))!;
    expect([rincian.foto.struk, rincian.strukTidakTercatat.map((s) => s.url)]).toEqual([null, [url]]);
    const lain = (await prisma.spgSaleReturn.findFirstOrThrow({ where: { idempotencyKey: `${tag}-o1e` }, select: { id: true } })).id;
    expect((await rincianReturPembeliKantor(lain))!.strukTidakTercatat).toEqual([]);
  });

  it("P78-marked rejection: a queued slip is only attached — no second charge, refund day stays unknown", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o1f"));
    const tangkap = new Date();
    expect(
      (await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "tidak sesuai", uangTernyataDikembalikan: true, alasanUangKembali: "toko melapor" })).ok,
    ).toBe(true);
    const c = (await bebanDari(id))!;
    expect(await uangKembali(id, { waktuTangkap: tangkap })).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, ulang: false });
    const r = await laporan(id);
    expect([r.refundedAt, r.refundSlipR2Key, r.refundMarkedById]).toEqual([null, await strukUntuk(id), kantorA]);
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
    expect((await bebanDari(id))!.amount.toString()).toBe(c.amount.toString());
    const dicatat = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    expect(dicatat).toHaveLength(1);
    expect(dicatat[0].metadata).toMatchObject({ status: "DITOLAK", ditandaiKantor: true });
    // Ulangan: sama → ulang; foto lain → sudah dicatat.
    expect(await uangKembali(id)).toMatchObject({ ok: true, ulang: true });
    expect(await uangKembali(id, { key: `${folderFotoReturPembeli(storeId, await kunciLaporan(id))}/struk.png` })).toEqual({ ok: false, alasan: "SUDAH_DICATAT" });
  });

  it("P78: a queued refund captured BEFORE the SPG withdrew the report reopens it for the office; one captured after stays refused", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o1g"));
    const tangkap = new Date();
    await tunda(20);
    expect((await tarik(id)).ok).toBe(true);
    // Ditangkap sesudah ditarik (atau langsung, tanpa jam tangkap): tetap ditolak, tidak ada yang
    // berubah dan tidak ada beban — tetapi uangnya sudah keluar, jadi setiap penolakan membunyikan
    // lonceng kantor dengan kunci foto struknya.
    expect(await uangKembali(id, { waktuTangkap: new Date() })).toEqual({ ok: false, alasan: "TIDAK_DISETUJUI" });
    expect(await uangKembali(id)).toEqual({ ok: false, alasan: "TIDAK_DISETUJUI" });
    const ditarik = await laporan(id);
    expect([ditarik.status, ditarik.refundedAt, ditarik.refundSlipR2Key]).toEqual(["DIBATALKAN", null, null]);
    expect(await bebanDari(id)).toBeNull();
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(0);
    const tidakTercatat = (await lonceng(id)).map((x) => x.metadata as Record<string, unknown>).filter((m) => m.tidakTercatat === true);
    expect(tidakTercatat).toHaveLength(2);
    for (const m of tidakTercatat) expect(m).toMatchObject({ returnId: id, uangSudahDikembalikan: true, laporanDitarik: true, fotoStrukKey: await strukUntuk(id) });
    // Foto yang dirujuk lonceng itu terbuka di rincian kantor (sekali per kunci), bukan sebagai struk laporan.
    const sebelum = (await rincianReturPembeliKantor(id))!;
    expect(sebelum.foto.struk).toBeNull();
    expect(sebelum.strukTidakTercatat.map((s) => s.url)).toEqual([urlFotoReturPembeli({ storeId, key: await strukUntuk(id) }, "struk")]);

    expect(await uangKembali(id, { waktuTangkap: tangkap })).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId, ulang: false });
    const r = await laporan(id);
    expect([r.status, r.decidedById, r.decidedAt, r.rejectReason, r.refundedAt?.getTime()]).toEqual(["MENUNGGU", null, null, null, tangkap.getTime()]);
    // Dua jejak di transaksi yang sama: uangnya dicatat, dan penarikannya dibatalkan — masing-masing dengan namanya.
    const semua = await jejak(id);
    const dicatat = semua.filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    expect(dicatat).toHaveLength(1);
    expect(dicatat[0].changes).toEqual({
      before: { refundedAt: null, refundSlipR2Key: null },
      after: { refundedAt: tangkap.toISOString(), refundSlipR2Key: await strukUntuk(id) },
    });
    expect(dicatat[0].metadata).toMatchObject({ status: "DIBATALKAN", luring: true });
    expect(dicatat[0].metadata).not.toHaveProperty("penarikanDibatalkan");
    const batalTarik = semua.filter((x) => x.action === JEJAK.RETUR_PEMBELI_PENARIKAN_DIBATALKAN);
    expect(batalTarik).toHaveLength(1);
    expect(batalTarik[0].changes).toEqual({
      before: { status: "DIBATALKAN", decidedById: spgId, decidedAt: ditarik.decidedAt!.toISOString(), rejectReason: "salah catat" },
      after: { status: "MENUNGGU", decidedById: null, decidedAt: null, rejectReason: null },
    });
    expect(batalTarik[0].metadata).toEqual({ spgSaleId: n.saleId, docNo: n.docNo, storeId, luring: true });
    expect((await rincianReturPembeliKantor(id))!.jejak.map((j) => j.action)).toContain(JEJAK.RETUR_PEMBELI_PENARIKAN_DIBATALKAN);
    // Kunci yang sama kini struk laporannya sendiri — tidak lagi ditampilkan sebagai "tidak tercatat".
    const sesudah = (await rincianReturPembeliKantor(id))!;
    expect(sesudah.foto.struk).toBe(urlFotoReturPembeli({ storeId, key: await strukUntuk(id) }, "struk"));
    expect(sesudah.strukTidakTercatat).toEqual([]);
    expect((await lonceng(id)).map((x) => x.metadata)).toContainEqual(expect.objectContaining({ returnId: id, uangSudahDikembalikan: true }));
    // Kantor yang memutuskan: SPG tidak bisa menarik lagi; menolaknya membuat beban.
    expect(await tarik(id)).toEqual({ ok: false, alasan: "UANG_SUDAH_DIKEMBALIKAN" });
    expect((await tolak(id)).ok).toBe(true);
    expect(await jumlahBeban(id)).toBe(bulat2(await hargaPotong(n.lineId)));
  });

  it("a withdrawn report whose released pieces were reported again refuses the queued refund and bells the office", async () => {
    const n = await jual(1);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o1h"));
    const tangkap = new Date();
    await tunda(20);
    expect((await tarik(id)).ok).toBe(true);
    idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o1i"));
    expect(await uangKembali(id, { waktuTangkap: tangkap })).toEqual({ ok: false, alasan: "POTONG_SUDAH_DILAPORKAN_ULANG" });
    expect((await laporan(id)).status).toBe("DIBATALKAN");
    expect((await lonceng(id)).map((x) => x.metadata)).toContainEqual(
      expect.objectContaining({ returnId: id, tidakTercatat: true, laporanDitarik: true, fotoStrukKey: await strukUntuk(id) }),
    );
  });

  it("a refund recorded while waiting, whose answer was lost, still replays ok after the rejection", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "o2"));
    expect((await uangKembali(id)).ok).toBe(true);
    expect((await tolak(id)).ok).toBe(true);
    expect(await uangKembali(id)).toMatchObject({ ok: true, ulang: true });
    expect(await jumlahBeban(id)).toBe(bulat2(await hargaPotong(n.lineId)));
  });

  /* --------------------------------------------------------- batalkan penolakan (P82) */

  it("P82: a mistaken charged rejection is reversed while nothing was taken — approved, effects applied, charge cancelled", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "b1", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const batal = (alasan: unknown, oleh = kantorB) => batalkanPenolakanReturPembeli({ returnId: id, olehUserId: oleh, alasan });
    expect(await batal(" ")).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await batal("keliru", spgId)).toEqual({ ok: false, alasan: "PELAPOR_SAMA" });
    expect(await batal("keliru")).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId });
    const r = await laporan(id);
    expect([r.status, r.decidedById, r.rejectReason]).toEqual(["DISETUJUI", kantorB, null]);
    expect(await returnedQty(n.lineId)).toBe(1);
    expect((await bukuRetur()).map((b) => b.qty)).toEqual([1]);
    expect(await riwayat(n.docNo)).toEqual([2, 1, 1]);
    const c = (await bebanDari(id))!;
    expect([c.status, c.cancelledById, c.cancelReason]).toEqual(["BATAL", kantorB, "keliru"]);
    expect((await jejak(id)).some((x) => x.action === JEJAK.RETUR_PEMBELI_PENOLAKAN_DIBATALKAN)).toBe(true);
    expect((await jejak(c.id)).some((x) => x.action === JEJAK.BEBAN_SPG_DIBATALKAN)).toBe(true);
    expect(await batal("lagi")).toEqual({ ok: false, alasan: "BUKAN_DITOLAK" });
  });

  it("P82: refused without a charge, and once anything was deducted from pay", async () => {
    const n = await jual(3);
    const tanpa = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "b2"));
    expect((await tolak(tanpa)).ok).toBe(true);
    expect(await batalkanPenolakanReturPembeli({ returnId: tanpa, olehUserId: kantorB, alasan: "x" })).toEqual({ ok: false, alasan: "TANPA_BEBAN" });

    const dipotong = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "b3", spgId, storeId, { uangSudah: true }));
    expect((await tolak(dipotong)).ok).toBe(true);
    await lunasiDariBayaran((await bebanDari(dipotong))!.id, 10_000);
    expect(await batalkanPenolakanReturPembeli({ returnId: dipotong, olehUserId: kantorB, alasan: "x" })).toEqual({ ok: false, alasan: "SUDAH_DIPOTONG" });
  });

  it("P82: a charge moved to SPG debt at her final payment is not reversed here (SUDAH_DIUTANGKAN) and the debt is left untouched", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "b4", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const c = (await bebanDari(id))!;
    const debt = await prisma.spgDebt.create({
      data: {
        spgUserId: spgId,
        kind: "RETUR_PEMBELI",
        sourceKey: c.id,
        sourceStoreId: storeId,
        amount: c.amount,
        createdRefType: "SpgDebtRecording",
        createdRefId: `${tag}-catat-${c.id}`,
        note: "uji",
        createdById: kantorA,
      },
    });
    debtIds.push(debt.id);
    await runSerializable((tx) =>
      catatBebanDipotong(tx, {
        olehUserId: kantorA,
        waktu: new Date(),
        bulanBayar: "2026-11",
        potong: [{ chargeId: c.id, jumlah: Number(c.amount), dariKomisi: 0, dariGaji: 0, paidRefType: "SpgDebt", paidRefId: debt.id }],
      }),
    );
    expect(await batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorB, alasan: "keliru" })).toEqual({ ok: false, alasan: "SUDAH_DIUTANGKAN" });
    expect((await laporan(id)).status).toBe("DITOLAK");
    expect((await bebanDari(id))!.status).toBe("DIUTANGKAN");
    const d = await prisma.spgDebt.findUniqueOrThrow({ where: { id: seededId(debt.id) } });
    expect([d.status, Number(d.settledAmount)]).toEqual(["TERBUKA", 0]);
  });

  /* -------------------------------------------------------------- keputusan barang (P79) */

  it("P79: the goods decision waits until the charge is fully compensated, then happens once", async () => {
    const n = await jual(3);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "g1", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const c = (await bebanDari(id))!;
    expect(await putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: kantorB })).toEqual({ ok: false, alasan: "BEBAN_BELUM_LUNAS" });
    const { lunas } = await lunasiDariBayaran(c.id, Number(c.amount));
    expect(lunas).toHaveLength(1);
    expect(lunas[0].metadata).toMatchObject({ returnId: id, chargeId: c.id });
    expect(await putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: spgId })).toEqual({ ok: false, alasan: "PELAPOR_SAMA" });

    expect(await putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: kantorB })).toEqual({ ok: true, returnId: id, spgSaleId: n.saleId });
    expect((await laporan(id)).status).toBe("DISETUJUI");
    expect(await returnedQty(n.lineId)).toBe(1);
    expect((await bukuRetur()).map((b) => b.qty)).toEqual([1]);
    const sesudah = (await bebanDari(id))!;
    expect([sesudah.goodsDecision, Number(sesudah.paybackAmount), sesudah.paybackPaidAt]).toEqual(["KEMBALI_STOK", Number(c.amount), null]);
    expect(await putuskanBarangReturPembeli({ returnId: id, keputusan: "DIBELI_SPG", olehUserId: kantorB })).toEqual({ ok: false, alasan: "TANPA_BEBAN" });
  });

  it("P79 DIBELI_SPG: nothing moves, the sale stands and the pieces stay held", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "g2", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    await lunasiDariBayaran((await bebanDari(id))!.id, await jumlahBeban(id));
    expect((await putuskanBarangReturPembeli({ returnId: id, keputusan: "DIBELI_SPG", olehUserId: kantorB })).ok).toBe(true);
    expect((await laporan(id)).status).toBe("DITOLAK");
    expect(await returnedQty(n.lineId)).toBe(0);
    expect(await bukuRetur()).toHaveLength(0);
    expect((await bebanDari(id))!.goodsDecision).toBe("DIBELI_SPG");
    expect(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "g3")).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect(await putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: kantorB })).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await barangDisisihkan(storeId)).toEqual([]);
  });

  it("P9: the office detail warns about the ORIGINAL nota month's closed commission, separately from the report month", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "p9"));
    const bulanLaporan = wibYearMonth((await laporan(id)).createdAt);
    // Nota bulan lalu: komisinya yang dikurangi (P9), bukan komisi bulan laporannya.
    const waktuNota = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await prisma.spgSale.update({ where: { id: seededId(n.saleId) }, data: { createdAt: waktuNota } });
    const bulanNota = wibYearMonth(waktuNota);
    expect(bulanNota).not.toBe(bulanLaporan);
    expect((await rincianReturPembeliKantor(id))!.peringatan).toEqual({ bulanKomisi: bulanNota, komisiDitutup: false, bulanLaporan, siklusKonsiTerkunci: false });
    // Laporan bulan LAPORAN yang dicek tidak memicu peringatan komisi; bulan nota yang dicek memicunya.
    const cekLaporan = await prisma.spgSalesCheck.create({ data: { storeId, period: bulanLaporan, checkedById: kantorA } });
    let cekNota = "";
    try {
      expect((await rincianReturPembeliKantor(id))!.peringatan.komisiDitutup).toBe(false);
      cekNota = (await prisma.spgSalesCheck.create({ data: { storeId, period: bulanNota, checkedById: kantorA } })).id;
      expect((await rincianReturPembeliKantor(id))!.peringatan).toEqual({ bulanKomisi: bulanNota, komisiDitutup: true, bulanLaporan, siklusKonsiTerkunci: false });
    } finally {
      await prisma.spgSalesCheck.delete({ where: { id: seededId(cekLaporan.id) } });
      if (cekNota) await prisma.spgSalesCheck.delete({ where: { id: seededId(cekNota) } });
    }
  });

  /* -------------------------------------------------------------------- balapan */

  it("race: two refund steps with the same slip — one compare-and-swap, one audit row", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r1"));
    expect((await setujui(id)).ok).toBe(true);
    const [a, b] = await Promise.all([uangKembali(id), tunda(5).then(() => uangKembali(id))]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(1);
  });

  it("race: refund step vs rejection of a waiting report — in either order it ends rejected, refunded, with exactly one charge", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r2"));
    const [u, t] = await Promise.all([uangKembali(id), tunda(5).then(() => tolak(id, "dobel", kantorB))]);
    expect([u.ok, t.ok]).toEqual([true, true]);
    const r = await laporan(id);
    expect(r.status).toBe("DITOLAK");
    expect(r.refundedAt).not.toBeNull();
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
    expect((await jejak((await bebanDari(id))!.id)).filter((x) => x.action === JEJAK.BEBAN_SPG_DIBUAT)).toHaveLength(1);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(1);
  });

  it("race: two queued refunds of a no-refund rejection — one records and charges, the other replays", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r2b"));
    expect((await tolak(id)).ok).toBe(true);
    const [a, b] = await Promise.all([uangKembali(id), tunda(5).then(() => uangKembali(id))]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect([a, b].filter((x) => x.ok && x.ulang)).toHaveLength(1);
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(1);
  });

  it("race: refund step on a no-refund rejection vs the SPG reporting the same released pieces again — exactly one holds them, never both", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "r2e"));
    expect((await tolak(id)).ok).toBe(true);
    expect(await potongTerhitung(n.lineId)).toBe(0);
    // Pelaporan ulang lebih pendek: mulainya digeser supaya kedua urutan benar-benar terjadi.
    const [u, l] = await Promise.all([uangKembali(id), tunda(5).then(() => lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "r2f"))]);
    expect([u.ok, l.ok].filter(Boolean)).toHaveLength(1);
    const r = await laporan(id);
    const dicatat = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    if (u.ok) {
      expect(l).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
      expect([r.status, r.refundedAt !== null, r.refundSlipR2Key]).toEqual(["DITOLAK", true, await strukUntuk(id)]);
      const c = (await bebanDari(id))!;
      expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
      expect((await jejak(c.id)).filter((x) => x.action === JEJAK.BEBAN_SPG_DIBUAT)).toHaveLength(1);
      expect(dicatat).toHaveLength(1);
      expect((await lonceng(id)).map((x) => x.metadata)).toContainEqual(expect.objectContaining({ returnId: id, chargeId: c.id }));
    } else {
      expect(u).toEqual({ ok: false, alasan: "POTONG_SUDAH_DILAPORKAN_ULANG" });
      expect([r.status, r.refundedAt, r.refundSlipR2Key]).toEqual(["DITOLAK", null, null]);
      expect(await bebanDari(id)).toBeNull();
      expect(dicatat).toHaveLength(0);
      expect((await lonceng(id)).filter((x) => (x.metadata as Record<string, unknown>).tidakTercatat === true)).toHaveLength(1);
      if (l.ok) expect((await laporan(l.returnId)).status).toBe("MENUNGGU");
    }
    // Potongnya terhitung sekali: ditahan beban laporan lama ATAU menunggu di laporan baru, tidak keduanya.
    expect(await potongTerhitung(n.lineId)).toBe(2);
  });

  it("race: a queued refund captured BEFORE the withdrawal vs the SPG reporting the same released pieces again — exactly one holds them, never both", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "r2g"));
    const key = await strukUntuk(id);
    const tangkap = new Date();
    await tunda(20);
    expect((await tarik(id)).ok).toBe(true);
    expect(await potongTerhitung(n.lineId)).toBe(0);
    const [u, l] = await Promise.all([
      uangKembali(id, { key, waktuTangkap: tangkap }),
      tunda(5).then(() => lapor(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "r2h")),
    ]);
    expect([u.ok, l.ok].filter(Boolean)).toHaveLength(1);
    const r = await laporan(id);
    const dicatat = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    if (u.ok) {
      // Penarikannya batal (P78): laporan lama menunggu kantor lagi, pelaporan ulang tidak muat.
      expect(l).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
      expect([r.status, r.decidedAt, r.refundSlipR2Key, r.refundedAt?.getTime()]).toEqual(["MENUNGGU", null, key, tangkap.getTime()]);
      expect(dicatat).toHaveLength(1);
      expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_PENARIKAN_DIBATALKAN)).toHaveLength(1);
    } else {
      expect(u).toEqual({ ok: false, alasan: "POTONG_SUDAH_DILAPORKAN_ULANG" });
      expect([r.status, r.refundedAt, r.refundSlipR2Key]).toEqual(["DIBATALKAN", null, null]);
      expect(dicatat).toHaveLength(0);
      const tidakTercatat = (await lonceng(id)).map((x) => x.metadata as Record<string, unknown>).filter((m) => m.tidakTercatat === true);
      expect(tidakTercatat).toHaveLength(1);
      expect(tidakTercatat[0]).toMatchObject({ laporanDitarik: true, fotoStrukKey: key });
      if (l.ok) expect((await laporan(l.returnId)).status).toBe("MENUNGGU");
    }
    expect(await bebanDari(id)).toBeNull();
    expect(await potongTerhitung(n.lineId)).toBe(2);
  });

  it("race: two queued slips of a P78-marked rejection — one attaches, the other replays; one audit row, still one charge", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r2c"));
    const tangkap = new Date();
    expect(
      (await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "tidak sesuai", uangTernyataDikembalikan: true, alasanUangKembali: "toko melapor" })).ok,
    ).toBe(true);
    const c = (await bebanDari(id))!;
    const key = await strukUntuk(id);
    const [a, b] = await Promise.all([uangKembali(id, { key, waktuTangkap: tangkap }), tunda(5).then(() => uangKembali(id, { key, waktuTangkap: tangkap }))]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect([a, b].filter((x) => x.ok && x.ulang)).toHaveLength(1);
    const r = await laporan(id);
    expect([r.status, r.refundedAt, r.refundSlipR2Key, r.refundMarkedById]).toEqual(["DITOLAK", null, key, kantorA]);
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
    expect((await bebanDari(id))!.amount.toString()).toBe(c.amount.toString());
    const dicatat = (await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
    expect(dicatat).toHaveLength(1);
    expect(dicatat[0].metadata).toMatchObject({ ditandaiKantor: true });
  });

  it("race: two DIFFERENT queued slips of a P78-marked rejection — exactly one is attached, the other is SUDAH_DICATAT", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r2d"));
    expect(
      (await tolakReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "tidak sesuai", uangTernyataDikembalikan: true, alasanUangKembali: "toko melapor" })).ok,
    ).toBe(true);
    const jpg = await strukUntuk(id);
    const png = `${folderFotoReturPembeli(storeId, await kunciLaporan(id))}/struk.png`;
    const [a, b] = await Promise.all([uangKembali(id, { key: jpg }), tunda(5).then(() => uangKembali(id, { key: png }))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(a.ok ? b : a).toEqual({ ok: false, alasan: "SUDAH_DICATAT" });
    expect((await laporan(id)).refundSlipR2Key).toBe(a.ok ? jpg : png);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(1);
    expect(await prisma.spgCharge.count({ where: { source: "RETUR_PEMBELI", sourceId: seededId(id) } })).toBe(1);
  });

  it("race: approve vs reject of an early-refunded report — exactly one wins; a charge exists iff the rejection won", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r3", spgId, storeId, { uangSudah: true }));
    const [s1, t1] = await Promise.all([setujui(id, kantorA), tunda(5).then(() => tolak(id, "dobel", kantorB))]);
    expect([s1.ok, t1.ok].filter(Boolean)).toHaveLength(1);
    expect((await bebanDari(id)) !== null).toBe(t1.ok);
  });

  it("race: P82 reversal vs a payment deducting the same charge — never both", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r4", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const chargeId = (await bebanDari(id))!.id;
    const jumlah = await jumlahBeban(id);
    const [batal, bayar] = await Promise.allSettled([
      batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorB, alasan: "keliru" }),
      tunda(5).then(() => lunasiDariBayaran(chargeId, jumlah)),
    ]);
    const c = (await bebanDari(id))!;
    const potongan = await prisma.spgChargeDeduction.count({ where: { chargeId: seededId(chargeId) } });
    if (c.status === "BATAL") {
      expect(potongan).toBe(0);
      expect(batal.status === "fulfilled" && batal.value.ok).toBe(true);
    } else {
      expect(potongan).toBe(1);
      expect(bayar.status).toBe("fulfilled");
      expect(batal.status === "fulfilled" ? batal.value : null).toEqual({ ok: false, alasan: "SUDAH_DIPOTONG" });
    }
  });

  it("race: two P82 reversals of the same rejection — exactly one wins; the approval effects, the cancellation and their audit rows are written once", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "r9", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const chargeId = (await bebanDari(id))!.id;
    const [a, b] = await Promise.all([
      batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorA, alasan: "keliru" }),
      tunda(5).then(() => batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorB, alasan: "keliru juga" })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(a.ok ? b : a).toEqual({ ok: false, alasan: "BUKAN_DITOLAK" });
    expect((await laporan(id)).status).toBe("DISETUJUI");
    expect(await returnedQty(n.lineId)).toBe(1);
    expect((await bukuRetur()).filter((x) => x.refId === id).map((x) => x.qty)).toEqual([1]);
    expect(await riwayat(n.docNo)).toEqual([2, 1, 1]);
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_PENOLAKAN_DIBATALKAN)).toHaveLength(1);
    const c = (await bebanDari(id))!;
    expect(c.status).toBe("BATAL");
    expect((await jejak(chargeId)).filter((x) => x.action === JEJAK.BEBAN_SPG_DIBATALKAN)).toHaveLength(1);
  });

  it("race: two goods decisions — one wins", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r5", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    await lunasiDariBayaran((await bebanDari(id))!.id, await jumlahBeban(id));
    const [a, b] = await Promise.all([
      putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: kantorA }),
      tunda(5).then(() => putuskanBarangReturPembeli({ returnId: id, keputusan: "DIBELI_SPG", olehUserId: kantorB })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await jejak((await bebanDari(id))!.id)).filter((x) => x.action === JEJAK.BEBAN_SPG_BARANG_DIPUTUSKAN)).toHaveLength(1);
  });

  it("race: withdrawal vs a QUEUED refund captured before it — in either order the report ends waiting with the refund recorded", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r6b"));
    const key = await strukUntuk(id);
    const tangkap = new Date();
    await tunda(10);
    const [u, w] = await Promise.all([uangKembali(id, { key, waktuTangkap: tangkap }), tunda(5).then(() => tarik(id))]);
    expect(u.ok).toBe(true);
    const r = await laporan(id);
    expect([r.status, r.refundSlipR2Key, r.refundedAt?.getTime()]).toEqual(["MENUNGGU", key, tangkap.getTime()]);
    if (!w.ok) expect(w).toEqual({ ok: false, alasan: "UANG_SUDAH_DIKEMBALIKAN" });
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN)).toHaveLength(1);
    // Penarikan yang sempat menang dibatalkan dengan jejaknya sendiri; yang ditolak tidak meninggalkan apa-apa.
    expect((await jejak(id)).filter((x) => x.action === JEJAK.RETUR_PEMBELI_PENARIKAN_DIBATALKAN)).toHaveLength(w.ok ? 1 : 0);
    expect(await bebanDari(id)).toBeNull();
  });

  it("race: withdrawal vs the refund step on a waiting report — one wins; a refunded report never ends withdrawn", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r6"));
    const key = await strukUntuk(id);
    // Penarikan lebih pendek: mulainya digeser supaya kedua urutan benar-benar terjadi.
    const [u, w] = await Promise.all([uangKembali(id, { key }), tunda(5).then(() => tarik(id))]);
    expect([u.ok, w.ok].filter(Boolean)).toHaveLength(1);
    const r = await laporan(id);
    const aksi = (await jejak(id)).map((x) => x.action);
    if (u.ok) {
      expect([r.status, r.refundSlipR2Key]).toEqual(["MENUNGGU", key]);
      expect(w).toEqual({ ok: false, alasan: "UANG_SUDAH_DIKEMBALIKAN" });
      expect(aksi).not.toContain(JEJAK.RETUR_PEMBELI_DITARIK);
    } else {
      expect([r.status, r.refundedAt]).toEqual(["DIBATALKAN", null]);
      expect(u).toEqual({ ok: false, alasan: "TIDAK_DISETUJUI" });
      expect(aksi).not.toContain(JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN);
      // Uangnya sudah keluar: kantor tetap diberi tahu, sekali.
      expect((await lonceng(id)).filter((x) => (x.metadata as Record<string, unknown>).tidakTercatat === true)).toHaveLength(1);
    }
  });

  it("race: two payments paying back the same charge — one compare-and-swap, one audit row", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "r7", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const c = (await bebanDari(id))!;
    await lunasiDariBayaran(c.id, Number(c.amount));
    expect((await putuskanBarangReturPembeli({ returnId: id, keputusan: "KEMBALI_STOK", olehUserId: kantorB })).ok).toBe(true);
    const kembalikan = (ref: string) =>
      runSerializable((tx) =>
        catatPengembalianBebanDibayar(tx, {
          olehUserId: kantorA,
          waktu: new Date(),
          bulanBayar: "2026-12",
          paidRefType: "SpgCommission",
          paidRefId: `${tag}-kembali-${ref}`,
          kembali: [{ chargeId: c.id, jumlah: Number(c.amount) }],
        }),
      );
    const hasil = await Promise.allSettled([kembalikan("a"), tunda(5).then(() => kembalikan("b"))]);
    expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    const menang = hasil[0].status === "fulfilled" ? "a" : "b";
    const sesudah = (await bebanDari(id))!;
    expect([sesudah.paybackPaidRefId, sesudah.paybackPayoutMonth]).toEqual([`${tag}-kembali-${menang}`, "2026-12"]);
    expect((await jejak(c.id)).filter((x) => x.action === JEJAK.BEBAN_SPG_DIKEMBALIKAN)).toHaveLength(1);
  });

  it("race: amount change vs P82 reversal of the same charge — the charge always ends cancelled, never changed after it", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "r8", spgId, storeId, { uangSudah: true }));
    expect((await tolak(id)).ok).toBe(true);
    const asal = await jumlahBeban(id);
    // Ubah besar beban lebih pendek dari pembatalan (yang menerapkan persetujuan): digeser beberapa ms.
    const [batal, ubah] = await Promise.all([
      batalkanPenolakanReturPembeli({ returnId: id, olehUserId: kantorB, alasan: "keliru" }),
      tunda(5).then(() => ubahBesarBebanSpg({ returnId: id, olehUserId: kantorA, besar: 1_000, alasan: "struk kasir" })),
    ]);
    // Tidak ada yang dipotong, jadi pembatalan selalu boleh — di urutan mana pun.
    expect(batal.ok).toBe(true);
    expect((await laporan(id)).status).toBe("DISETUJUI");
    const c = (await bebanDari(id))!;
    expect(c.status).toBe("BATAL");
    const jejakBeban = await jejak(c.id);
    const dibatalkan = jejakBeban.filter((x) => x.action === JEJAK.BEBAN_SPG_DIBATALKAN);
    const diubah = jejakBeban.filter((x) => x.action === JEJAK.BEBAN_SPG_DIUBAH);
    expect(dibatalkan).toHaveLength(1);
    if (ubah.ok) {
      expect(Number(c.amount)).toBe(1_000);
      expect(diubah).toHaveLength(1);
      expect(diubah[0].createdAt.getTime()).toBeLessThanOrEqual(dibatalkan[0].createdAt.getTime());
    } else {
      expect(ubah).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
      expect(Number(c.amount)).toBe(asal);
      expect(diubah).toHaveLength(0);
    }
  });
});
