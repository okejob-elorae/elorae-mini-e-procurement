import { describe, expect, it } from "vitest";
import { bacaPeriodeKlaim, bacaStatusKlaim, dalamPeriode, hitungTabKlaim, URUT_STATUS_KLAIM } from "./saring";

/*
 * Tab daftar Pelunasan. Dulu "Semua 6" = 2 + 3 + 0 + 1 BKM batal yang tidak
 * punya tab, dan angka tab tidak ikut kotak cari.
 */
describe("bacaStatusKlaim", () => {
  it("menerima keempat status, termasuk yang dibatalkan", () => {
    for (const s of URUT_STATUS_KLAIM) expect(bacaStatusKlaim(s)).toBe(s);
    expect(bacaStatusKlaim("DIBATALKAN")).toBe("DIBATALKAN");
  });

  it("nilai lain berarti semua", () => {
    expect(bacaStatusKlaim(undefined)).toBeNull();
    expect(bacaStatusKlaim("")).toBeNull();
    expect(bacaStatusKlaim("dikirim")).toBeNull();
  });
});

describe("hitungTabKlaim", () => {
  const baris = [
    { status: "DIKIRIM", mintaKoreksi: false },
    { status: "DIKIRIM", mintaKoreksi: true },
    { status: "TERVERIFIKASI", mintaKoreksi: false },
    { status: "TERVERIFIKASI", mintaKoreksi: false },
    { status: "TERVERIFIKASI", mintaKoreksi: true },
    { status: "DIBATALKAN", mintaKoreksi: false },
  ];

  it("Semua sama dengan jumlah keempat tab", () => {
    const j = hitungTabKlaim(baris);
    expect(j).toEqual({ semua: 6, koreksi: 2, DIKIRIM: 2, TERVERIFIKASI: 3, DITOLAK: 0, DIBATALKAN: 1 });
    expect(j.DIKIRIM + j.TERVERIFIKASI + j.DITOLAK + j.DIBATALKAN).toBe(j.semua);
  });

  it("tanpa baris semuanya nol", () => {
    expect(hitungTabKlaim([])).toEqual({ semua: 0, koreksi: 0, DIKIRIM: 0, TERVERIFIKASI: 0, DITOLAK: 0, DIBATALKAN: 0 });
  });
});

describe("bacaPeriodeKlaim", () => {
  it("tanpa ?dari/?sampai yang sah: tanpa saringan tanggal", () => {
    expect(bacaPeriodeKlaim({})).toBeNull();
    expect(bacaPeriodeKlaim({ dari: "kemarin", sampai: "" })).toBeNull();
    expect(bacaPeriodeKlaim({ dari: "2026-02-31" })).toBeNull();
    expect(bacaPeriodeKlaim({ dari: "2026-9-1" })).toBeNull();
  });

  it("hari WIB, kedua ujung ikut", () => {
    const p = bacaPeriodeKlaim({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(p?.mulai?.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(p?.akhir?.toISOString()).toBe("2026-09-30T16:59:59.999Z");
  });

  it("satu ujung saja boleh; ujung terbalik ditukar", () => {
    expect(bacaPeriodeKlaim({ dari: "2026-09-01" })).toMatchObject({ dari: "2026-09-01", sampai: null, akhir: null });
    expect(bacaPeriodeKlaim({ dari: "2026-09-30", sampai: "2026-09-01" })).toMatchObject({ dari: "2026-09-01", sampai: "2026-09-30" });
  });
});

describe("dalamPeriode", () => {
  const sept = bacaPeriodeKlaim({ dari: "2026-09-01", sampai: "2026-09-30" });
  // Transfer 28 Agu, diverifikasi 1 Okt 00.30 WIB (= 30 Sep 17.30 UTC).
  const bkm = { claimedTransferAt: "2026-08-28T03:00:00.000Z", verifiedAt: "2026-09-30T17:30:00.000Z" };

  it("tab Terverifikasi memakai tanggal verifikasi, per hari WIB", () => {
    expect(dalamPeriode(bkm, "TERVERIFIKASI", sept)).toBe(false);
    const okt = bacaPeriodeKlaim({ dari: "2026-10-01", sampai: "2026-10-31" });
    expect(dalamPeriode(bkm, "TERVERIFIKASI", okt)).toBe(true);
  });

  it("tab lain dan Semua memakai tanggal transfer di BKM", () => {
    const agu = bacaPeriodeKlaim({ dari: "2026-08-01", sampai: "2026-08-31" });
    expect(dalamPeriode(bkm, null, agu)).toBe(true);
    expect(dalamPeriode(bkm, "DIKIRIM", sept)).toBe(false);
  });

  it("BKM yang belum diverifikasi tidak masuk periode verifikasi apa pun", () => {
    expect(dalamPeriode({ claimedTransferAt: bkm.claimedTransferAt, verifiedAt: null }, "TERVERIFIKASI", sept)).toBe(false);
  });

  it("tanpa periode semuanya lolos", () => {
    expect(dalamPeriode(bkm, "TERVERIFIKASI", null)).toBe(true);
  });
});

describe("hitungTabKlaim dengan periode", () => {
  const sept = bacaPeriodeKlaim({ dari: "2026-09-01", sampai: "2026-09-30" });
  const baris = [
    // Transfer Agustus, diverifikasi September → tab Terverifikasi September, bukan "Semua" September.
    { status: "TERVERIFIKASI", mintaKoreksi: false, claimedTransferAt: "2026-08-28T03:00:00Z", verifiedAt: "2026-09-02T03:00:00Z" },
    // Transfer September, diverifikasi Oktober.
    { status: "TERVERIFIKASI", mintaKoreksi: false, claimedTransferAt: "2026-09-29T03:00:00Z", verifiedAt: "2026-10-02T03:00:00Z" },
    { status: "DIKIRIM", mintaKoreksi: true, claimedTransferAt: "2026-09-10T03:00:00Z", verifiedAt: null },
    { status: "DIKIRIM", mintaKoreksi: false, claimedTransferAt: "2026-07-10T03:00:00Z", verifiedAt: null },
  ];

  it("angka tiap tab = baris yang muncul saat tab itu diklik", () => {
    expect(hitungTabKlaim(baris, sept)).toEqual({ semua: 2, koreksi: 1, DIKIRIM: 1, TERVERIFIKASI: 1, DITOLAK: 0, DIBATALKAN: 0 });
  });
});
