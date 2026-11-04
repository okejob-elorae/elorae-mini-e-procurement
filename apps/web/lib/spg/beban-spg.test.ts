import { describe, expect, it } from "vitest";
import {
  KEADAAN_BEBAN_SPG,
  bagiBebanKeBaris,
  bebanSudahDiganti,
  kalimatBebanKabar,
  keadaanBebanSpg,
  nilaiBebanReturPembeli,
  nilaiBersihBarisRetur,
  periksaBesarBeban,
  terapkanBebanSpg,
  type BebanSpgTerbuka,
} from "./beban-spg";

const beban = (id: string, sisa: number, dibuatPada = "2026-10-01T00:00:00.000Z"): BebanSpgTerbuka => ({
  id,
  sumber: "RETUR_PEMBELI",
  sumberId: `r-${id}`,
  docNo: `SPG/${id}`,
  storeId: "toko",
  jenisToko: "KONSI",
  dibuatPada,
  sisa,
});

describe("terapkanBebanSpg — komisi dulu, lalu gaji, tidak di bawah nol (P5, P11a, P13a)", () => {
  it("takes the commission part first, then salary", () => {
    const h = terapkanBebanSpg({ sisaKomisiSen: 4_000_000, sisaGajiSen: 100_000_000, beban: [beban("a", 50_000)] });
    expect(h.baris).toEqual([expect.objectContaining({ chargeId: "a", dariKomisi: 40_000, dariGaji: 10_000, diterapkan: 50_000, dibawa: 0 })]);
    expect(h.jumlahSen).toBe(5_000_000);
    expect(h.sisaKomisiSen).toBe(0);
    expect(h.sisaGajiSen).toBe(99_000_000);
  });

  it("never goes below zero: what does not fit is carried", () => {
    const h = terapkanBebanSpg({ sisaKomisiSen: 1_000_000, sisaGajiSen: 2_000_000, beban: [beban("a", 50_000)] });
    expect(h.baris[0]).toMatchObject({ diterapkan: 30_000, dibawa: 20_000, dariKomisi: 10_000, dariGaji: 20_000 });
    expect([h.sisaKomisiSen, h.sisaGajiSen]).toEqual([0, 0]);
  });

  it("oldest charge first (createdAt, then id), whatever order they come in", () => {
    const h = terapkanBebanSpg({
      sisaKomisiSen: 3_000_000,
      sisaGajiSen: 0,
      beban: [beban("baru", 20_000, "2026-10-05T00:00:00.000Z"), beban("lama-b", 20_000, "2026-10-01T00:00:00.000Z"), beban("lama-a", 20_000, "2026-10-01T00:00:00.000Z")],
    });
    expect(h.baris.map((b) => [b.chargeId, b.diterapkan])).toEqual([
      ["lama-a", 20_000],
      ["lama-b", 10_000],
      ["baru", 0],
    ]);
  });

  it("zero parts apply nothing; sums are exact in sen", () => {
    const h = terapkanBebanSpg({ sisaKomisiSen: 0, sisaGajiSen: 0, beban: [beban("a", 12_345.67)] });
    expect(h.baris[0]).toMatchObject({ diterapkan: 0, dibawa: 12_345.67 });
    const j = terapkanBebanSpg({ sisaKomisiSen: 1_234_567, sisaGajiSen: 0, beban: [beban("a", 0.1), beban("b", 0.2)] });
    expect(j.jumlahSen).toBe(30);
    expect(j.baris.map((b) => b.diterapkan)).toEqual([0.1, 0.2]);
  });

  it("several unpaid rows: each row shows only what its own payment takes (display = payment)", () => {
    const peta = bagiBebanKeBaris(
      [
        { ref: "row-1", sisaKomisiSen: 2_000_000, sisaGajiSen: 0 },
        { ref: "row-2", sisaKomisiSen: 5_000_000, sisaGajiSen: 0 },
      ],
      [beban("a", 50_000)],
    );
    expect(peta.get("row-1")?.baris.map((b) => b.diterapkan)).toEqual([20_000]);
    expect(peta.get("row-2")?.baris.map((b) => b.diterapkan)).toEqual([30_000]);
    expect((peta.get("row-1")?.jumlahSen ?? 0) + (peta.get("row-2")?.jumlahSen ?? 0)).toBe(5_000_000);
  });
});

