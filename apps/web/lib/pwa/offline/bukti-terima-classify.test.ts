import { describe, expect, it } from "vitest";
import { letakAlasanBuktiTerima, nasibBuktiTerima } from "./bukti-terima-classify";

describe("nasibBuktiTerima", () => {
  it("removes the proof from the phone once the server has it — including a replay", () => {
    expect(nasibBuktiTerima({ ok: true, ulangan: false })).toBe("evict");
    expect(nasibBuktiTerima({ ok: true, ulangan: true })).toBe("evict");
  });

  it("retries a lost send and an unexpected server error", () => {
    expect(nasibBuktiTerima({ thrown: true })).toBe("retry");
    expect(nasibBuktiTerima({ ok: false, kode: "GAGAL" })).toBe("retry");
  });

  it("retries a phone clock running ahead — the server's clock catches up", () => {
    expect(nasibBuktiTerima({ ok: false, kode: "WAKTU_DI_MASA_DEPAN" })).toBe("retry");
  });

  it("stops on a rejection of the content, so the salesman sees why", () => {
    for (const kode of [
      "SUDAH_DITERIMA",
      "TANPA_AKSES",
      "TIDAK_DITEMUKAN",
      "NAMA_TIDAK_SAH",
      "WAKTU_TIDAK_SAH",
      "WAKTU_SEBELUM_KIRIM",
      "FOTO_WAJIB",
      "FOTO_TIDAK_SAH",
      "FOTO_TIDAK_DITEMUKAN",
      "FOTO_SUDAH_DIPAKAI",
      "KUNCI_TIDAK_SAH",
    ]) {
      expect(nasibBuktiTerima({ ok: false, kode }), kode).toBe("terminal");
    }
  });
});

describe("letakAlasanBuktiTerima", () => {
  it("sends upload rejections to the photo messages and everything else to the proof messages", () => {
    expect(letakAlasanBuktiTerima("UNGGAH_TERLALU_BESAR")).toEqual({ ruang: "foto", kunci: "errTERLALU_BESAR" });
    expect(letakAlasanBuktiTerima("FOTO_TIDAK_DITEMUKAN")).toEqual({ ruang: "buktiTerima", kunci: "FOTO_TIDAK_DITEMUKAN" });
    expect(letakAlasanBuktiTerima("SUDAH_DITERIMA")).toEqual({ ruang: "buktiTerima", kunci: "SUDAH_DITERIMA" });
    expect(letakAlasanBuktiTerima(undefined)).toEqual({ ruang: "buktiTerima", kunci: "GAGAL" });
  });
});
