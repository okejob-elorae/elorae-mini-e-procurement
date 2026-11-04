import { describe, expect, it, vi } from "vitest";

// Modul ini memuat Dexie lewat `./db`; yang dites di sini hanya bagian murninya.
vi.mock("./db", () => ({ pwaDb: {} }));

const {
  UMUR_KUNJUNGAN_LOKAL_MS,
  adaTransaksiTertahan,
  bacaAturanTersimpan,
  bacaCatatanTerkirim,
  ikatanKunjungan,
  kunjunganLokalSah,
  pilihKunjunganLokal,
} = await import("./luring-kunjungan");

const SEKARANG = Date.parse("2026-10-03T08:00:00.000Z");
const jam = (n: number) => SEKARANG - n * 3_600_000;

const checkin = (localId: string, storeId: string, waktu: number, lain: Record<string, unknown> = {}) => ({
  localId,
  storeId,
  storeName: `Toko ${storeId}`,
  waktu,
  syncState: "pending" as const,
  error: undefined,
  galatRinci: null,
  ...lain,
});

describe("pilihKunjunganLokal", () => {
  it("a queued check-in is the visit running on the phone", () => {
    const k = pilihKunjunganLokal({ checkins: [checkin("c1", "A", jam(1))], checkouts: [], terkirim: null, sekarang: SEKARANG });
    expect(k).toMatchObject({ clientId: "c1", storeId: "A", keadaan: "antre", visitId: null });
  });

  it("a queued check-out ends it", () => {
    const k = pilihKunjunganLokal({
      checkins: [checkin("c1", "A", jam(1))],
      checkouts: [{ visitId: null, visitClientId: "c1" }],
      terkirim: null,
      sekarang: SEKARANG,
    });
    expect(k).toBeNull();
  });

  it("the latest check-in wins — a later one at another store means this store has no visit", () => {
    const m = { checkins: [checkin("c1", "A", jam(3)), checkin("c2", "B", jam(1))], checkouts: [], terkirim: null, sekarang: SEKARANG };
    expect(pilihKunjunganLokal(m)?.clientId).toBe("c2");
    expect(pilihKunjunganLokal({ ...m, storeId: "A" })).toBeNull();
    expect(pilihKunjunganLokal({ ...m, storeId: "B" })?.clientId).toBe("c2");
  });

  it("a rejected check-in is reported with its reason and numbers, and is not valid to work under", () => {
    const k = pilihKunjunganLokal({
      checkins: [checkin("c1", "A", jam(1), { syncState: "failed", error: "DI_LUAR_RADIUS", galatRinci: { jarakMeter: 900, radiusMeter: 100 } })],
      checkouts: [],
      terkirim: null,
      sekarang: SEKARANG,
    });
    expect(k).toMatchObject({ keadaan: "ditolak", alasan: "DI_LUAR_RADIUS", rinci: { jarakMeter: 900, radiusMeter: 100 } });
    expect(kunjunganLokalSah(k)).toBe(false);
  });

  it("a check-in already sent stays the running visit until checked out, by its client id or server id", () => {
    const terkirim = { clientId: "c1", storeId: "A", storeName: "Toko A", waktu: jam(2), visitId: "v1" };
    expect(pilihKunjunganLokal({ checkins: [], checkouts: [], terkirim, sekarang: SEKARANG })).toMatchObject({
      keadaan: "terkirim",
      visitId: "v1",
    });
    expect(pilihKunjunganLokal({ checkins: [], checkouts: [{ visitId: "v1", visitClientId: null }], terkirim, sekarang: SEKARANG })).toBeNull();
    expect(pilihKunjunganLokal({ checkins: [], checkouts: [{ visitId: null, visitClientId: "c1" }], terkirim, sekarang: SEKARANG })).toBeNull();
  });

  it("forgets visits older than a working day", () => {
    const tua = SEKARANG - UMUR_KUNJUNGAN_LOKAL_MS - 1;
    expect(pilihKunjunganLokal({ checkins: [checkin("c1", "A", tua)], checkouts: [], terkirim: null, sekarang: SEKARANG })).toBeNull();
  });
});

