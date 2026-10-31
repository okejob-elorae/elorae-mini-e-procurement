import { describe, it, expect } from "vitest";
import {
  bacaHariBaru,
  barangBaru,
  porsiBulan,
  susunSaranTawar,
  BATAS_ANDALAN_TERATAS,
  BATAS_SARAN,
  HARI_BARU_BAWAAN,
  HARI_TIDAK_DIPESAN,
  MIN_PCS_LARIS,
  type BahanSaranTawar,
  type BarangTersedia,
  type BeliToko,
} from "./saran-tawar";

const HARI = 86_400_000;
// 30 Sep 2026, 12.00 WIB.
const hariIni = new Date("2026-09-30T05:00:00Z");
const lalu = (n: number) => new Date(hariIni.getTime() - n * HARI);
const lama = new Date("2025-01-01T00:00:00Z");

const ada = (itemId: string, tersedia = 10, dibuat: Date = lama): BarangTersedia => ({ itemId, tersedia, dibuat });
const beli = (itemId: string, hariLalu: number, pcs = 6): BeliToko => ({ itemId, tanggal: lalu(hariLalu), pcs });

function bahan(b: Partial<BahanSaranTawar>): BahanSaranTawar {
  return { beliToko: [], jualSejenis: [], barang: [], hariBaru: HARI_BARU_BAWAAN, ...b };
}

describe("bacaHariBaru", () => {
  it("kosong atau rusak → bawaan 90", () => {
    expect(bacaHariBaru(null)).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru(undefined)).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru("")).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru("abc")).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru("0")).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru("-5")).toBe(HARI_BARU_BAWAAN);
    expect(bacaHariBaru("12.5")).toBe(HARI_BARU_BAWAAN);
  });

  it("bilangan bulat positif dipakai, spasi diabaikan", () => {
    expect(bacaHariBaru("30")).toBe(30);
    expect(bacaHariBaru(" 45 ")).toBe(45);
  });

  it("dibatasi sepuluh tahun supaya jendela kueri tidak liar", () => {
    expect(bacaHariBaru("999999")).toBe(3650);
  });
});

