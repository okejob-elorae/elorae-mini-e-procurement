import { describe, expect, it } from "vitest";
import {
  ATURAN_MUTASI_BAWAAN,
  bacaAturanMutasi,
  kekuranganSaldo,
  keputusanArah,
  nomorMutasiBerikut,
  rapikanBarisMutasi,
  rapikanTeksMutasi,
  selisihPenerimaan,
  sudahMacet,
  tahunWib,
  bulanWib,
} from "./mutasi-aturan";

describe("bacaAturanMutasi", () => {
  it("falls back to the default when nothing is stored or the JSON is broken", () => {
    expect(bacaAturanMutasi(null)).toEqual(ATURAN_MUTASI_BAWAAN);
    expect(bacaAturanMutasi("{bukan json")).toEqual(ATURAN_MUTASI_BAWAAN);
    expect(bacaAturanMutasi("[1,2]")).toEqual(ATURAN_MUTASI_BAWAAN);
  });

  it("defaults: consignment to consignment needs approval, anything touching a PUTUS store is refused", () => {
    const a = bacaAturanMutasi(null);
    expect(a.aturan).toEqual({ KONSI_KONSI: "SETUJU", KONSI_PUTUS: "TOLAK", PUTUS_KONSI: "TOLAK", PUTUS_PUTUS: "TOLAK" });
    expect(a).toMatchObject({ aktif: true, saldo: "PERINGATAN", tujuanTanpaSpg: true, hariPengingat: 3 });
  });

  it("reads each field on its own — one broken field keeps the others", () => {
    const a = bacaAturanMutasi(JSON.stringify({ aktif: false, saldo: "SEMBARANG", hariPengingat: 7, aturan: { KONSI_KONSI: "LANGSUNG" } }));
    expect(a.aktif).toBe(false);
    expect(a.saldo).toBe("PERINGATAN");
    expect(a.hariPengingat).toBe(7);
    expect(a.aturan.KONSI_KONSI).toBe("LANGSUNG");
    expect(a.aturan.PUTUS_KONSI).toBe("TOLAK");
  });

  it("never stores LANGSUNG for a direction that involves a PUTUS store — it reads as SETUJU", () => {
    const a = bacaAturanMutasi(JSON.stringify({ aturan: { KONSI_PUTUS: "LANGSUNG", PUTUS_KONSI: "LANGSUNG", PUTUS_PUTUS: "LANGSUNG" } }));
    expect(a.aturan).toMatchObject({ KONSI_PUTUS: "SETUJU", PUTUS_KONSI: "SETUJU", PUTUS_PUTUS: "SETUJU" });
  });

  it("rejects a reminder period outside 1..60 days", () => {
    expect(bacaAturanMutasi(JSON.stringify({ hariPengingat: 0 })).hariPengingat).toBe(3);
    expect(bacaAturanMutasi(JSON.stringify({ hariPengingat: 61 })).hariPengingat).toBe(3);
    expect(bacaAturanMutasi(JSON.stringify({ hariPengingat: 2.5 })).hariPengingat).toBe(3);
  });

  it("round-trips what the settings card saves", () => {
    const a = { ...ATURAN_MUTASI_BAWAAN, saldo: "TOLAK" as const, aturan: { ...ATURAN_MUTASI_BAWAAN.aturan, KONSI_KONSI: "LANGSUNG" as const } };
    expect(bacaAturanMutasi(JSON.stringify(a))).toEqual(a);
  });
});

describe("keputusanArah", () => {
  it("guards LANGSUNG even if a raw object slipped past the reader", () => {
    const a = { ...ATURAN_MUTASI_BAWAAN, aturan: { ...ATURAN_MUTASI_BAWAAN.aturan, PUTUS_KONSI: "LANGSUNG" as const } };
    expect(keputusanArah(a, "PUTUS", "KONSI")).toBe("SETUJU");
    expect(keputusanArah({ ...a, aturan: { ...a.aturan, KONSI_KONSI: "LANGSUNG" } }, "KONSI", "KONSI")).toBe("LANGSUNG");
    expect(keputusanArah(ATURAN_MUTASI_BAWAAN, "KONSI", "PUTUS")).toBe("TOLAK");
  });
});

describe("nomorMutasiBerikut", () => {
  it("starts at 00001 and keeps counting within the WIB year", () => {
    expect(nomorMutasiBerikut(null, 2026)).toBe("MTS/2026/00001");
    expect(nomorMutasiBerikut("MTS/2026/00041", 2026)).toBe("MTS/2026/00042");
    expect(nomorMutasiBerikut("MTS/2025/00041", 2026)).toBe("MTS/2026/00001");
  });

  it("uses the Jakarta calendar for the year and month", () => {
    // 31 Des 2026 17.30 UTC = 1 Jan 2027 00.30 WIB.
    expect(tahunWib(new Date("2026-12-31T17:30:00Z"))).toBe(2027);
    expect(bulanWib(new Date("2026-09-30T17:30:00Z"))).toEqual({ tahun: 2026, bulan: 10 });
  });
});

describe("rapikanBarisMutasi", () => {
  it("merges the same item+size and trims", () => {
    expect(
      rapikanBarisMutasi([
        { itemId: "a", variantSku: "a-M", qty: 2 },
        { itemId: "a", variantSku: " a-M ", qty: 3 },
        { itemId: "b", variantSku: null, qty: 1 },
      ]),
    ).toEqual({
      ok: true,
      baris: [
        { itemId: "a", variantSku: "a-M", qty: 5 },
        { itemId: "b", variantSku: "", qty: 1 },
      ],
    });
  });

  it("refuses empty lists, zero/fractional quantities and junk", () => {
    expect(rapikanBarisMutasi([])).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(rapikanBarisMutasi("x")).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(rapikanBarisMutasi([{ itemId: "a", qty: 0 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisMutasi([{ itemId: "a", qty: 1.5 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisMutasi([null])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_VALID" });
  });
});

describe("rapikanTeksMutasi", () => {
  it("requires a reason only when asked, and caps the length", () => {
    expect(rapikanTeksMutasi("  ", true)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanTeksMutasi("  ", false)).toEqual({ ok: true, teks: null });
    expect(rapikanTeksMutasi(" stok kosong ", true)).toEqual({ ok: true, teks: "stok kosong" });
    expect(rapikanTeksMutasi("x".repeat(501), false)).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
  });
});

describe("kekuranganSaldo / selisihPenerimaan / sudahMacet", () => {
  it("lists only the lines above what is available", () => {
    const tersedia = (itemId: string) => (itemId === "a" ? 3 : 10);
    expect(
      kekuranganSaldo(
        [
          { itemId: "a", variantSku: "", qty: 5 },
          { itemId: "b", variantSku: "", qty: 5 },
        ],
        tersedia,
      ),
    ).toEqual([{ itemId: "a", variantSku: "", qty: 5, tersedia: 3 }]);
  });

  it("sums the shortfall", () => {
    expect(
      selisihPenerimaan([
        { qtySent: 5, qtyReceived: 3 },
        { qtySent: 2, qtyReceived: 2 },
      ]),
    ).toEqual({ kurang: 2, barisKurang: 1 });
  });

  it("flags a shipment that has been on the road for the reminder period", () => {
    const kirim = new Date("2026-09-01T03:00:00Z");
    expect(sudahMacet(kirim, 3, new Date("2026-09-04T02:59:00Z"))).toBe(false);
    expect(sudahMacet(kirim, 3, new Date("2026-09-04T03:00:00Z"))).toBe(true);
    expect(sudahMacet(null, 3, new Date())).toBe(false);
  });
});
