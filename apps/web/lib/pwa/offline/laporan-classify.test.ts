import { describe, expect, it } from "vitest";
import { letakAlasanLaporan, nasibLaporan, nasibUnggah } from "./laporan-classify";

describe("nasibLaporan", () => {
  it("removes a report once the server has it", () => {
    expect(nasibLaporan({ ok: true })).toBe("evict");
  });

  it("keeps retrying when the send itself failed or the server hiccuped", () => {
    expect(nasibLaporan({ thrown: true })).toBe("retry");
    expect(nasibLaporan({ ok: false, kode: "GAGAL" })).toBe("retry");
  });

  it("stops on a rejection of the content — sending it again is rejected again", () => {
    for (const kode of ["SUDAH_LUNAS", "MELEBIHI_SISA", "NOMOR_SUDAH_DIPAKAI", "TANPA_AKSES", "KUNCI_DIPAKAI", "FOTO_SUDAH_DIPAKAI"]) {
      expect(nasibLaporan({ ok: false, kode }), kode).toBe("terminal");
    }
  });
});

describe("nasibUnggah", () => {
  it("retries a dropped connection", () => {
    expect(nasibUnggah(new TypeError("Failed to fetch"))).toBe("retry");
    expect(nasibUnggah("aneh")).toBe("retry");
  });

  it("retries a generic server failure but stops on a rejected file", () => {
    expect(nasibUnggah(new Error("GAGAL"))).toBe("retry");
    expect(nasibUnggah(new Error("TERLALU_BESAR"))).toBe("terminal");
    expect(nasibUnggah(new Error("TANPA_AKSES"))).toBe("terminal");
  });
});

describe("letakAlasanLaporan", () => {
  it("writer codes that start with FOTO_ read from the report's namespace, not the upload one", () => {
    for (const kode of ["FOTO_SUDAH_DIPAKAI", "FOTO_BUKAN_MILIK", "FOTO_WAJIB"]) {
      expect(letakAlasanLaporan(kode)).toEqual({ ruang: "laporan", kunci: `err${kode}` });
    }
  });

  it("upload rejections (new UNGGAH_ prefix and old FOTO_ rows) read from the foto namespace", () => {
    expect(letakAlasanLaporan("UNGGAH_TERLALU_BESAR")).toEqual({ ruang: "foto", kunci: "errTERLALU_BESAR" });
    expect(letakAlasanLaporan("FOTO_TERLALU_BESAR")).toEqual({ ruang: "foto", kunci: "errTERLALU_BESAR" });
  });

  it("everything else reads from the report's namespace", () => {
    expect(letakAlasanLaporan("SUDAH_LUNAS")).toEqual({ ruang: "laporan", kunci: "errSUDAH_LUNAS" });
  });
});
