import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Aset tetap di basis data sungguhan, TAHUN 2000–2001 (tidak pernah berisi
 * data sungguhan). Peran aset dipalsukan ke akun uji milik tes ini — pemetaan
 * akun bersama tidak disentuh. Baris periode yang sudah ada sebelum tes tidak
 * dihapus.
 */
const akun = vi.hoisted(() => ({ aset: "", akum: "", beban: "", labaRugi: "", tanpaBeban: false }));
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: async (role: string, client?: unknown) => {
      if (role === "FIXED_ASSET") return akun.aset;
      if (role === "ACCUM_DEPRECIATION") return akun.akum;
      if (role === "DEPRECIATION_EXPENSE") {
        if (akun.tanpaBeban) throw new m.UnmappedRoleError("DEPRECIATION_EXPENSE" as never);
        return akun.beban;
      }
      if (role === "ASSET_DISPOSAL_GAIN_LOSS") return akun.labaRugi;
      return m.resolveAccount(role as never, client as never);
    },
  };
});

import { batalkanAset, batalkanPelepasan, catatAset, lepasAset, ubahAset } from "./writer";
import { postingPenyusutan, postingPenyusutanSatu } from "./penyusutan";
import { cariPenyusutanTanpaJurnal } from "./sapuan";
import { semuaSumberSapuan } from "@/lib/finance/sapuan/registri";
import { isianAwalAsetDariDokumen, rincianAset } from "./queries";
import { JEJAK_ASET } from "./jejak";
import type { IsianAset } from "./aturan";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const HARI_INI = "2001-12-31";
const TAHUN = [2000, 2001];

