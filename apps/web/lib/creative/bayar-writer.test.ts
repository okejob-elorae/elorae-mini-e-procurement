import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { catatPembayaran, catatPembayaranBanyak } from "./bayar-writer";

/*
 * Penulis pembayaran fee KOL terhadap basis data sungguhan: aturan jumlah,
 * jejak sebelum/sesudah di transaksi yang sama, tahap maju lewat
 * `terapkanMajuOtomatis`, dan pembayaran massal yang utuh atau tidak sama
 * sekali.
 */

const tag = `BAYARUJI-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolId = "";
let kolabIds: string[] = [];

async function kolaborasi(akhiran: string, data: { fee: number; tahap?: "DEAL" | "TAYANG"; payStatus?: "BELUM" | "SEBAGIAN" | "LUNAS" | "TIDAK_PERLU"; paidAmount?: number }) {
  const c = await prisma.kolBrief.create({
    data: {
      docNo: `${tag}/${akhiran}`,
      kolId,
      fee: data.fee,
      tahap: data.tahap ?? "TAYANG",
      payStatus: data.payStatus ?? (data.fee > 0 ? "BELUM" : "TIDAK_PERLU"),
      paidAmount: data.paidAmount ?? 0,
    },
    select: { id: true },
  });
  kolabIds.push(c.id);
  return c.id;
}

const baca = (id: string) => prisma.kolBrief.findUniqueOrThrow({ where: { id } });
const jejakBayar = (id: string) =>
  prisma.auditLog.findMany({ where: { entityId: id, action: "KOL_PAYMENT_RECORDED" }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  userId = "";
  kolId = "";
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

describe("catatPembayaran", () => {
  it("LUNAS mengisi jumlah = fee dan tanggal hari ini, menulis jejak, dan memajukan TAYANG → DIBAYAR", async () => {
    const id = await kolaborasi("lunas", { fee: 1_500_000 });
    const r = await catatPembayaran({ kolaborasiId: id, status: "LUNAS", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berubah: true, payStatus: "LUNAS", paidAmount: 1_500_000, tahap: { dari: "TAYANG", ke: "DIBAYAR" } });

    const b = await baca(id);
    expect(b.payStatus).toBe("LUNAS");
    expect(Number(b.paidAmount)).toBe(1_500_000);
    expect(formatDateOnlyJakarta(b.paidAt!)).toBe(hariIniWib());
    expect(b.tahap).toBe("DIBAYAR");

    const jejak = await jejakBayar(id);
    expect(jejak).toHaveLength(1);
    expect(jejak[0].changes).toEqual({
      before: { payStatus: "BELUM", paidAmount: 0, paidAt: null, payNote: null },
      after: { payStatus: "LUNAS", paidAmount: 1_500_000, paidAt: hariIniWib(), payNote: null },
    });
    const otomatis = await prisma.auditLog.findMany({ where: { entityId: id, action: "KOL_COLLAB_STAGE_AUTO_ADVANCED" } });
    expect(otomatis).toHaveLength(1);
  });

  it("LUNAS sebelum tayang tidak memindah tahap", async () => {
    const id = await kolaborasi("depan", { fee: 800_000, tahap: "DEAL" });
    const r = await catatPembayaran({ kolaborasiId: id, status: "LUNAS", tanggal: "2026-10-01", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, tahap: null });
    const b = await baca(id);
    expect(b.tahap).toBe("DEAL");
    expect(formatDateOnlyJakarta(b.paidAt!)).toBe("2026-10-01");
  });

  it("SEBAGIAN menuntut 0 < jumlah < fee, lalu menyimpan jumlah dan catatan", async () => {
    const id = await kolaborasi("sebagian", { fee: 1_000_000 });
    expect(await catatPembayaran({ kolaborasiId: id, status: "SEBAGIAN", olehUserId: userId })).toEqual({ ok: false, kode: "JUMLAH_WAJIB" });
    expect(await catatPembayaran({ kolaborasiId: id, status: "SEBAGIAN", jumlah: 1_000_000, olehUserId: userId })).toEqual({
      ok: false,
      kode: "JUMLAH_TIDAK_VALID",
    });
    expect(await jejakBayar(id)).toHaveLength(0);

    const r = await catatPembayaran({ kolaborasiId: id, status: "SEBAGIAN", jumlah: 400_000, catatan: "  DP transfer BCA ", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, payStatus: "SEBAGIAN", paidAmount: 400_000, tahap: null });
    const b = await baca(id);
    expect(Number(b.paidAmount)).toBe(400_000);
    expect(b.payNote).toBe("DP transfer BCA");
    expect(b.tahap).toBe("TAYANG");
  });

  it("BELUM mengosongkan jumlah dan tanggal", async () => {
    const id = await kolaborasi("balik", { fee: 1_000_000 });
    await catatPembayaran({ kolaborasiId: id, status: "SEBAGIAN", jumlah: 300_000, olehUserId: userId });
    const r = await catatPembayaran({ kolaborasiId: id, status: "BELUM", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, payStatus: "BELUM", paidAmount: 0 });
    const b = await baca(id);
    expect(Number(b.paidAmount)).toBe(0);
    expect(b.paidAt).toBeNull();
    expect(await jejakBayar(id)).toHaveLength(2);
  });

  it("fee nol menjadi TIDAK_PERLU; TIDAK_PERLU untuk fee > 0 ditolak", async () => {
    const nol = await kolaborasi("nol", { fee: 0, payStatus: "BELUM" });
    expect(await catatPembayaran({ kolaborasiId: nol, status: "LUNAS", olehUserId: userId })).toMatchObject({ ok: true, payStatus: "TIDAK_PERLU" });
    expect((await baca(nol)).payStatus).toBe("TIDAK_PERLU");

    const berfee = await kolaborasi("berfee", { fee: 50_000 });
    expect(await catatPembayaran({ kolaborasiId: berfee, status: "TIDAK_PERLU", olehUserId: userId })).toEqual({ ok: false, kode: "ADA_FEE" });
  });

  it("menolak tanggal sesudah hari ini dan kolaborasi yang tidak ada", async () => {
    const id = await kolaborasi("depan2", { fee: 10_000 });
    expect(await catatPembayaran({ kolaborasiId: id, status: "LUNAS", tanggal: "2999-01-01", olehUserId: userId })).toEqual({
      ok: false,
      kode: "TANGGAL_DEPAN",
    });
    expect(await catatPembayaran({ kolaborasiId: "tidak-ada", status: "LUNAS", olehUserId: userId })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });

  it("tanpa perubahan apa pun tidak menulis jejak", async () => {
    const id = await kolaborasi("sama", { fee: 10_000 });
    await catatPembayaran({ kolaborasiId: id, status: "LUNAS", tanggal: "2026-10-02", olehUserId: userId });
    const r = await catatPembayaran({ kolaborasiId: id, status: "LUNAS", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berubah: false });
    // Status sama tanpa tanggal: tanggal lama dipertahankan.
    expect(formatDateOnlyJakarta((await baca(id)).paidAt!)).toBe("2026-10-02");
    expect(await jejakBayar(id)).toHaveLength(1);
  });
});

describe("catatPembayaranBanyak", () => {
  it("menulis semua dalam satu transaksi, satu jejak per kolaborasi, jumlah per baris", async () => {
    const a = await kolaborasi("m-a", { fee: 1_000_000 });
    const b = await kolaborasi("m-b", { fee: 2_000_000 });
    const r = await catatPembayaranBanyak({
      items: [
        { kolaborasiId: a, jumlah: 250_000 },
        { kolaborasiId: b, jumlah: 1_500_000 },
      ],
      status: "SEBAGIAN",
      tanggal: "2026-10-03",
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: true, jumlah: 2, berubah: 2, totalDibayar: 1_750_000 });
    expect(Number((await baca(a)).paidAmount)).toBe(250_000);
    expect(Number((await baca(b)).paidAmount)).toBe(1_500_000);
    expect(await jejakBayar(a)).toHaveLength(1);
    expect(await jejakBayar(b)).toHaveLength(1);
  });

  it("satu baris salah membatalkan semuanya", async () => {
    const a = await kolaborasi("x-a", { fee: 1_000_000 });
    const b = await kolaborasi("x-b", { fee: 500_000 });
    const r = await catatPembayaranBanyak({
      items: [
        { kolaborasiId: a, jumlah: 100_000 },
        { kolaborasiId: b, jumlah: 500_000 },
      ],
      status: "SEBAGIAN",
      tanggal: "2026-10-03",
      olehUserId: userId,
    });
    expect(r).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID", kolaborasiId: b });
    expect((await baca(a)).payStatus).toBe("BELUM");
    expect(await jejakBayar(a)).toHaveLength(0);
  });

  it("LUNAS massal memajukan yang sudah tayang dan melaporkan perpindahannya", async () => {
    const a = await kolaborasi("l-a", { fee: 300_000 });
    const b = await kolaborasi("l-b", { fee: 700_000, tahap: "DEAL" });
    const r = await catatPembayaranBanyak({ items: [{ kolaborasiId: a }, { kolaborasiId: b }, { kolaborasiId: a }], status: "LUNAS", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    expect(r.jumlah).toBe(2);
    expect(r.totalDibayar).toBe(1_000_000);
    expect(r.perpindahan).toEqual([{ kolaborasiId: a, dari: "TAYANG", ke: "DIBAYAR" }]);
  });

  it("daftar kosong ditolak", async () => {
    expect(await catatPembayaranBanyak({ items: [], status: "LUNAS", olehUserId: userId })).toEqual({ ok: false, kode: "KOSONG" });
  });
});
