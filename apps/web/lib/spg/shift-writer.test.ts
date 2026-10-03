import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kabar ke HP dipalsukan supaya penerimanya bisa diperiksa; kabar sungguhan
 * memang dilewati di bawah VITEST, jadi tanpa ini tidak ada yang bisa dilihat.
 */
const kabar = vi.hoisted(() => ({ calls: [] as { userId: string; jenis: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return {
    ...m,
    kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; data: Record<string, string> }) => {
      kabar.calls.push({ userId, jenis: k.jenis, data: k.data });
    }),
  };
});

import { KUNCI_SHIFT, SHIFT_BAWAAN } from "./pengaturan";
import { ENTITAS_JADWAL_SPG, ENTITAS_TUKAR_SHIFT, JEJAK_SHIFT, KATEGORI_NOTIF_TUKAR_SHIFT } from "./shift";
import { ajukanTukarShift, batalkanTukarShift, jawabTukarShift, setujuiTukarShift, simpanJadwalSpg, tolakTukarShift } from "./shift-writer";

/*
 * Jadwal kerja dan tukar shift SPG terhadap basis data uji. Semua baris milik
 * fixture buatan tes (toko dan pengguna berkode acak); teardown hanya lewat id
 * yang diseed. Hari dipatok jauh ke depan (Januari 2030) lewat `sekarang`,
 * supaya "hari lewat" bisa diuji tanpa bergantung jam.
 *
 * Pengaturan `spg.shift` dipotret di awal, ditetapkan ke bawaan selama tes,
 * dan dikembalikan persis di akhir — basis datanya dipakai bersama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `SHF-${Math.random().toString(36).slice(2, 9)}`;
// Senin 7 Januari 2030, 10.00 WIB.
const SEKARANG = new Date("2030-01-07T03:00:00Z");
const SEL = "2030-01-08";
const RAB = "2030-01-09";
const KAM = "2030-01-10";

d("jadwal & tukar shift SPG — penulis (test bed only)", () => {
  let toko = "";
  let tokoLain = "";
  let a = "";
  let b = "";
  let c = "";
  let x = "";
  let kantor = "";
  let kantor2 = "";
  let setelanAwal: string | null = null;
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  const userIds = () => seededIds([a, b, c, x, kantor, kantor2].filter(Boolean));
  const tokoIds = () => seededIds([toko, tokoLain].filter(Boolean));

  const sel = (userId: string, day: string) =>
    prisma.spgShift.findUnique({
      where: { userId_day: { userId, day } },
      select: { kind: true, shiftCode: true, startTime: true, endTime: true, storeId: true },
    });

  const isiAwal = (isian: { userId: string; day: string; isi: { jenis: "KERJA"; kode: string } | { jenis: "LIBUR" } | null }[]) =>
    simpanJadwalSpg({ storeId: toko, olehUserId: kantor, isian, sekarang: SEKARANG });

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } });
    setelanAwal = ada?.value ?? null;
    const nilai = JSON.stringify(SHIFT_BAWAAN);
    await prisma.systemSetting.upsert({ where: { key: KUNCI_SHIFT }, create: { key: KUNCI_SHIFT, value: nilai }, update: { value: nilai } });

    toko = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    const orang = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    a = await orang("ani", toko);
    b = await orang("budi", toko);
    c = await orang("citra", toko);
    x = await orang("xena", tokoLain);
    kantor = await orang("kantor", null);
    kantor2 = await orang("kantor2", null);
  });

  beforeEach(() => {
    kabar.calls = [];
  });

  afterEach(async () => {
    const swaps = await prisma.spgShiftSwap.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const swapIds = swaps.map((s) => s.id);
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_TUKAR_SHIFT }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((n) => {
        const m = n.metadata as Record<string, unknown> | null;
        return typeof m?.swapId === "string" && swapIds.includes(m.swapId);
      })
      .map((n) => n.id);
    if (milikUji.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds() } } });
    await prisma.spgShiftSwap.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgShift.deleteMany({ where: { userId: { in: userIds() } } });
  });

  afterAll(async () => {
    try {
      if (setelanAwal === null) await prisma.systemSetting.delete({ where: { key: KUNCI_SHIFT } });
      else await prisma.systemSetting.update({ where: { key: KUNCI_SHIFT }, data: { value: setelanAwal } });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
      await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    }
  });

  // ─── Simpan jadwal ──────────────────────────────────────────────────────

  it("menyimpan sel dengan jam disalin dari pengaturan, satu jejak, satu kabar per SPG", async () => {
    const r = await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: a, day: RAB, isi: { jenis: "KERJA", kode: "SIANG" } },
      { userId: b, day: RAB, isi: { jenis: "LIBUR" } },
    ]);
    expect(r).toEqual({ ok: true, berubah: 3, hariPertama: { [a]: SEL, [b]: RAB } });
    expect(await sel(a, SEL)).toEqual({ kind: "KERJA", shiftCode: "PAGI", startTime: "10:00", endTime: "18:00", storeId: toko });
    expect(await sel(b, RAB)).toMatchObject({ kind: "LIBUR", shiftCode: null, startTime: null });

    const jejak = await prisma.auditLog.findMany({ where: { entityType: ENTITAS_JADWAL_SPG, entityId: seededId(toko) } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].action).toBe(JEJAK_SHIFT.DIUBAH);
    const ch = jejak[0].changes as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(ch.before[`${a}|${SEL}`]).toBeNull();
    expect(ch.after[`${a}|${SEL}`]).toEqual({ kind: "KERJA", shiftCode: "PAGI", startTime: "10:00", endTime: "18:00" });

    expect(kabar.calls.map((k) => `${k.userId}:${k.jenis}:${k.data.day}`).sort()).toEqual([`${a}:JADWAL_SPG:${SEL}`, `${b}:JADWAL_SPG:${RAB}`].sort());

    // Simpan yang sama lagi: tidak ada perubahan, tidak ada jejak baru, tidak ada kabar.
    kabar.calls = [];
    const ulang = await isiAwal([{ userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } }]);
    expect(ulang).toEqual({ ok: true, berubah: 0, hariPertama: {} });
    expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_JADWAL_SPG, entityId: seededId(toko) } })).toBe(1);
    expect(kabar.calls).toHaveLength(0);

    // Dikosongkan → barisnya hilang, kabar hanya ke yang berubah.
    const kosong = await isiAwal([{ userId: a, day: RAB, isi: null }]);
    expect(kosong).toMatchObject({ ok: true, berubah: 1 });
    expect(await sel(a, RAB)).toBeNull();
    expect(kabar.calls.map((k) => k.userId)).toEqual([a]);
  });

  it("menolak hari lewat, SPG toko lain, dan shift tak dikenal — tanpa menulis apa pun", async () => {
    expect(await isiAwal([{ userId: a, day: "2030-01-06", isi: { jenis: "LIBUR" } }])).toMatchObject({ ok: false, kode: "HARI_LEWAT" });
    expect(await isiAwal([{ userId: x, day: SEL, isi: { jenis: "LIBUR" } }])).toMatchObject({ ok: false, kode: "BUKAN_SPG_TOKO", userId: x });
    expect(
      await isiAwal([
        { userId: a, day: SEL, isi: { jenis: "LIBUR" } },
        { userId: b, day: SEL, isi: { jenis: "KERJA", kode: "MALAM" } },
      ]),
    ).toMatchObject({ ok: false, kode: "SHIFT_TIDAK_DIKENAL" });
    expect(await sel(a, SEL)).toBeNull();
    expect(await prisma.auditLog.count({ where: { userId: kantor } })).toBe(0);
    expect(kabar.calls).toHaveLength(0);
  });

  // ─── Tukar shift ────────────────────────────────────────────────────────

  const ajukan = (o: { userId?: string; day?: string; partnerId?: string; partnerDay?: string | null; alasan?: string; key?: string } = {}) =>
    ajukanTukarShift({
      userId: o.userId ?? a,
      storeId: toko,
      day: o.day ?? SEL,
      partnerId: o.partnerId ?? b,
      partnerDay: o.partnerDay ?? null,
      alasan: o.alasan ?? "Ada acara keluarga",
      idempotencyKey: o.key ?? kunci(),
      sekarang: SEKARANG,
    });

  it("alur lengkap: ajukan → rekan setuju → kantor setujui; rekan libur → shift berpindah", async () => {
    await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: b, day: SEL, isi: { jenis: "LIBUR" } },
    ]);
    kabar.calls = [];

    const key = kunci();
    const r = await ajukan({ key });
    if (!r.ok) throw new Error(r.kode);
    expect(r.status).toBe("MENUNGGU_REKAN");
    expect(kabar.calls).toEqual([{ userId: b, jenis: "TUKAR_SHIFT_DIMINTA", data: { swapId: r.id } }]);

    // Kiriman ulang dengan kunci yang sama → ajuan yang sama, tanpa kabar kedua.
    kabar.calls = [];
    expect(await ajukan({ key })).toEqual({ ok: true, id: r.id, status: "MENUNGGU_REKAN", ulang: true });
    expect(kabar.calls).toHaveLength(0);
    // Kunci orang lain → ditolak.
    expect(await ajukan({ key, userId: c, partnerId: b })).toEqual({ ok: false, kode: "KUNCI_DIPAKAI" });

    // Bukan rekan yang diminta tidak bisa menjawab; kantor belum bisa memutuskan.
    expect(await jawabTukarShift({ swapId: r.id, userId: c, storeId: toko, setuju: true, sekarang: SEKARANG })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: kantor, sekarang: SEKARANG })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });

    const jawab = await jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    expect(jawab).toEqual({ ok: true, id: r.id, status: "MENUNGGU_KANTOR" });
    const notif = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_TUKAR_SHIFT }, select: { metadata: true } });
    expect(notif.filter((n) => (n.metadata as Record<string, unknown> | null)?.swapId === r.id)).toHaveLength(1);
    expect(kabar.calls.at(-1)).toEqual({ userId: a, jenis: "TUKAR_SHIFT_DIPUTUSKAN", data: { swapId: r.id } });

    // Jadwal belum berubah sampai kantor menyetujui.
    expect(await sel(a, SEL)).toMatchObject({ kind: "KERJA", shiftCode: "PAGI" });

    // Pengaju (atau rekan) yang kebetulan punya izin kantor tidak bisa memutuskan ajuannya sendiri.
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: a, sekarang: SEKARANG })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });

    kabar.calls = [];
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: kantor, catatan: "ok", sekarang: SEKARANG })).toEqual({
      ok: true,
      id: r.id,
      status: "DISETUJUI",
    });
    expect(await sel(a, SEL)).toMatchObject({ kind: "LIBUR", shiftCode: null });
    expect(await sel(b, SEL)).toEqual({ kind: "KERJA", shiftCode: "PAGI", startTime: "10:00", endTime: "18:00", storeId: toko });
    expect(kabar.calls.map((k) => `${k.userId}:${k.jenis}`).sort()).toEqual([`${a}:TUKAR_SHIFT_DIPUTUSKAN`, `${b}:TUKAR_SHIFT_DIPUTUSKAN`].sort());

    const swap = await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: r.id } });
    expect(swap).toMatchObject({ status: "DISETUJUI", decidedById: kantor, decisionNote: "ok" });
    expect(swap.partnerAnsweredAt).not.toBeNull();
    const aksi = (await prisma.auditLog.findMany({ where: { entityType: ENTITAS_TUKAR_SHIFT, entityId: seededId(r.id) }, select: { action: true } })).map(
      (j) => j.action,
    );
    expect(aksi.sort()).toEqual([JEJAK_SHIFT.TUKAR_DIAJUKAN, JEJAK_SHIFT.TUKAR_DISETUJUI_REKAN, JEJAK_SHIFT.TUKAR_DISETUJUI].sort());
  });

  it("tukar balik dua hari: hari pengaju dan hari rekan bertukar isi", async () => {
    await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: b, day: KAM, isi: { jenis: "KERJA", kode: "SIANG" } },
    ]);
    const r = await ajukan({ partnerDay: KAM });
    if (!r.ok) throw new Error(r.kode);
    await jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: kantor, sekarang: SEKARANG })).toMatchObject({ ok: true });
    // Rekan kosong di Selasa → pengaju libur; pengaju kosong di Kamis → rekan libur.
    expect(await sel(a, SEL)).toMatchObject({ kind: "LIBUR" });
    expect(await sel(b, SEL)).toMatchObject({ kind: "KERJA", shiftCode: "PAGI" });
    expect(await sel(a, KAM)).toMatchObject({ kind: "KERJA", shiftCode: "SIANG", startTime: "14:00" });
    expect(await sel(b, KAM)).toMatchObject({ kind: "LIBUR" });
  });

  it("ajuan ditolak: pengaju tidak bekerja, rekan toko lain, bentrok, tanpa alasan", async () => {
    await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: c, day: SEL, isi: { jenis: "KERJA", kode: "SIANG" } },
    ]);
    expect(await ajukan({ day: RAB })).toEqual({ ok: false, kode: "PENGAJU_TIDAK_KERJA" });
    expect(await ajukan({ partnerId: x })).toEqual({ ok: false, kode: "REKAN_TIDAK_SAH" });
    expect(await ajukan({ partnerId: a })).toEqual({ ok: false, kode: "REKAN_TIDAK_SAH" });
    expect(await ajukan({ alasan: "  " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await ajukan({ partnerDay: RAB })).toEqual({ ok: false, kode: "REKAN_TIDAK_KERJA" });
    expect(await ajukan({ day: "2030-01-06" })).toEqual({ ok: false, kode: "HARI_LEWAT" });
    expect(await ajukanTukarShift({ userId: a, storeId: toko, day: SEL, partnerId: b, alasan: "x", idempotencyKey: "", sekarang: SEKARANG })).toEqual({
      ok: false,
      kode: "KUNCI_WAJIB",
    });
    expect((await ajukan()).ok).toBe(true);
    // Sel yang sama sedang dalam ajuan lain.
    expect(await ajukan({ userId: c, partnerId: a })).toEqual({ ok: false, kode: "BENTROK" });
  });

  it("rekan menolak; kantor menolak dengan catatan wajib; pengaju membatalkan", async () => {
    await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: a, day: RAB, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: a, day: KAM, isi: { jenis: "KERJA", kode: "PAGI" } },
    ]);
    kabar.calls = [];
    const r1 = await ajukan({ day: SEL });
    if (!r1.ok) throw new Error(r1.kode);
    expect(await jawabTukarShift({ swapId: r1.id, userId: b, storeId: toko, setuju: false, alasan: "Saya kuliah", sekarang: SEKARANG })).toEqual({
      ok: true,
      id: r1.id,
      status: "DITOLAK_REKAN",
    });
    expect(kabar.calls.at(-1)).toEqual({ userId: a, jenis: "TUKAR_SHIFT_DIPUTUSKAN", data: { swapId: r1.id } });
    expect((await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: r1.id } })).decisionNote).toBe("Saya kuliah");

    const r2 = await ajukan({ day: RAB });
    if (!r2.ok) throw new Error(r2.kode);
    await jawabTukarShift({ swapId: r2.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    expect(await tolakTukarShift({ swapId: r2.id, olehUserId: kantor, catatan: " " })).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect(await tolakTukarShift({ swapId: r2.id, olehUserId: kantor, catatan: "Stok opname hari itu" })).toEqual({ ok: true, id: r2.id, status: "DITOLAK" });
    expect(await sel(a, RAB)).toMatchObject({ kind: "KERJA", shiftCode: "PAGI" });

    const r3 = await ajukan({ day: KAM });
    if (!r3.ok) throw new Error(r3.kode);
    await jawabTukarShift({ swapId: r3.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    // Hanya pengaju yang bisa membatalkan.
    expect(await batalkanTukarShift({ swapId: r3.id, userId: b, storeId: toko })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(await batalkanTukarShift({ swapId: r3.id, userId: a, storeId: toko })).toEqual({ ok: true, id: r3.id, status: "DIBATALKAN" });
    expect(await setujuiTukarShift({ swapId: r3.id, olehUserId: kantor, sekarang: SEKARANG })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
    expect(await batalkanTukarShift({ swapId: r3.id, userId: a, storeId: toko })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("jadwal diubah kantor sesudah rekan setuju → persetujuan ditolak, ajuan tetap menunggu", async () => {
    await isiAwal([{ userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } }]);
    const r = await ajukan();
    if (!r.ok) throw new Error(r.kode);
    await jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    await isiAwal([{ userId: a, day: SEL, isi: { jenis: "LIBUR" } }]);
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: kantor, sekarang: SEKARANG })).toEqual({ ok: false, kode: "PENGAJU_TIDAK_KERJA" });
    expect((await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("MENUNGGU_KANTOR");
    // Hari sudah lewat saat diputuskan → juga ditolak.
    await isiAwal([{ userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } }]);
    expect(await setujuiTukarShift({ swapId: r.id, olehUserId: kantor, sekarang: new Date("2030-01-09T03:00:00Z") })).toEqual({
      ok: false,
      kode: "HARI_LEWAT",
    });
  });

  // ─── Balapan ────────────────────────────────────────────────────────────

  const siapDiputuskan = async () => {
    await isiAwal([
      { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
      { userId: b, day: SEL, isi: { jenis: "KERJA", kode: "SIANG" } },
    ]);
    const r = await ajukan();
    if (!r.ok) throw new Error(r.kode);
    await jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG });
    return r.id;
  };

  it("balapan: dua kantor menyetujui bersamaan → tepat satu berhasil, shift ditukar sekali", async () => {
    const id = await siapDiputuskan();
    const hasil = await Promise.all([
      setujuiTukarShift({ swapId: id, olehUserId: kantor, sekarang: SEKARANG }),
      setujuiTukarShift({ swapId: id, olehUserId: kantor2, sekarang: SEKARANG }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIPUTUSKAN" }]);
    // Ditukar dua kali akan kembali ke semula.
    expect(await sel(a, SEL)).toMatchObject({ shiftCode: "SIANG" });
    expect(await sel(b, SEL)).toMatchObject({ shiftCode: "PAGI" });
    expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_TUKAR_SHIFT, entityId: seededId(id), action: JEJAK_SHIFT.TUKAR_DISETUJUI } })).toBe(1);
  });

  it("balapan: setujui vs tolak, dan setujui vs batal → tepat satu menang, keadaan konsisten", async () => {
    const id = await siapDiputuskan();
    const [s, t] = await Promise.all([
      setujuiTukarShift({ swapId: id, olehUserId: kantor, sekarang: SEKARANG }),
      tolakTukarShift({ swapId: id, olehUserId: kantor2, catatan: "tidak" }),
    ]);
    expect([s.ok, t.ok].filter(Boolean)).toHaveLength(1);
    const akhir = await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id } });
    expect(akhir.status).toBe(s.ok ? "DISETUJUI" : "DITOLAK");
    expect(await sel(a, SEL)).toMatchObject({ shiftCode: s.ok ? "SIANG" : "PAGI" });

    // Bersihkan sel untuk putaran kedua (ajuan pertama sudah tertutup).
    await prisma.spgShift.deleteMany({ where: { userId: { in: seededIds([a, b]) } } });
    const id2 = await siapDiputuskan();
    const [s2, b2] = await Promise.all([
      setujuiTukarShift({ swapId: id2, olehUserId: kantor, sekarang: SEKARANG }),
      batalkanTukarShift({ swapId: id2, userId: a, storeId: toko }),
    ]);
    expect([s2.ok, b2.ok].filter(Boolean)).toHaveLength(1);
    const akhir2 = await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: id2 } });
    expect(akhir2.status).toBe(s2.ok ? "DISETUJUI" : "DIBATALKAN");
    expect(await sel(a, SEL)).toMatchObject({ shiftCode: s2.ok ? "SIANG" : "PAGI" });
  });

  it("balapan: rekan menjawab dua kali bersamaan (setuju vs tolak) → tepat satu", async () => {
    await isiAwal([{ userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } }]);
    const r = await ajukan();
    if (!r.ok) throw new Error(r.kode);
    const hasil = await Promise.all([
      jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: true, sekarang: SEKARANG }),
      jawabTukarShift({ swapId: r.id, userId: b, storeId: toko, setuju: false, sekarang: SEKARANG }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    const notif = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_TUKAR_SHIFT }, select: { metadata: true } });
    const punyaNotif = notif.some((n) => (n.metadata as Record<string, unknown> | null)?.swapId === r.id);
    const akhir = await prisma.spgShiftSwap.findUniqueOrThrow({ where: { id: r.id } });
    // Catatan kantor ada hanya bila yang menang adalah "setuju".
    expect(punyaNotif).toBe(akhir.status === "MENUNGGU_KANTOR");
  });
});
