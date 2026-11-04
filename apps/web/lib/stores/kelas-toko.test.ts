import { describe, expect, it } from "vitest";
import { susunRencanaDenganMenurun, type TokoMenurun } from "@/lib/salesman/toko-menurun";
import type { TokoRencana } from "@/lib/salesman/dasbor";
import {
  ATURAN_KELAS_BAWAAN,
  bacaAturanKelasToko,
  bacaKelas,
  batasDariPersen,
  jarakKunjungan,
  perubahanUsulan,
  persenDariBatas,
  susunRencanaPerKelas,
  usulanPerJenis,
  usulkanKelas,
  type AturanKelasToko,
} from "./kelas-toko";

describe("bacaKelas", () => {
  it("menerima A/B/C, tahan spasi dan huruf kecil", () => {
    expect(bacaKelas("A")).toBe("A");
    expect(bacaKelas(" b ")).toBe("B");
    expect(bacaKelas("c")).toBe("C");
  });
  it("selain itu → null", () => {
    expect(bacaKelas("D")).toBeNull();
    expect(bacaKelas("")).toBeNull();
    expect(bacaKelas(null)).toBeNull();
    expect(bacaKelas(undefined)).toBeNull();
    expect(bacaKelas(1)).toBeNull();
    expect(bacaKelas("AB")).toBeNull();
  });
});

describe("bacaAturanKelasToko", () => {
  it("kosong atau rusak → bawaan", () => {
    expect(bacaAturanKelasToko(null)).toEqual(ATURAN_KELAS_BAWAAN);
    expect(bacaAturanKelasToko("")).toEqual(ATURAN_KELAS_BAWAAN);
    expect(bacaAturanKelasToko("{bukan json")).toEqual(ATURAN_KELAS_BAWAAN);
    expect(bacaAturanKelasToko("[1,2]")).toEqual(ATURAN_KELAS_BAWAAN);
    expect(bacaAturanKelasToko("7")).toEqual(ATURAN_KELAS_BAWAAN);
  });

  it("bawaan: A 7, B 14, C 30 hari; otomatis mati, persentil 80/50", () => {
    expect(ATURAN_KELAS_BAWAAN).toEqual({
      jarakHari: { A: 7, B: 14, C: 30 },
      otomatis: { aktif: false, batasA: 80, batasB: 50 },
    });
  });

  it("nilai sah dibaca apa adanya", () => {
    const x: AturanKelasToko = {
      jarakHari: { A: 5, B: 10, C: 60 },
      otomatis: { aktif: true, batasA: 90, batasB: 60 },
    };
    expect(bacaAturanKelasToko(JSON.stringify(x))).toEqual(x);
  });

  it("jarak rusak jatuh ke bawaan PER KELAS, kelas lain tetap", () => {
    const x = { jarakHari: { A: 0, B: 21, C: "30" }, otomatis: { aktif: true, batasA: 80, batasB: 50 } };
    expect(bacaAturanKelasToko(JSON.stringify(x)).jarakHari).toEqual({ A: 7, B: 21, C: 30 });
    const y = { jarakHari: { A: 2.5, B: 400, C: 45 } };
    expect(bacaAturanKelasToko(JSON.stringify(y)).jarakHari).toEqual({ A: 7, B: 14, C: 45 });
  });

  it("aktif bukan boolean → mati", () => {
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { aktif: "ya" } })).otomatis.aktif).toBe(false);
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { aktif: 1 } })).otomatis.aktif).toBe(false);
  });

  it("batas persentil rusak per kolom, lalu pasangan yang bertabrakan kembali ke bawaan", () => {
    // batasB rusak → 50; batasA 70 masih di atasnya → dipakai.
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { batasA: 70, batasB: 120 } })).otomatis).toMatchObject({
      batasA: 70,
      batasB: 50,
    });
    // A harus di atas B; kalau tidak keduanya kembali ke bawaan.
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { batasA: 40, batasB: 60 } })).otomatis).toMatchObject({
      batasA: 80,
      batasB: 50,
    });
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { batasA: 30 } })).otomatis).toMatchObject({
      batasA: 80,
      batasB: 50,
    });
    expect(bacaAturanKelasToko(JSON.stringify({ otomatis: { batasA: 0, batasB: 0 } })).otomatis).toMatchObject({
      batasA: 80,
      batasB: 50,
    });
  });
});

describe("jarakKunjungan", () => {
  const aturan = ATURAN_KELAS_BAWAAN;
  it("toko berkelas memakai jarak kelasnya", () => {
    expect(jarakKunjungan({ storeClass: "A" }, aturan, 14)).toBe(7);
    expect(jarakKunjungan({ storeClass: "B" }, aturan, 21)).toBe(14);
    expect(jarakKunjungan({ storeClass: "C" }, aturan, 14)).toBe(30);
  });
  it("tanpa kelas (atau kelas tak dikenal) → batas umum", () => {
    expect(jarakKunjungan({ storeClass: null }, aturan, 21)).toBe(21);
    expect(jarakKunjungan({}, aturan, 10)).toBe(10);
    expect(jarakKunjungan({ storeClass: "Z" }, aturan, 12)).toBe(12);
  });
});

