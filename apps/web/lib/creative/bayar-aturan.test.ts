import { describe, expect, it } from "vitest";
import {
  bacaChipBayar,
  rencanaPembayaran,
  ringkasDialogBayar,
  ringkasTagihan,
  sisaBayar,
  statusBayarEfektif,
} from "./bayar-aturan";

const HARI_INI = "2026-10-07";

describe("rencanaPembayaran", () => {
  it("LUNAS mengisi jumlah sebesar fee dan tanggal hari ini bila kosong", () => {
    expect(rencanaPembayaran({ fee: 1_500_000, status: "LUNAS", hariIni: HARI_INI })).toEqual({
      ok: true,
      payStatus: "LUNAS",
      paidAmount: 1_500_000,
      paidAtHari: HARI_INI,
    });
  });

  it("LUNAS memakai tanggal yang diketik", () => {
    const r = rencanaPembayaran({ fee: 1_000, status: "LUNAS", tanggal: "2026-10-01", hariIni: HARI_INI });
    expect(r).toMatchObject({ ok: true, paidAtHari: "2026-10-01" });
  });

  it("SEBAGIAN menuntut 0 < jumlah < fee", () => {
    expect(rencanaPembayaran({ fee: 1_000_000, status: "SEBAGIAN", hariIni: HARI_INI })).toEqual({ ok: false, kode: "JUMLAH_WAJIB" });
    expect(rencanaPembayaran({ fee: 1_000_000, status: "SEBAGIAN", jumlah: Number.NaN, hariIni: HARI_INI })).toEqual({
      ok: false,
      kode: "JUMLAH_WAJIB",
    });
    expect(rencanaPembayaran({ fee: 1_000_000, status: "SEBAGIAN", jumlah: 0, hariIni: HARI_INI })).toEqual({
      ok: false,
      kode: "JUMLAH_TIDAK_VALID",
    });
    expect(rencanaPembayaran({ fee: 1_000_000, status: "SEBAGIAN", jumlah: 1_000_000, hariIni: HARI_INI })).toEqual({
      ok: false,
      kode: "JUMLAH_TIDAK_VALID",
    });
    expect(rencanaPembayaran({ fee: 1_000_000, status: "SEBAGIAN", jumlah: 400_000.5, hariIni: HARI_INI })).toEqual({
      ok: true,
      payStatus: "SEBAGIAN",
      paidAmount: 400_000.5,
      paidAtHari: HARI_INI,
    });
  });

  it("BELUM mengosongkan jumlah dan tanggal", () => {
    expect(rencanaPembayaran({ fee: 1_000_000, status: "BELUM", jumlah: 50, tanggal: "2026-10-01", hariIni: HARI_INI })).toEqual({
      ok: true,
      payStatus: "BELUM",
      paidAmount: 0,
      paidAtHari: null,
    });
  });

  it("fee nol selalu TIDAK_PERLU, apa pun status yang diminta", () => {
    for (const status of ["LUNAS", "SEBAGIAN", "BELUM", "TIDAK_PERLU"]) {
      expect(rencanaPembayaran({ fee: 0, status, jumlah: 10, hariIni: HARI_INI })).toEqual({
        ok: true,
        payStatus: "TIDAK_PERLU",
        paidAmount: 0,
        paidAtHari: null,
      });
    }
  });

  it("TIDAK_PERLU ditolak untuk kolaborasi yang punya fee", () => {
    expect(rencanaPembayaran({ fee: 1, status: "TIDAK_PERLU", hariIni: HARI_INI })).toEqual({ ok: false, kode: "ADA_FEE" });
  });

  it("menolak status asing, tanggal rusak, dan tanggal sesudah hari ini", () => {
    expect(rencanaPembayaran({ fee: 1_000, status: "DIBAYAR", hariIni: HARI_INI })).toEqual({ ok: false, kode: "STATUS_TIDAK_VALID" });
    expect(rencanaPembayaran({ fee: 1_000, status: "LUNAS", tanggal: "2026-02-31", hariIni: HARI_INI })).toEqual({
      ok: false,
      kode: "TANGGAL_TIDAK_VALID",
    });
    expect(rencanaPembayaran({ fee: 1_000, status: "LUNAS", tanggal: "2026-10-08", hariIni: HARI_INI })).toEqual({
      ok: false,
      kode: "TANGGAL_DEPAN",
    });
  });
});

