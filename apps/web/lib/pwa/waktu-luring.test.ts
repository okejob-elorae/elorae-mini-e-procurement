import { describe, expect, it } from "vitest";
import { BATAS_CHECKIN_LURING_MS, BATAS_STOK_LURING_MS, jepitWaktuLuring } from "./waktu-luring";

const SEKARANG = new Date("2026-10-03T08:00:00.000Z");

describe("jepitWaktuLuring", () => {
  it("keeps a capture time inside the window, from a Date, an ISO string or milliseconds", () => {
    const t = new Date("2026-10-03T02:00:00.000Z");
    expect(jepitWaktuLuring(t, SEKARANG, BATAS_CHECKIN_LURING_MS)?.toISOString()).toBe(t.toISOString());
    expect(jepitWaktuLuring(t.toISOString(), SEKARANG, BATAS_CHECKIN_LURING_MS)?.toISOString()).toBe(t.toISOString());
    expect(jepitWaktuLuring(t.getTime(), SEKARANG, BATAS_CHECKIN_LURING_MS)?.toISOString()).toBe(t.toISOString());
  });

  it("clamps a phone clock that runs ahead to now", () => {
    expect(jepitWaktuLuring("2026-10-03T09:30:00.000Z", SEKARANG, BATAS_CHECKIN_LURING_MS)?.toISOString()).toBe(SEKARANG.toISOString());
  });

  it("accepts a check-in from a whole day without signal, refuses one older than 14 days like sales and stock", () => {
    const sehari_penuh = new Date(SEKARANG.getTime() - 20 * 3_600_000);
    expect(jepitWaktuLuring(sehari_penuh, SEKARANG, BATAS_CHECKIN_LURING_MS)).not.toBeNull();
    const lima_belas_hari = new Date(SEKARANG.getTime() - 15 * 86_400_000);
    expect(jepitWaktuLuring(lima_belas_hari, SEKARANG, BATAS_CHECKIN_LURING_MS)).toBeNull();
    expect(BATAS_CHECKIN_LURING_MS).toBe(BATAS_STOK_LURING_MS);
    // Tepat di batas masih diterima.
    expect(jepitWaktuLuring(SEKARANG.getTime() - BATAS_CHECKIN_LURING_MS, SEKARANG, BATAS_CHECKIN_LURING_MS)).not.toBeNull();
  });

  it("refuses what cannot be read", () => {
    for (const x of [null, undefined, "", "bukan tanggal", Number.NaN]) {
      expect(jepitWaktuLuring(x as never, SEKARANG, BATAS_STOK_LURING_MS)).toBeNull();
    }
  });
});