describe("persen ⇄ batas", () => {
  it("bawaan: A 20% teratas, B 30% berikutnya, C sisanya", () => {
    expect(persenDariBatas(ATURAN_KELAS_BAWAAN.otomatis)).toEqual({ A: 20, B: 30, C: 50 });
    expect(batasDariPersen(20, 30)).toEqual({ batasA: 80, batasB: 50 });
    expect(batasDariPersen(10, 40)).toEqual({ batasA: 90, batasB: 50 });
  });
});

describe("usulkanKelas", () => {
  it("20% teratas A, 30% berikutnya B, sisanya C", () => {
    const nilai = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i + 1}`, (i + 1) * 1_000_000]));
    const u = usulkanKelas(nilai);
    expect([u.t10, u.t9]).toEqual(["A", "A"]);
    expect([u.t8, u.t7, u.t6]).toEqual(["B", "B", "B"]);
    expect([u.t5, u.t4, u.t3, u.t2, u.t1]).toEqual(["C", "C", "C", "C", "C"]);
  });

  it("toko tanpa pembelian tetap tanpa kelas dan tidak ikut dihitung", () => {
    const u = usulkanKelas({ a: 0, b: -5, c: Number.NaN, d: 100, e: 50 });
    expect(u.a).toBeNull();
    expect(u.b).toBeNull();
    expect(u.c).toBeNull();
    // Populasinya hanya d dan e.
    expect(u.d).toBe("B");
    expect(u.e).toBe("C");
  });

  it("nilai sama → kelas sama", () => {
    const u = usulkanKelas({ a: 10, b: 10, c: 10, d: 10 });
    expect(new Set(Object.values(u)).size).toBe(1);
  });

  it("peta kosong → kosong", () => {
    expect(usulkanKelas({})).toEqual({});
  });

  it("batas bisa diatur", () => {
    const nilai = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i + 1}`, i + 1]));
    const u = usulkanKelas(nilai, { batasA: 60, batasB: 20 });
    expect(Object.values(u).filter((k) => k === "A")).toHaveLength(4);
    expect(Object.values(u).filter((k) => k === "B")).toHaveLength(4);
    expect(Object.values(u).filter((k) => k === "C")).toHaveLength(2);
  });

  it("menerima Map juga", () => {
    const u = usulkanKelas(new Map([["x", 5]]));
    expect(u).toEqual({ x: "B" });
  });
});

describe("usulanPerJenis", () => {
  it("putus diperingkat dengan rupiah, konsinyasi dengan potong — terpisah", () => {
    const hasil = usulanPerJenis(
      [
        { storeId: "p1", termsType: "PUTUS", rupiah: 10_000_000, potong: 0 },
        { storeId: "p2", termsType: "PUTUS", rupiah: 1_000_000, potong: 500 },
        { storeId: "k1", termsType: "KONSI", rupiah: 0, potong: 300 },
        { storeId: "k2", termsType: "KONSI", rupiah: 99_000_000, potong: 20 },
        { storeId: "k3", termsType: "KONSI", rupiah: 0, potong: 0 },
      ],
      ATURAN_KELAS_BAWAAN.otomatis,
    );
    expect(hasil.p1).toEqual({ nilai: 10_000_000, satuan: "RUPIAH", usulan: "B" });
    expect(hasil.p2).toEqual({ nilai: 1_000_000, satuan: "RUPIAH", usulan: "C" });
    // Rupiah konsinyasi diabaikan: k1 lebih banyak potongnya.
    expect(hasil.k1).toEqual({ nilai: 300, satuan: "POTONG", usulan: "B" });
    expect(hasil.k2).toEqual({ nilai: 20, satuan: "POTONG", usulan: "C" });
    expect(hasil.k3).toEqual({ nilai: 0, satuan: "POTONG", usulan: null });
  });
});

describe("perubahanUsulan", () => {
  const daftar = [
    { storeId: "naik", kelas: "C" as const, usulan: "A" as const },
    { storeId: "baru", kelas: null, usulan: "B" as const },
    { storeId: "sama", kelas: "B" as const, usulan: "B" as const },
    { storeId: "tanpaBeli", kelas: "A" as const, usulan: null },
    { storeId: "takDipilih", kelas: null, usulan: "C" as const },
  ];

  it("hanya toko terpilih yang usulannya ada dan berbeda", () => {
    expect(perubahanUsulan(daftar, ["naik", "baru", "sama", "tanpaBeli", "hantu"])).toEqual([
      { storeId: "naik", dari: "C", ke: "A" },
      { storeId: "baru", dari: null, ke: "B" },
    ]);
  });

  it("toko tanpa pembelian tidak pernah dikosongkan kelasnya", () => {
    expect(perubahanUsulan(daftar, ["tanpaBeli"])).toEqual([]);
  });

  it("pilihan ganda dihitung sekali", () => {
    expect(perubahanUsulan(daftar, ["baru", "baru"])).toHaveLength(1);
  });
});

// ─── Rencana kunjungan per kelas ─────────────────────────────────────────────

