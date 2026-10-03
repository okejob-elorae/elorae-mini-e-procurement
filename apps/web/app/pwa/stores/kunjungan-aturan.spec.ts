import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aturan kunjungan di server: mode radius TOLAK, tanda check-in janggal, dan
 * hasil kunjungan saat check-out. Tanpa basis data — semua tiruan, seperti
 * `checkin-kunci.spec.ts`.
 */

type Kunjungan = {
  id: string;
  userId: string;
  storeId: string;
  checkinAt: Date;
  checkoutAt: Date | null;
};

const dec = (n: number) => ({ toNumber: () => n });

const state = {
  tokoTetapSpg: null as string | null,
  toko: { lat: null as number | null, lng: null as number | null, radius: null as number | null },
  setelan: {} as Record<string, string>,
  kunjungan: null as Kunjungan | null,
  sebelumnya: null as null | Record<string, unknown>,
  kembar: [] as Record<string, unknown>[],
  gagalBacaTanda: false,
  jumlah: { pesanan: 0, klaim: 0, retur: 0, van: 0, tukarFaktur: 0, foto: 0 },
  aktif: null as null | { id: string; storeId: string },
  transaksi: 0,
};

const tx = {
  storeVisit: {
    findFirst: vi.fn(async () => state.aktif),
    updateMany: vi.fn<(a: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })),
    create: vi.fn<(a: unknown) => Promise<object>>(async () => ({})),
  },
};

const updateManyLuar = vi.fn<(a: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/store-changes/writer", () => ({ submitStoreChangeRequest: vi.fn() }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => false) }));

const hitung = (k: keyof typeof state.jumlah) => vi.fn(async () => state.jumlah[k]);

vi.mock("@elorae/db", () => ({
  Prisma: {
    Decimal: class {
      constructor(public value: number) {}
    },
    TransactionIsolationLevel: { Serializable: "Serializable" },
  },
  prisma: {
    user: { findUnique: vi.fn(async () => ({ assignedStoreId: state.tokoTetapSpg })) },
    store: {
      findUnique: vi.fn(async () => ({
        id: "s1",
        isActive: true,
        lat: state.toko.lat === null ? null : dec(state.toko.lat),
        lng: state.toko.lng === null ? null : dec(state.toko.lng),
        checkinRadiusMeters: state.toko.radius,
        salesmanId: null,
      })),
    },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key in state.setelan ? { value: state.setelan[where.key] } : null,
      ),
    },
    storeVisit: {
      findUnique: vi.fn(async () => state.kunjungan),
      findFirst: vi.fn(async () => {
        if (state.gagalBacaTanda) throw new Error("db putus");
        return state.sebelumnya;
      }),
      findMany: vi.fn(async () => state.kembar),
      updateMany: (a: unknown) => updateManyLuar(a),
    },
    fieldSalesOrder: { count: hitung("pesanan") },
    paymentClaim: { count: hitung("klaim") },
    storeReturn: { count: hitung("retur") },
    vanSale: { count: hitung("van") },
    collectionNote: { count: hitung("tukarFaktur") },
    visitPhoto: { count: hitung("foto") },
    $transaction: vi.fn(async (cb: (c: unknown) => Promise<unknown>) => {
      state.transaksi += 1;
      return cb(tx);
    }),
  },
}));

const { checkIn, checkOut, bacaSyaratCheckOut } = await import("./actions");

const MASUK = { storeId: "s1", lat: -7.78, lng: 110.37, accuracy: 15 };
// ≈ 1,1 km di utara titik check-in.
const TOKO_JAUH = { lat: -7.77, lng: 110.37, radius: null };
const TOKO_DEKAT = { lat: -7.7801, lng: 110.37, radius: null };
const KELUAR = { visitId: "v1", lat: -7.78, lng: 110.37 };

