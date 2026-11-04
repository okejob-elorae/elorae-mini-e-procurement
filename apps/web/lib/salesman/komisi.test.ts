import { describe, expect, it } from "vitest";
import {
  ATURAN_PERINGKAT_BAWAAN,
  bacaAturanPeringkat,
  bacaBulan,
  bacaSkemaKomisi,
  daftarBulanTerakhir,
  formatPersen,
  hitungKomisi,
  namaBulan,
  nilaiTunaiPorsi,
  porsiTagih,
  rentangBulanWib,
  ringkasTagih,
  SKEMA_KOMISI_BAWAAN,
  susunPeringkat,
  tulisSkemaKomisi,
  validasiSkemaKomisi,
  type MasukanKomisi,
  type SkemaKomisi,
} from "./komisi";

const skema = (x: Partial<SkemaKomisi> = {}): SkemaKomisi => ({ ...SKEMA_KOMISI_BAWAAN, ...x });
const masukan = (x: Partial<MasukanKomisi> = {}): MasukanKomisi => ({
  skema: skema(),
  salesmanId: "s1",
  omzet: 0,
  tertagih: 0,
  target: null,
  ...x,
});

describe("bacaSkemaKomisi", () => {
  it("kosong / bukan JSON / bukan objek → bawaan", () => {
    expect(bacaSkemaKomisi(null)).toEqual(SKEMA_KOMISI_BAWAAN);
    expect(bacaSkemaKomisi("")).toEqual(SKEMA_KOMISI_BAWAAN);
    expect(bacaSkemaKomisi("{rusak")).toEqual(SKEMA_KOMISI_BAWAAN);
    expect(bacaSkemaKomisi("[1,2]")).toEqual(SKEMA_KOMISI_BAWAAN);
    expect(bacaSkemaKomisi("null")).toEqual(SKEMA_KOMISI_BAWAAN);
    expect(bacaSkemaKomisi("42")).toEqual(SKEMA_KOMISI_BAWAAN);
  });

  it("bawaan: aktif, dasar TERTAGIH 1%, tanpa tingkat, penagih 0%", () => {
    expect(SKEMA_KOMISI_BAWAAN).toEqual({
      aktif: true,
      dasar: "TERTAGIH",
      tarifPersen: 1,
      tingkat: [],
      bagianPenagihPersen: 0,
      perSalesman: {},
    });
  });

  it("nilai sah terbaca apa adanya", () => {
    const s = bacaSkemaKomisi(
      JSON.stringify({
        aktif: false,
        dasar: "PENJUALAN",
        tarifPersen: 1.25,
        tingkat: [{ capaianPersen: 100, tarifPersen: 1.5 }],
        bagianPenagihPersen: 30,
        perSalesman: { u1: 2 },
      }),
    );
    expect(s).toEqual({
      aktif: false,
      dasar: "PENJUALAN",
      tarifPersen: 1.25,
      tingkat: [{ capaianPersen: 100, tarifPersen: 1.5 }],
      bagianPenagihPersen: 30,
      perSalesman: { u1: 2 },
    });
  });

  it("kolom rusak jatuh ke bawaan PER KOLOM, kolom lain tetap", () => {
    const s = bacaSkemaKomisi(
      JSON.stringify({
        aktif: "ya",
        dasar: "OMZET",
        tarifPersen: -3,
        tingkat: "banyak",
        bagianPenagihPersen: 150,
        perSalesman: [1],
      }),
    );
    expect(s).toEqual(SKEMA_KOMISI_BAWAAN);
    const t = bacaSkemaKomisi(JSON.stringify({ tarifPersen: 2.5, bagianPenagihPersen: "x" }));
    expect(t.tarifPersen).toBe(2.5);
    expect(t.bagianPenagihPersen).toBe(0);
    expect(t.dasar).toBe("TERTAGIH");
  });

  it("tarif di atas 100% atau NaN ditolak (bawaan)", () => {
    expect(bacaSkemaKomisi(JSON.stringify({ tarifPersen: 101 })).tarifPersen).toBe(1);
    expect(bacaSkemaKomisi('{"tarifPersen": "2"}').tarifPersen).toBe(1);
    expect(bacaSkemaKomisi(JSON.stringify({ tarifPersen: 0 })).tarifPersen).toBe(0);
  });

  it("tingkat: yang rusak dibuang, diurutkan naik, ambang kembar diambil tarif tertinggi", () => {
    const s = bacaSkemaKomisi(
      JSON.stringify({
        tingkat: [
          { capaianPersen: 120, tarifPersen: 2 },
          { capaianPersen: 100, tarifPersen: 1.5 },
          { capaianPersen: 0, tarifPersen: 5 },
          { capaianPersen: 100, tarifPersen: 1.75 },
          { capaianPersen: 90 },
          "sampah",
          null,
          { capaianPersen: 110, tarifPersen: 200 },
        ],
      }),
    );
    expect(s.tingkat).toEqual([
      { capaianPersen: 100, tarifPersen: 1.75 },
      { capaianPersen: 120, tarifPersen: 2 },
    ]);
  });

  it("perSalesman: entri rusak dibuang, yang sah tetap", () => {
    const s = bacaSkemaKomisi(JSON.stringify({ perSalesman: { a: 2, b: -1, c: "3", d: 0, e: 150 } }));
    expect(s.perSalesman).toEqual({ a: 2, d: 0 });
  });

  it("tulis → baca kembali persis sama", () => {
    const asli = skema({
      dasar: "PENJUALAN",
      tarifPersen: 0.5,
      tingkat: [
        { capaianPersen: 100, tarifPersen: 1 },
        { capaianPersen: 150, tarifPersen: 2 },
      ],
      bagianPenagihPersen: 25,
      perSalesman: { x: 0.75 },
    });
    expect(bacaSkemaKomisi(tulisSkemaKomisi(asli))).toEqual(asli);
  });
});