describe("ikatanKunjungan", () => {
  const lokal = (keadaan: "antre" | "terkirim" | "ditolak", waktu = jam(1)) => ({
    clientId: "c1",
    storeId: "A",
    storeName: null,
    waktu,
    keadaan,
    alasan: null,
    rinci: null,
    visitId: keadaan === "terkirim" ? "v-lokal" : null,
  });

  it("binds work to a queued check-in by its client id, and to a sent one by its server id", () => {
    expect(ikatanKunjungan(null, lokal("antre"))).toEqual({ visitId: null, visitClientId: "c1" });
    expect(ikatanKunjungan(null, lokal("terkirim"))).toEqual({ visitId: "v-lokal", visitClientId: null });
  });

  it("uses the newer of the page's server visit and the phone's visit", () => {
    expect(ikatanKunjungan({ id: "v-server", checkinAtMs: jam(3) }, lokal("antre", jam(1)))).toEqual({ visitId: null, visitClientId: "c1" });
    expect(ikatanKunjungan({ id: "v-server", checkinAtMs: jam(0.5) }, lokal("antre", jam(1)))).toEqual({ visitId: "v-server", visitClientId: null });
  });

  it("never binds to a rejected check-in", () => {
    expect(ikatanKunjungan({ id: "v-server" }, lokal("ditolak"))).toEqual({ visitId: "v-server", visitClientId: null });
    expect(ikatanKunjungan(null, lokal("ditolak"))).toBeNull();
  });
});

describe("adaTransaksiTertahan", () => {
  const kosong = { pesanan: [], klaim: [], retur: [] };
  const acuan = { visitId: "v1", visitClientId: "c1", storeId: "A", sejakMs: jam(2) };

  it("sees an order tied to the visit by either id, but not a rejected one", () => {
    expect(adaTransaksiTertahan({ ...kosong, pesanan: [{ visitId: "v1", syncState: "pending" }] }, acuan)).toBe(true);
    expect(adaTransaksiTertahan({ ...kosong, pesanan: [{ visitId: null, visitClientId: "c1", syncState: "pending" }] }, acuan)).toBe(true);
    expect(adaTransaksiTertahan({ ...kosong, pesanan: [{ visitId: "v1", syncState: "failed" }] }, acuan)).toBe(false);
  });

  it("sees a payment report or store return at the store since check-in", () => {
    expect(adaTransaksiTertahan({ ...kosong, klaim: [{ storeId: "A", capturedAt: jam(1), syncState: "pending" }] }, acuan)).toBe(true);
    expect(adaTransaksiTertahan({ ...kosong, retur: [{ storeId: "A", capturedAt: jam(3), syncState: "pending" }] }, acuan)).toBe(false);
    expect(adaTransaksiTertahan({ ...kosong, retur: [{ storeId: "B", capturedAt: jam(1), syncState: "pending" }] }, acuan)).toBe(false);
    // Waktu check-in tidak diketahui (kunjungan server, tanpa sinyal): semua di toko itu dihitung.
    expect(adaTransaksiTertahan({ ...kosong, retur: [{ storeId: "A", capturedAt: jam(30), syncState: "pending" }] }, { ...acuan, sejakMs: null })).toBe(true);
  });
});

describe("stored records", () => {
  it("reads a sent-visit record and refuses a broken one", () => {
    const sah = { clientId: "c1", storeId: "A", storeName: "Toko A", waktu: 1, visitId: "v1" };
    expect(bacaCatatanTerkirim(JSON.stringify(sah))).toEqual(sah);
    expect(bacaCatatanTerkirim("{rusak")).toBeNull();
    expect(bacaCatatanTerkirim(JSON.stringify({ ...sah, visitId: 5 }))).toBeNull();
    expect(bacaCatatanTerkirim(null)).toBeNull();
  });

  it("reads the stored check-out rules only when every field is a boolean", () => {
    expect(bacaAturanTersimpan(JSON.stringify({ spg: true, alasanWajib: false, fotoWajib: false }))).toEqual({ spg: true, alasanWajib: false, fotoWajib: false });
    expect(bacaAturanTersimpan(JSON.stringify({ spg: "ya", alasanWajib: false, fotoWajib: false }))).toBeNull();
    expect(bacaAturanTersimpan(null)).toBeNull();
  });
});
