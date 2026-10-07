import { describe, expect, it } from "vitest";
import {
  bolehPindahStatusKonten,
  idPilihSemua,
  kodeGalatUnggah,
  kontenTelat,
  periksaBerkasFoto,
  pilihanStatusKonten,
} from "./rencana-konten";

describe("perpindahan status rencana konten (bug F)", () => {
  it("maju boleh melompat tanpa alasan", () => {
    expect(bolehPindahStatusKonten("IDE", "DIJADWALKAN")).toEqual({ boleh: true, jenis: "MAJU" });
    expect(bolehPindahStatusKonten("IDE", "TAYANG")).toEqual({ boleh: true, jenis: "MAJU" });
  });

  it("mundur wajib beralasan, termasuk dari TAYANG", () => {
    expect(bolehPindahStatusKonten("REVIEW", "DRAFT")).toEqual({ boleh: false, sebab: "ALASAN_WAJIB" });
    expect(bolehPindahStatusKonten("REVIEW", "DRAFT", "  ")).toEqual({ boleh: false, sebab: "ALASAN_WAJIB" });
    expect(bolehPindahStatusKonten("TAYANG", "DIJADWALKAN", "salah tandai")).toEqual({ boleh: true, jenis: "MUNDUR" });
  });

  it("BATAL dari mana pun kecuali TAYANG; yang batal boleh hidup lagi", () => {
    expect(bolehPindahStatusKonten("REVIEW", "BATAL")).toEqual({ boleh: true, jenis: "BATAL" });
    expect(bolehPindahStatusKonten("TAYANG", "BATAL")).toEqual({ boleh: false, sebab: "TIDAK_BISA" });
    expect(bolehPindahStatusKonten("BATAL", "REVIEW")).toEqual({ boleh: true, jenis: "HIDUP_LAGI" });
    expect(bolehPindahStatusKonten("IDE", "IDE")).toEqual({ boleh: false, sebab: "SAMA" });
  });

  it("dialog hanya menawarkan status yang sah, dengan status sekarang di dalamnya", () => {
    expect(pilihanStatusKonten("TAYANG")).toEqual(["IDE", "DRAFT", "REVIEW", "DIJADWALKAN", "TAYANG"]);
    expect(pilihanStatusKonten("REVIEW")).toEqual(["IDE", "DRAFT", "REVIEW", "DIJADWALKAN", "TAYANG", "BATAL"]);
    expect(pilihanStatusKonten(null)).toHaveLength(6);
  });
});

describe("kontenTelat (bug G)", () => {
  it("jadwal hari ini belum terlambat walau jamnya sudah lewat", () => {
    // 2026-10-07 07.00 WIB, sekarang hari yang sama.
    expect(kontenTelat("DIJADWALKAN", new Date("2026-10-07T00:00:00Z"), "2026-10-07")).toBe(false);
  });

  it("terlambat sesudah hari WIB berganti", () => {
    // 6 Okt 23.00 WIB — harinya sudah berganti.
    expect(kontenTelat("DIJADWALKAN", new Date("2026-10-06T16:00:00Z"), "2026-10-07")).toBe(true);
    expect(kontenTelat("DIJADWALKAN", "2026-10-06T03:00:00.000Z", "2026-10-07")).toBe(true);
  });

  it("tengah malam UTC yang di WIB sudah hari berikutnya dibaca menurut WIB", () => {
    // 2026-10-06T18:00Z = 7 Okt 01.00 WIB → hari ini, belum terlambat.
    expect(kontenTelat("IDE", new Date("2026-10-06T18:00:00Z"), "2026-10-07")).toBe(false);
  });

  it("yang tayang, batal, atau tanpa jadwal tidak pernah terlambat", () => {
    expect(kontenTelat("TAYANG", "2026-01-01T00:00:00Z", "2026-10-07")).toBe(false);
    expect(kontenTelat("BATAL", "2026-01-01T00:00:00Z", "2026-10-07")).toBe(false);
    expect(kontenTelat("IDE", null, "2026-10-07")).toBe(false);
  });
});

describe("pilih semua (bug I) dan galat unggah (bug H)", () => {
  it("hanya ubin bergambar yang ikut terpilih", () => {
    expect(
      idPilihSemua([
        { id: "a", imageUrl: "/api/foto/1" },
        { id: "b", imageUrl: null },
        { id: "c", imageUrl: " " },
      ]),
    ).toEqual(["a"]);
  });

  it("kode galat unggah dikenali, sisanya GAGAL", () => {
    expect(kodeGalatUnggah(new Error("TERLALU_BESAR"))).toBe("TERLALU_BESAR");
    expect(kodeGalatUnggah(new TypeError("Failed to fetch"))).toBe("GAGAL");
    expect(kodeGalatUnggah("JENIS_TIDAK_DIIZINKAN")).toBe("JENIS_TIDAK_DIIZINKAN");
    expect(kodeGalatUnggah(undefined)).toBe("GAGAL");
  });

  it("berkas bukan gambar ditolak sebelum diunggah", () => {
    expect(periksaBerkasFoto({ type: "application/pdf" })).toBe("JENIS_TIDAK_DIIZINKAN");
    expect(periksaBerkasFoto({ type: "image/jpeg" })).toBeNull();
    expect(periksaBerkasFoto(undefined)).toBe("FILE_WAJIB");
  });
});
