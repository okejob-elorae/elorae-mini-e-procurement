import { describe, expect, it } from "vitest";
import { pesanTolakRetur, tolakReturBasi } from "./pesan-tolak-retur";

/** Penerjemah tiruan: hanya kunci yang terdaftar "ada", nilai disisipkan seperti next-intl. */
function penerjemah(pesan: Record<string, string>) {
  const t = (kunci: string, nilai: Record<string, string | number> = {}) =>
    pesan[kunci].replace(/\{(\w+)\}/g, (_, k: string) => String(nilai[k] ?? ""));
  t.has = (kunci: string) => kunci in pesan;
  return t;
}

const t = penerjemah({
  "err.STOK_KURANG": "Stok {barang} tidak cukup: perlu {perlu}, tersedia {ada}.",
  "err.SUDAH_DIPROSES": "Retur ini sudah diproses.",
});

describe("pesanTolakRetur", () => {
  it("STOK_KURANG menyebut barang dan angkanya (format Indonesia)", () => {
    expect(
      pesanTolakRetur({ ok: false, code: "STOK_KURANG", barang: "Kain katun", perlu: 1250.5, ada: 3 }, t, "Gagal", "id"),
    ).toBe("Stok Kain katun tidak cukup: perlu 1.250,5, tersedia 3.");
  });

  it("kode tanpa teks → cadangan; kode biasa → teksnya", () => {
    expect(pesanTolakRetur({ ok: false, code: "GAGAL" }, t, "Retur gagal diproses.", "id")).toBe("Retur gagal diproses.");
    expect(pesanTolakRetur({ ok: false, code: "SUDAH_DIPROSES" }, t, "x", "id")).toBe("Retur ini sudah diproses.");
  });

  it("tolakReturBasi: hanya penolakan karena dokumen berubah/hilang", () => {
    expect(tolakReturBasi({ ok: false, code: "SUDAH_SELESAI" })).toBe(true);
    expect(tolakReturBasi({ ok: false, code: "STOK_KURANG" })).toBe(false);
    expect(tolakReturBasi({ ok: false, code: "TANPA_AKSES" })).toBe(false);
  });
});
