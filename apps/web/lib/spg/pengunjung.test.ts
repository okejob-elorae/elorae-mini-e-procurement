import { describe, expect, it } from "vitest";
import {
  bacaCatatan,
  catatanKedaluwarsa,
  gabungDenganServer,
  hariDariKunci,
  hariIniPengunjung,
  ketuk,
  kirimanMenang,
  kunciCatatan,
  MAKS_PENGUNJUNG,
  perluDikirim,
  periksaKirimanPengunjung,
  setelahDiterima,
  type CatatanPengunjung,
} from "./pengunjung";

// 3 Okt 2026 12.00 WIB.
const SEKARANG = new Date("2026-10-03T05:00:00Z");
const kirim = (o: Record<string, unknown>) => periksaKirimanPengunjung({ day: "2026-10-03", count: 5, clientUpdatedAt: "2026-10-03T04:59:00Z", ...o }, SEKARANG);

describe("periksaKirimanPengunjung", () => {
  it("accepts today and up to three days back, refuses older and future days", () => {
    expect(kirim({})).toEqual({ ok: true, nilai: { day: "2026-10-03", count: 5, clientUpdatedAt: new Date("2026-10-03T04:59:00Z") } });
    expect(kirim({ day: "2026-09-30" }).ok).toBe(true);
    expect(kirim({ day: "2026-09-29" })).toEqual({ ok: false, kode: "HARI_TERLALU_LAMA" });
    expect(kirim({ day: "2026-10-04" })).toEqual({ ok: false, kode: "HARI_DEPAN" });
  });

  it("judges 'today' by the WIB calendar, not UTC", () => {
    // 23.30 WIB 3 Okt = 16.30 UTC: masih 3 Okt; 00.30 WIB 4 Okt = 17.30 UTC 3 Okt.
    expect(periksaKirimanPengunjung({ day: "2026-10-04", count: 1, clientUpdatedAt: "2026-10-03T17:30:00Z" }, new Date("2026-10-03T17:30:00Z")).ok).toBe(true);
    expect(periksaKirimanPengunjung({ day: "2026-10-04", count: 1, clientUpdatedAt: "2026-10-03T16:30:00Z" }, new Date("2026-10-03T16:30:00Z"))).toEqual({
      ok: false,
      kode: "HARI_DEPAN",
    });
  });

  it("refuses counts that are not whole, negative or absurd", () => {
    for (const count of [-1, 1.5, "5", MAKS_PENGUNJUNG + 1, null]) expect(kirim({ count })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    expect(kirim({ count: 0 }).ok).toBe(true);
    expect(kirim({ day: "2026-02-30" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    expect(periksaKirimanPengunjung(null, SEKARANG)).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
  });

  it("refuses a missing, broken, or far-future change time (a phone clock hours ahead would win forever)", () => {
    expect(kirim({ clientUpdatedAt: undefined })).toEqual({ ok: false, kode: "WAKTU_TIDAK_SAH" });
    expect(kirim({ clientUpdatedAt: "kemarin" })).toEqual({ ok: false, kode: "WAKTU_TIDAK_SAH" });
    expect(kirim({ clientUpdatedAt: "2026-10-03T07:00:00Z" })).toEqual({ ok: false, kode: "WAKTU_TIDAK_SAH" });
    expect(kirim({ clientUpdatedAt: "2026-10-03T05:30:00Z" }).ok).toBe(true);
  });
});

describe("kirimanMenang", () => {
  it("writes only a strictly newer change; the same time is a resend", () => {
    const t = new Date("2026-10-03T04:00:00Z");
    expect(kirimanMenang(null, t)).toBe(true);
    expect(kirimanMenang(t, new Date(t.getTime() + 1))).toBe(true);
    expect(kirimanMenang(t, t)).toBe(false);
    expect(kirimanMenang(t, new Date(t.getTime() - 1))).toBe(false);
  });
});

describe("catatan di HP", () => {
  it("never goes below zero and keeps the change time moving forward even when the phone clock steps back", () => {
    const a = ketuk(null, 1, SEKARANG);
    expect(a).toEqual({ count: 1, ubah: SEKARANG.toISOString(), terkirim: null });
    const b = ketuk(a, -1, SEKARANG);
    expect(b.count).toBe(0);
    expect(Date.parse(b.ubah)).toBeGreaterThan(Date.parse(a.ubah));
    const c = ketuk(b, -1, new Date(SEKARANG.getTime() - 60_000));
    expect(c.count).toBe(0);
    expect(Date.parse(c.ubah)).toBeGreaterThan(Date.parse(b.ubah));
  });

  it("keeps the last acknowledged time so a tap made while sending is still sent afterwards", () => {
    const awal: CatatanPengunjung = { count: 3, ubah: "2026-10-03T04:00:00.000Z", terkirim: null };
    const dikirim = awal.ubah;
    const sesudahKetuk = ketuk(awal, 1, SEKARANG);
    const server = { count: 3, clientUpdatedAt: dikirim };
    const hasil = setelahDiterima(sesudahKetuk, dikirim, server);
    expect(hasil).toEqual({ ...sesudahKetuk, terkirim: null });
    expect(perluDikirim(hasil)).toBe(true);
    // Tanpa ketukan di tengah jalan: tertanda terkirim.
    expect(perluDikirim(setelahDiterima(awal, dikirim, server))).toBe(false);
  });

  it("merges with the server: the newer change time wins either way", () => {
    const lokal: CatatanPengunjung = { count: 7, ubah: "2026-10-03T04:00:00.000Z", terkirim: null };
    expect(gabungDenganServer(lokal, null)).toBe(lokal);
    expect(gabungDenganServer(null, { count: 2, clientUpdatedAt: "2026-10-03T03:00:00.000Z" })).toEqual({
      count: 2,
      ubah: "2026-10-03T03:00:00.000Z",
      terkirim: "2026-10-03T03:00:00.000Z",
    });
    expect(gabungDenganServer(lokal, { count: 2, clientUpdatedAt: "2026-10-03T03:00:00.000Z" })).toBe(lokal);
    expect(gabungDenganServer(lokal, { count: 9, clientUpdatedAt: "2026-10-03T04:30:00.000Z" })).toEqual({
      count: 9,
      ubah: "2026-10-03T04:30:00.000Z",
      terkirim: "2026-10-03T04:30:00.000Z",
    });
    expect(gabungDenganServer(lokal, { count: 7, clientUpdatedAt: lokal.ubah })).toEqual({ ...lokal, terkirim: lokal.ubah });
  });

  it("reads back only well-formed records", () => {
    const c: CatatanPengunjung = { count: 4, ubah: "2026-10-03T04:00:00.000Z", terkirim: null };
    expect(bacaCatatan(JSON.stringify(c))).toEqual(c);
    expect(bacaCatatan(null)).toBeNull();
    expect(bacaCatatan("{rusak")).toBeNull();
    expect(bacaCatatan(JSON.stringify({ count: -2, ubah: c.ubah }))).toBeNull();
    expect(bacaCatatan(JSON.stringify({ count: 2, ubah: "bukan waktu" }))).toBeNull();
    expect(bacaCatatan(JSON.stringify({ count: 2, ubah: c.ubah, terkirim: 12 }))).toEqual({ count: 2, ubah: c.ubah, terkirim: null });
  });

  it("keys records by person, store and day, and never reads another person's key", () => {
    const k = kunciCatatan("u1", "s1", "2026-10-03");
    expect(hariDariKunci(k, "u1", "s1")).toBe("2026-10-03");
    expect(hariDariKunci(k, "u2", "s1")).toBeNull();
    expect(hariDariKunci(k, "u1", "s2")).toBeNull();
    expect(hariDariKunci(`${kunciCatatan("u1", "s1", "")}xx`, "u1", "s1")).toBeNull();
  });

  it("drops records the server would no longer accept", () => {
    const hariIni = hariIniPengunjung(SEKARANG);
    expect(hariIni).toBe("2026-10-03");
    expect(catatanKedaluwarsa("2026-09-30", hariIni)).toBe(false);
    expect(catatanKedaluwarsa("2026-09-29", hariIni)).toBe(true);
  });
});