const dataDibuat = () => (tx.storeVisit.create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;
const dataDitutup = () => (updateManyLuar.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;

beforeEach(() => {
  vi.clearAllMocks();
  state.tokoTetapSpg = null;
  state.toko = { lat: null, lng: null, radius: null };
  state.setelan = {};
  state.kunjungan = { id: "v1", userId: "u1", storeId: "s1", checkinAt: new Date(Date.now() - 3_600_000), checkoutAt: null };
  state.sebelumnya = null;
  state.kembar = [];
  state.gagalBacaTanda = false;
  state.jumlah = { pesanan: 0, klaim: 0, retur: 0, van: 0, tukarFaktur: 0, foto: 0 };
  state.aktif = null;
  state.transaksi = 0;
});

describe("checkIn — mode radius", () => {
  it("PERINGATAN (bawaan): di luar radius tetap boleh, ditandai", async () => {
    state.toko = TOKO_JAUH;
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__:/pwa/stores/s1");
    expect(dataDibuat()).toMatchObject({ checkinOutOfRadius: true });
    expect(dataDibuat().checkinDistanceMeters).toBeGreaterThan(1000);
  });

  it("TOLAK: di luar radius ditolak dengan jarak dan radius, sebelum membuka kunjungan", async () => {
    state.toko = TOKO_JAUH;
    state.setelan["salesman.checkin"] = JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 100 });
    const r = await checkIn(MASUK);
    expect(r).toMatchObject({ ok: false, code: "DI_LUAR_RADIUS", radiusMeter: 100, akurasiMeter: 15 });
    expect((r as { jarakMeter: number }).jarakMeter).toBeGreaterThan(1000);
    expect(state.transaksi).toBe(0);
  });

  it("TOLAK memakai radius per toko / global yang sama dengan mode peringatan", async () => {
    state.toko = { ...TOKO_JAUH, radius: 2000 };
    state.setelan["salesman.checkin"] = JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 100 });
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");

    state.toko = TOKO_JAUH;
    state.setelan["checkin.radiusMeters"] = "5000";
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
  });

  it("TOLAK: di dalam radius atau toko tanpa pin peta tetap boleh", async () => {
    state.setelan["salesman.checkin"] = JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 100 });
    state.toko = TOKO_DEKAT;
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    state.toko = { lat: null, lng: null, radius: null };
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    expect(state.transaksi).toBe(2);
  });

  it("TOLAK juga berlaku untuk SPG di tokonya sendiri", async () => {
    state.tokoTetapSpg = "s1";
    state.toko = TOKO_JAUH;
    state.setelan["salesman.checkin"] = JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 100 });
    expect(await checkIn(MASUK)).toMatchObject({ ok: false, code: "DI_LUAR_RADIUS" });
  });
});