describe("validasiSkemaKomisi (ketat, untuk aksi simpan)", () => {
  const sah = {
    aktif: true,
    dasar: "TERTAGIH",
    tarifPersen: 1,
    tingkat: [{ capaianPersen: 100, tarifPersen: 1.5 }],
    bagianPenagihPersen: 20,
    perSalesman: { u1: 2 },
  };

  it("masukan sah → skema ternormalisasi", () => {
    expect(validasiSkemaKomisi(sah)).toEqual(sah);
  });

  it("tingkat diurutkan naik", () => {
    const v = validasiSkemaKomisi({
      ...sah,
      tingkat: [
        { capaianPersen: 150, tarifPersen: 3 },
        { capaianPersen: 100, tarifPersen: 1.5 },
      ],
    });
    expect(v?.tingkat.map((t) => t.capaianPersen)).toEqual([100, 150]);
  });

  it.each([
    ["bukan objek", null],
    ["aktif bukan boolean", { ...sah, aktif: 1 }],
    ["dasar tak dikenal", { ...sah, dasar: "OMZET" }],
    ["tarif negatif", { ...sah, tarifPersen: -1 }],
    ["tarif > 100", { ...sah, tarifPersen: 100.5 }],
    ["tarif > 2 desimal", { ...sah, tarifPersen: 1.234 }],
    ["tingkat bukan larik", { ...sah, tingkat: {} }],
    ["ambang 0", { ...sah, tingkat: [{ capaianPersen: 0, tarifPersen: 2 }] }],
    ["ambang > 1000", { ...sah, tingkat: [{ capaianPersen: 1001, tarifPersen: 2 }] }],
    [
      "ambang kembar",
      {
        ...sah,
        tingkat: [
          { capaianPersen: 100, tarifPersen: 2 },
          { capaianPersen: 100, tarifPersen: 3 },
        ],
      },
    ],
    ["tingkat terlalu banyak", { ...sah, tingkat: Array.from({ length: 11 }, (_, i) => ({ capaianPersen: 100 + i, tarifPersen: 2 })) }],
    ["bagian penagih > 100", { ...sah, bagianPenagihPersen: 101 }],
    ["perSalesman bukan objek", { ...sah, perSalesman: [] }],
    ["perSalesman nilai rusak", { ...sah, perSalesman: { u1: "2" } }],
  ])("%s → null", (_nama, isi) => {
    expect(validasiSkemaKomisi(isi)).toBeNull();
  });
});