d("aset tetap — penulis & penyusutan (test bed only, 2000–2001)", () => {
  let token = "";
  let userId = "";
  let bank = "";
  let periodeLama: string[] = [];
  let voucherId = "";
  const asetIds: string[] = [];

  const isian = (x: Partial<IsianAset> = {}): IsianAset => ({
    nama: `Mesin uji ${token}`,
    kategori: "KELOMPOK_1",
    tanggalPerolehan: "2001-01-10",
    biaya: 48_000_000,
    cara: "JURNAL",
    akunLawanId: bank,
    ...x,
  });

  async function catat(x: Partial<IsianAset> = {}) {
    const r = await catatAset({ ...isian(x), olehUserId: userId, hariIni: HARI_INI });
    if (!r.ok) throw new Error(`catatAset gagal: ${r.kode}`);
    asetIds.push(r.id);
    return r;
  }

  const saldo = async (akunId: string, journalIds?: string[]) => {
    const s = await prisma.journalLine.aggregate({
      where: { chartAccountId: akunId, journal: { status: "POSTED", postedById: userId, ...(journalIds ? { id: { in: journalIds } } : {}) } },
      _sum: { debit: true, credit: true },
    });
    return Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0);
  };

  beforeAll(async () => {
    userId = "";
    bank = "";
    akun.aset = "";
    akun.akum = "";
    akun.beban = "";
    akun.labaRugi = "";
    akun.tanpaBeban = false;
    periodeLama = [];
    voucherId = "";
    asetIds.length = 0;
    token = Math.floor(Math.random() * 10_000_000).toString();
    periodeLama = (await prisma.accountingPeriod.findMany({ where: { year: { in: TAHUN } }, select: { id: true } })).map((p) => p.id);
    userId = (await prisma.user.create({ data: { email: `uji-aset-${token}@test.local`, name: "Uji aset" } })).id;
    const buat = (kode: string, nama: string, type: "ASET" | "BEBAN" | "PENDAPATAN") => prisma.chartAccount.create({ data: { code: `9${token}${kode}`, name: nama, type, depth: 1 } });
    akun.aset = (await buat("81", "Aset tetap uji", "ASET")).id;
    akun.akum = (await buat("82", "Akumulasi uji", "ASET")).id;
    akun.beban = (await buat("83", "Beban penyusutan uji", "BEBAN")).id;
    akun.labaRugi = (await buat("84", "Laba rugi pelepasan uji", "PENDAPATAN")).id;
    bank = (await buat("85", "Bank uji aset", "ASET")).id;
  });

  afterAll(async () => {
    const ids = [...asetIds];
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const n = await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, metadata: true } });
        const milik = n
          .filter((x) => {
            const docId = String((x.metadata as Record<string, unknown> | null)?.docId ?? "");
            return ids.some((id) => docId.startsWith(`${id}/`));
          })
          .map((x) => x.id);
        if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      },
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        const jid = j.map((x) => x.id);
        if (!jid.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jid) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jid) }, reversalOfId: { not: null } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jid) } } });
      },
      async () => {
        if (ids.length) await prisma.fixedAsset.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      async () => {
        if (voucherId) await prisma.cashVoucher.delete({ where: { id: voucherId } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } }),
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: { in: TAHUN } }, select: { id: true } });
        const baru = p.map((x) => x.id).filter((id) => !periodeLama.includes(id));
        if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(akun.aset), seededId(akun.akum), seededId(akun.beban), seededId(akun.labaRugi), seededId(bank)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[aset writer.test] teardown", e);
      }
    }
  }, 60_000);

  it("mencatat aset dengan jurnal perolehan: DR aset / CR bank, bertanggal perolehan; kunci idempoten", async () => {
    const kunci = `aset-${token}`;
    const r = await catatAset({ ...isian(), olehUserId: userId, hariIni: HARI_INI, idempotencyKey: kunci });
    if (!r.ok) throw new Error(r.kode);
    asetIds.push(r.id);
    expect(r.kode).toMatch(/^AT\//);
    const j = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "FIXED_ASSET", sourceId: r.id } },
      select: { date: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    expect(j.date.toISOString()).toBe("2001-01-09T17:00:00.000Z");
    expect(j.lines.find((l) => l.chartAccountId === akun.aset)?.debit.toString()).toBe("48000000");
    expect(j.lines.find((l) => l.chartAccountId === bank)?.credit.toString()).toBe("48000000");
    const ulang = await catatAset({ ...isian(), olehUserId: userId, hariIni: HARI_INI, idempotencyKey: kunci });
    expect(ulang).toEqual({ ok: true, id: r.id, ulang: true });
    expect(await prisma.auditLog.count({ where: { action: JEJAK_ASET.DICATAT, entityId: r.id } })).toBe(1);
  });

  it("penyusutan bulanan: satu jurnal per bulan, bertanggal hari terakhir, idempoten", async () => {
    const r = await catat();
    const h = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 3 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
    expect(h).toMatchObject({ diposting: 3, totalNilai: 3_000_000, gagal: [] });
    const rows = await prisma.fixedAssetDepreciation.findMany({ where: { assetId: r.id }, orderBy: { period: "asc" }, select: { period: true, amount: true, journalId: true } });
    expect(rows.map((x) => [x.period, Number(x.amount)])).toEqual([
      ["2001-01", 1_000_000],
      ["2001-02", 1_000_000],
      ["2001-03", 1_000_000],
    ]);
    const jan = await prisma.journal.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "DEPRECIATION", sourceId: `${r.id}/2001-01` } }, select: { date: true } });
    expect(jan.date.toISOString()).toBe("2001-01-30T17:00:00.000Z");
    expect(await saldo(akun.akum, rows.map((x) => x.journalId!))).toBe(-3_000_000);
    const lagi = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 3 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
    expect(lagi.diposting).toBe(0);
  });

  it("bulan yang ditutup dilewati tanpa baris; nilainya disusulkan bulan terbuka berikutnya", async () => {
    const r = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2000-05-02" });
    await prisma.accountingPeriod.upsert({ where: { year_month: { year: 2000, month: 6 } }, create: { year: 2000, month: 6, status: "CLOSED" }, update: { status: "CLOSED" } });
    try {
      const h = await postingPenyusutan({ sampai: { tahun: 2000, bulan: 7 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
      expect(h).toMatchObject({ diposting: 2, periodeDitutup: 1 });
      const rows = await prisma.fixedAssetDepreciation.findMany({ where: { assetId: r.id }, orderBy: { period: "asc" }, select: { period: true, amount: true } });
      expect(rows.map((x) => [x.period, Number(x.amount)])).toEqual([
        ["2000-05", 1_000_000],
        ["2000-07", 2_000_000],
      ]);
    } finally {
      await prisma.accountingPeriod.update({ where: { year_month: { year: 2000, month: 6 } }, data: { status: "OPEN" } });
    }
  });

  it("aset lama: akumulasi awal menutup bulan sebelumnya; mulai dari bulan tanggal mulai buku besar", async () => {
    const r = await catat({ cara: "SALDO_AWAL", akunLawanId: null, tanggalPerolehan: "2000-01-15", akumulasiAwal: 12_000_000 });
    const h = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 1 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: new Date("2000-12-31T17:00:00.000Z") });
    expect(h).toMatchObject({ diposting: 1, totalNilai: 1_000_000 });
    expect(await prisma.journal.count({ where: { sourceType: "FIXED_ASSET", sourceId: r.id } })).toBe(0);
  });

  it("peran belum dipetakan: berhenti di bulan itu dan menulis JOURNAL_PENDING", async () => {
    const r = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2001-06-01" });
    akun.tanpaBeban = true;
    try {
      const h = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 7 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
      expect(h.diposting).toBe(0);
      expect(h.gagal).toEqual([expect.objectContaining({ asetId: r.id, periode: "2001-06", kodeGalat: "UNMAPPED_ROLE", peran: "DEPRECIATION_EXPENSE" })]);
      const n = await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING", readAt: null }, select: { metadata: true } });
      expect(n.some((x) => (x.metadata as Record<string, unknown>)?.docId === `${r.id}/2001-06`)).toBe(true);
    } finally {
      akun.tanpaBeban = false;
    }
    const pulih = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 7 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
    expect(pulih.diposting).toBe(2);
    const n = await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { metadata: true, readAt: true } });
    expect(n.find((x) => (x.metadata as Record<string, unknown>)?.docId === `${r.id}/2001-06`)?.readAt).not.toBeNull();
  });

  it("pelepasan: penyusutan disusulkan, laba pelepasan, batal pelepasan, dan pelepasan ulang bergenerasi", async () => {
    const r = await catat({ tanggalPerolehan: "2001-01-10" });
    const lepas = await lepasAset({ id: r.id, tanggal: "2001-04-20", hasilJual: "50.000.000", akunPenerimaanId: bank, olehUserId: userId, hariIni: HARI_INI, tanggalMulai: null });
    expect(lepas).toMatchObject({ ok: true });
    const rows = await prisma.fixedAssetDepreciation.findMany({ where: { assetId: r.id }, select: { period: true } });
    expect(rows.map((x) => x.period).sort()).toEqual(["2001-01", "2001-02", "2001-03"]);
    const j = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "ASSET_DISPOSAL", sourceId: r.id } },
      select: { id: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    const baris = (id: string) => j.lines.find((l) => l.chartAccountId === id);
    expect(Number(baris(akun.akum)?.debit)).toBe(3_000_000);
    expect(Number(baris(bank)?.debit)).toBe(50_000_000);
    expect(Number(baris(akun.aset)?.credit)).toBe(48_000_000);
    expect(Number(baris(akun.labaRugi)?.credit)).toBe(5_000_000);
    const a = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, disposalProceeds: true } });
    expect(a.status).toBe("DISPOSED");
    // Bulan pelepasan dan sesudahnya tidak disusutkan.
    expect((await postingPenyusutan({ sampai: { tahun: 2001, bulan: 6 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null })).diposting).toBe(0);
    expect(await lepasAset({ id: r.id, tanggal: "2001-04-21", hasilJual: 0, olehUserId: userId, hariIni: HARI_INI, tanggalMulai: null })).toEqual({ ok: false, kode: "BUKAN_AKTIF" });

    expect(await batalkanPelepasan({ id: r.id, alasan: "x", olehUserId: userId })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const batal = await batalkanPelepasan({ id: r.id, alasan: "Salah catat pembeli", olehUserId: userId, tanggal: "2001-04-25" });
    expect(batal).toMatchObject({ ok: true });
    const balik = await prisma.journal.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "ASSET_DISPOSAL_REVERSAL", sourceId: r.id } }, select: { reversalOfId: true } });
    expect(balik.reversalOfId).toBe(j.id);
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: r.id }, select: { status: true } })).status).toBe("ACTIVE");

    const lagi = await lepasAset({ id: r.id, tanggal: "2001-05-02", hasilJual: 0, olehUserId: userId, hariIni: HARI_INI, tanggalMulai: null });
    expect(lagi).toMatchObject({ ok: true });
    const kedua = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "ASSET_DISPOSAL", sourceId: `${r.id}#2` } },
      select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    // April disusutkan sesudah pelepasan pertama dibatalkan: akumulasi 4 jt, rugi = nilai buku 44 jt.
    expect(Number(kedua.lines.find((l) => l.chartAccountId === akun.akum)?.debit)).toBe(4_000_000);
    expect(Number(kedua.lines.find((l) => l.chartAccountId === akun.labaRugi)?.debit)).toBe(44_000_000);
    const rinci = await rincianAset(r.id, new Date("2001-06-01T00:00:00Z"));
    expect(rinci?.jurnal.map((x) => x.jenis)).toEqual(["FIXED_ASSET", "ASSET_DISPOSAL", "ASSET_DISPOSAL_REVERSAL", "ASSET_DISPOSAL"]);
    expect(rinci?.jadwal.find((x) => x.periode === "2001-05")?.keadaan).toBe("SESUDAH_LEPAS");
  });

  it("membatalkan dan mengubah aset: hanya sebelum ada penyusutan berjurnal", async () => {
    const r = await catat({ tanggalPerolehan: "2001-08-01" });
    expect(await ubahAset({ ...isian({ tanggalPerolehan: "2001-08-01", nama: "Mesin diganti nama" }), id: r.id, olehUserId: userId, hariIni: HARI_INI })).toEqual({ ok: true, id: r.id });
    expect(
      await ubahAset({ ...isian({ tanggalPerolehan: "2001-08-01", biaya: 40_000_000 }), id: r.id, olehUserId: userId, hariIni: HARI_INI }),
    ).toEqual({ ok: false, kode: "ADA_JURNAL_PEROLEHAN" });
    await postingPenyusutan({ sampai: { tahun: 2001, bulan: 8 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null });
    expect(await batalkanAset({ id: r.id, alasan: "Salah catat", olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DISUSUTKAN" });

    const s = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2001-09-01" });
    expect(await ubahAset({ ...isian({ cara: "SUDAH_DICATAT", tanggalPerolehan: "2001-09-01", biaya: 24_000_000 }), id: s.id, olehUserId: userId, hariIni: HARI_INI })).toEqual({
      ok: true,
      id: s.id,
    });
    expect(Number((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: s.id }, select: { cost: true } })).cost)).toBe(24_000_000);

    const t = await catat({ tanggalPerolehan: "2001-10-01" });
    const b = await batalkanAset({ id: t.id, alasan: "Dobel catat", olehUserId: userId, tanggal: "2001-10-05" });
    expect(b).toMatchObject({ ok: true });
    const balik = await prisma.journal.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "FIXED_ASSET_REVERSAL", sourceId: t.id } }, select: { lines: { select: { chartAccountId: true, credit: true } } } });
    expect(Number(balik.lines.find((l) => l.chartAccountId === akun.aset)?.credit)).toBe(48_000_000);
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: t.id }, select: { status: true } })).status).toBe("CANCELLED");
  });

  it("jurnal perolehan ke bulan tertutup ditolak dan asetnya tidak tercatat", async () => {
    await prisma.accountingPeriod.upsert({ where: { year_month: { year: 2000, month: 3 } }, create: { year: 2000, month: 3, status: "CLOSED" }, update: { status: "CLOSED" } });
    try {
      const sebelum = await prisma.fixedAsset.count({ where: { createdById: userId } });
      expect(await catatAset({ ...isian({ tanggalPerolehan: "2000-03-15" }), olehUserId: userId, hariIni: HARI_INI })).toEqual({ ok: false, kode: "PERIOD_CLOSED" });
      expect(await prisma.fixedAsset.count({ where: { createdById: userId } })).toBe(sebelum);
    } finally {
      await prisma.accountingPeriod.update({ where: { year_month: { year: 2000, month: 3 } }, data: { status: "OPEN" } });
    }
  });

  it("sapuan: bulan tanpa penyusutan ditemukan dan diposting lewat registri", async () => {
    const r = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2001-11-03" });
    const ditemukan = await cariPenyusutanTanpaJurnal({ sejak: new Date("2001-10-31T17:00:00.000Z"), sampai: new Date("2001-12-31T16:59:59.999Z"), batas: 500 });
    const milik = ditemukan.filter((x) => x.id.startsWith(`${r.id}/`));
    expect(milik.map((x) => x.id)).toEqual([`${r.id}/2001-11`, `${r.id}/2001-12`]);
    const sumber = semuaSumberSapuan().find((s) => s.sourceType === "DEPRECIATION");
    expect(sumber).toBeDefined();
    const h = await sumber!.posting(`${r.id}/2001-11`, userId);
    expect(h).toMatchObject({ ok: true, created: true });
    const lagi = await cariPenyusutanTanpaJurnal({ sejak: new Date("2001-10-31T17:00:00.000Z"), sampai: new Date("2001-12-31T16:59:59.999Z"), batas: 500 });
    expect(lagi.filter((x) => x.id.startsWith(`${r.id}/`)).map((x) => x.id)).toEqual([`${r.id}/2001-12`]);
  });

  it("isian awal dari voucher kas: baris berakun ASET menjadi akun dan nilai aset, cara sudah dicatat", async () => {
    const v = await prisma.cashVoucher.create({
      data: {
        docNumber: `UJI-BKK-${token}`,
        type: "OUT",
        date: new Date("2001-06-09T17:00:00.000Z"),
        cashAccountId: bank,
        totalAmount: 7_500_000,
        netAmount: 7_500_000,
        description: "Beli laptop",
        createdById: userId,
        lines: {
          create: [
            { chartAccountId: akun.beban, amount: 500_000, memo: "Ongkir", sortOrder: 0 },
            { chartAccountId: akun.aset, amount: 7_000_000, memo: "Laptop desain", sortOrder: 1 },
          ],
        },
      },
      select: { id: true },
    });
    voucherId = v.id;
    expect(await isianAwalAsetDariDokumen({ voucher: v.id })).toEqual({
      nama: "Laptop desain",
      tanggalPerolehan: "2001-06-10",
      biaya: "7000000",
      akunAsetId: akun.aset,
      catatan: `Dari voucher UJI-BKK-${token}`,
      cara: "SUDAH_DICATAT",
    });
    expect(await isianAwalAsetDariDokumen({ voucher: "tidak-ada" })).toBeNull();
  });

  it("dua posting penyusutan yang balapan untuk aset-bulan yang sama: satu jurnal, satu baris", async () => {
    const r = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2001-09-05" });
    const hasil = await Promise.all([
      postingPenyusutanSatu(r.id, { tahun: 2001, bulan: 9 }, userId),
      postingPenyusutanSatu(r.id, { tahun: 2001, bulan: 9 }, userId),
    ]);
    expect(hasil.map((h) => h.status).sort()).toEqual(["DIPOSTING", "SUDAH_ADA"]);
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: r.id } })).toBe(1);
    expect(await prisma.journal.count({ where: { sourceType: "DEPRECIATION", sourceId: `${r.id}/2001-09` } })).toBe(1);
  });

  it("bulan yang belum berakhir (WIB) tidak disusutkan dan tidak dihitung terlewat oleh sapuan", async () => {
    const r = await catat({ cara: "SUDAH_DICATAT", akunLawanId: null, tanggalPerolehan: "2001-06-04" });
    // "Sekarang" 30 Juni 2001 10:00 WIB: Juni belum berakhir walau tanggal jurnalnya (30 Juni 00:00 WIB) sudah lewat.
    const sekarang = new Date("2001-06-30T03:00:00.000Z");
    expect(await postingPenyusutanSatu(r.id, { tahun: 2001, bulan: 6 }, userId, sekarang)).toEqual({ status: "BELUM_BERAKHIR" });
    const h = await postingPenyusutan({ sampai: { tahun: 2001, bulan: 6 }, olehUserId: userId, asetIds: [r.id], tanggalMulai: null, sekarang });
    expect(h.diposting).toBe(0);
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: r.id } })).toBe(0);
    // Sapuan pada saat yang sama tidak menganggap Juni terlewat; sesudah bulan berakhir, ya.
    const sapu = (sampai: Date) => cariPenyusutanTanpaJurnal({ sejak: new Date("2001-05-31T17:00:00.000Z"), sampai, batas: 500 });
    expect((await sapu(sekarang)).filter((x) => x.id.startsWith(`${r.id}/`))).toEqual([]);
    expect((await sapu(new Date("2001-06-30T16:59:59.999Z"))).filter((x) => x.id.startsWith(`${r.id}/`)).map((x) => x.id)).toEqual([`${r.id}/2001-06`]);
    // Sesudah tengah malam WIB bulan itu diposting.
    const sesudah = new Date("2001-06-30T17:00:00.000Z");
    expect(await postingPenyusutanSatu(r.id, { tahun: 2001, bulan: 6 }, userId, sesudah)).toMatchObject({ status: "DIPOSTING" });
  });
});
