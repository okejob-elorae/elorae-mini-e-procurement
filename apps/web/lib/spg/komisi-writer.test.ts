import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { JEJAK_KOMISI_SPG } from "./komisi";
import { payloadGajiHp } from "./komisi-hp";
import { daftarKomisiKantor } from "./komisi-queries";
import { tandaiKomisiDibayar, tetapkanKomisiToko } from "./komisi-writer";
import { KUNCI_KOMISI_PUTUS } from "./pengaturan";
import { gajiKomisiSpg, tokoSpg } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Komisi SPG toko putus terhadap basis data sungguhan: hitungan dari nota dan
 * pengembalian sebulan WIB, penetapan (ulang) dengan jejak, penjaga bayar di
 * bawah balapan, halaman kantor, dan isi HP yang tidak pernah membawa rupiah
 * rekan. Semua baris diseed di sini; penghapusan lewat `seededId(s)`.
 */
d("komisi SPG toko putus (test bed only)", () => {
  const tag = `KSP${Math.random().toString(36).slice(2, 8)}`;
  const PERIODE = "2026-08";
  let uomId = "";
  let kaos = "";
  let topi = "";
  let putus = "";
  let putusKosong = "";
  let konsi = "";
  let spgA = "";
  let spgB = "";
  let spgK = "";
  let kantor = "";
  const nota: string[] = [];
  let setelanAwal: string | null = null;
  let nomor = 0;

  const tokoIds = () => seededIds([putus, putusKosong, konsi].filter(Boolean));

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_KOMISI_PUTUS }, select: { value: true } });
    setelanAwal = ada?.value ?? null;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (kode: string, komisi: number) =>
      (
        await prisma.item.create({
          data: { sku: `${tag}-${kode}`, nameId: `${kode} ${tag}`, nameEn: kode, type: "FINISHED_GOOD", uomId, sellingPrice: 50_000, commissionPerPcs: komisi },
        })
      ).id;
    kaos = await barang("KAOS", 2_000);
    topi = await barang("TOPI", 1_500);

    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putus = await toko("PUTUS", "PUTUS");
    putusKosong = await toko("KOSONG", "PUTUS");
    konsi = await toko("KONSI", "KONSI");

    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("Ani", putus);
    spgB = await orang("Budi", putus);
    spgK = await orang("Kirana", konsi);
    kantor = await orang("Kantor", null);
  });

  afterEach(async () => {
    const audit = await prisma.auditLog.findMany({ where: { entityType: "SpgCommission" }, select: { id: true, metadata: true } });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return typeof m?.storeId === "string" && tokoIds().includes(m.storeId);
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;
  });

  afterAll(async () => {
    if (setelanAwal === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_KOMISI_PUTUS) } });
    else await prisma.systemSetting.update({ where: { key: KUNCI_KOMISI_PUTUS }, data: { value: setelanAwal } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB, spgK, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, topi].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function aturan(nilai: Record<string, unknown> | null) {
    if (nilai === null) {
      await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_KOMISI_PUTUS) } });
      return;
    }
    const v = JSON.stringify(nilai);
    await prisma.systemSetting.upsert({ where: { key: KUNCI_KOMISI_PUTUS }, create: { key: KUNCI_KOMISI_PUTUS, value: v }, update: { value: v } });
  }

  async function jual(salesmanId: string, storeId: string, waktu: Date, baris: { itemId: string; qty: number }[]) {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${nomor++}`,
        salesmanId,
        storeId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt: waktu,
        lines: { create: baris.map((b) => ({ itemId: b.itemId, productName: "uji", qty: b.qty, unitPrice: 50_000, lineTotal: 50_000 * b.qty })) },
      },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    nota.push(s.id);
    return s;
  }

  async function kembalikan(sale: { id: string; lines: { id: string; itemId: string }[] }, storeId: string, qty: number, waktu: Date) {
    await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: sale.id,
        storeId,
        createdById: kantor,
        reason: "uji",
        idempotencyKey: `${tag}-r${nomor++}`,
        createdAt: waktu,
        lines: { create: [{ spgSaleLineId: sale.lines[0].id, itemId: sale.lines[0].itemId, qty }] },
      },
    });
  }

  /** Agustus: Ani 3 kaos + 1 topi; Budi 5 kaos, 2 dikembalikan; nota di luar bulan diabaikan. */
  async function agustus() {
    await jual(spgA, putus, new Date("2026-08-10T10:00:00+07:00"), [
      { itemId: kaos, qty: 3 },
      { itemId: topi, qty: 1 },
    ]);
    const b = await jual(spgB, putus, new Date("2026-08-31T23:30:00+07:00"), [{ itemId: kaos, qty: 5 }]);
    await kembalikan(b, putus, 2, new Date("2026-08-31T23:45:00+07:00"));
    await jual(spgA, putus, new Date("2026-07-31T23:30:00+07:00"), [{ itemId: kaos, qty: 10 }]);
    await jual(spgB, putus, new Date("2026-09-01T00:10:00+07:00"), [{ itemId: kaos, qty: 10 }]);
  }

  const baris = (storeId = putus) =>
    prisma.spgCommission.findMany({
      where: { storeId: seededId(storeId), period: PERIODE },
      orderBy: { commission: "desc" },
      select: { id: true, userId: true, unitsSold: true, commission: true, basis: true, lockedById: true, paidAt: true },
    });

  const jejak = async () => {
    const semua = await prisma.auditLog.findMany({
      where: { entityType: "SpgCommission" },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityId: true, changes: true, metadata: true },
    });
    return semua.filter((a) => (a.metadata as Record<string, unknown> | null)?.storeId === putus);
  };

  it("defaults to PER_SPG: each SPG's own net pieces × rate, WIB month bounds, audit with before = null", async () => {
    await aturan(null);
    await agustus();

    const h = await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });
    expect(h).toEqual({ ok: true, ulang: false, ditulis: 2, dihapus: 0, totalToko: 13_500 });

    const r = await baris();
    expect(r.map((x) => [x.userId, x.unitsSold, Number(x.commission), x.basis, x.lockedById, x.paidAt])).toEqual([
      [spgA, 4, 7_500, "PER_SPG", kantor, null],
      [spgB, 3, 6_000, "PER_SPG", kantor, null],
    ]);

    const j = await jejak();
    expect(j.map((x) => x.action)).toEqual([JEJAK_KOMISI_SPG.DITETAPKAN, JEJAK_KOMISI_SPG.DITETAPKAN]);
    expect(j.find((x) => x.entityId === r[0].id)?.changes).toEqual({ before: null, after: { unitsSold: 4, commission: 7_500, basis: "PER_SPG", deduction: 0 } });
  });

  it("BAGI_RATA splits the store's net commission between the store's SPGs", async () => {
    await aturan({ aktif: true, dasar: "BAGI_RATA" });
    await agustus();
    expect((await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor })).ok).toBe(true);
    const r = await baris();
    expect(r.map((x) => [Number(x.commission), x.basis])).toEqual([
      [6_750, "BAGI_RATA"],
      [6_750, "BAGI_RATA"],
    ]);
  });

  it("re-locks after a late receipt, with the replaced figures in the trail, and the office sees the drift first", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await agustus();
    await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });

    // Nota dari antrean HP yang baru tersinkron, bertanggal Agustus.
    await jual(spgA, putus, new Date("2026-08-20T12:00:00+07:00"), [{ itemId: kaos, qty: 2 }]);
    const kantorLihat = (await daftarKomisiKantor(PERIODE, new Date())).toko.find((t) => t.storeId === putus);
    expect(kantorLihat?.berbeda).toBe(true);
    expect(kantorLihat?.baris.find((b) => b.userId === spgA)).toMatchObject({ potong: 6, komisi: 11_500, status: "DITETAPKAN" });

    const h = await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });
    expect(h).toMatchObject({ ok: true, ulang: true, ditulis: 2 });
    const r = await baris();
    expect(r.map((x) => [x.userId, Number(x.commission)])).toEqual([
      [spgA, 11_500],
      [spgB, 6_000],
    ]);
    const ulang = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.DITETAPKAN_ULANG);
    expect(ulang).toHaveLength(2);
    expect(ulang.find((x) => x.entityId === r[0].id)?.changes).toEqual({
      before: { unitsSold: 4, commission: 7_500, basis: "PER_SPG", deduction: 0 },
      after: { unitsSold: 6, commission: 11_500, basis: "PER_SPG", deduction: 0 },
    });
    expect((await daftarKomisiKantor(PERIODE, new Date())).toko.find((t) => t.storeId === putus)?.berbeda).toBe(false);
  });

  it("refuses an unfinished month, a consignment store, a switched-off rule, and a store without SPG", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    expect(await tetapkanKomisiToko({ storeId: putus, periode: bulanWib(new Date()), olehUserId: kantor })).toEqual({ ok: false, code: "BULAN_BELUM_SELESAI" });
    expect(await tetapkanKomisiToko({ storeId: putus, periode: "2026-8", olehUserId: kantor })).toEqual({ ok: false, code: "PERIODE_TIDAK_SAH" });
    expect(await tetapkanKomisiToko({ storeId: konsi, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "BUKAN_TOKO_PUTUS" });
    expect(await tetapkanKomisiToko({ storeId: putusKosong, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "TANPA_SPG" });
    await aturan({ aktif: false, dasar: "PER_SPG" });
    expect(await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "KOMISI_MATI" });
    expect(await baris()).toEqual([]);
  });

  it("two first locks at once end with one row per SPG", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await agustus();
    const [a, b] = await Promise.all([
      tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor }),
      tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await baris()).map((x) => Number(x.commission))).toEqual([7_500, 6_000]);
  });

  it("marks paid exactly once under a race, then refuses to re-lock the store's month", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await agustus();
    await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });
    const [ani] = await baris();

    const hasil = await Promise.all([
      tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor, catatan: "transfer" }),
      tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_DIBAYAR" }]);

    const dibayar = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.DIBAYAR);
    expect(dibayar).toHaveLength(1);
    expect((dibayar[0].changes as { before: unknown }).before).toEqual({ paidAt: null });
    expect((await baris())[0].paidAt).not.toBeNull();

    expect(await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await tandaiKomisiDibayar({ commissionId: "tidak-ada", olehUserId: kantor })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(await tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor, catatan: "x".repeat(501) })).toEqual({
      ok: false,
      code: "CATATAN_TERLALU_PANJANG",
    });
  });

  it("lists PUTUS stores with their SPGs for the office, and consignment stores only as a link", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await agustus();
    const data = await daftarKomisiKantor(PERIODE, new Date());
    const t = data.toko.find((x) => x.storeId === putus);
    expect(t?.baris.map((b) => [b.userId, b.potong, b.komisi, b.status])).toEqual([
      [spgA, 4, 7_500, "BELUM"],
      [spgB, 3, 6_000, "BELUM"],
    ]);
    expect(t).toMatchObject({ potongToko: 7, totalToko: 13_500, adaResmi: false });
    expect(data.toko.some((x) => x.storeId === putusKosong)).toBe(false);
    expect(data.toko.some((x) => x.storeId === konsi)).toBe(false);
    expect(data.tokoKonsi.find((x) => x.storeId === konsi)).toMatchObject({ jumlahSpg: 1, siklusId: null });
    expect(data.bulanSelesai).toBe(true);
  });

  describe("HP SPG", () => {
    const fmt = { bulan: (p: string) => p, tanggal: (iso: string) => iso.slice(0, 10) };

    async function bulanIni() {
      await jual(spgA, putus, new Date(), [{ itemId: kaos, qty: 2 }]);
      await jual(spgB, putus, new Date(), [{ itemId: kaos, qty: 4 }]);
    }

    it("PER_SPG: only her own share and pieces reach the phone — never a colleague's rupiah, name or id", async () => {
      await aturan({ aktif: true, dasar: "PER_SPG" });
      await agustus();
      await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });
      await bulanIni();

      const toko = await tokoSpg(spgA);
      const g = await gajiKomisiSpg(spgA, toko, new Date());
      expect(g.perkiraan).toMatchObject({ jenis: "PUTUS", dasar: "PER_SPG", bagianSaya: 4_000, potongSaya: 2, totalToko: 4_000 });
      expect(g.resmi.filter((r) => r.jenis === "PUTUS").map((r) => [r.periode, r.komisi, r.potong])).toEqual([[PERIODE, 7_500, 4]]);

      const json = JSON.stringify(payloadGajiHp(g, false, fmt));
      expect(json).not.toContain(spgB);
      expect(json).not.toContain("Budi");
      // Komisi Budi bulan ini (8.000) dan Agustus (6.000), dan total toko (12.000 / 13.500).
      for (const angka of ["8000", "6000", "12000", "13500"]) expect(json).not.toContain(angka);
      expect(JSON.parse(json).perkiraan).toMatchObject({ bagianSaya: 4_000, totalToko: null, potongToko: null });
    });

    it("BAGI_RATA: her share and the store total, still nothing of the colleague by name or id", async () => {
      await aturan({ aktif: true, dasar: "BAGI_RATA" });
      await bulanIni();
      const g = await gajiKomisiSpg(spgB, await tokoSpg(spgB), new Date());
      expect(g.perkiraan).toMatchObject({ dasar: "BAGI_RATA", totalToko: 12_000, bagianSaya: 6_000, potongToko: 6, jumlahSpg: 2 });
      const json = JSON.stringify(payloadGajiHp(g, false, fmt));
      expect(json).not.toContain(spgA);
      expect(json).not.toContain("Ani");
    });

    it("no estimate at a PUTUS store while the rule is off; a consignment store is always split evenly", async () => {
      await aturan({ aktif: false, dasar: "PER_SPG" });
      await bulanIni();
      expect((await gajiKomisiSpg(spgA, await tokoSpg(spgA), new Date())).perkiraan).toBeNull();

      await jual(spgK, konsi, new Date(), [{ itemId: topi, qty: 2 }]);
      const k = await gajiKomisiSpg(spgK, await tokoSpg(spgK), new Date());
      expect(k.perkiraan).toMatchObject({ jenis: "KONSI", dasar: "BAGI_RATA", bagianSaya: 3_000, totalToko: 3_000, jumlahSpg: 1 });
    });
  });
});