describe("bacaAturanPeringkat", () => {
  it("bawaan menampilkan nama", () => {
    expect(ATURAN_PERINGKAT_BAWAAN).toEqual({ tampilkanNama: true });
    expect(bacaAturanPeringkat(null)).toEqual({ tampilkanNama: true });
    expect(bacaAturanPeringkat("rusak")).toEqual({ tampilkanNama: true });
    expect(bacaAturanPeringkat('{"tampilkanNama":"tidak"}')).toEqual({ tampilkanNama: true });
  });
  it("false terbaca", () => {
    expect(bacaAturanPeringkat('{"tampilkanNama":false}')).toEqual({ tampilkanNama: false });
  });
});

describe("hitungKomisi", () => {
  it("dasar TERTAGIH memakai uang tertagih, bukan omzet", () => {
    const h = hitungKomisi(masukan({ omzet: 50_000_000, tertagih: 10_000_000 }));
    expect(h.dasar).toBe("TERTAGIH");
    expect(h.dasarNilai).toBe(10_000_000);
    expect(h.tarifDipakai).toBe(1);
    expect(h.komisi).toBe(100_000);
  });

  it("dasar PENJUALAN memakai omzet", () => {
    const h = hitungKomisi(masukan({ skema: skema({ dasar: "PENJUALAN" }), omzet: 50_000_000, tertagih: 10_000_000 }));
    expect(h.dasarNilai).toBe(50_000_000);
    expect(h.komisi).toBe(500_000);
  });

  it("komisi dibulatkan ke rupiah", () => {
    const h = hitungKomisi(masukan({ skema: skema({ tarifPersen: 1.5 }), tertagih: 333_333 }));
    expect(h.komisi).toBe(5_000); // 4.999,995
  });

  it("tanpa target: capaian null, tingkat tidak berlaku, tidak ada tingkat berikut", () => {
    const h = hitungKomisi(
      masukan({ skema: skema({ tingkat: [{ capaianPersen: 100, tarifPersen: 2 }] }), omzet: 99_000_000, tertagih: 1_000_000 }),
    );
    expect(h.capaianPersen).toBeNull();
    expect(h.tarifDipakai).toBe(1);
    expect(h.tingkatBerikut).toBeNull();
  });

  const bertingkat = skema({
    tingkat: [
      { capaianPersen: 100, tarifPersen: 1.5 },
      { capaianPersen: 120, tarifPersen: 2 },
    ],
  });

  it("di bawah tingkat pertama: tarif dasar, tingkat berikut = 100% dengan kekurangan omzetnya", () => {
    const h = hitungKomisi(masukan({ skema: bertingkat, omzet: 80_000_000, tertagih: 40_000_000, target: 100_000_000 }));
    expect(h.capaianPersen).toBe(80);
    expect(h.tarifDipakai).toBe(1);
    expect(h.komisi).toBe(400_000);
    expect(h.tingkatBerikut).toEqual({ capaianPersen: 100, tarifPersen: 1.5, kurangNilai: 20_000_000 });
  });

  it("tepat di ambang: tingkat itu berlaku", () => {
    const h = hitungKomisi(masukan({ skema: bertingkat, omzet: 100_000_000, tertagih: 40_000_000, target: 100_000_000 }));
    expect(h.tarifDipakai).toBe(1.5);
    expect(h.komisi).toBe(600_000);
    expect(h.tingkatBerikut).toEqual({ capaianPersen: 120, tarifPersen: 2, kurangNilai: 20_000_000 });
  });

  it("99,6% TIDAK dibulatkan jadi 100% — tingkat belum tercapai", () => {
    const h = hitungKomisi(masukan({ skema: bertingkat, omzet: 99_600_000, target: 100_000_000 }));
    expect(h.capaianPersen).toBe(99.6);
    expect(h.tarifDipakai).toBe(1);
    expect(h.tingkatBerikut?.kurangNilai).toBe(400_000);
  });

  it("setiap tingkat membawa tanda tercapai dari perbandingan tepat", () => {
    const s = skema({ tingkat: [{ capaianPersen: 100.05, tarifPersen: 1.5 }, { capaianPersen: 120, tarifPersen: 2 }] });
    // 100,07% ditampilkan 100% (dibulatkan ke bawah) tetapi tingkat 100,05% SUDAH berlaku.
    const h = hitungKomisi(masukan({ skema: s, omzet: 100_070_000, target: 100_000_000 }));
    expect(h.capaianPersen).toBe(100);
    expect(h.tingkat.map((t) => t.tercapai)).toEqual([true, false]);
    expect(h.tarifDipakai).toBe(1.5);
    expect(hitungKomisi(masukan({ skema: s, omzet: 999, target: null })).tingkat.every((t) => !t.tercapai)).toBe(true);
  });

  it("melewati tingkat tertinggi: tarif tertinggi, tidak ada tingkat berikut", () => {
    const h = hitungKomisi(masukan({ skema: bertingkat, omzet: 150_000_000, tertagih: 10_000_000, target: 100_000_000 }));
    expect(h.capaianPersen).toBe(150);
    expect(h.tarifDipakai).toBe(2);
    expect(h.tingkatBerikut).toBeNull();
  });

  it("kekurangan dibulatkan ke atas (rupiah yang benar-benar dibutuhkan)", () => {
    const h = hitungKomisi(masukan({ skema: bertingkat, omzet: 1_000, target: 3_333 }));
    // 100% dari 3.333 = 3.333 → kurang 2.333
    expect(h.tingkatBerikut).toEqual({ capaianPersen: 100, tarifPersen: 1.5, kurangNilai: 2_333 });
    const g = hitungKomisi(
      masukan({ skema: skema({ tingkat: [{ capaianPersen: 110, tarifPersen: 2 }] }), omzet: 0, target: 1_001 }),
    );
    // 110% dari 1.001 = 1.101,1 → kurang 1.102
    expect(g.tingkatBerikut?.kurangNilai).toBe(1_102);
  });

  it("tarif khusus per salesman menggantikan tarif dasar", () => {
    const s = skema({ perSalesman: { s1: 3, s2: 0 } });
    expect(hitungKomisi(masukan({ skema: s, tertagih: 1_000_000 })).tarifDipakai).toBe(3);
    expect(hitungKomisi(masukan({ skema: s, salesmanId: "s2", tertagih: 1_000_000 })).komisi).toBe(0);
    expect(hitungKomisi(masukan({ skema: s, salesmanId: "s3", tertagih: 1_000_000 })).tarifDipakai).toBe(1);
  });

  it("tarif = yang tertinggi antara tarif dasar dan tingkat yang tercapai; tingkat yang tidak menaikkan tarif bukan 'berikut'", () => {
    const s = skema({ perSalesman: { s1: 1.8 }, tingkat: bertingkat.tingkat });
    const di100 = hitungKomisi(masukan({ skema: s, omzet: 100_000_000, target: 100_000_000 }));
    expect(di100.tarifDipakai).toBe(1.8);
    expect(di100.tingkatBerikut).toEqual({ capaianPersen: 120, tarifPersen: 2, kurangNilai: 20_000_000 });
    const di80 = hitungKomisi(masukan({ skema: s, omzet: 80_000_000, target: 100_000_000 }));
    // Tingkat 100% (1,5%) tidak menaikkan tarif 1,8% — yang dikejar adalah 120%.
    expect(di80.tingkatBerikut).toEqual({ capaianPersen: 120, tarifPersen: 2, kurangNilai: 40_000_000 });
  });

  it("skema nonaktif: komisi 0, tetapi angka dasarnya tetap terlihat", () => {
    const h = hitungKomisi(masukan({ skema: skema({ aktif: false }), tertagih: 5_000_000 }));
    expect(h.aktif).toBe(false);
    expect(h.dasarNilai).toBe(5_000_000);
    expect(h.komisi).toBe(0);
    expect(h.tingkatBerikut).toBeNull();
  });

  it("dasar negatif tidak menghasilkan komisi negatif", () => {
    expect(hitungKomisi(masukan({ tertagih: -500_000 })).komisi).toBe(0);
  });
});

