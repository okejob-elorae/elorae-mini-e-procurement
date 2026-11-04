import { describe, expect, it } from "vitest";
import { DocType } from "@elorae/db";
import { contohNomorBerikutnya, kelompokDokumen, periksaIsianNomor, SEMUA_JENIS_DOKUMEN, urutkanJenisDokumen } from "./jenis-dokumen";

// 6 Okt 2026, siang (waktu setempat).
const KINI = new Date(2026, 9, 6, 12, 0, 0);

describe("SEMUA_JENIS_DOKUMEN", () => {
  it("memuat setiap jenis dokumen yang dibuat generateDocNumber, tepat satu kali", () => {
    expect(new Set(SEMUA_JENIS_DOKUMEN)).toEqual(new Set(Object.values(DocType)));
    expect(SEMUA_JENIS_DOKUMEN.length).toBe(Object.values(DocType).length);
  });
});

describe("urutkanJenisDokumen — jenis baru tanpa kelompok tidak mematahkan build", () => {
  it("diurutkan per kelompok; jenis yang belum dikelompokkan masuk Lainnya, paling akhir", () => {
    const urut = urutkanJenisDokumen(["VANSALE", "BARU" as never, "PO", "DELIVERY", "WO"]);
    expect(urut).toEqual(["PO", "WO", "DELIVERY", "VANSALE", "BARU"]);
    expect(kelompokDokumen("BARU" as never)).toBe("lainnya");
  });
});

describe("contohNomorBerikutnya — sama dengan susunan generateDocNumber", () => {
  it("tahunan di tahun yang sama: nomor terakhir + 1", () => {
    expect(
      contohNomorBerikutnya({ prefix: "PO/", resetPeriod: "YEARLY", padding: 4, lastNumber: 48, year: 2026, month: 3 }, KINI),
    ).toBe("PO/2026/0049");
  });

  it("tahunan, penghitung masih tahun lalu: mulai dari 1", () => {
    expect(
      contohNomorBerikutnya({ prefix: "PO/", resetPeriod: "YEARLY", padding: 4, lastNumber: 812, year: 2025, month: 12 }, KINI),
    ).toBe("PO/2026/0001");
  });

  it("bulanan memuat bulan dua digit; bulan lain mulai dari 1", () => {
    expect(
      contohNomorBerikutnya({ prefix: "DLV/", resetPeriod: "MONTHLY", padding: 4, lastNumber: 11, year: 2026, month: 10 }, KINI),
    ).toBe("DLV/2026/10/0012");
    expect(
      contohNomorBerikutnya({ prefix: "DLV/", resetPeriod: "MONTHLY", padding: 4, lastNumber: 11, year: 2026, month: 9 }, KINI),
    ).toBe("DLV/2026/10/0001");
  });

  it("tidak pernah direset: lanjut walau tahunnya lain, tahun tetap tahun ini", () => {
    expect(
      contohNomorBerikutnya({ prefix: "SPG", resetPeriod: "NEVER", padding: 6, lastNumber: 1203, year: 2024, month: 1 }, KINI),
    ).toBe("SPG/2026/001204");
  });

  it("garis miring di akhir awalan ditambahkan bila belum ada", () => {
    expect(
      contohNomorBerikutnya({ prefix: "KONSI", resetPeriod: "YEARLY", padding: 4, lastNumber: 0, year: 2026, month: 10 }, KINI),
    ).toBe("KONSI/2026/0001");
  });
});

describe("periksaIsianNomor", () => {
  it("menerima awalan dan jumlah digit yang sah", () => {
    expect(periksaIsianNomor({ prefix: "PO/", padding: "4" })).toBeNull();
  });

  it("awalan kosong ditolak", () => {
    expect(periksaIsianNomor({ prefix: "  ", padding: "4" })).toBe("AWALAN_KOSONG");
  });

  it("awalan terlalu panjang ditolak", () => {
    expect(periksaIsianNomor({ prefix: "A".repeat(21), padding: "4" })).toBe("AWALAN_PANJANG");
  });

  it("jumlah digit di luar 1–8 atau bukan bilangan bulat ditolak", () => {
    expect(periksaIsianNomor({ prefix: "PO/", padding: "0" })).toBe("DIGIT_TIDAK_SAH");
    expect(periksaIsianNomor({ prefix: "PO/", padding: "9" })).toBe("DIGIT_TIDAK_SAH");
    expect(periksaIsianNomor({ prefix: "PO/", padding: "4.5" })).toBe("DIGIT_TIDAK_SAH");
    expect(periksaIsianNomor({ prefix: "PO/", padding: "" })).toBe("DIGIT_TIDAK_SAH");
  });
});
