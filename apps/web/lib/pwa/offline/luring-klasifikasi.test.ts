import { describe, expect, it } from "vitest";
import { KUNJUNGAN_DITOLAK, kunciAlasanLuring, nasibKode, nasibReturPembeli } from "./luring-klasifikasi";

describe("nasibKode (check-in, check-out, terima kiriman, opname)", () => {
  it("evicts what was recorded, stops on any returned refusal, retries what threw", () => {
    expect(nasibKode({ ok: true })).toBe("evict");
    for (const code of ["DI_LUAR_RADIUS", "WAKTU_TIDAK_VALID", "HASIL_WAJIB", "SUDAH_DITERIMA", "KUNJUNGAN_TIDAK_SAH", "BARU_DARI_SERVER"]) {
      expect(nasibKode({ ok: false, code })).toBe("terminal");
    }
    expect(nasibKode({ thrown: true })).toBe("retry");
  });
});

describe("nasibReturPembeli", () => {
  it("retries GAGAL (a caught server error), stops on a refusal", () => {
    expect(nasibReturPembeli({ ok: true })).toBe("evict");
    expect(nasibReturPembeli({ ok: false, kode: "GAGAL" })).toBe("retry");
    expect(nasibReturPembeli({ ok: false, kode: "MELEBIHI_SISA" })).toBe("terminal");
    expect(nasibReturPembeli({ thrown: true })).toBe("retry");
  });
});

describe("kunciAlasanLuring", () => {
  it("maps known codes to their own text, photo upload refusals to one text, the rest to the general text", () => {
    expect(kunciAlasanLuring("DI_LUAR_RADIUS")).toBe("DI_LUAR_RADIUS");
    expect(kunciAlasanLuring(KUNJUNGAN_DITOLAK)).toBe("KUNJUNGAN_DITOLAK");
    expect(kunciAlasanLuring("FOTO_TERLALU_BESAR")).toBe("FOTO");
    expect(kunciAlasanLuring("APA_INI")).toBe("UMUM");
    expect(kunciAlasanLuring(undefined)).toBe("UMUM");
  });
});

describe("reason texts", () => {
  it("every reason code has its text in both languages", async () => {
    const { KODE_ALASAN_LURING } = await import("./luring-klasifikasi");
    const { KODE_ALASAN_NOTA_SPG } = await import("./spg-jual-klasifikasi");
    for (const bahasa of ["id", "en"] as const) {
      const pesan = (await import(`@/lib/i18n/messages/${bahasa}.json`)).default as {
        pwaLuring: { alasan: Record<string, string> };
        pwa: { spgAntrean: { alasan: Record<string, string> } };
      };
      for (const kode of [...KODE_ALASAN_LURING, "UMUM", "FOTO", "DI_LUAR_RADIUS_UMUM"]) {
        expect(pesan.pwaLuring.alasan[kode], `${bahasa}: pwaLuring.alasan.${kode}`).toBeTruthy();
      }
      for (const kode of KODE_ALASAN_NOTA_SPG) {
        expect(pesan.pwa.spgAntrean.alasan[kode], `${bahasa}: pwa.spgAntrean.alasan.${kode}`).toBeTruthy();
      }
    }
  });
});
