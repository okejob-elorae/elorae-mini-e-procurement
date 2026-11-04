import { describe, expect, it } from "vitest";
import {
  arahSelisih,
  awalanNomorTukar,
  BATAS_BARIS_TUKAR,
  BATAS_QTY_TUKAR,
  bolehMelihatTukar,
  bolehMengajukanTukar,
  bolehMenyelesaikanTukar,
  bolehMenyetujuiTukar,
  bolehPindahTukar,
  bacaStatusTukar,
  hitungNilaiTukar,
  kekuranganStok,
  kunciBarisTukar,
  nomorTukarBerikut,
  periksaJenisToko,
  periksaNilaiTukar,
  periksaTukar,
  rapikanAlasanTukar,
  rapikanBarisTukar,
  rapikanCatatanTukar,
  statusTukarTerbuka,
  tahunWib,
  type BarisTukar,
} from "./tukar-barang";

const masuk = (itemId: string, qty: number, variantSku = ""): BarisTukar => ({ direction: "MASUK", itemId, variantSku, qty });
const keluar = (itemId: string, qty: number, variantSku = ""): BarisTukar => ({ direction: "KELUAR", itemId, variantSku, qty });

describe("rapikanBarisTukar", () => {
  it("menerima satu MASUK dan satu KELUAR, merapikan varian", () => {
    const r = rapikanBarisTukar([
      { direction: "MASUK", itemId: "a", variantSku: " A-M ", qty: 2 },
      { direction: "KELUAR", itemId: "a", variantSku: null, qty: 2 },
    ]);
    expect(r).toEqual({
      ok: true,
      baris: [
        { direction: "MASUK", itemId: "a", variantSku: "A-M", qty: 2 },
        { direction: "KELUAR", itemId: "a", variantSku: "", qty: 2 },
      ],
    });
  });

  it("bukan larik → BARIS_TIDAK_SAH", () => {
    expect(rapikanBarisTukar(null)).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH" });
    expect(rapikanBarisTukar({})).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH" });
  });

  it("arah tidak dikenal / barang kosong → BARIS_TIDAK_SAH", () => {
    expect(rapikanBarisTukar([{ direction: "RETUR", itemId: "a", qty: 1 }]).ok).toBe(false);
    expect(rapikanBarisTukar([{ direction: "MASUK", itemId: "  ", qty: 1 }])).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH" });
    expect(rapikanBarisTukar([{ direction: "MASUK", itemId: 5, qty: 1 }])).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH" });
    expect(rapikanBarisTukar(["x"])).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH" });
  });

  it.each([0, -1, 1.5, Number.NaN, "2", BATAS_QTY_TUKAR + 1])("qty %s ditolak", (qty) => {
    expect(
      rapikanBarisTukar([
        { direction: "MASUK", itemId: "a", qty },
        { direction: "KELUAR", itemId: "b", qty: 1 },
      ]),
    ).toEqual({ ok: false, kode: "QTY_TIDAK_SAH" });
  });

  it("barang+varian sama dua kali pada arah yang sama → BARIS_GANDA", () => {
    expect(
      rapikanBarisTukar([
        { direction: "MASUK", itemId: "a", variantSku: "M", qty: 1 },
        { direction: "MASUK", itemId: "a", variantSku: " M", qty: 1 },
        { direction: "KELUAR", itemId: "b", qty: 1 },
      ]),
    ).toEqual({ ok: false, kode: "BARIS_GANDA" });
  });

  it("barang+varian yang sama di DUA arah sah (tukar barang cacat dengan yang sama)", () => {
    const r = rapikanBarisTukar([
      { direction: "MASUK", itemId: "a", variantSku: "M", qty: 1 },
      { direction: "KELUAR", itemId: "a", variantSku: "M", qty: 1 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("varian beda dari barang yang sama pada satu arah bukan ganda", () => {
    const r = rapikanBarisTukar([
      { direction: "MASUK", itemId: "a", variantSku: "M", qty: 1 },
      { direction: "MASUK", itemId: "a", variantSku: "L", qty: 1 },
      { direction: "KELUAR", itemId: "a", variantSku: "XL", qty: 2 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("tanpa MASUK / tanpa KELUAR ditolak", () => {
    expect(rapikanBarisTukar([{ direction: "KELUAR", itemId: "a", qty: 1 }])).toEqual({ ok: false, kode: "TANPA_MASUK" });
    expect(rapikanBarisTukar([{ direction: "MASUK", itemId: "a", qty: 1 }])).toEqual({ ok: false, kode: "TANPA_KELUAR" });
    expect(rapikanBarisTukar([])).toEqual({ ok: false, kode: "TANPA_MASUK" });
  });

  it("terlalu banyak baris ditolak sebelum dibaca satu per satu", () => {
    const banyak = Array.from({ length: BATAS_BARIS_TUKAR + 1 }, (_, i) => ({
      direction: i % 2 ? "MASUK" : "KELUAR",
      itemId: `i${i}`,
      qty: 1,
    }));
    expect(rapikanBarisTukar(banyak)).toEqual({ ok: false, kode: "TERLALU_BANYAK_BARIS" });
  });
});

describe("hitungNilaiTukar + periksaNilaiTukar", () => {
  const harga = new Map<string, number | null>([
    ["kaos", 85_000],
    ["kemeja", 150_000],
    ["celana", 150_000.4],
    ["polos", null],
    ["gratis", 0],
  ]);

  it("tukar ukuran barang yang sama: nilai sama persis", () => {
    const r = hitungNilaiTukar([masuk("kaos", 3, "K-M"), keluar("kaos", 3, "K-L")], harga);
    expect(r).toEqual({ ok: true, nilai: { masuk: 255_000, keluar: 255_000, selisih: 0 } });
    if (r.ok) expect(periksaNilaiTukar(r.nilai)).toEqual({ ok: true });
  });

  it("selisih ≤ Rp 1 masih dianggap sama (pembulatan sen)", () => {
    const r = hitungNilaiTukar([masuk("kemeja", 2), keluar("celana", 2)], harga);
    expect(r.ok && r.nilai.selisih).toBeCloseTo(0.8, 5);
    if (r.ok) expect(periksaNilaiTukar(r.nilai).ok).toBe(true);
  });

  it("keluar lebih mahal → SELISIH_NILAI dengan angka lengkap, selisih positif", () => {
    const r = hitungNilaiTukar([masuk("kaos", 1), keluar("kemeja", 1)], harga);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(periksaNilaiTukar(r.nilai)).toEqual({ ok: false, kode: "SELISIH_NILAI", masuk: 85_000, keluar: 150_000, selisih: 65_000 });
    expect(arahSelisih(r.nilai.selisih)).toBe("LEWAT_PESANAN");
  });

  it("masuk lebih mahal → selisih negatif, lewat retur", () => {
    const r = hitungNilaiTukar([masuk("kemeja", 1), keluar("kaos", 1)], harga);
    if (!r.ok) throw new Error("harus ok");
    const p = periksaNilaiTukar(r.nilai);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.selisih).toBe(-65_000);
    expect(arahSelisih(r.nilai.selisih)).toBe("LEWAT_RETUR");
    expect(arahSelisih(0.5)).toBe("PAS");
  });

  it("tepat Rp 1 lolos, Rp 1,01 tidak", () => {
    expect(periksaNilaiTukar({ masuk: 100, keluar: 101, selisih: 1 }).ok).toBe(true);
    expect(periksaNilaiTukar({ masuk: 100, keluar: 101.01, selisih: 1.01 }).ok).toBe(false);
  });

  it("harga kosong, nol, atau barang tak dikenal → HARGA_BELUM_DISET (nilai nol lawan nol bukan bukti setara)", () => {
    expect(hitungNilaiTukar([masuk("polos", 1), keluar("polos", 1, "X")], harga)).toEqual({
      ok: false,
      kode: "HARGA_BELUM_DISET",
      itemIds: ["polos"],
    });
    expect(hitungNilaiTukar([masuk("gratis", 1), keluar("hantu", 1)], harga)).toEqual({
      ok: false,
      kode: "HARGA_BELUM_DISET",
      itemIds: ["gratis", "hantu"],
    });
  });
});

describe("periksaTukar (gabungan)", () => {
  const harga = new Map<string, number | null>([
    ["kaos", 85_000],
    ["kemeja", 150_000],
  ]);

  it("toko KONSI ditolak paling dulu", () => {
    expect(periksaTukar({ termsType: "KONSI", baris: [], harga })).toEqual({ ok: false, kode: "BUKAN_TOKO_PUTUS" });
    expect(periksaJenisToko("PUTUS")).toBeNull();
    expect(periksaJenisToko("KONSI")).toBe("BUKAN_TOKO_PUTUS");
  });

  it("baris salah dilaporkan sebelum nilai", () => {
    expect(periksaTukar({ termsType: "PUTUS", baris: [{ direction: "MASUK", itemId: "kaos", qty: 1 }], harga })).toEqual({
      ok: false,
      kode: "TANPA_KELUAR",
    });
  });

  it("sah: mengembalikan baris rapi + nilai", () => {
    const r = periksaTukar({
      termsType: "PUTUS",
      baris: [
        { direction: "MASUK", itemId: "kaos", variantSku: "K-M", qty: 2 },
        { direction: "KELUAR", itemId: "kaos", variantSku: "K-XL", qty: 2 },
      ],
      harga,
    });
    expect(r).toEqual({
      ok: true,
      baris: [masuk("kaos", 2, "K-M"), keluar("kaos", 2, "K-XL")],
      nilai: { masuk: 170_000, keluar: 170_000, selisih: 0 },
    });
  });

  it("selisih nilai dilaporkan lengkap", () => {
    const r = periksaTukar({
      termsType: "PUTUS",
      baris: [
        { direction: "MASUK", itemId: "kaos", qty: 1 },
        { direction: "KELUAR", itemId: "kemeja", qty: 1 },
      ],
      harga,
    });
    expect(r).toEqual({ ok: false, kode: "SELISIH_NILAI", masuk: 85_000, keluar: 150_000, selisih: 65_000 });
  });
});

describe("status", () => {
  it("perpindahan yang sah", () => {
    expect(bolehPindahTukar("DIAJUKAN", "DISETUJUI")).toBe(true);
    expect(bolehPindahTukar("DIAJUKAN", "DITOLAK")).toBe(true);
    expect(bolehPindahTukar("DIAJUKAN", "DIBATALKAN")).toBe(true);
    expect(bolehPindahTukar("DISETUJUI", "SELESAI")).toBe(true);
    expect(bolehPindahTukar("DISETUJUI", "DIBATALKAN")).toBe(true);
  });

  it("yang tidak sah: melompat, mundur, dari keadaan akhir, status asing", () => {
    expect(bolehPindahTukar("DIAJUKAN", "SELESAI")).toBe(false);
    expect(bolehPindahTukar("DISETUJUI", "DITOLAK")).toBe(false);
    expect(bolehPindahTukar("SELESAI", "DIBATALKAN")).toBe(false);
    expect(bolehPindahTukar("DITOLAK", "DISETUJUI")).toBe(false);
    expect(bolehPindahTukar("DIBATALKAN", "DIAJUKAN")).toBe(false);
    expect(bolehPindahTukar("ANEH", "DISETUJUI")).toBe(false);
  });

  it("terbuka = belum selesai dan belum diputus berhenti", () => {
    expect(statusTukarTerbuka("DIAJUKAN")).toBe(true);
    expect(statusTukarTerbuka("DISETUJUI")).toBe(true);
    expect(statusTukarTerbuka("SELESAI")).toBe(false);
    expect(statusTukarTerbuka("DITOLAK")).toBe(false);
    expect(bacaStatusTukar("SELESAI")).toBe("SELESAI");
    expect(bacaStatusTukar("x")).toBeNull();
    expect(bacaStatusTukar(undefined)).toBeNull();
  });
});

describe("kekuranganStok", () => {
  it("menjumlah KELUAR per barang+varian, mengabaikan MASUK, melaporkan yang kurang saja", () => {
    const stok = new Map([
      [kunciBarisTukar("a", "M"), 5],
      [kunciBarisTukar("b", ""), 1],
    ]);
    const kurang = kekuranganStok(
      [masuk("a", 10, "M"), keluar("a", 4, "M"), keluar("b", 2), keluar("c", 1, "X")],
      (itemId, variantSku) => stok.get(kunciBarisTukar(itemId, variantSku)) ?? 0,
    );
    expect(kurang).toEqual([
      { itemId: "b", variantSku: "", butuh: 2, tersedia: 1 },
      { itemId: "c", variantSku: "X", butuh: 1, tersedia: 0 },
    ]);
  });

  it("stok minus dilaporkan apa adanya, cukup = kosong", () => {
    expect(kekuranganStok([keluar("a", 1)], () => -3)).toEqual([{ itemId: "a", variantSku: "", butuh: 1, tersedia: -3 }]);
    expect(kekuranganStok([keluar("a", 3)], () => 3)).toEqual([]);
  });
});

describe("nomor dokumen", () => {
  it("TKR/tahun/urutan empat digit, lanjut dari yang terakhir", () => {
    expect(awalanNomorTukar(2026)).toBe("TKR/2026/");
    expect(nomorTukarBerikut(null, 2026)).toBe("TKR/2026/0001");
    expect(nomorTukarBerikut("TKR/2026/0041", 2026)).toBe("TKR/2026/0042");
    expect(nomorTukarBerikut("TKR/2026/9999", 2026)).toBe("TKR/2026/10000");
  });

  it("nomor tahun lain atau rusak tidak dilanjutkan", () => {
    expect(nomorTukarBerikut("TKR/2025/0099", 2026)).toBe("TKR/2026/0001");
    expect(nomorTukarBerikut("TKR/2026/abc", 2026)).toBe("TKR/2026/0001");
  });

  it("tahun menurut WIB: 31 Desember 18:00 UTC sudah tahun baru di Jakarta", () => {
    expect(tahunWib(new Date("2026-12-31T16:59:00Z"))).toBe(2026);
    expect(tahunWib(new Date("2026-12-31T17:00:00Z"))).toBe(2027);
  });
});

describe("teks", () => {
  it("alasan wajib ditolak kosong, dipangkas, dibatasi panjang", () => {
    expect(rapikanAlasanTukar("  ", true)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanAlasanTukar(undefined, true)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanAlasanTukar(" rusak ", true)).toEqual({ ok: true, alasan: "rusak" });
    expect(rapikanAlasanTukar("", false)).toEqual({ ok: true, alasan: null });
    expect(rapikanAlasanTukar("x".repeat(501), false)).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
  });

  it("catatan boleh kosong", () => {
    expect(rapikanCatatanTukar(null)).toEqual({ ok: true, catatan: null });
    expect(rapikanCatatanTukar("  ukuran salah kirim ")).toEqual({ ok: true, catatan: "ukuran salah kirim" });
    expect(rapikanCatatanTukar("x".repeat(501))).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
  });
});

describe("izin", () => {
  it("mengajukan = aplikasi lapangan", () => {
    expect(bolehMengajukanTukar(["pwa:access"])).toBe(true);
    expect(bolehMengajukanTukar(["field_sales_orders:approve"])).toBe(false);
    expect(bolehMengajukanTukar(undefined)).toBe(false);
  });

  it("menyetujui = izin setujui pesanan lapangan; menyelesaikan = izin kelola stok gudang", () => {
    expect(bolehMenyetujuiTukar(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMenyetujuiTukar(["inventory:manage"])).toBe(false);
    expect(bolehMenyelesaikanTukar(["inventory:manage"])).toBe(true);
    expect(bolehMenyelesaikanTukar(["field_sales_orders:approve"])).toBe(false);
    expect(bolehMenyetujuiTukar(["*"])).toBe(true);
  });

  it("melihat: siapa pun yang punya salah satu dari ketiganya", () => {
    expect(bolehMelihatTukar(["field_sales_orders:view"])).toBe(true);
    expect(bolehMelihatTukar(["inventory:manage"])).toBe(true);
    expect(bolehMelihatTukar(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMelihatTukar(["pwa:access"])).toBe(false);
  });
});
