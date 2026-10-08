import { describe, expect, it } from "vitest";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import { alasanPinBelum, alasanSandiBelum } from "./alasan-keamanan";

describe("alasanSandiBelum — isian pertama yang kurang", () => {
  it("lengkap → null", () => {
    expect(alasanSandiBelum({ lama: "lama123", baru: "baru1234", ulang: "baru1234" })).toBeNull();
  });
  it("urut formulir: sandi lama, sandi baru, ulangan", () => {
    expect(alasanSandiBelum({ lama: " ", baru: "", ulang: "x" })).toBe("passwordCurrent");
    expect(alasanSandiBelum({ lama: "lama123", baru: "", ulang: "" })).toBe("passwordNew");
    // Sama dengan formulir Pengguna (`SANDI_MIN` = 8): 7 karakter belum cukup.
    expect(alasanSandiBelum({ lama: "lama123", baru: "1234567", ulang: "1234567" })).toBe("passwordNew");
    expect(alasanSandiBelum({ lama: "lama123", baru: "baru1234", ulang: "baru1235" })).toBe("passwordRepeat");
  });
});

describe("alasanPinBelum", () => {
  it("PIN 4–6 digit yang diulang sama → null", () => {
    expect(alasanPinBelum({ baru: "1234", ulang: "1234" })).toBeNull();
    expect(alasanPinBelum({ baru: "123456", ulang: "123456" })).toBeNull();
  });
  it("terlalu pendek, terlalu panjang, atau bukan angka", () => {
    expect(alasanPinBelum({ baru: "123", ulang: "123" })).toBe("pinNew");
    expect(alasanPinBelum({ baru: "1234567", ulang: "1234567" })).toBe("pinNew");
    expect(alasanPinBelum({ baru: "12a4", ulang: "12a4" })).toBe("pinNew");
  });
  it("ulangan berbeda", () => {
    expect(alasanPinBelum({ baru: "1234", ulang: "1235" })).toBe("pinRepeat");
  });
});

describe("teks alasan", () => {
  it("setiap alasan punya kalimat di kedua bahasa", () => {
    for (const k of ["passwordCurrent", "passwordNew", "passwordRepeat", "pinNew", "pinRepeat", "resetUser"]) {
      expect((id.security.belum as Record<string, string>)[k], `id ${k}`).toBeTruthy();
      expect((en.security.belum as Record<string, string>)[k], `en ${k}`).toBeTruthy();
    }
  });
});
