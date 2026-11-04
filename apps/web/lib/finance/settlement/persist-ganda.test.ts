import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  AKSI_HAPUS_SETTLEMENT,
  hapusSettlementBelumDijurnal,
  persistSettlement,
  SettlementGandaError,
  tandaiSettlementGanda,
} from "./persist";
import type { ParsedSettlement } from "./shopee-settlement-parser";

/**
 * Settlement yang sama tidak boleh tersimpan dua kali: jurnalnya berkunci id
 * settlement, jadi unggahan kedua = bank didebit dan piutang dikredit dua kali.
 * Terhadap basis data sungguhan, karena penjaganya hidup di kueri dan
 * transaksinya (termasuk balapan dua unggahan bersamaan).
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/** Periode jauh di depan + penjual acak: tidak ada settlement sungguhan yang kembar dengannya. */
function bangun(token: string, dilepas = 12_345_678.5, lain: Partial<ParsedSettlement> = {}): ParsedSettlement {
  return {
    seller: `uji-${token}`,
    periodFrom: "2031-03-01",
    periodTo: "2031-03-31",
    summary: { totalPendapatan: 15_000_000, totalPengeluaran: -2_654_321.5, totalDilepas: dilepas, raw: {} },
    incomeLines: [
      {
        orderNo: `${token}-A`,
        netIncome: dilepas,
        hargaAsliProduk: 15_000_000,
        totalDiskonProduk: 0,
        biayaAdministrasi: -1_200_000,
        biayaLayanan: -900_000,
        biayaKomisiAms: -300_000,
        biayaProsesPesanan: -254_321.5,
        raw: {},
      },
    ],
    sellerFeesRaw: [],
    adjustmentsRaw: [],
    parsedNetTotal: dilepas,
    ...lain,
  };
}