describe("susunSaranTawar — andalan toko", () => {
  it("barang yang biasa dipesan tiap 30 hari dan sudah 90 hari tidak dipesan → ANDALAN_TOKO", () => {
    const hasil = susunSaranTawar(
      bahan({ beliToko: [beli("a", 150), beli("a", 120), beli("a", 90)], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([
      { itemId: "a", alasan: "ANDALAN_TOKO", tersedia: 10, jedaBiasa: 30, hariSejakPesan: 90, pcsRiwayat: 18 },
    ]);
  });

  it("belum melewati jedanya → tidak disarankan", () => {
    // Jeda 30 hari, terakhir 33 hari lalu: belum lewat 30 × 1,2 = 36.
    const hasil = susunSaranTawar(
      bahan({ beliToko: [beli("a", 93), beli("a", 63), beli("a", 33)], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it("baru saja dipesan tidak pernah disarankan, walau jedanya pendek", () => {
    // Jeda 3 hari, terakhir 10 hari lalu: lewat jedanya, tapi di bawah batas minimum 14 hari.
    const hasil = susunSaranTawar(
      bahan({ beliToko: [beli("a", 16), beli("a", 13), beli("a", 10)], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it("butuh dua pesanan di hari berbeda — dua pesanan di hari yang sama bukan kebiasaan", () => {
    const hasil = susunSaranTawar(
      bahan({ beliToko: [beli("a", 100), beli("a", 100)], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it("hari dihitung per hari kalender WIB", () => {
    // Pukul 01.00 WIB tepat 120 hari kalender WIB lalu — dalam UTC masih hari
    // sebelumnya (121 hari). Dihitung per hari UTC, barang ini keliru lolos
    // sebagai "tidak dipesan lebih dari 120 hari".
    const dini = new Date(Date.parse("2026-09-30T00:00:00+07:00") - HARI_TIDAK_DIPESAN * HARI + 3_600_000);
    expect(dini.toISOString().slice(11, 13)).toBe("18");
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [{ itemId: "a", tanggal: dini, pcs: 6 }],
        jualSejenis: [{ itemId: "a", pcs: 50, toko: 2 }],
        barang: [ada("a")],
      }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it(`hanya ${BATAS_ANDALAN_TERATAS} barang teratas toko yang dianggap andalan`, () => {
    const beliToko: BeliToko[] = [];
    const barang: BarangTersedia[] = [];
    for (let i = 0; i < BATAS_ANDALAN_TERATAS + 1; i++) {
      const id = `x${String(i).padStart(2, "0")}`;
      // x00 terbanyak, x10 paling sedikit.
      beliToko.push(beli(id, 120, 100 - i), beli(id, 90, 100 - i));
      barang.push(ada(id));
    }
    const hasil = susunSaranTawar(bahan({ beliToko, barang }), hariIni, { batas: 50 });
    expect(hasil).toHaveLength(BATAS_ANDALAN_TERATAS);
    expect(hasil.map((s) => s.itemId)).not.toContain("x10");
  });

  it("yang paling terlambat dibanding kebiasaannya paling depan", () => {
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [
          // a: jeda 30, sejak 60 → 2×.  b: jeda 20, sejak 100 → 5×.
          beli("a", 120, 50), beli("a", 90, 50), beli("a", 60, 50),
          beli("b", 140, 5), beli("b", 120, 5), beli("b", 100, 5),
        ],
        barang: [ada("a"), ada("b")],
      }),
      hariIni,
    );
    expect(hasil.map((s) => s.itemId)).toEqual(["b", "a"]);
  });
});

describe("susunSaranTawar — laris di toko sejenis", () => {
  it("laris di toko sejenis dan belum pernah dipesan di sini → LARIS_DI_AREA dengan angkanya", () => {
    const hasil = susunSaranTawar(
      bahan({ jualSejenis: [{ itemId: "a", pcs: 48, toko: 3 }], barang: [ada("a", 24)] }),
      hariIni,
    );
    expect(hasil).toEqual([
      { itemId: "a", alasan: "LARIS_DI_AREA", tersedia: 24, pcs: 48, toko: 3, hariSejakPesan: null },
    ]);
  });

  it(`di bawah ${MIN_PCS_LARIS} pcs belum dianggap laris`, () => {
    const hasil = susunSaranTawar(
      bahan({ jualSejenis: [{ itemId: "a", pcs: MIN_PCS_LARIS - 1, toko: 1 }], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it(`sudah dipesan toko ini dalam ${HARI_TIDAK_DIPESAN} hari → tidak disarankan`, () => {
    const hasil = susunSaranTawar(
      bahan({ beliToko: [beli("a", 30)], jualSejenis: [{ itemId: "a", pcs: 48, toko: 3 }], barang: [ada("a")] }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it(`terakhir dipesan lebih dari ${HARI_TIDAK_DIPESAN} hari lalu → disarankan, dengan harinya`, () => {
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [beli("a", HARI_TIDAK_DIPESAN + 10)],
        jualSejenis: [{ itemId: "a", pcs: 48, toko: 3 }],
        barang: [ada("a")],
      }),
      hariIni,
    );
    expect(hasil).toEqual([
      { itemId: "a", alasan: "LARIS_DI_AREA", tersedia: 10, pcs: 48, toko: 3, hariSejakPesan: HARI_TIDAK_DIPESAN + 10 },
    ]);
  });

  it("paling laris dulu; seri → yang dijual lebih banyak toko", () => {
    const hasil = susunSaranTawar(
      bahan({
        jualSejenis: [
          { itemId: "a", pcs: 12, toko: 1 },
          { itemId: "b", pcs: 40, toko: 2 },
          { itemId: "c", pcs: 12, toko: 4 },
        ],
        barang: [ada("a"), ada("b"), ada("c")],
      }),
      hariIni,
    );
    expect(hasil.map((s) => s.itemId)).toEqual(["b", "c", "a"]);
  });
});

describe("susunSaranTawar — barang baru", () => {
  it("barang baru yang belum pernah dikirim ke toko ini → BARU", () => {
    const hasil = susunSaranTawar(bahan({ barang: [ada("a", 5, lalu(10))] }), hariIni);
    expect(hasil).toEqual([{ itemId: "a", alasan: "BARU", tersedia: 5, umurHari: 10 }]);
  });

  it("sudah pernah dikirim ke sini → bukan saran BARU", () => {
    const hasil = susunSaranTawar(bahan({ beliToko: [beli("a", 5)], barang: [ada("a", 5, lalu(10))] }), hariIni);
    expect(hasil).toEqual([]);
  });

  it("lebih tua dari batas hari barang baru → bukan BARU; batasnya bisa diubah", () => {
    const b = bahan({ barang: [ada("a", 5, lalu(100))] });
    expect(susunSaranTawar(b, hariIni)).toEqual([]);
    expect(susunSaranTawar({ ...b, hariBaru: 120 }, hariIni)).toEqual([
      { itemId: "a", alasan: "BARU", tersedia: 5, umurHari: 100 },
    ]);
  });

  it("yang paling baru paling depan", () => {
    const hasil = susunSaranTawar(bahan({ barang: [ada("a", 5, lalu(40)), ada("b", 5, lalu(2))] }), hariIni);
    expect(hasil.map((s) => s.itemId)).toEqual(["b", "a"]);
  });

  it("tanggal dibuat di masa depan (jam server meleset) dianggap hari ini", () => {
    const hasil = susunSaranTawar(bahan({ barang: [ada("a", 5, new Date(hariIni.getTime() + 2 * HARI))] }), hariIni);
    expect(hasil).toEqual([{ itemId: "a", alasan: "BARU", tersedia: 5, umurHari: 0 }]);
  });
});

describe("susunSaranTawar — aturan bersama", () => {
  it("barang yang stoknya habis tidak pernah disarankan, apa pun alasannya", () => {
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [beli("andalan", 150), beli("andalan", 120), beli("andalan", 90)],
        jualSejenis: [{ itemId: "laris", pcs: 48, toko: 3 }],
        barang: [ada("andalan", 0), ada("laris", -2), ada("baru", 0, lalu(3))],
      }),
      hariIni,
    );
    expect(hasil).toEqual([]);
  });

  it("barang di luar daftar barang tersedia (nonaktif / bukan barang jadi) tidak disarankan", () => {
    const hasil = susunSaranTawar(bahan({ jualSejenis: [{ itemId: "hilang", pcs: 99, toko: 5 }] }), hariIni);
    expect(hasil).toEqual([]);
  });

  it("satu barang satu kali: andalan mengalahkan laris, laris mengalahkan baru", () => {
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [beli("a", 200), beli("a", 170), beli("a", 140)],
        jualSejenis: [
          { itemId: "a", pcs: 60, toko: 3 },
          { itemId: "b", pcs: 30, toko: 2 },
        ],
        barang: [ada("a"), ada("b", 10, lalu(5))],
      }),
      hariIni,
    );
    expect(hasil.map((s) => [s.itemId, s.alasan])).toEqual([
      ["a", "ANDALAN_TOKO"],
      ["b", "LARIS_DI_AREA"],
    ]);
  });

  it("alasan bergiliran supaya satu alasan tidak menutupi yang lain", () => {
    const hasil = susunSaranTawar(
      bahan({
        beliToko: [
          beli("a1", 150, 30), beli("a1", 120, 30), beli("a1", 90, 30),
          beli("a2", 150, 20), beli("a2", 120, 20), beli("a2", 90, 20),
        ],
        jualSejenis: [
          { itemId: "l1", pcs: 40, toko: 2 },
          { itemId: "l2", pcs: 20, toko: 2 },
        ],
        barang: [ada("a1"), ada("a2"), ada("l1"), ada("l2"), ada("b1", 3, lalu(1)), ada("b2", 3, lalu(9))],
      }),
      hariIni,
    );
    expect(hasil.map((s) => s.itemId)).toEqual(["a1", "l1", "b1", "a2", "l2", "b2"]);
  });

  it(`paling banyak ${BATAS_SARAN} saran, dan batasnya bisa diperkecil`, () => {
    const barang: BarangTersedia[] = [];
    const jualSejenis = [];
    for (let i = 0; i < 15; i++) {
      barang.push(ada(`l${i}`), ada(`b${i}`, 3, lalu(i)));
      jualSejenis.push({ itemId: `l${i}`, pcs: 100 - i, toko: 1 });
    }
    expect(susunSaranTawar(bahan({ barang, jualSejenis }), hariIni)).toHaveLength(BATAS_SARAN);
    expect(susunSaranTawar(bahan({ barang, jualSejenis }), hariIni, { batas: 3 })).toHaveLength(3);
  });

  it("tanpa data apa pun → kosong", () => {
    expect(susunSaranTawar(bahan({}), hariIni)).toEqual([]);
  });
});

describe("barangBaru", () => {
  it("barang baru yang ada stoknya, terbaru dulu — termasuk yang pernah dikirim", () => {
    expect(
      barangBaru([ada("a", 5, lalu(30)), ada("b", 5, lalu(2)), ada("c", 0, lalu(1)), ada("d", 5, lalu(200))], hariIni, 90),
    ).toEqual([
      { itemId: "b", umurHari: 2 },
      { itemId: "a", umurHari: 30 },
    ]);
  });
});

describe("porsiBulan", () => {
  it("90 hari sampai 30 Sep: Juli sebagian, Agustus dan September utuh", () => {
    expect(porsiBulan(hariIni, 90)).toEqual([
      { tahun: 2026, bulan: 7, porsi: 30 / 31 },
      { tahun: 2026, bulan: 8, porsi: 1 },
      { tahun: 2026, bulan: 9, porsi: 1 },
    ]);
  });

  it("melewati pergantian tahun, dan bulan berjalan hanya sampai hari ini", () => {
    expect(porsiBulan(new Date("2026-01-15T05:00:00Z"), 30)).toEqual([
      { tahun: 2025, bulan: 12, porsi: 16 / 31 },
      { tahun: 2026, bulan: 1, porsi: 15 / 31 },
    ]);
  });
});
