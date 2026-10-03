import { describe, expect, it } from "vitest";
import { nasibLaporan, nasibUnggah } from "./laporan-classify";

describe("nasibLaporan", () => {
  it("removes a report once the server has it", () => {
    expect(nasibLaporan({ ok: true })).toBe("evict");
  });

  it("keeps retrying when the send itself failed or the server hiccuped", () => {
    expect(nasibLaporan({ thrown: true })).toBe("retry");
    expect(nasibLaporan({ ok: false, kode: "GAGAL" })).toBe("retry");
  });

  it("stops on a rejection of the content — sending it again is rejected again", () => {
    for (const kode of ["SUDAH_LUNAS", "MELEBIHI_SISA", "NOMOR_SUDAH_DIPAKAI", "TANPA_AKSES", "KUNCI_DIPAKAI"]) {
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
