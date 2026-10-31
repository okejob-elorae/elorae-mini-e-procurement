import { describe, expect, it } from "vitest";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import { KELOMPOK_PENGATURAN, kunciIsiKartu, kunciJudulKartu } from "./kartu-pengaturan";

const ambil = (pesan: unknown, kunci: string): unknown =>
  `settings.${kunci}`.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), pesan);

const semua = KELOMPOK_PENGATURAN.flatMap((g) => g.items);
const kartu = (key: string) => semua.find((k) => k.key === key)!;

describe("kartu pusat pengaturan", () => {
  it("setiap judul kelompok dan kartu punya teks di kedua bahasa", () => {
    for (const g of KELOMPOK_PENGATURAN) {
      expect(typeof ambil(id, g.judulKey), g.judulKey).toBe("string");
      expect(typeof ambil(en, g.judulKey), g.judulKey).toBe("string");
    }
    for (const k of semua) {
      for (const kunci of [kunciJudulKartu(k), kunciIsiKartu(k)]) {
        expect(typeof ambil(id, kunci), `id settings.${kunci}`).toBe("string");
        expect(typeof ambil(en, kunci), `en settings.${kunci}`).toBe("string");
      }
    }
  });

  it("setiap kartu membuka halaman pengaturan yang berbeda", () => {
    const href = semua.map((k) => k.href);
    expect(new Set(href).size).toBe(href.length);
    for (const h of href) expect(h.startsWith("/backoffice/settings/")).toBe(true);
  });

  it("kartu Pajak menyebut surat PO, karena halamannya juga memuat kartu Surat PO", () => {
    const k = kartu("tax");
    expect(ambil(id, kunciJudulKartu(k))).toBe("Pajak & surat PO");
    expect(String(ambil(id, kunciIsiKartu(k)))).toContain("surat PO");
  });

  it("kartu Rasio pack menyebut Rencana kirim, bukan istilah lama smart request", () => {
    const isi = String(ambil(id, kunciIsiKartu(kartu("packRatio"))));
    expect(isi).toContain("Rencana kirim");
    expect(isi.toLowerCase()).not.toContain("smart request");
  });
});