describe("nilaiTunaiPorsi — uang yang benar-benar masuk untuk satu faktur", () => {
  it("tanpa potongan: sama dengan nilai yang dilunasi", () => {
    expect(nilaiTunaiPorsi(1_000_000, 1_000_000, 1_000_000)).toBe(1_000_000);
  });
  it("potongan (mis. retur) mengurangi porsi secara proporsional", () => {
    // Klaim melunasi 2 faktur (600rb + 400rb), toko memotong 200rb retur → masuk 800rb.
    expect(nilaiTunaiPorsi(600_000, 1_000_000, 800_000)).toBe(480_000);
    expect(nilaiTunaiPorsi(400_000, 1_000_000, 800_000)).toBe(320_000);
  });
  it("tidak pernah melebihi nilai yang dilunasi, tidak pernah negatif", () => {
    expect(nilaiTunaiPorsi(500_000, 500_000, 900_000)).toBe(500_000);
    expect(nilaiTunaiPorsi(500_000, 500_000, -1)).toBe(0);
  });
  it("nilai faktur klaim nol → nol", () => {
    expect(nilaiTunaiPorsi(500_000, 0, 500_000)).toBe(0);
  });
});

describe("porsiTagih — bagian penjual vs penagih", () => {
  it("penjual = penagih = saya → seluruhnya, peran SENDIRI", () => {
    expect(porsiTagih({ penjualId: "s1", penagihId: "s1", nilai: 1_000 }, "s1", 30)).toEqual({ peran: "SENDIRI", bagian: 1_000 });
  });
  it("saya penjual, orang lain menagih → dikurangi bagian penagih", () => {
    expect(porsiTagih({ penjualId: "s1", penagihId: "s2", nilai: 1_000 }, "s1", 30)).toEqual({ peran: "PENJUAL", bagian: 700 });
  });
  it("saya penagih toko orang lain → bagian penagih", () => {
    expect(porsiTagih({ penjualId: "s1", penagihId: "s2", nilai: 1_000 }, "s2", 30)).toEqual({ peran: "PENAGIH", bagian: 300 });
  });
  it("bagian penagih 0% (bawaan): penagih tidak mendapat apa pun, penjual utuh", () => {
    expect(porsiTagih({ penjualId: "s1", penagihId: "s2", nilai: 1_000 }, "s2", 0)).toBeNull();
    expect(porsiTagih({ penjualId: "s1", penagihId: "s2", nilai: 1_000 }, "s1", 0)).toEqual({ peran: "PENJUAL", bagian: 1_000 });
  });
  it("faktur tanpa penjual (impor): seluruhnya milik penagih", () => {
    expect(porsiTagih({ penjualId: null, penagihId: "s2", nilai: 1_000 }, "s2", 0)).toEqual({ peran: "TANPA_PENJUAL", bagian: 1_000 });
  });
  it("bukan urusan saya → null", () => {
    expect(porsiTagih({ penjualId: "s1", penagihId: "s2", nilai: 1_000 }, "s3", 30)).toBeNull();
  });
  it("pembulatan: bagian penjual + penagih selalu = nilai", () => {
    const b = { penjualId: "s1", penagihId: "s2", nilai: 1_001 };
    const j = porsiTagih(b, "s1", 33)!.bagian + porsiTagih(b, "s2", 33)!.bagian;
    expect(j).toBe(1_001);
  });
});

