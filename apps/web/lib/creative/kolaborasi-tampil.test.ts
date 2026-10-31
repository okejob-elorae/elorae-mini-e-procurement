import { describe, expect, it } from "vitest";
import { alamatLengkap, nadaRiwayat, nadaTahap, teksAlamatKirim } from "./kolaborasi-tampil";
import { SEMUA_TAHAP } from "./tahap";

const alamat = {
  name: "Ayu Lestari",
  recipientName: null,
  phone: "0812 3456 7890",
  address: "Jl. Melati 5, RT 02/03",
  city: "Bandung",
  province: "Jawa Barat",
  postalCode: "40123",
};

describe("teksAlamatKirim", () => {
  it("nama, HP, alamat, lalu kota/provinsi/kode pos — siap ditempel ke aplikasi kurir", () => {
    expect(teksAlamatKirim(alamat)).toBe("Ayu Lestari\n0812 3456 7890\nJl. Melati 5, RT 02/03\nBandung, Jawa Barat, 40123");
  });

  it("nama penerima menang atas nama KOL; baris kosong dilewati", () => {
    expect(teksAlamatKirim({ ...alamat, recipientName: "Ibu Sari", province: null, postalCode: " " })).toBe(
      "Ibu Sari\n0812 3456 7890\nJl. Melati 5, RT 02/03\nBandung",
    );
  });

  it("alamat lengkap butuh alamat dan nomor HP", () => {
    expect(alamatLengkap(alamat)).toBe(true);
    expect(alamatLengkap({ ...alamat, phone: "" })).toBe(false);
    expect(alamatLengkap({ ...alamat, address: null })).toBe(false);
  });
});

describe("nada", () => {
  it("jalur keluar selalu merah; setiap tahap punya nada", () => {
    for (const t of SEMUA_TAHAP) expect(nadaTahap(t)).toBeTruthy();
    expect(nadaTahap("GHOSTING")).toBe("attention");
    expect(nadaTahap("SELESAI")).toBe("settled");
  });

  it("kotak riwayat biru hanya bila ROAS ≥ 1", () => {
    expect(nadaRiwayat(1)).toBe("baik");
    expect(nadaRiwayat(0.99)).toBe("waspada");
    expect(nadaRiwayat(null)).toBe("waspada");
  });
});