d("settlement ganda (test bed only)", () => {
  let token = "";
  let userId = "";
  const settlementIds: string[] = [];
  let journalId = "";

  beforeEach(async () => {
    token = "";
    userId = "";
    journalId = "";
    settlementIds.length = 0;
    token = Math.random().toString(36).slice(2, 10);
    userId = (await prisma.user.create({ data: { email: `stl-${token}@uji.local`, name: `Keuangan ${token}` } })).id;
  });

  afterEach(async () => {
    // Settlement yang mungkin tercipta di jalur galat juga ikut: dicari lewat penjual acaknya.
    const semua = token.length >= 6
      ? await prisma.settlement.findMany({ where: { seller: `uji-${token}` }, select: { id: true } })
      : [];
    const ids = [...new Set([...settlementIds, ...semua.map((s) => s.id)])];
    if (journalId) await prisma.journal.delete({ where: { id: seededId(journalId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.settlementLine.deleteMany({ where: { settlementId: { in: seededIds(ids) } } });
    await prisma.settlement.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  async function unggah(parsed: ParsedSettlement, fileName = "Income.sudah dilepas.xlsx", marketplace = "SHOPEE") {
    const r = await persistSettlement({ parsed, fileName, uploadedById: userId, marketplace });
    settlementIds.push(r.settlementId);
    return r;
  }

  it("menolak berkas yang sama diunggah kedua kali, dan menyebut unggahan pertamanya", async () => {
    const pertama = await unggah(bangun(token), "juni-pertama.xlsx");

    const gagal = await unggah(bangun(token), "juni-kedua.xlsx").catch((e: unknown) => e);
    expect(gagal).toBeInstanceOf(SettlementGandaError);
    const e = gagal as SettlementGandaError;
    expect(e.pertama.id).toBe(pertama.settlementId);
    expect(e.pertama.fileName).toBe("juni-pertama.xlsx");
    expect(e.pertama.uploadedAt).toBeInstanceOf(Date);
    expect(e.pertama.uploadedByName).toBe(`Keuangan ${token}`);

    // Tidak ada baris kedua, dan tidak ada baris order kedua.
    expect(await prisma.settlement.count({ where: { seller: `uji-${token}` } })).toBe(1);
    expect(await prisma.settlementLine.count({ where: { orderNo: `${token}-A` } })).toBe(1);
  });

  it("tetap menerima periode yang sama dengan uang dilepas yang berbeda, atau toko lain", async () => {
    await unggah(bangun(token, 12_345_678.5));
    await unggah(bangun(token, 9_000_000));
    await unggah(bangun(token, 12_345_678.5), "tiktok.xlsx", "TIKTOK");
    expect(await prisma.settlement.count({ where: { seller: `uji-${token}` } })).toBe(3);
  });

  it("dua unggahan bersamaan dari berkas yang sama: tepat satu yang tersimpan", async () => {
    // Diulang karena urutan dua transaksi tidak bisa dipaksakan dari luar.
    for (let putaran = 0; putaran < 4; putaran += 1) {
      const p = bangun(token, 1_000_000 + putaran);
      const hasil = await Promise.allSettled([unggah(p, "a.xlsx"), unggah(p, "b.xlsx")]);
      const berhasil = hasil.filter((h) => h.status === "fulfilled");
      const ditolak = hasil.filter((h) => h.status === "rejected");
      expect(berhasil).toHaveLength(1);
      expect(ditolak).toHaveLength(1);
      expect((ditolak[0] as PromiseRejectedResult).reason).toBeInstanceOf(SettlementGandaError);
    }
    expect(await prisma.settlement.count({ where: { seller: `uji-${token}` } })).toBe(4);
  });

  it("menghapus unggahan yang belum dijurnal, dengan jejak dan alasan, lalu berkasnya boleh diunggah ulang", async () => {
    const r = await unggah(bangun(token), "salah-unggah.xlsx");

    expect(await hapusSettlementBelumDijurnal({ settlementId: r.settlementId, userId, alasan: "   " })).toEqual({
      ok: false,
      code: "ALASAN_WAJIB",
    });

    const hasil = await hapusSettlementBelumDijurnal({ settlementId: r.settlementId, userId, alasan: " terunggah dua kali " });
    expect(hasil).toEqual({ ok: true });
    expect(await prisma.settlement.count({ where: { id: seededId(r.settlementId) } })).toBe(0);
    expect(await prisma.settlementLine.count({ where: { settlementId: seededId(r.settlementId) } })).toBe(0);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Settlement", entityId: seededId(r.settlementId) } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0]).toMatchObject({ userId, action: AKSI_HAPUS_SETTLEMENT, reason: "terunggah dua kali" });
    // Barisnya hilang; ringkasannya hanya hidup di jejak ini.
    expect(jejak[0].changes).toMatchObject({
      before: {
        marketplace: "SHOPEE",
        seller: `uji-${token}`,
        fileName: "salah-unggah.xlsx",
        totalDilepas: "12345678.5",
        lineCount: 1,
        status: "PARSED",
      },
      after: null,
    });

    await unggah(bangun(token), "unggah-ulang.xlsx");
    expect(await prisma.settlement.count({ where: { seller: `uji-${token}` } })).toBe(1);
  });

  it("menolak menghapus settlement yang sudah punya jurnal, atau yang tidak ada", async () => {
    const r = await unggah(bangun(token));
    journalId = (
      await prisma.journal.create({
        data: { date: new Date(), description: `uji ${token}`, sourceType: "SETTLEMENT", sourceId: r.settlementId, postedById: userId },
      })
    ).id;

    expect(await hapusSettlementBelumDijurnal({ settlementId: r.settlementId, userId, alasan: "x" })).toEqual({
      ok: false,
      code: "SUDAH_DIJURNAL",
    });
    expect(await prisma.settlement.count({ where: { id: seededId(r.settlementId) } })).toBe(1);

    // Status RECONCILED tanpa baris jurnal (jurnalnya dihapus tangan) tetap ditolak.
    await prisma.journal.delete({ where: { id: seededId(journalId) } });
    journalId = "";
    await prisma.settlement.update({ where: { id: seededId(r.settlementId) }, data: { status: "RECONCILED" } });
    expect(await hapusSettlementBelumDijurnal({ settlementId: r.settlementId, userId, alasan: "x" })).toEqual({
      ok: false,
      code: "SUDAH_DIJURNAL",
    });

    expect(await hapusSettlementBelumDijurnal({ settlementId: `tidak-ada-${token}`, userId, alasan: "x" })).toEqual({
      ok: false,
      code: "TIDAK_DITEMUKAN",
    });
    expect(await prisma.auditLog.count({ where: { userId: seededId(userId) } })).toBe(0);
  });

  it("settlement sebulan penuh (3.000 pesanan) tersimpan utuh dalam batas waktu transaksi", async () => {
    const dasar = bangun(token, 3_000 * 40_000);
    // Baris mentah selebar lembar Income Shopee (43 kolom), bukan objek kosong.
    const mentah = (i: number) =>
      Object.fromEntries(Array.from({ length: 43 }, (_, k) => [`Kolom ${k} lembar Income`, `nilai ${i}-${k} 2031-03-15 12:34`]));
    const baris = Array.from({ length: 3_000 }, (_, i) => ({
      ...dasar.incomeLines[0],
      orderNo: `${token}-${i}`,
      netIncome: 40_000,
      raw: mentah(i),
    }));
    const r = await unggah({ ...dasar, incomeLines: baris, parsedNetTotal: 3_000 * 40_000 });
    expect(r.lineCount).toBe(3_000);
    expect(r.checksumOk).toBe(true);
    expect(await prisma.settlementLine.count({ where: { settlementId: seededId(r.settlementId) } })).toBe(3_000);
  });

  it("menandai unggahan yang kembar dengan unggahan lebih awal (data lama sebelum penjaga ada)", async () => {
    const pertama = await unggah(bangun(token), "awal.xlsx");
    // Meniru kembaran yang tersimpan sebelum penjaga ini ada: ditulis langsung.
    const asal = await prisma.settlement.findUniqueOrThrow({ where: { id: seededId(pertama.settlementId) } });
    const kembar = await prisma.settlement.create({
      data: {
        marketplace: asal.marketplace,
        seller: asal.seller,
        periodFrom: asal.periodFrom,
        periodTo: asal.periodTo,
        fileName: "kembar.xlsx",
        uploadedById: userId,
        status: "PARSED",
        totalPendapatan: asal.totalPendapatan,
        totalPengeluaran: asal.totalPengeluaran,
        totalDilepas: asal.totalDilepas,
        parsedNetTotal: asal.parsedNetTotal,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        createdAt: new Date(asal.createdAt.getTime() + 60_000),
      },
      select: { id: true },
    });
    settlementIds.push(kembar.id);
    const lain = await unggah(bangun(token, 777_000));

    const tanda = await tandaiSettlementGanda([pertama.settlementId, kembar.id, lain.settlementId]);
    expect(Object.keys(tanda)).toEqual([kembar.id]);
    expect(tanda[kembar.id]).toMatchObject({ id: pertama.settlementId, fileName: "awal.xlsx" });
    expect(await tandaiSettlementGanda([])).toEqual({});

    // Kembaran yang LEBIH BARU tapi sudah dijurnal adalah yang berlaku: yang lebih
    // awal (belum dijurnal) yang ditandai, supaya jurnal keduanya tertahan dan dia
    // yang dihapus — bukan sebaliknya (yang dijurnal tidak bisa dihapus).
    journalId = (
      await prisma.journal.create({
        data: { date: new Date(), description: `uji ${token}`, sourceType: "SETTLEMENT", sourceId: kembar.id, postedById: userId },
      })
    ).id;
    const tandaDijurnal = await tandaiSettlementGanda([pertama.settlementId, kembar.id]);
    expect(Object.keys(tandaDijurnal)).toEqual([pertama.settlementId]);
    expect(tandaDijurnal[pertama.settlementId]).toMatchObject({ id: kembar.id, fileName: "kembar.xlsx" });

    // Sama bila hanya statusnya RECONCILED (jurnalnya dihapus tangan).
    await prisma.journal.delete({ where: { id: seededId(journalId) } });
    journalId = "";
    await prisma.settlement.update({ where: { id: seededId(kembar.id) }, data: { status: "RECONCILED" } });
    expect(Object.keys(await tandaiSettlementGanda([pertama.settlementId, kembar.id]))).toEqual([pertama.settlementId]);
  });
});
