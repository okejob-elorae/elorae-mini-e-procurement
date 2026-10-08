import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import id from "@/lib/i18n/messages/id.json";
import {
  ALFABET_KODE,
  bacaPantau,
  dalamJamKerja,
  DAFTAR_KUNCI_PANTAU,
  JEJAK_PANTAU,
  KODE_GALAT_PANTAU,
  KODE_MASALAH,
  normalKodeSambung,
  PANTAU_BAWAAN,
  validasiPantau,
} from "./pantau-aturan";

describe("pengaturan kreatif.pantau", () => {
  it("bawaan = keputusan P4–P6", () => {
    expect(PANTAU_BAWAAN).toMatchObject({
      aktif: true,
      kuotaHarian: 300,
      jamMulai: "08:00",
      jamSelesai: "17:00",
      jedaMinDetik: 15,
      jedaMaksDetik: 40,
      istirahatSetiapMenit: 45,
      istirahatMinMenit: 5,
      istirahatMaksMenit: 10,
      jedaOtomatisMenit: 60,
      maksGagalBeruntun: 3,
      hariAkunAktif: 7,
      hariAkunLain: 30,
      naikPengikutPersen: 30,
      naikPengikutHari: 14,
      turunErPersen: 40,
    });
  });

  it("pembaca pemaaf: baris rusak atau kunci salah jatuh ke bawaan per kunci", () => {
    expect(bacaPantau(null)).toEqual(PANTAU_BAWAAN);
    expect(bacaPantau("{rusak")).toEqual(PANTAU_BAWAAN);
    const r = bacaPantau(JSON.stringify({ kuotaHarian: 500, jamMulai: "25:00", aktif: false, jedaMinDetik: -4 }));
    expect(r.kuotaHarian).toBe(500);
    expect(r.aktif).toBe(false);
    expect(r.jamMulai).toBe("08:00");
    expect(r.jedaMinDetik).toBe(15);
  });

  it("pembaca menjaga pasangan min ≤ maks walau barisnya tidak", () => {
    const r = bacaPantau({ jedaMinDetik: 50, jedaMaksDetik: 20, jamMulai: "18:00", jamSelesai: "09:00" });
    expect(r.jedaMinDetik).toBeLessThanOrEqual(r.jedaMaksDetik);
    expect(r.jamMulai < r.jamSelesai).toBe(true);
  });

  it("validasi menolak (tidak mengganti diam-diam) isian yang salah", () => {
    expect(validasiPantau({ ...PANTAU_BAWAAN }).ok).toBe(true);
    const r = validasiPantau({ ...PANTAU_BAWAAN, kuotaHarian: 0, jamSelesai: "7:00", jedaMaksDetik: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.galat.map((g) => g.kunci).sort()).toEqual(["jamSelesai", "jedaMaksDetik", "kuotaHarian"]);
    }
    const urutan = validasiPantau({ ...PANTAU_BAWAAN, jamMulai: "17:00", jamSelesai: "08:00" });
    expect(!urutan.ok && urutan.galat).toEqual([{ kunci: "jamSelesai", sebab: "URUTAN" }]);
  });

  it("setiap kunci pengaturan punya label di kedua bahasa", () => {
    for (const k of DAFTAR_KUNCI_PANTAU) {
      expect(typeof (id as Record<string, any>).kreatifRuang.pantau.pengaturan.kunci[k], k).toBe("string");
      expect(typeof (en as Record<string, any>).kreatifRuang.pantau.pengaturan.kunci[k], k).toBe("string");
    }
  });
});

describe("dalamJamKerja", () => {
  // 01:00Z = 08:00 WIB; 10:00Z = 17:00 WIB.
  it("jam mulai inklusif, jam selesai eksklusif, dihitung di WIB", () => {
    expect(dalamJamKerja(new Date("2003-05-05T00:59:00Z"), PANTAU_BAWAAN)).toBe(false);
    expect(dalamJamKerja(new Date("2003-05-05T01:00:00Z"), PANTAU_BAWAAN)).toBe(true);
    expect(dalamJamKerja(new Date("2003-05-05T09:59:00Z"), PANTAU_BAWAAN)).toBe(true);
    expect(dalamJamKerja(new Date("2003-05-05T10:00:00Z"), PANTAU_BAWAAN)).toBe(false);
  });
});

describe("kode sambung", () => {
  it("alfabet tanpa huruf/angka yang mirip (0/O, 1/I/L)", () => {
    for (const c of "01ILO") expect(ALFABET_KODE.includes(c)).toBe(false);
    expect(new Set(ALFABET_KODE).size).toBe(ALFABET_KODE.length);
  });

  it("normalKodeSambung: huruf besar, tanpa spasi/tanda hubung; panjang lain ditolak", () => {
    expect(normalKodeSambung(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalKodeSambung("abcdefg")).toBeNull();
    expect(normalKodeSambung("ABCDEFG0")).toBeNull();
    expect(normalKodeSambung(42)).toBeNull();
  });
});

describe("label jejak dan kode", () => {
  type Pesan = Record<string, unknown>;
  const ambil = (pesan: Pesan, jalur: string): unknown =>
    jalur.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Pesan)[k] : undefined), pesan);

  it.each([
    ["id", id as Pesan],
    ["en", en as Pesan],
  ])("setiap nama jejak, kode masalah, dan kode galat berlabel (%s)", (_b, pesan) => {
    for (const aksi of Object.values(JEJAK_PANTAU)) expect(typeof ambil(pesan, `auditActions.actions.${aksi}`), aksi).toBe("string");
    expect(typeof ambil(pesan, "auditActions.entities.KolPerangkat")).toBe("string");
    for (const k of KODE_MASALAH) expect(typeof ambil(pesan, `kreatifRuang.pantau.kode.${k}`), k).toBe("string");
    for (const k of KODE_GALAT_PANTAU) expect(typeof ambil(pesan, `kreatifRuang.pantau.err.${k}`), k).toBe("string");
  });
});