const HARI_INI = new Date("2026-09-30T03:00:00Z"); // 10.00 WIB
const hariLalu = (n: number) => new Date(HARI_INI.getTime() - n * 86_400_000);

function toko(storeId: string, x: Partial<TokoRencana> & { jarakHari?: number | null } = {}) {
  return {
    storeId,
    nama: storeId,
    kunjunganTerakhir: null,
    tagih: false,
    sisaTagihan: 0,
    lat: null,
    lng: null,
    ...x,
  };
}

const menurunUntuk = (storeId: string): TokoMenurun => ({
  storeId,
  nama: storeId,
  alasan: "JARANG",
  hariSejakTerakhir: 40,
  jarakBiasa: 10,
  nilai90: null,
  nilai90Sebelumnya: null,
});

describe("susunRencanaPerKelas", () => {
  it("setiap toko dinilai dengan jaraknya sendiri", () => {
    const hasil = susunRencanaPerKelas(
      [
        toko("A-lewat", { jarakHari: 7, kunjunganTerakhir: hariLalu(8) }),
        toko("A-belum", { jarakHari: 7, kunjunganTerakhir: hariLalu(5) }),
        toko("C-belum", { jarakHari: 30, kunjunganTerakhir: hariLalu(20) }),
        toko("C-lewat", { jarakHari: 30, kunjunganTerakhir: hariLalu(31) }),
        toko("umum-lewat", { kunjunganTerakhir: hariLalu(15) }),
        toko("umum-belum", { jarakHari: null, kunjunganTerakhir: hariLalu(10) }),
      ],
      [],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(hasil.map((b) => b.storeId).sort()).toEqual(["A-lewat", "C-lewat", "umum-lewat"]);
    expect(hasil.find((b) => b.storeId === "A-lewat")?.jarakHari).toBe(7);
    expect(hasil.find((b) => b.storeId === "umum-lewat")?.jarakHari).toBe(14);
  });

  it("tepat di batas sudah jatuh tempo; belum pernah dikunjungi selalu masuk", () => {
    const hasil = susunRencanaPerKelas(
      [toko("pas", { jarakHari: 7, kunjunganTerakhir: hariLalu(7) }), toko("baru", { jarakHari: 30 })],
      [],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(hasil.map((b) => [b.storeId, b.alasan])).toEqual([
      ["baru", ["lama"]],
      ["pas", ["lama"]],
    ]);
  });

  it("tagihan tetap masuk walau belum waktunya dikunjungi — tanpa alasan 'lama'", () => {
    const hasil = susunRencanaPerKelas(
      [toko("tagih", { jarakHari: 30, kunjunganTerakhir: hariLalu(2), tagih: true, sisaTagihan: 500_000 })],
      [],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].alasan).toEqual(["tagih"]);
  });

  it("toko menurun tetap masuk walau belum waktunya dikunjungi", () => {
    const hasil = susunRencanaPerKelas(
      [toko("turun", { jarakHari: 30, kunjunganTerakhir: hariLalu(3) }), toko("biasa", { jarakHari: 30, kunjunganTerakhir: hariLalu(3) })],
      [menurunUntuk("turun")],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(hasil.map((b) => b.storeId)).toEqual(["turun"]);
    expect(hasil[0].alasan).toEqual([]);
    expect(hasil[0].menurun?.storeId).toBe("turun");
  });

  it("tanpa kelas sama sekali, hasilnya persis rencana lama", () => {
    const daftar = [
      toko("t1", { kunjunganTerakhir: hariLalu(20), lat: -6.9, lng: 107.6 }),
      toko("t2", { kunjunganTerakhir: hariLalu(3), tagih: true, sisaTagihan: 2_000_000 }),
      toko("t3", { kunjunganTerakhir: hariLalu(2) }),
      toko("t4"),
      toko("t5", { kunjunganTerakhir: hariLalu(40), tagih: true, sisaTagihan: 100 }),
      toko("t6", { kunjunganTerakhir: hariLalu(1) }),
    ];
    const menurun = [menurunUntuk("t6"), menurunUntuk("t1")];
    for (const posisi of [null, { lat: -6.91, lng: 107.61 }]) {
      const opsi = { batasHari: 14, hariIni: HARI_INI, posisi };
      const lama = susunRencanaDenganMenurun(daftar, menurun, opsi);
      const baru = susunRencanaPerKelas(daftar, menurun, opsi);
      const ringkas = (b: { storeId: string; alasan: string[]; hariSejak: number | null; menurun: TokoMenurun | null }) => [
        b.storeId,
        b.alasan,
        b.hariSejak,
        b.menurun?.storeId ?? null,
      ];
      expect(baru.map(ringkas)).toEqual(lama.map(ringkas));
    }
  });

  it("kolom tambahan toko (kelas) ikut terbawa", () => {
    const hasil = susunRencanaPerKelas([{ ...toko("x", { jarakHari: 7 }), kelas: "A" as const }], [], {
      batasHari: 14,
      hariIni: HARI_INI,
    });
    expect(hasil[0].kelas).toBe("A");
  });
});
