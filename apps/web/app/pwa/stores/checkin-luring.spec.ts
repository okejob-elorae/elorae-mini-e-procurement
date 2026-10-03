import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Check-in dan check-out yang dicatat TANPA sinyal, terhadap basis data uji:
 * idempoten per id buatan HP, dicatat pada waktu HP (dijepit/ditolak), urutan
 * waktu dijaga walau tiba sesudah kunjungan yang lebih baru, ditautkan ke
 * check-in dengan sinyal yang jawabannya hilang, dan absensi SPG ikut waktu HP.
 *
 * Fixture bertag acak; teardown hanya lewat id yang diseed. Penulis absensi
 * ditirukan — yang dipasak hanya waktu yang diteruskan kepadanya.
 */

const h = vi.hoisted(() => ({
  userId: "",
  absenMasuk: vi.fn(async () => "LEWATI"),
  absenPulang: vi.fn(async () => "LEWATI"),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: h.userId, permissions: ["pwa:access"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/salesman/absensi-writer", () => ({ absenMasukLewatCheckin: h.absenMasuk, absenPulangLewatCheckout: h.absenPulang }));

const { checkInLuringAction, checkOutLuringAction } = await import("./actions");
const { cariKunjunganAntrean } = await import("@/lib/pwa/kunjungan-antrean");
const { bacaAturanHasilKunjungan, KUNCI_HASIL_KUNJUNGAN } = await import("@/lib/salesman/aturan-kunjungan");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `CIL-${Math.random().toString(36).slice(2, 9)}`;

d("check-in / check-out tanpa sinyal (test bed only)", () => {
  let salesman = "";
  let salesman2 = "";
  let spg = "";
  let tokoA = "";
  let tokoB = "";
  let kunci = 0;
  const id = () => `${tag}-${kunci++}`;

  beforeAll(async () => {
    const pengguna = async (n: string, assignedStoreId: string | null = null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    salesman = await pengguna("sales");
    salesman2 = await pengguna("sales2");
    // Toko dipegang salesman uji — kunci "hanya toko sendiri" (bila menyala) tetap meloloskannya.
    const toko = async (kode: string) =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType: "PUTUS", salesmanId: salesman },
        })
      ).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    spg = await pengguna("spg", tokoA);
  });

  beforeEach(() => {
    h.userId = salesman;
    h.absenMasuk.mockClear();
    h.absenPulang.mockClear();
  });

  afterEach(async () => {
    await prisma.storeVisit.deleteMany({ where: { userId: { in: seededIds([salesman, salesman2, spg]) } } });
  });

  afterAll(async () => {
    // SPG menunjuk toko, toko menunjuk salesman: hapus berurutan.
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesman, salesman2]) } } });
  });

  const jamLalu = (n: number) => new Date(Date.now() - n * 3_600_000);
  const masuk = (clientId: string, storeId: string, waktu: Date) =>
    checkInLuringAction({ clientId, storeId, lat: -7.78, lng: 110.37, accuracy: 10, waktu: waktu.toISOString() });
  const kunjungan = (visitId: string) => prisma.storeVisit.findUniqueOrThrow({ where: { id: visitId } });
  const bukaOnline = (storeId: string, checkinAt: Date, userId = salesman) =>
    prisma.storeVisit.create({ data: { storeId, userId, checkinAt, checkinLat: 1, checkinLng: 1 } });

  it("records the visit at the phone's time, marked offline, and a resend returns the same visit", async () => {
    const waktu = jamLalu(2);
    const c = id();
    const r = await masuk(c, tokoA, waktu);
    if (!r.ok) throw new Error(r.code);
    const v = await kunjungan(r.visitId);
    expect(v).toMatchObject({ storeId: tokoA, clientId: c, capturedOffline: true, checkinAt: waktu, checkoutAt: null });
    expect(v.syncedAt).not.toBeNull();

    expect(await masuk(c, tokoA, waktu)).toEqual({ ok: true, visitId: r.visitId, storeId: tokoA });
    expect(await prisma.storeVisit.count({ where: { userId: salesman } })).toBe(1);

    // Id yang sama milik orang lain tidak membuka kunjungannya.
    h.userId = salesman2;
    expect(await masuk(c, tokoA, waktu)).toEqual({ ok: false, code: "KUNCI_DIPAKAI" });
  });

  it("refuses a check-in older than 14 days and clamps a phone clock that runs ahead", async () => {
    expect(await masuk(id(), tokoA, jamLalu(15 * 24))).toEqual({ ok: false, code: "WAKTU_TIDAK_VALID" });
    const sebelum = Date.now();
    const r = await masuk(id(), tokoA, new Date(Date.now() + 3 * 3_600_000));
    if (!r.ok) throw new Error(r.code);
    const v = await kunjungan(r.visitId);
    expect(v.checkinAt.getTime()).toBeGreaterThanOrEqual(sebelum - 1000);
    expect(v.checkinAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("closes the visit still open elsewhere at the phone's check-in time, not when the signal came back", async () => {
    const lama = await bukaOnline(tokoB, jamLalu(3));
    const waktu = jamLalu(2);
    const r = await masuk(id(), tokoA, waktu);
    if (!r.ok) throw new Error(r.code);
    expect(await kunjungan(lama.id)).toMatchObject({ checkoutAt: waktu, autoClosed: true });
    expect((await kunjungan(r.visitId)).checkoutAt).toBeNull();
  });

  it("a check-in arriving after a newer visit is recorded already closed, and its own check-out straightens the time", async () => {
    const baru = await bukaOnline(tokoB, jamLalu(1));
    const c = id();
    const waktu = jamLalu(3);
    const r = await masuk(c, tokoA, waktu);
    if (!r.ok) throw new Error(r.code);
    expect(await kunjungan(r.visitId)).toMatchObject({ checkinAt: waktu, checkoutAt: baru.checkinAt, autoClosed: true });
    // Kunjungan yang lebih baru tidak tersentuh.
    expect((await kunjungan(baru.id)).checkoutAt).toBeNull();

    const keluar = jamLalu(2);
    const k = await checkOutLuringAction({ visitClientId: c, waktu: keluar.toISOString(), lat: 1, lng: 2, outcome: "TOKO_TUTUP", outcomeNote: null });
    expect(k).toEqual({ ok: true, storeId: tokoA, sudahTertutup: false });
    expect(await kunjungan(r.visitId)).toMatchObject({ checkoutAt: keluar, autoClosed: false, outcome: "TOKO_TUTUP" });
  });

  it("links to the online check-in whose answer never arrived instead of opening a second visit", async () => {
    const online = await bukaOnline(tokoA, jamLalu(2));
    const c = id();
    const r = await masuk(c, tokoA, jamLalu(1));
    expect(r).toEqual({ ok: true, visitId: online.id, storeId: tokoA });
    expect((await kunjungan(online.id)).clientId).toBe(c);
    expect(await prisma.storeVisit.count({ where: { userId: salesman } })).toBe(1);
  });

  it("checks out an offline visit at the phone's time, asking a salesman for the reason the owner requires", async () => {
    const c = id();
    const r = await masuk(c, tokoA, jamLalu(3));
    if (!r.ok) throw new Error(r.code);
    const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_HASIL_KUNJUNGAN }, select: { value: true } });
    const alasanWajib = bacaAturanHasilKunjungan(setelan?.value).alasanWajib;
    const tanpaAlasan = await checkOutLuringAction({ visitClientId: c, waktu: jamLalu(2).toISOString(), lat: 1, lng: 2 });
    if (alasanWajib) {
      expect(tanpaAlasan).toEqual({ ok: false, code: "HASIL_WAJIB" });
      const keluar = jamLalu(2);
      const k = await checkOutLuringAction({ visitClientId: c, waktu: keluar.toISOString(), lat: 1, lng: 2, transaksiTertunda: true });
      expect(k).toEqual({ ok: true, storeId: tokoA, sudahTertutup: false });
      expect(await kunjungan(r.visitId)).toMatchObject({ checkoutAt: keluar, outcome: "TRANSAKSI_TERTUNDA" });
    } else {
      expect(tanpaAlasan).toEqual({ ok: true, storeId: tokoA, sudahTertutup: false });
    }
    // Kiriman ulang: sudah ditutup, tidak diubah lagi.
    const ulang = await checkOutLuringAction({ visitClientId: c, waktu: jamLalu(1).toISOString(), lat: 1, lng: 2, outcome: "TOKO_TUTUP" });
    expect(ulang).toEqual({ ok: true, storeId: tokoA, sudahTertutup: true });
  });

  it("never closes a visit before it began, and refuses someone else's visit", async () => {
    const c = id();
    const r = await masuk(c, tokoA, jamLalu(2));
    if (!r.ok) throw new Error(r.code);
    h.userId = salesman2;
    expect(await checkOutLuringAction({ visitClientId: c, waktu: jamLalu(1).toISOString(), lat: 1, lng: 2 })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await checkOutLuringAction({ visitClientId: "tidak-ada", waktu: jamLalu(1).toISOString(), lat: 1, lng: 2 })).toEqual({
      ok: false,
      code: "KUNJUNGAN_TIDAK_SAH",
    });
    h.userId = salesman;
    const k = await checkOutLuringAction({ visitClientId: c, waktu: jamLalu(5).toISOString(), lat: 1, lng: 2, transaksiTertunda: true });
    expect(k.ok).toBe(true);
    const v = await kunjungan(r.visitId);
    expect(v.checkoutAt?.getTime()).toBe(v.checkinAt.getTime());
  });

  it("an SPG checks in only at their own store, and attendance follows the phone's times", async () => {
    h.userId = spg;
    expect(await masuk(id(), tokoB, jamLalu(1))).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
    const c = id();
    const waktu = jamLalu(3);
    const r = await masuk(c, tokoA, waktu);
    if (!r.ok) throw new Error(r.code);
    expect(h.absenMasuk).toHaveBeenCalledWith(expect.objectContaining({ userId: spg, sekarang: waktu }));
    const keluar = jamLalu(1);
    expect(await checkOutLuringAction({ visitClientId: c, waktu: keluar.toISOString(), lat: 1, lng: 2 })).toEqual({
      ok: true,
      storeId: tokoA,
      sudahTertutup: false,
    });
    expect(h.absenPulang).toHaveBeenCalledWith(expect.objectContaining({ userId: spg, sekarang: keluar }));
  });

  it("balapan: two sends of the same offline check-out at once close the visit once, and clock the SPG out once", async () => {
    h.userId = spg;
    const c = id();
    const r = await masuk(c, tokoA, jamLalu(3));
    if (!r.ok) throw new Error(r.code);
    const keluar = jamLalu(1).toISOString();
    const hasil = await Promise.all([
      checkOutLuringAction({ visitClientId: c, waktu: keluar, lat: 1, lng: 2 }),
      checkOutLuringAction({ visitClientId: c, waktu: keluar, lat: 1, lng: 2 }),
    ]);
    expect(hasil.map((x) => (x.ok ? x.sudahTertutup : "gagal")).sort()).toEqual([false, true]);
    expect(h.absenPulang).toHaveBeenCalledTimes(1);
  });

  it("balapan: two sends of the same offline check-in at once open one visit", async () => {
    const c = id();
    const waktu = jamLalu(1);
    const hasil = await Promise.all([masuk(c, tokoA, waktu), masuk(c, tokoA, waktu)]);
    expect(hasil.every((x) => x.ok)).toBe(true);
    expect(new Set(hasil.map((x) => (x.ok ? x.visitId : ""))).size).toBe(1);
    expect(await prisma.storeVisit.count({ where: { userId: salesman } })).toBe(1);
  });

  it("work queued under an offline check-in finds its visit by the phone's id — only the owner's, only at that store", async () => {
    const c = id();
    const r = await masuk(c, tokoA, jamLalu(1));
    if (!r.ok) throw new Error(r.code);
    expect(await cariKunjunganAntrean({ userId: salesman, storeId: tokoA, visitClientId: c })).toBe(r.visitId);
    expect(await cariKunjunganAntrean({ userId: salesman2, storeId: tokoA, visitClientId: c })).toBeNull();
    expect(await cariKunjunganAntrean({ userId: salesman, storeId: tokoB, visitClientId: c })).toBeNull();
    // Id server tetap bisa dipakai; id buatan HP didahulukan bila keduanya ada.
    expect(await cariKunjunganAntrean({ userId: salesman, storeId: tokoA, visitId: r.visitId })).toBe(r.visitId);
    expect(await cariKunjunganAntrean({ userId: salesman, storeId: tokoA, visitId: "salah", visitClientId: c })).toBe(r.visitId);
    expect(await cariKunjunganAntrean({ userId: salesman, storeId: tokoA })).toBeNull();
  });

});
