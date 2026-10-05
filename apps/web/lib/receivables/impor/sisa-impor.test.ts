import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { simpanImpor } from "./writer";
import { batalkanImpor } from "./batal";
import type { BarisImpor } from "./baris";
import { daftarPiutang } from "../queries";
import { hitungUlangPiutang, putuskanKlaim } from "../writer";
import { buatKlaimPembayaran } from "../claim-writer";
import { JEJAK } from "../jejak";

/**
 * Faktur yang sudah dibayar sebagian SEBELUM diimpor, terhadap basis data
 * sungguhan.
 *
 * Berkas impor menulis nilai Rp10 jt dan sisa Rp4 jt. Dulu penyimpannya menaruh
 * Rp4 jt di kolom `outstanding`, lalu setiap perhitungan ulang (daftar piutang,
 * BKM, verifikasi) menghitung dari `amount` dan mengembalikannya ke Rp10 jt —
 * toko ditagih ulang untuk uang yang sudah dibayarnya. Basis data dipakai
 * bersama data dev, jadi setiap penghapusan lewat `seededId()`.
 */

const tag = `IMPS-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let tokoId = "";
let salesId = "";
let keuanganId = "";
let piutangId = "";
let jejakImporId = "";
let klaimIds: string[] = [];

function baris(nilai: number, sisa: number): BarisImpor {
  return {
    baris: 2,
    noFaktur: `${tag}/INV`,
    kodeToko: `${tag}-S`,
    namaToko: null,
    tglFaktur: wib("2026-08-01"),
    jatuhTempo: wib("2026-09-01"),
    nilai,
    sisaTertulis: sisa,
    sales: null,
    sisa,
    masalah: [],
  };
}

beforeEach(async () => {
  tokoId = "";
  salesId = "";
  keuanganId = "";
  piutangId = "";
  jejakImporId = "";
  klaimIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  salesId = orang[0].id;
  keuanganId = orang[1].id;

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;

  const hasil = await simpanImpor([baris(10_000_000, 4_000_000)], { olehUserId: keuanganId, salesmanId: salesId });
  expect(hasil.masuk).toBe(1);
  piutangId = (await prisma.receivable.findUniqueOrThrow({ where: { invoiceNo: `${tag}/INV` } })).id;
  jejakImporId = (
    await prisma.auditLog.findFirstOrThrow({
      where: { action: JEJAK.FAKTUR_IMPOR, entityId: seededId(piutangId) },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  // Pembatalan impor menulis jejaknya dengan entityId = id jejak impor.
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...klaimIds, piutangId, jejakImporId].filter(Boolean).map(seededId) } },
  });
  if (jejakImporId) await prisma.auditLog.deleteMany({ where: { id: seededId(jejakImporId) } });
  await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds).filter(Boolean) } } });
  if (piutangId) await prisma.receivable.deleteMany({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

async function lapor(nilai: number) {
  const h = await buatKlaimPembayaran({
    storeId: tokoId,
    salesmanId: salesId,
    createdById: salesId,
    claimedTransferAt: wib("2026-09-15"),
    method: "transfer",
    pelunasan: [{ receivableId: piutangId, nilai }],
    transferPhotoUrl: "/api/foto/uji",
  });
  if (h.ok) klaimIds.push(h.id);
  return h;
}

describe("impor faktur yang sudah dibayar sebagian", () => {
  it("menyimpan bagian yang sudah dibayar di kolomnya sendiri", async () => {
    const p = await prisma.receivable.findUniqueOrThrow({ where: { id: seededId(piutangId) } });
    expect(Number(p.amount)).toBe(10_000_000);
    expect(Number(p.outstanding)).toBe(4_000_000);
    expect(Number(p.paidBeforeImport)).toBe(6_000_000);
  });

  it("daftar piutang dan perhitungan ulang tetap Rp4 jt, bukan Rp10 jt", async () => {
    const [b] = await daftarPiutang({ receivableIds: [piutangId] });
    expect(b.outstanding).toBe(4_000_000);
    expect(await hitungUlangPiutang(prisma, piutangId)).toBe(4_000_000);
    const p = await prisma.receivable.findUniqueOrThrow({ where: { id: seededId(piutangId) } });
    expect(Number(p.outstanding)).toBe(4_000_000);
  });

  it("BKM yang melunasi lebih dari Rp4 jt ditolak", async () => {
    expect(await lapor(5_000_000)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
  });

  it("klaim terverifikasi sesudahnya mengurangi dari Rp4 jt", async () => {
    const k = await lapor(1_500_000);
    expect(k.ok).toBe(true);
    if (!k.ok) return;
    const v = await putuskanKlaim({ paymentClaimId: k.id, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });
    expect(v).toEqual({ ok: true, sisaBaru: [2_500_000] });
    const [b] = await daftarPiutang({ receivableIds: [piutangId] });
    expect(b.outstanding).toBe(2_500_000);
  });

  it("impor yang belum disentuh tetap bisa dibatalkan walau sisanya tidak penuh", async () => {
    const h = await batalkanImpor({ auditLogId: jejakImporId, alasan: "salah berkas", olehUserId: keuanganId });
    expect(h).toEqual({ ok: true, dihapus: 1 });
    expect(await prisma.receivable.findUnique({ where: { id: seededId(piutangId) } })).toBeNull();
    piutangId = "";
  });
});
