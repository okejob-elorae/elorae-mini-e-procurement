import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KODE_GALAT_OPNAME, kodeGalatOpname, kunciGalatOpname } from "./galat-opname";
import { SELF_APPROVAL_ERROR } from "./opname";

describe("kodeGalatOpname", () => {
  it("pesan yang dilempar aksi opname menjadi kode", () => {
    expect(kodeGalatOpname(new Error("Opname not found"))).toBe("TIDAK_ADA");
    expect(kodeGalatOpname(new Error("Tidak ada item/roll dalam scope yang dipilih"))).toBe("TANPA_BARIS");
    expect(kodeGalatOpname(new Error("Semua roll harus diisi sebelum submit"))).toBe("ROLL_BELUM_DIISI");
    expect(kodeGalatOpname(new Error("Semua baris harus diisi sebelum submit"))).toBe("BARIS_BELUM_DIISI");
    expect(kodeGalatOpname(new Error("Opname sudah dikirim untuk persetujuan; hitungan tidak dapat diubah lagi"))).toBe(
      "HITUNGAN_DITUTUP",
    );
    expect(kodeGalatOpname(new Error("Forbidden: Insufficient permissions"))).toBe("TANPA_IZIN");
    expect(kodeGalatOpname(new Error("Unauthorized"))).toBe("TANPA_IZIN");
    expect(kodeGalatOpname(SELF_APPROVAL_ERROR)).toBe("SETUJUI_SENDIRI");
  });

  it("galat lain (Prisma, jaringan) tidak pernah tampil mentah → GAGAL", () => {
    expect(kodeGalatOpname(new Error("Invalid `prisma.stockOpname.create()` invocation"))).toBe("GAGAL");
    expect(kodeGalatOpname(undefined)).toBe("GAGAL");
  });

  it("kunci i18n untuk setiap kode; kode asing jatuh ke GAGAL", () => {
    expect(kunciGalatOpname("TIDAK_ADA")).toBe("galat.TIDAK_ADA");
    expect(kunciGalatOpname("APA_INI")).toBe("galat.GAGAL");
    expect(kunciGalatOpname(undefined)).toBe("galat.GAGAL");
  });

  it("setiap kode punya terjemahan di kedua bahasa", () => {
    for (const bahasa of ["id", "en"]) {
      const pesan = JSON.parse(
        readFileSync(join(__dirname, "..", "i18n", "messages", `${bahasa}.json`), "utf8"),
      ) as { stockOpname: { galat: Record<string, string> } };
      for (const kode of KODE_GALAT_OPNAME) expect(pesan.stockOpname.galat[kode], `${bahasa}:${kode}`).toBeTruthy();
    }
  });
});