describe("ringkasTagih", () => {
  it("menjumlahkan per peran: SENDIRI/PENJUAL → penjual, PENAGIH/TANPA_PENJUAL → penagih", () => {
    const r = ringkasTagih(
      [
        { penjualId: "s1", penagihId: "s1", nilai: 1_000 },
        { penjualId: "s1", penagihId: "s2", nilai: 2_000 },
        { penjualId: "s2", penagihId: "s1", nilai: 3_000 },
        { penjualId: null, penagihId: "s1", nilai: 400 },
        { penjualId: "s3", penagihId: "s3", nilai: 9_999 },
      ],
      "s1",
      50,
    );
    expect(r).toEqual({ bagianPenjual: 2_000, bagianPenagih: 1_900, total: 3_900 });
  });
});

describe("bulan WIB", () => {
  it("rentang bulan dimulai tengah malam WIB tanggal 1 dan berakhir di awal bulan berikutnya", () => {
    const r = rentangBulanWib("2026-09")!;
    expect(r.awal.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(r.akhir.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    const d = rentangBulanWib("2026-12")!;
    expect(d.akhir.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });
  it("teks bulan rusak → null", () => {
    expect(rentangBulanWib("2026-13")).toBeNull();
    expect(rentangBulanWib("2026-9")).toBeNull();
    expect(rentangBulanWib("")).toBeNull();
  });
  it("enam bulan terakhir menurut kalender WIB, terbaru dulu, melintasi tahun", () => {
    // 1 Feb 2026 00.30 WIB = 31 Jan 17.30 UTC — sudah Februari di Jakarta.
    expect(daftarBulanTerakhir(new Date("2026-01-31T17:30:00Z"), 6)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
      "2025-10",
      "2025-09",
    ]);
  });
  it("bacaBulan: hanya bulan dari daftar, selain itu bulan pertama", () => {
    const daftar = ["2026-09", "2026-08"];
    expect(bacaBulan("2026-08", daftar)).toBe("2026-08");
    expect(bacaBulan("2025-01", daftar)).toBe("2026-09");
    expect(bacaBulan(undefined, daftar)).toBe("2026-09");
    expect(bacaBulan(["2026-08", "x"], daftar)).toBe("2026-08");
  });
});

describe("susunPeringkat", () => {
  const peserta = [
    { id: "a", nama: "Andi", omzet: 90, target: 100 },
    { id: "b", nama: "Budi", omzet: 150, target: 100 },
    { id: "c", nama: "Citra", omzet: 500, target: null },
    { id: "d", nama: "Dewi", omzet: 45, target: 50 },
    { id: "e", nama: "Eko", omzet: 700, target: 0 },
  ];

  it("yang bertarget diurutkan menurut capaian %, lalu yang tanpa target menurut omzet", () => {
    const p = susunPeringkat(peserta, "a", ATURAN_PERINGKAT_BAWAAN);
    expect(p.map((x) => x.id)).toEqual(["b", "a", "d", "e", "c"]);
    expect(p.map((x) => x.persen)).toEqual([150, 90, 90, null, null]);
    expect(p.map((x) => x.adaTarget)).toEqual([true, true, true, false, false]);
  });

  it("capaian sama → peringkat sama (1, 2, 2, 4, 5)", () => {
    const p = susunPeringkat(peserta, "a", ATURAN_PERINGKAT_BAWAAN);
    expect(p.map((x) => x.peringkat)).toEqual([1, 2, 2, 4, 5]);
    expect(p.map((x) => x.posisi)).toEqual([1, 2, 3, 4, 5]);
  });

  it("omzet hanya terlihat untuk diri sendiri; penonton ditandai", () => {
    const p = susunPeringkat(peserta, "c", ATURAN_PERINGKAT_BAWAAN);
    const saya = p.find((x) => x.diriSendiri)!;
    expect(saya.id).toBe("c");
    expect(saya.omzet).toBe(500);
    expect(p.filter((x) => !x.diriSendiri).every((x) => x.omzet === null)).toBe(true);
  });

  it("nama disembunyikan bila diatur, kecuali nama sendiri", () => {
    const p = susunPeringkat(peserta, "a", { tampilkanNama: false });
    expect(p.find((x) => x.id === "a")!.nama).toBe("Andi");
    expect(p.filter((x) => x.id !== "a").every((x) => x.nama === null)).toBe(true);
  });

  it("nama sama di urutan terakhir diurutkan menurut nama supaya stabil", () => {
    const p = susunPeringkat(
      [
        { id: "z", nama: "Zul", omzet: 0, target: null },
        { id: "y", nama: "Yan", omzet: 0, target: null },
      ],
      "z",
      ATURAN_PERINGKAT_BAWAAN,
    );
    expect(p.map((x) => x.id)).toEqual(["y", "z"]);
    expect(p.map((x) => x.peringkat)).toEqual([1, 1]);
  });
});

describe("tampilan", () => {
  it("namaBulan merakit dari kunci pesan, bukan Intl", () => {
    const t = (k: string) => `<${k}>`;
    expect(namaBulan(t, "2026-09", "panjang")).toBe("<bulanPanjang.9> 2026");
    expect(namaBulan(t, "2026-01", "pendek")).toBe("<bulanPendek.1> 2026");
  });
  it("formatPersen memakai pemisah desimal bahasanya", () => {
    expect(formatPersen(1.5, "id")).toBe("1,5");
    expect(formatPersen(1.5, "en")).toBe("1.5");
    expect(formatPersen(2, "id")).toBe("2");
  });
});