describe("sisaBayar dan ringkasTagihan", () => {
  it("sisa = fee − dibayar, nol untuk TIDAK_PERLU, tidak pernah negatif", () => {
    expect(sisaBayar({ fee: 1_000_000, paidAmount: 400_000, payStatus: "SEBAGIAN" })).toBe(600_000);
    expect(sisaBayar({ fee: 1_000_000, paidAmount: 1_000_000, payStatus: "LUNAS" })).toBe(0);
    expect(sisaBayar({ fee: 1_000_000, paidAmount: 0, payStatus: "TIDAK_PERLU" })).toBe(0);
    expect(sisaBayar({ fee: 100, paidAmount: 150, payStatus: "LUNAS" })).toBe(0);
    expect(sisaBayar({ fee: 0.3, paidAmount: 0.1, payStatus: "SEBAGIAN" })).toBe(0.2);
  });

  it("menjumlah fee, yang sudah dibayar, dan sisanya aman-sen", () => {
    expect(
      ringkasTagihan([
        { fee: 1_000_000, paidAmount: 0, payStatus: "BELUM" },
        { fee: 500_000.1, paidAmount: 200_000.2, payStatus: "SEBAGIAN" },
        { fee: 750_000, paidAmount: 750_000, payStatus: "LUNAS" },
      ]),
    ).toEqual({ jumlah: 3, totalFee: 2_250_000.1, dibayar: 950_000.2, sisa: 1_299_999.9 });
  });
});

describe("ringkasDialogBayar", () => {
  const dipilih = [
    { id: "a", fee: 1_000_000, paidAmount: 0, payStatus: "BELUM" as const },
    { id: "b", fee: 2_000_000, paidAmount: 500_000, payStatus: "SEBAGIAN" as const },
    { id: "c", fee: 300_000, paidAmount: 0, payStatus: "BELUM" as const },
  ];

  it("LUNAS: total dari SEMUA yang dipilih, termasuk yang tidak tampil di halaman", () => {
    expect(ringkasDialogBayar(dipilih, "LUNAS", {})).toEqual({
      jumlah: 3,
      totalFee: 3_300_000,
      dibayarSesudah: 3_300_000,
      tambahan: 2_800_000,
      galat: {},
    });
  });

  it("SEBAGIAN: memakai jumlah per baris dan menandai baris yang salah", () => {
    const r = ringkasDialogBayar(dipilih, "SEBAGIAN", { a: 250_000, b: 2_000_000 });
    // Baris yang salah dihitung apa adanya (tidak berubah); penyimpanannya ditolak utuh.
    expect(r.dibayarSesudah).toBe(250_000 + 500_000);
    expect(r.tambahan).toBe(250_000);
    expect(r.galat).toEqual({ b: "JUMLAH_TIDAK_VALID", c: "JUMLAH_WAJIB" });
    expect(ringkasDialogBayar(dipilih, "SEBAGIAN", { a: 250_000, b: 1_500_000, c: 100_000 })).toMatchObject({
      dibayarSesudah: 1_850_000,
      tambahan: 1_350_000,
      galat: {},
    });
  });

  it("BELUM: semua kembali ke nol", () => {
    const r = ringkasDialogBayar(dipilih, "BELUM", {});
    expect(r).toMatchObject({ jumlah: 3, dibayarSesudah: 0, tambahan: -500_000, galat: {} });
  });
});

describe("statusBayarEfektif", () => {
  it("fee 0 = TIDAK_PERLU; fee > 0 yang masih TIDAK_PERLU dibaca BELUM", () => {
    expect(statusBayarEfektif(0, "LUNAS")).toBe("TIDAK_PERLU");
    expect(statusBayarEfektif(500_000, "TIDAK_PERLU")).toBe("BELUM");
    expect(statusBayarEfektif(500_000, "SEBAGIAN")).toBe("SEBAGIAN");
  });
});

describe("bacaChipBayar", () => {
  it("bawaan Belum, menerima chip yang dikenal", () => {
    expect(bacaChipBayar(undefined)).toBe("BELUM");
    expect(bacaChipBayar("lunas")).toBe("BELUM");
    expect(bacaChipBayar("LUNAS")).toBe("LUNAS");
    expect(bacaChipBayar("SEMUA")).toBe("SEMUA");
  });
});
