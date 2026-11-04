import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_TUKAR_SHIFT } from "@/lib/spg/shift";
import { JEJAK_SPG_BERHENTI } from "./spg-berhenti";
import { runSerializable } from "@/lib/db/tx-retry";
import { adaRiwayatSpg, aturMulaiSpg, aturMulaiSpgDalamTx, batalkanSpgBerhenti, tandaiSpgBerhenti } from "./spg-berhenti-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * "SPG berhenti" dan tanggal mulai bekerja terhadap basis data sungguhan (P66, P62, B25, B27):
 * tokonya dilepas dan diingat, ajuan tukar shift terbuka dibatalkan, sel jadwalnya dibiarkan, dan
 * semuanya tukar-bandingkan di dalam `runSerializable` dengan jejak di transaksi yang sama. Semua
 * baris diseed di sini dan dihapus lewat `seededId(s)`.
 */
d("SPG berhenti (test bed only)", () => {
  const tag = `SBH${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date("2026-11-04T10:00:00+07:00");
  let toko = "";
  let dewi = "";
  let rekan = "";
  let kantor = "";

  const orangIds = () => [dewi, rekan, kantor].filter(Boolean);
  const keadaan = () =>
    prisma.user.findUniqueOrThrow({ where: { id: dewi }, select: { assignedStoreId: true, spgEndedOn: true, spgEndedStoreId: true, spgStartedOn: true } });
  const tandai = (hariTerakhir: string, alasan = "mengundurkan diri") => tandaiSpgBerhenti({ userId: dewi, hariTerakhir, alasan, olehUserId: kantor, sekarang });

  beforeAll(async () => {
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    dewi = (await prisma.user.create({ data: { email: `${tag}-dewi@test.local`, name: `Dewi ${tag}` } })).id;
    rekan = (await prisma.user.create({ data: { email: `${tag}-rekan@test.local`, name: `Rekan ${tag}`, assignedStoreId: toko } })).id;
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: dewi }, data: { assignedStoreId: toko, spgStartedOn: "2026-09-01", spgEndedOn: null, spgEndedStoreId: null } });
  });

  afterEach(async () => {
    const tukar = await prisma.spgShiftSwap.findMany({ where: { storeId: seededId(toko) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_TUKAR_SHIFT, entityId: { in: seededIds(tukar.map((t) => t.id)) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: seededId(dewi) } });
    await prisma.spgShiftSwap.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.spgShift.deleteMany({ where: { userId: seededId(dewi) } });
    await prisma.storeVisit.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.spgDebt.deleteMany({ where: { spgUserId: seededId(dewi) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
  });

  it("menandai: toko dilepas dan diingat, ajuan tukar terbuka dibatalkan, sel jadwal dibiarkan, jejak di transaksi yang sama", async () => {
    await prisma.spgShift.create({ data: { userId: dewi, storeId: toko, day: "2026-11-20", kind: "KERJA", shiftCode: "PAGI", createdById: kantor } });
    const tukar = await prisma.spgShiftSwap.create({ data: { storeId: toko, requesterId: dewi, partnerId: rekan, day: "2026-11-20", status: "MENUNGGU_REKAN" } });

    expect(await tandai("2026-11-03")).toEqual({ ok: true });
    expect(await keadaan()).toMatchObject({ assignedStoreId: null, spgEndedOn: "2026-11-03", spgEndedStoreId: toko });
    expect((await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: tukar.id }, select: { status: true } })).status).toBe("DIBATALKAN");
    expect(await prisma.spgShift.count({ where: { userId: seededId(dewi) } })).toBe(1);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "User", entityId: dewi, action: JEJAK_SPG_BERHENTI.DITANDAI }, select: { reason: true } });
    expect(jejak).toEqual([{ reason: "mengundurkan diri" }]);
    expect(await tandai("2026-11-03")).toEqual({ ok: false, kode: "SUDAH_BERHENTI" });
  });

  it("hari terakhir di depan, sebelum mulai, atau sebelum check-in terakhirnya ditolak; alasan wajib", async () => {
    expect(await tandai("2026-11-05")).toEqual({ ok: false, kode: "TANGGAL_DEPAN" });
    expect(await tandai("2026-08-31")).toEqual({ ok: false, kode: "SEBELUM_MULAI" });
    expect(await tandai("2026-11-03", " ")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    await prisma.storeVisit.create({ data: { storeId: toko, userId: dewi, checkinAt: new Date("2026-11-04T08:00:00+07:00"), checkinLat: 0, checkinLng: 0 } });
    expect(await tandai("2026-11-03")).toEqual({ ok: false, kode: "ADA_KEGIATAN_SESUDAH" });
    expect((await keadaan()).assignedStoreId).toBe(toko);
  });

  it("membatalkan mengembalikan tokonya; ditolak begitu ada utang atas namanya", async () => {
    expect((await tandai("2026-11-03")).ok).toBe(true);
    expect(await batalkanSpgBerhenti({ userId: dewi, alasan: " ", olehUserId: kantor })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    // Belum pernah dibayar apa pun: salah tandai masih bisa dibatalkan.
    expect(await batalkanSpgBerhenti({ userId: dewi, alasan: "salah orang", olehUserId: kantor })).toEqual({ ok: true });
    expect(await keadaan()).toMatchObject({ assignedStoreId: toko, spgEndedOn: null, spgEndedStoreId: null });

    expect((await tandai("2026-11-03")).ok).toBe(true);
    await prisma.spgDebt.create({
      data: { spgUserId: dewi, kind: "KOREKSI", sourceKey: `${tag}-s`, amount: 1_000, createdRefType: "SpgDebtRecording", createdRefId: `${tag}-c`, note: "uji", createdById: kantor },
    });
    expect(await batalkanSpgBerhenti({ userId: dewi, alasan: "salah orang", olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DISELESAIKAN" });
  });

  it("tanggal mulai: tidak sesudah check-in pertamanya, dan terkunci begitu ada gaji yang dibayar", async () => {
    await prisma.storeVisit.create({ data: { storeId: toko, userId: dewi, checkinAt: new Date("2026-09-10T08:00:00+07:00"), checkinLat: 0, checkinLng: 0 } });
    expect(await aturMulaiSpg({ userId: dewi, mulai: "2026-09-11", olehUserId: kantor })).toEqual({ ok: false, kode: "MULAI_SESUDAH_KEGIATAN" });
    expect(await aturMulaiSpg({ userId: dewi, mulai: "2026-09-05", olehUserId: kantor })).toEqual({ ok: true });
    expect((await keadaan()).spgStartedOn).toBe("2026-09-05");
    await prisma.spgCommission.create({
      data: { userId: dewi, storeId: toko, period: "2026-09", unitsSold: 0, commission: 0, basis: "TARIF_KATEGORI", lockedById: kantor, paidAt: sekarang, paidById: kantor },
    });
    expect(await aturMulaiSpg({ userId: dewi, mulai: "2026-09-01", olehUserId: kantor })).toEqual({ ok: false, kode: "MULAI_TERKUNCI" });
  });

  it("balapan tandai berhenti vs batalkan: tidak pernah setengah-setengah", async () => {
    expect((await tandai("2026-11-03")).ok).toBe(true);
    const [batal, lagi] = await Promise.all([
      batalkanSpgBerhenti({ userId: dewi, alasan: "salah orang", olehUserId: kantor }),
      tandaiSpgBerhenti({ userId: dewi, hariTerakhir: "2026-11-02", alasan: "ulang", olehUserId: kantor, sekarang }),
    ]);
    expect(batal.ok).toBe(true);
    const k = await keadaan();
    // Batal dulu lalu tandai ulang → berhenti 2 November; tandai dulu (ditolak SUDAH_BERHENTI) lalu batal → aktif.
    if (lagi.ok) expect(k).toMatchObject({ assignedStoreId: null, spgEndedOn: "2026-11-02", spgEndedStoreId: toko });
    else {
      expect(lagi).toEqual({ ok: false, kode: "SUDAH_BERHENTI" });
      expect(k).toMatchObject({ assignedStoreId: toko, spgEndedOn: null, spgEndedStoreId: null });
    }
  });

  it("balapan dua tanggal mulai: tidak ada penulisan yang lolos dengan 'sebelum' yang basi — jejaknya berantai sampai nilai akhirnya", async () => {
    await prisma.user.update({ where: { id: dewi }, data: { spgStartedOn: null } });
    const [a, b] = await Promise.all([
      aturMulaiSpg({ userId: dewi, mulai: "2026-09-03", olehUserId: kantor }),
      aturMulaiSpg({ userId: dewi, mulai: "2026-09-07", olehUserId: kantor }),
    ]);
    expect(a.ok || b.ok).toBe(true);
    const akhir = (await keadaan()).spgStartedOn;
    expect(["2026-09-03", "2026-09-07"]).toContain(akhir);
    const jejak = (
      await prisma.auditLog.findMany({
        where: { entityType: "User", entityId: dewi, action: "USER_UPDATED" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { changes: true },
      })
    ).map((j) => j.changes as { before: { spgStartedOn: string | null }; after: { spgStartedOn: string } });
    // Setiap penulisan mencatat nilai yang benar-benar ia ganti: dari kosong, lalu dari yang pertama.
    expect(jejak[0].before.spgStartedOn).toBeNull();
    for (let i = 1; i < jejak.length; i++) expect(jejak[i].before.spgStartedOn).toBe(jejak[i - 1].after.spgStartedOn);
    expect(jejak[jejak.length - 1].after.spgStartedOn).toBe(akhir);
  });

  it("di dalam transaksi pemanggil (formulir Pengguna): tanggal mulai ditulis bersama penyimpanannya, dan riwayat dibaca lewat transaksi yang sama", async () => {
    await prisma.user.update({ where: { id: dewi }, data: { spgStartedOn: null } });
    expect(await runSerializable(async (tx) => adaRiwayatSpg(dewi, toko, tx))).toBe(false);
    await prisma.storeVisit.create({ data: { storeId: toko, userId: dewi, checkinAt: new Date("2026-09-10T08:00:00+07:00"), checkinLat: 0, checkinLng: 0 } });
    expect(await adaRiwayatSpg(dewi, toko)).toBe(true);
    expect(await runSerializable((tx) => aturMulaiSpgDalamTx(tx, { userId: dewi, mulai: "2026-09-11", olehUserId: kantor }))).toEqual({
      ok: false,
      kode: "MULAI_SESUDAH_KEGIATAN",
    });
    expect(await runSerializable((tx) => aturMulaiSpgDalamTx(tx, { userId: dewi, mulai: "2026-09-02", olehUserId: kantor }))).toEqual({ ok: true });
    expect((await keadaan()).spgStartedOn).toBe("2026-09-02");
  });
});