describe("checkIn — akurasi dan tanda janggal", () => {
  it("menyimpan akurasi dan daftar tanda kosong bila bersih", async () => {
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    expect(dataDibuat()).toMatchObject({ checkinAccuracyMeters: 15, checkinFlags: [] });
  });

  it("akurasi di atas batas pemilik → AKURASI_BURUK", async () => {
    state.setelan["salesman.checkin"] = JSON.stringify({ modeRadius: "PERINGATAN", akurasiMaksMeter: 50 });
    await expect(checkIn({ ...MASUK, accuracy: 320.4 })).rejects.toThrow("__REDIRECT__");
    expect(dataDibuat()).toMatchObject({
      checkinAccuracyMeters: 320,
      checkinFlags: [{ kode: "AKURASI_BURUK", akurasiMeter: 320, batasMeter: 50 }],
    });
  });

  it("tanpa akurasi (aplikasi lama) → tetap boleh, ditandai AKURASI_TIDAK_ADA", async () => {
    await expect(checkIn({ storeId: "s1", lat: -7.78, lng: 110.37 })).rejects.toThrow("__REDIRECT__");
    expect(dataDibuat()).toMatchObject({ checkinAccuracyMeters: null, checkinFlags: [{ kode: "AKURASI_TIDAK_ADA" }] });
  });

  it("akurasi bukan angka tidak membuat check-in gagal", async () => {
    await expect(checkIn({ ...MASUK, accuracy: Number.NaN })).rejects.toThrow("__REDIRECT__");
    expect(dataDibuat()).toMatchObject({ checkinAccuracyMeters: null });
  });

  it("lompatan dari check-out sebelumnya dan koordinat kembar ikut tercatat", async () => {
    state.sebelumnya = {
      id: "v0",
      storeId: "s9",
      checkinLat: dec(-7.3),
      checkinLng: dec(110.37),
      checkinAt: new Date(Date.now() - 3_600_000),
      checkoutLat: dec(-7.3),
      checkoutLng: dec(110.37),
      checkoutAt: new Date(Date.now() - 5 * 60_000),
    };
    state.kembar = [
      { storeId: "s2", checkinLat: dec(-7.78), checkinLng: dec(110.37), checkinAt: new Date(Date.now() - 86_400_000), store: { name: "Toko Dua" } },
    ];
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    const kode = (dataDibuat().checkinFlags as { kode: string }[]).map((t) => t.kode);
    expect(kode).toEqual(["LOMPATAN_MUSTAHIL", "KOORDINAT_KEMBAR"]);
  });

  it("bacaan tanda gagal → check-in tetap jalan, tanda tidak disimpan", async () => {
    state.gagalBacaTanda = true;
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    expect(dataDibuat()).not.toHaveProperty("checkinFlags");
    expect(dataDibuat()).toMatchObject({ checkinAccuracyMeters: 15 });
    galat.mockRestore();
  });
});

describe("checkIn — menutup otomatis kunjungan lain", () => {
  const terbuka = {
    id: "v0",
    storeId: "s9",
    checkinLat: dec(-7.7801),
    checkinLng: dec(110.37),
    checkinAt: new Date(Date.now() - 3_600_000),
    checkoutLat: null,
    checkoutLng: null,
    checkoutAt: null,
  };

  it("kunjungan yang ditutup otomatis dan bertransaksi dicatat TRANSAKSI", async () => {
    state.sebelumnya = terbuka;
    state.aktif = { id: "v0", storeId: "s9" };
    state.jumlah.pesanan = 1;
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    expect(tx.storeVisit.updateMany).toHaveBeenCalledWith({
      where: { id: "v0", outcome: null },
      data: { outcome: "TRANSAKSI" },
    });
  });

  it("tanpa transaksi → hanya ditutup, hasil dibiarkan kosong", async () => {
    state.sebelumnya = terbuka;
    state.aktif = { id: "v0", storeId: "s9" };
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__");
    expect(tx.storeVisit.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.storeVisit.updateMany.mock.calls[0][0]).toMatchObject({ data: { autoClosed: true } });
  });
});

