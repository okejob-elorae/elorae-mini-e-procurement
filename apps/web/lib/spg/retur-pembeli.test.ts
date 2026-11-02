import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { recordSpgSale } from "./sale-writer";
import {
  catatReturPembeli,
  kembaliPerNota,
  notaUntukKembali,
  rapikanBarisReturPembeli,
  setujuiReturPembeli,
  tarikReturPembeli,
  tolakReturPembeli,
} from "./retur-pembeli";
import { returPembeliSaya } from "./retur-pembeli-queries";
import { gerakLakuBersih } from "./laku-bersih";
import { JEJAK } from "@/lib/receivables/jejak";
import { KATEGORI_NOTIF_RETUR_PEMBELI } from "./retur-pembeli-status";

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
 * Terhadap basis data sungguhan: lapor → putuskan. Melapor tidak mengubah apa
 * pun; menyetujui menerapkan buku stok toko, `returnedQty`, `SalesHistory`, dan
 * jejak sekali; menolak dan menarik tidak menerapkan apa pun; penjaga sisa dan
 * keputusan di bawah balapan. SPG DIPINJAM; dua pengguna kantor dibuat tes ini.
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
  const lapor = (saleId: string, baris: Baris[], kunci: string, userId = spgId, toko = storeId) =>
    catatReturPembeli({ spgSaleId: saleId, storeId: toko, userId, baris, alasan: "ukuran tidak pas", idempotencyKey: `${tag}-${kunci}` }).then((h) => {
      if (h.ok && !returIds.includes(h.returnId)) returIds.push(h.returnId);
      return h;
    });
  const idDari = (h: Awaited<ReturnType<typeof lapor>>) => {
    if (!h.ok) throw new Error(`lapor gagal: ${h.alasan}`);
    return h.returnId;
  };
  const setujui = (returnId: string, oleh = kantorA) => setujuiReturPembeli({ returnId, olehUserId: oleh });
  const tolak = (returnId: string, alasan = "barang tidak sesuai nota", oleh = kantorA) => tolakReturPembeli({ returnId, olehUserId: oleh, alasan });
  const tarik = (returnId: string, alasan = "salah catat", userId = spgId, toko = storeId) => tarikReturPembeli({ returnId, userId, storeId: toko, alasan });

  const returnedQty = async (lineId: string) => (await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: seededId(lineId) } })).returnedQty;
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
    expect(setuju[0].metadata).toMatchObject({ bukuDitulis: 1, bukuDilewati: 0 });

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

  it("a sellable piece a store count saw after the report is not added to the book again — and it stops counting as sold", async () => {
    const n = await jual(2);
    const id = idDari(await lapor(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "LAYAK" }], "a"));
    const dilaporkan = (await laporan(id)).createdAt;
    const dihitung = new Date(dilaporkan.getTime() + 60_000);
    // Opname toko menghitung barangnya di rak SESUDAH dilaporkan, sebelum disetujui.
    await prisma.storeOpname.create({
      data: {
        storeId,
        countedById: spgId,
        countedAt: dihitung,
        lines: { create: [{ itemId, variantSku: `${tag}-M`, productName: `Kaos ${tag}`, qtySystem: 0, qtyCounted: 1, countedAt: dihitung }] },
      },
    });
    expect((await setujui(id)).ok).toBe(true);
    expect(await bukuRetur()).toHaveLength(0);
    const setuju = (await jejak(id)).find((x) => x.action === JEJAK.RETUR_PEMBELI_DISETUJUI);
    expect(setuju?.metadata).toMatchObject({ bukuDitulis: 0, bukuDilewati: 1 });
    // returnedQty dan SalesHistory tetap bergerak — barangnya memang kembali.
    expect(await returnedQty(n.lineId)).toBe(1);
    expect(await riwayat(n.docNo)).toEqual([2, 1, 1]);
    // Laku bersih: JUAL −2, dan retur LAYAK tanpa baris buku tetap mengurangi laku → laku 1.
    const gerak = await gerakLakuBersih([{ storeId }]);
    expect(-gerak.filter((g) => g.itemId === itemId).reduce((s, g) => s + g.qty, 0)).toBe(1);
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
    expect(kantor.riwayat[0]).toMatchObject({ langsungBerlaku: false, alasan: "ukuran tidak pas" });
    expect(kantor.riwayat[0].diputuskanOleh).not.toBeNull();
    expect(kantor.riwayat[0].diputuskanPada).not.toBeNull();
    expect(kantor.riwayat[1]).toMatchObject({ diputuskanOleh: null, diputuskanPada: null, langsungBerlaku: false });

    const saya = await returPembeliSaya(spgId, storeId);
    expect(saya.map((r) => [r.id, r.status, r.bisaDitarik])).toEqual([
      [menunggu, "MENUNGGU", true],
      [disetujui, "DISETUJUI", false],
    ]);
    expect(JSON.stringify(saya)).not.toMatch(/price|Price|total|lineTotal|nilai|discount/);
    expect(await returPembeliSaya(spgId, tokoLainId)).toEqual([]);
  });

  it("an old row written without a status reads as approved, effective since it was recorded", async () => {
    const n = await jual(2);
    const lama = await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: n.saleId,
        storeId,
        createdById: spgId,
        reason: "baris lama",
        idempotencyKey: `${tag}-lama`,
        lines: { create: [{ spgSaleLineId: n.lineId, itemId, variantSku: `${tag}-M`, qty: 1, condition: "RUSAK" }] },
      },
    });
    returIds.push(lama.id);
    expect(lama.status).toBe("DISETUJUI");
    expect(lama.decidedAt).toBeNull();
    const kantor = await kembaliPerNota(n.saleId);
    expect(kantor.riwayat[0]).toMatchObject({ status: "DISETUJUI", langsungBerlaku: true });
  });
});