describe("besar beban (P81)", () => {
  it("is the net price on the SPG nota, discounts included, per line", () => {
    // 6 terjual, total baris 270.000 → 45.000 per potong.
    expect(nilaiBersihBarisRetur({ qty: 2, saleLine: { qty: 6, lineTotal: 270_000, unitPrice: 50_000 } })).toBe(90_000);
    // Total baris kosong → harga satuan.
    expect(nilaiBersihBarisRetur({ qty: 1, saleLine: { qty: 1, lineTotal: null, unitPrice: 49_999.5 } })).toBe(49_999.5);
    expect(
      nilaiBebanReturPembeli([
        { qty: 1, saleLine: { qty: 3, lineTotal: 100_000, unitPrice: 40_000 } },
        { qty: 1, saleLine: { qty: 3, lineTotal: 100_000, unitPrice: 40_000 } },
      ]),
    ).toBe(66_666.66);
  });

  it("an amount different from the computed one needs a reason; zero, negative or NaN are refused", () => {
    expect(periksaBesarBeban({ besar: null, dihitung: 45_000, alasan: null })).toEqual({ ok: true, besar: 45_000, alasan: null });
    expect(periksaBesarBeban({ besar: 45_000, dihitung: 45_000, alasan: null })).toEqual({ ok: true, besar: 45_000, alasan: null });
    expect(periksaBesarBeban({ besar: 40_000, dihitung: 45_000, alasan: " " })).toEqual({ ok: false, alasan: "ALASAN_BESAR_BEBAN_WAJIB" });
    expect(periksaBesarBeban({ besar: 40_000, dihitung: 45_000, alasan: "struk kasir Rp 40.000" })).toEqual({
      ok: true,
      besar: 40_000,
      alasan: "struk kasir Rp 40.000",
    });
    for (const besar of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.234, 10_000_000_000_000]) {
      expect(periksaBesarBeban({ besar, dihitung: 45_000, alasan: "x" })).toEqual({ ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" });
    }
    expect(periksaBesarBeban({ besar: 40_000, dihitung: 45_000, alasan: "x".repeat(501) })).toEqual({ ok: false, alasan: "ALASAN_TERLALU_PANJANG" });
  });
});

describe("keadaan beban", () => {
  it("is compensated only when deducted in full, or moved to debts that are ALL paid", () => {
    expect(bebanSudahDiganti({ status: "LUNAS", utang: [] })).toBe(true);
    expect(bebanSudahDiganti({ status: "TERBUKA", utang: [] })).toBe(false);
    expect(bebanSudahDiganti({ status: "DIUTANGKAN", utang: [{ lunas: true }, { lunas: false }] })).toBe(false);
    expect(bebanSudahDiganti({ status: "DIUTANGKAN", utang: [{ lunas: true }] })).toBe(true);
    expect(bebanSudahDiganti({ status: "DIUTANGKAN", utang: [] })).toBe(false);
    expect(bebanSudahDiganti({ status: "BATAL", utang: [] })).toBe(false);
  });

  it("labels every state", () => {
    const semua = [
      keadaanBebanSpg({ status: "TERBUKA", goodsDecision: null, diganti: false }),
      keadaanBebanSpg({ status: "DIUTANGKAN", goodsDecision: null, diganti: false }),
      keadaanBebanSpg({ status: "LUNAS", goodsDecision: null, diganti: true }),
      keadaanBebanSpg({ status: "LUNAS", goodsDecision: "DIBELI_SPG", diganti: true }),
      keadaanBebanSpg({ status: "LUNAS", goodsDecision: "KEMBALI_STOK", diganti: true }),
      keadaanBebanSpg({ status: "BATAL", goodsDecision: null, diganti: false }),
    ];
    expect(semua).toEqual(["TERBUKA", "DIUTANGKAN", "MENUNGGU_KEPUTUSAN_BARANG", "DIBELI_SPG", "KEMBALI_STOK", "BATAL"]);
    expect(new Set(semua)).toEqual(new Set(KEADAAN_BEBAN_SPG));
  });

  it("pay notice text names the nota, the deducted amount, the carried rest and the payback", () => {
    const h = terapkanBebanSpg({ sisaKomisiSen: 3_000_000, sisaGajiSen: 0, beban: [beban("a", 50_000)] });
    const teks = kalimatBebanKabar(h.baris, [{ chargeId: "b", docNo: "SPG/9", storeId: "toko", jenisToko: "PUTUS", jumlah: 25_000 }]);
    expect(teks).toContain("Dipotong beban retur pembeli ditolak (nota SPG/a)");
    expect(teks).toContain("30.000");
    expect(teks).toContain("20.000");
    expect(teks).toContain("Pengembalian beban (nota SPG/9)");
    expect(kalimatBebanKabar([], [])).toBe("");
  });
});