describe("checkOut — hasil kunjungan", () => {
  it("salesman tanpa transaksi, alasan wajib (bawaan), tanpa alasan → HASIL_WAJIB, kunjungan tetap terbuka", async () => {
    expect(await checkOut(KELUAR)).toEqual({ ok: false, code: "HASIL_WAJIB" });
    expect(updateManyLuar).not.toHaveBeenCalled();
  });

  it("dengan alasan → ditutup dan alasan + catatan tersimpan", async () => {
    expect(await checkOut({ ...KELUAR, outcome: "STOK_MASIH_BANYAK", outcomeNote: " masih 3 lusin " })).toEqual({
      alreadyClosed: false,
      storeId: "s1",
    });
    expect(dataDitutup()).toMatchObject({ outcome: "STOK_MASIH_BANYAK", outcomeNote: "masih 3 lusin" });
  });

  it("LAINNYA tanpa catatan → CATATAN_WAJIB; alasan tak dikenal → HASIL_TIDAK_SAH", async () => {
    expect(await checkOut({ ...KELUAR, outcome: "LAINNYA" })).toEqual({ ok: false, code: "CATATAN_WAJIB" });
    expect(await checkOut({ ...KELUAR, outcome: "TRANSAKSI" })).toEqual({ ok: false, code: "HASIL_TIDAK_SAH" });
    expect(updateManyLuar).not.toHaveBeenCalled();
  });

  it.each(["pesanan", "klaim", "retur", "van", "tukarFaktur"] as const)(
    "ada %s sejak check-in → TRANSAKSI otomatis tanpa ditanya",
    async (jenis) => {
      state.jumlah[jenis] = 1;
      expect(await checkOut(KELUAR)).toEqual({ alreadyClosed: false, storeId: "s1" });
      expect(dataDitutup()).toMatchObject({ outcome: "TRANSAKSI", outcomeNote: null });
    },
  );

  it("transaksi masih di antrean HP → TRANSAKSI_TERTUNDA", async () => {
    await checkOut({ ...KELUAR, transaksiTertunda: true });
    expect(dataDitutup()).toMatchObject({ outcome: "TRANSAKSI_TERTUNDA" });
  });

  it("pemilik tidak mewajibkan alasan → boleh check-out tanpa hasil", async () => {
    state.setelan["salesman.hasilKunjungan"] = JSON.stringify({ alasanWajib: false, fotoWajib: false });
    expect(await checkOut(KELUAR)).toEqual({ alreadyClosed: false, storeId: "s1" });
    expect(dataDitutup()).not.toHaveProperty("outcome");
  });

  it("SPG: absensi — tidak ditanya alasan, tidak menghitung transaksi", async () => {
    state.tokoTetapSpg = "s1";
    expect(await checkOut(KELUAR)).toEqual({ alreadyClosed: false, storeId: "s1" });
    expect(dataDitutup()).not.toHaveProperty("outcome");
  });

  it("kunjungan yang sudah ditutup → alreadyClosed, tanpa minta alasan", async () => {
    state.kunjungan = { ...state.kunjungan!, checkoutAt: new Date() };
    expect(await checkOut(KELUAR)).toEqual({ alreadyClosed: true, storeId: "s1" });
    expect(updateManyLuar).not.toHaveBeenCalled();
  });

  it("kunjungan orang lain → FORBIDDEN", async () => {
    state.kunjungan = { ...state.kunjungan!, userId: "u2" };
    expect(await checkOut(KELUAR)).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

describe("bacaSyaratCheckOut", () => {
  it("salesman: perlu alasan bila belum ada transaksi; aturan foto dari setelan; hitung foto terkirim", async () => {
    state.setelan["salesman.hasilKunjungan"] = JSON.stringify({ alasanWajib: true, fotoWajib: true });
    state.jumlah.foto = 2;
    expect(await bacaSyaratCheckOut("v1")).toMatchObject({
      ok: true,
      selesai: false,
      storeId: "s1",
      spg: false,
      perluAlasan: true,
      alasanWajib: true,
      fotoWajib: true,
      fotoTerkirim: 2,
    });
    state.jumlah.pesanan = 1;
    expect(await bacaSyaratCheckOut("v1")).toMatchObject({ perluAlasan: false });
  });

  it("SPG tidak pernah ditanya alasan atau foto", async () => {
    state.tokoTetapSpg = "s1";
    state.setelan["salesman.hasilKunjungan"] = JSON.stringify({ alasanWajib: true, fotoWajib: true });
    expect(await bacaSyaratCheckOut("v1")).toMatchObject({ spg: true, perluAlasan: false, fotoWajib: false });
  });

  it("kunjungan selesai, milik orang lain, atau tidak ada", async () => {
    state.kunjungan = { ...state.kunjungan!, checkoutAt: new Date() };
    expect(await bacaSyaratCheckOut("v1")).toEqual({ ok: true, selesai: true, storeId: "s1" });
    state.kunjungan = { ...state.kunjungan!, checkoutAt: null, userId: "u2" };
    expect(await bacaSyaratCheckOut("v1")).toEqual({ ok: false, code: "FORBIDDEN" });
    state.kunjungan = null;
    expect(await bacaSyaratCheckOut("v1")).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
