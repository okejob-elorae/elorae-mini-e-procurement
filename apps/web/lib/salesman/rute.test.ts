import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/geo/haversine";
import {
  bacaRuteTersimpan,
  bagianGoogleMaps,
  FAKTOR_JALAN,
  geserUrutan,
  hitungRute,
  KECEPATAN_KOTA_KMJ,
  kunciSimpanRute,
  MAKS_SINGGAH_GOOGLE,
  MENIT_SINGGAH_BAWAAN,
  pecahMenit,
  perbaiki2Opt,
  pulihkanRute,
  susunRute,
  tautanArahGoogle,
  tetanggaTerdekat,
  titikSah,
  type Titik,
} from "./rute";

// Titik acuan di Yogyakarta. 0,01° lintang ≈ 1,11 km.
const POS: Titik = { lat: -7.78, lng: 110.37 };
const toko = (id: string, dLat: number | null, dLng = 0) => ({
  id,
  lat: dLat === null ? null : POS.lat + dLat,
  lng: dLat === null ? null : POS.lng + dLng,
});
const ids = (r: { langkah: { toko: { id: string } }[] }) => r.langkah.map((l) => l.toko.id);
const menitDari = (garisLurus: number) => ((garisLurus * FAKTOR_JALAN) / 1000 / KECEPATAN_KOTA_KMJ) * 60;

/** PRNG kecil berbiji — tes acak yang selalu sama setiap dijalankan. */
function acak(biji: number) {
  let s = biji >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const tokoAcak = (n: number, biji: number) => {
  const r = acak(biji);
  return Array.from({ length: n }, (_, i) => toko(`t${i}`, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2));
};

/** Jarak Euklides sederhana untuk tes tingkat indeks. */
const matriks = (titik: [number, number][]) =>
  titik.map(([ax, ay]) => titik.map(([bx, by]) => Math.hypot(ax - bx, ay - by)));
const panjang = (jalur: number[], d: number[][], kembali: boolean) => {
  let s = 0;
  for (let i = 1; i < jalur.length; i++) s += d[jalur[i - 1]][jalur[i]];
  return kembali && jalur.length > 1 ? s + d[jalur[jalur.length - 1]][jalur[0]] : s;
};

describe("titikSah", () => {
  it("koordinat biasa sah", () => {
    expect(titikSah(-7.78, 110.37)).toBe(true);
  });
  it("null, NaN, di luar batas bumi, dan 0,0 tidak sah", () => {
    expect(titikSah(null, 110)).toBe(false);
    expect(titikSah(-7, null)).toBe(false);
    expect(titikSah(Number.NaN, 110)).toBe(false);
    expect(titikSah(-91, 110)).toBe(false);
    expect(titikSah(-7, 181)).toBe(false);
    // 0,0 adalah kolom yang terisi nol, bukan toko di Teluk Guinea.
    expect(titikSah(0, 0)).toBe(false);
    expect(titikSah("-7", 110)).toBe(false);
  });
});

describe("hitungRute — urutan tetap", () => {
  it("kaki pertama dari posisi HP, lalu antar toko; total = jumlah kaki", () => {
    const a = toko("a", 0.01);
    const b = toko("b", 0.02);
    const r = hitungRute([a, b], { posisi: POS });
    expect(r.mulaiDiToko).toBe(false);
    expect(r.awal).toEqual(POS);
    expect(ids(r)).toEqual(["a", "b"]);
    const k1 = haversineMeters(POS, { lat: a.lat!, lng: a.lng! });
    const k2 = haversineMeters({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! });
    expect(r.langkah[0].garisLurusMeter).toBeCloseTo(k1, 6);
    expect(r.langkah[1].garisLurusMeter).toBeCloseTo(k2, 6);
    expect(r.langkah[0].jalanMeter).toBeCloseTo(k1 * FAKTOR_JALAN, 6);
    expect(r.langkah[0].menitTempuh).toBeCloseTo(menitDari(k1), 6);
    expect(r.total.garisLurusMeter).toBeCloseTo(k1 + k2, 6);
    expect(r.total.jalanMeter).toBeCloseTo((k1 + k2) * FAKTOR_JALAN, 6);
    expect(r.total.menitSinggah).toBe(2 * MENIT_SINGGAH_BAWAAN);
    expect(r.total.menit).toBeCloseTo(menitDari(k1 + k2) + 2 * MENIT_SINGGAH_BAWAAN, 6);
    expect(r.pulang).toBeNull();
  });

  it("perkiraan waktu: 25 km/jam atas jarak garis lurus × 1,3", () => {
    // 1 km garis lurus → 1,3 km jalan → 1,3 / 25 jam = 3,12 menit.
    expect(menitDari(1000)).toBeCloseTo(3.12, 6);
  });

  it("tanpa posisi HP, rute dimulai di toko pertama (kaki nol)", () => {
    const r = hitungRute([toko("a", 0.01), toko("b", 0.02)]);
    expect(r.mulaiDiToko).toBe(true);
    expect(r.awal).toEqual({ lat: POS.lat + 0.01, lng: POS.lng });
    expect(r.langkah[0].garisLurusMeter).toBe(0);
    expect(r.langkah[1].garisLurusMeter).toBeGreaterThan(1000);
  });

  it("posisi yang tidak sah diperlakukan seperti tidak diketahui", () => {
    const r = hitungRute([toko("a", 0.01)], { posisi: { lat: Number.NaN, lng: 110 } });
    expect(r.mulaiDiToko).toBe(true);
  });

  it("toko tanpa koordinat dipisah ke akhir, urutan masukan dipertahankan, tidak pernah dibuang", () => {
    const r = hitungRute([toko("x", null), toko("a", 0.01), { id: "nol", lat: 0, lng: 0 }, toko("b", 0.02)], {
      posisi: POS,
    });
    expect(ids(r)).toEqual(["a", "b"]);
    expect(r.tanpaKoordinat.map((t) => t.id)).toEqual(["x", "nol"]);
    // Perkiraan hanya menghitung toko yang punya titik.
    expect(r.total.menitSinggah).toBe(2 * MENIT_SINGGAH_BAWAAN);
  });

  it("kembali ke titik awal menambah kaki pulang ke total", () => {
    const a = toko("a", 0.01);
    const r = hitungRute([a], { posisi: POS, kembali: true });
    const k = haversineMeters(POS, { lat: a.lat!, lng: a.lng! });
    expect(r.pulang?.garisLurusMeter).toBeCloseTo(k, 6);
    expect(r.total.garisLurusMeter).toBeCloseTo(2 * k, 6);
  });

  it("kembali tanpa posisi pulang ke toko pertama; satu toko saja = tidak ada kaki pulang", () => {
    const dua = hitungRute([toko("a", 0.01), toko("b", 0.02)], { kembali: true });
    expect(dua.pulang?.garisLurusMeter).toBeCloseTo(dua.langkah[1].garisLurusMeter, 6);
    expect(hitungRute([toko("a", 0.01)], { kembali: true }).pulang).toBeNull();
  });

  it("menit per toko bisa diubah; nilai rusak kembali ke bawaan", () => {
    expect(hitungRute([toko("a", 0.01)], { posisi: POS, menitSinggah: 5 }).total.menitSinggah).toBe(5);
    expect(hitungRute([toko("a", 0.01)], { posisi: POS, menitSinggah: 0 }).total.menitSinggah).toBe(0);
    expect(hitungRute([toko("a", 0.01)], { posisi: POS, menitSinggah: -3 }).total.menitSinggah).toBe(MENIT_SINGGAH_BAWAAN);
    expect(hitungRute([toko("a", 0.01)], { posisi: POS, menitSinggah: Number.NaN }).total.menitSinggah).toBe(
      MENIT_SINGGAH_BAWAAN,
    );
  });

  it("toko yang sama dua kali hanya dihitung sekali (yang pertama)", () => {
    const r = hitungRute([toko("a", 0.01), toko("b", 0.02), toko("a", 0.01)], { posisi: POS });
    expect(ids(r)).toEqual(["a", "b"]);
  });

  it("kosong: nol semua, awal = posisi bila ada", () => {
    const r = hitungRute([], { posisi: POS, kembali: true });
    expect(r.langkah).toEqual([]);
    expect(r.pulang).toBeNull();
    expect(r.awal).toEqual(POS);
    expect(r.mulaiDiToko).toBe(false);
    expect(r.total).toEqual({ garisLurusMeter: 0, jalanMeter: 0, menitTempuh: 0, menitSinggah: 0, menit: 0 });
    expect(hitungRute([toko("x", null)]).awal).toBeNull();
  });
});

describe("tetanggaTerdekat", () => {
  it("mulai dari simpul 0, selalu ke yang terdekat", () => {
    const d = matriks([
      [0, 0],
      [5, 0],
      [1, 0],
      [3, 0],
    ]);
    expect(tetanggaTerdekat(d)).toEqual([0, 2, 3, 1]);
  });
  it("jarak sama: indeks yang lebih kecil dulu (stabil)", () => {
    const d = matriks([
      [0, 0],
      [1, 0],
      [-1, 0],
    ]);
    expect(tetanggaTerdekat(d)).toEqual([0, 1, 2]);
  });
  it("satu simpul atau kosong", () => {
    expect(tetanggaTerdekat([[0]])).toEqual([0]);
    expect(tetanggaTerdekat([])).toEqual([]);
  });
});

describe("perbaiki2Opt", () => {
  it("membuka persilangan; simpul awal tetap di depan", () => {
    // 0(0,0) → 1(1,1) → 2(1,0) → 3(0,1) bersilang; membalik [1,2] memendekkan.
    const d = matriks([
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    const hasil = perbaiki2Opt([0, 1, 2, 3], d, false);
    expect(hasil[0]).toBe(0);
    expect(hasil).toEqual([0, 2, 1, 3]);
    expect(panjang(hasil, d, false)).toBeLessThan(panjang([0, 1, 2, 3], d, false));
  });

  it("tidak mengubah jalur yang sudah terbaik", () => {
    const d = matriks([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(perbaiki2Opt([0, 1, 2, 3], d, false)).toEqual([0, 1, 2, 3]);
  });

  it("memperhitungkan kaki pulang bila kembali", () => {
    // Jalur terbuka 0→1→2→3 pada garis sudah terbaik; bila kembali ke 0,
    // urutan ini juga terbaik (1→2→3→0 = keliling). Hasil tetap permutasi dengan 0 di depan.
    const d = matriks([
      [0, 0],
      [2, 0],
      [1, 0],
      [3, 0],
    ]);
    const hasil = perbaiki2Opt([0, 1, 2, 3], d, true);
    expect(hasil[0]).toBe(0);
    expect([...hasil].sort()).toEqual([0, 1, 2, 3]);
    expect(panjang(hasil, d, true)).toBeLessThanOrEqual(panjang([0, 1, 2, 3], d, true) + 1e-9);
    expect(panjang(hasil, d, true)).toBeCloseTo(6, 9);
  });

  it("tidak mengubah masukannya", () => {
    const masuk = [0, 1, 2, 3];
    const d = matriks([
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    perbaiki2Opt(masuk, d, false);
    expect(masuk).toEqual([0, 1, 2, 3]);
  });
});

describe("susunRute — urutan otomatis", () => {
  it("toko segaris diurutkan dari yang terdekat ke posisi HP", () => {
    const r = susunRute([toko("c", 0.03), toko("a", 0.01), toko("d", 0.04), toko("b", 0.02)], { posisi: POS });
    expect(ids(r)).toEqual(["a", "b", "c", "d"]);
  });

  it("tanpa posisi, toko pertama masukan (paling mendesak) tetap jadi awal", () => {
    const r = susunRute([toko("c", 0.03), toko("a", 0.01), toko("d", 0.04), toko("b", 0.02)]);
    expect(r.mulaiDiToko).toBe(true);
    expect(ids(r)[0]).toBe("c");
    expect([...ids(r)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("toko tanpa koordinat tetap ada, di akhir", () => {
    const r = susunRute([toko("x", null), toko("b", 0.02), toko("a", 0.01)], { posisi: POS });
    expect(ids(r)).toEqual(["a", "b"]);
    expect(r.tanpaKoordinat.map((t) => t.id)).toEqual(["x"]);
  });

  it("deterministik: masukan sama → urutan sama", () => {
    const daftar = tokoAcak(25, 7);
    expect(ids(susunRute(daftar, { posisi: POS }))).toEqual(ids(susunRute(daftar, { posisi: POS })));
  });

  it("jarak sama dari posisi: yang lebih dulu di masukan didahulukan", () => {
    const r = susunRute([toko("timur", 0, 0.01), toko("barat", 0, -0.01)], { posisi: POS });
    expect(ids(r)[0]).toBe("timur");
    const r2 = susunRute([toko("barat", 0, -0.01), toko("timur", 0, 0.01)], { posisi: POS });
    expect(ids(r2)[0]).toBe("barat");
  });

  it("tidak pernah lebih panjang dari tetangga terdekat saja, dan tidak ada langkah 2-opt yang tersisa", () => {
    for (let biji = 1; biji <= 20; biji++) {
      for (const kembali of [false, true]) {
        const daftar = tokoAcak(12, biji);
        const r = susunRute(daftar, { posisi: POS, kembali });
        expect([...ids(r)].sort()).toEqual(daftar.map((t) => t.id).sort());

        const titik = [POS, ...daftar.map((t) => ({ lat: t.lat!, lng: t.lng! }))];
        const d = titik.map((a) => titik.map((b) => haversineMeters(a, b)));
        const nn = tetanggaTerdekat(d);
        expect(r.total.garisLurusMeter).toBeLessThanOrEqual(panjang(nn, d, kembali) + 1e-6);

        // Optimum lokal: tidak ada pembalikan potongan yang masih memendekkan.
        const jalur = [0, ...ids(r).map((id) => Number(id.slice(1)) + 1)];
        const dasar = panjang(jalur, d, kembali);
        for (let i = 1; i < jalur.length - 1; i++) {
          for (let j = i + 1; j < jalur.length; j++) {
            const coba = [...jalur.slice(0, i), ...jalur.slice(i, j + 1).reverse(), ...jalur.slice(j + 1)];
            expect(panjang(coba, d, kembali)).toBeGreaterThanOrEqual(dasar - 1e-3);
          }
        }
      }
    }
  });

  it("dekat dengan urutan terbaik untuk rute kecil (dibanding coba semua urutan)", () => {
    const permutasi = (a: number[]): number[][] =>
      a.length <= 1 ? [a] : a.flatMap((x, i) => permutasi([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
    for (let biji = 100; biji < 115; biji++) {
      const daftar = tokoAcak(7, biji);
      const titik = [POS, ...daftar.map((t) => ({ lat: t.lat!, lng: t.lng! }))];
      const d = titik.map((a) => titik.map((b) => haversineMeters(a, b)));
      const terbaik = Math.min(...permutasi([1, 2, 3, 4, 5, 6, 7]).map((p) => panjang([0, ...p], d, false)));
      const r = susunRute(daftar, { posisi: POS });
      expect(r.total.garisLurusMeter).toBeLessThanOrEqual(terbaik * 1.15);
    }
  });

  it("cepat untuk 40 toko", () => {
    const daftar = tokoAcak(40, 42);
    const mulai = performance.now();
    const r = susunRute(daftar, { posisi: POS, kembali: true });
    expect(performance.now() - mulai).toBeLessThan(250);
    expect(r.langkah).toHaveLength(40);
  });
});

describe("tautanArahGoogle", () => {
  it("merakit tautan arah gratis dengan persinggahan dipisah |", () => {
    expect(
      tautanArahGoogle({ lat: -7.78, lng: 110.37 }, { lat: -7.8, lng: 110.4 }, [
        { lat: -7.79, lng: 110.38 },
        { lat: -7.795, lng: 110.39 },
      ]),
    ).toBe(
      "https://www.google.com/maps/dir/?api=1" +
        "&origin=-7.780000%2C110.370000" +
        "&destination=-7.800000%2C110.400000" +
        "&waypoints=-7.790000%2C110.380000%7C-7.795000%2C110.390000" +
        "&travelmode=driving",
    );
  });
  it("tanpa asal: Google memakai lokasi HP; tanpa persinggahan: tidak ada waypoints", () => {
    expect(tautanArahGoogle(null, { lat: -7.8, lng: 110.4 }, [])).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-7.800000%2C110.400000&travelmode=driving",
    );
  });
});

describe("bagianGoogleMaps", () => {
  const banyak = (n: number) => Array.from({ length: n }, (_, i) => toko(`t${i + 1}`, 0.001 * (i + 1)));
  const param = (url: string, k: string) => new URL(url).searchParams.get(k);

  it("rute pendek: satu bagian dari posisi HP ke toko terakhir", () => {
    const r = hitungRute(banyak(3), { posisi: POS });
    const b = bagianGoogleMaps(r);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ nomor: 1, dari: 1, sampai: 3, pulang: false });
    expect(param(b[0].url, "origin")).toBe("-7.780000,110.370000");
    expect(param(b[0].url, "destination")).toBe(`${(POS.lat + 0.003).toFixed(6)},110.370000`);
    expect(param(b[0].url, "waypoints")?.split("|")).toHaveLength(2);
  });

  it("posisi tidak diketahui: tanpa origin, toko pertama ikut sebagai persinggahan", () => {
    const r = hitungRute(banyak(3));
    const [b] = bagianGoogleMaps(r);
    expect(param(b.url, "origin")).toBeNull();
    expect(param(b.url, "waypoints")?.split("|")).toHaveLength(2);
    expect(b).toMatchObject({ dari: 1, sampai: 3 });
  });

  it("dibagi per paling banyak 9 persinggahan; bagian berikut mulai dari tujuan bagian sebelumnya", () => {
    const r = hitungRute(banyak(25), { posisi: POS });
    const b = bagianGoogleMaps(r);
    expect(b.map((x) => [x.nomor, x.dari, x.sampai])).toEqual([
      [1, 1, 10],
      [2, 11, 20],
      [3, 21, 25],
    ]);
    for (const x of b) expect((param(x.url, "waypoints") ?? "").split("|").filter(Boolean).length).toBeLessThanOrEqual(MAKS_SINGGAH_GOOGLE);
    expect(param(b[1].url, "origin")).toBe(param(b[0].url, "destination"));
    expect(param(b[2].url, "origin")).toBe(param(b[1].url, "destination"));
  });

  it("kembali: tujuan akhir = titik awal; bagian yang isinya hanya pulang ditandai", () => {
    const r = hitungRute(banyak(10), { posisi: POS, kembali: true });
    const b = bagianGoogleMaps(r);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ dari: 1, sampai: 10, pulang: false });
    expect(b[1]).toMatchObject({ dari: null, sampai: null, pulang: true });
    expect(param(b[1].url, "destination")).toBe("-7.780000,110.370000");

    const pendek = bagianGoogleMaps(hitungRute(banyak(3), { posisi: POS, kembali: true }));
    expect(pendek).toHaveLength(1);
    expect(pendek[0]).toMatchObject({ dari: 1, sampai: 3, pulang: true });
    expect(param(pendek[0].url, "destination")).toBe("-7.780000,110.370000");
  });

  it("tanpa toko berkoordinat: tidak ada tautan", () => {
    expect(bagianGoogleMaps(hitungRute([toko("x", null)], { posisi: POS }))).toEqual([]);
  });

  it("batas persinggahan bisa diubah (mis. 3 untuk browser HP)", () => {
    const b = bagianGoogleMaps(hitungRute(banyak(8), { posisi: POS }), 3);
    expect(b.map((x) => [x.dari, x.sampai])).toEqual([
      [1, 4],
      [5, 8],
    ]);
  });
});

describe("penyimpanan per hari", () => {
  const simpan = (x: unknown) => JSON.stringify(x);

  it("kunci per pengguna", () => {
    expect(kunciSimpanRute("u1")).not.toBe(kunciSimpanRute("u2"));
  });

  it("bacaRuteTersimpan menolak teks rusak, bentuk salah, dan hari lain", () => {
    expect(bacaRuteTersimpan(null, "2026-09-30")).toBeNull();
    expect(bacaRuteTersimpan("{rusak", "2026-09-30")).toBeNull();
    expect(bacaRuteTersimpan(simpan([1, 2]), "2026-09-30")).toBeNull();
    expect(
      bacaRuteTersimpan(simpan({ tanggal: "2026-09-29", urutan: ["a"], dihapus: [], manual: false, kembali: false }), "2026-09-30"),
    ).toBeNull();
    expect(bacaRuteTersimpan(simpan({ tanggal: "2026-09-30", urutan: "a" }), "2026-09-30")).toBeNull();
  });

  it("bacaRuteTersimpan membersihkan isi yang bukan teks", () => {
    expect(
      bacaRuteTersimpan(
        simpan({ tanggal: "2026-09-30", urutan: ["a", 3, "b", "a"], dihapus: [null, "c"], manual: 1, kembali: true }),
        "2026-09-30",
      ),
    ).toEqual({ tanggal: "2026-09-30", urutan: ["a", "b"], dihapus: ["c"], manual: false, kembali: true });
  });

  it("pulihkanRute tanpa simpanan: rencana hari ini, urutan otomatis", () => {
    expect(pulihkanRute(null, ["a", "b", "zz"], ["a", "b", "c"])).toEqual({
      urutan: ["a", "b"],
      dihapus: [],
      manual: false,
      kembali: false,
    });
  });

  it("pulihkanRute dengan simpanan: pilihan Anda dipertahankan, rencana baru ditambahkan, yang dihapus tidak kembali", () => {
    const tersimpan = { tanggal: "2026-09-30", urutan: ["c", "a", "hilang"], dihapus: ["b"], manual: true, kembali: true };
    expect(pulihkanRute(tersimpan, ["a", "b", "d"], ["a", "b", "c", "d"])).toEqual({
      urutan: ["c", "a", "d"],
      dihapus: ["b"],
      manual: true,
      kembali: true,
    });
  });

  it("geserUrutan menukar dengan tetangga; di ujung atau id asing tidak berubah", () => {
    expect(geserUrutan(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(geserUrutan(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(geserUrutan(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(geserUrutan(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(geserUrutan(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("pecahMenit", () => {
  it("dibulatkan ke menit, dipecah jam dan menit", () => {
    expect(pecahMenit(0)).toEqual({ jam: 0, menit: 0 });
    expect(pecahMenit(0.3)).toEqual({ jam: 0, menit: 1 });
    expect(pecahMenit(44.4)).toEqual({ jam: 0, menit: 44 });
    expect(pecahMenit(59.6)).toEqual({ jam: 1, menit: 0 });
    expect(pecahMenit(135)).toEqual({ jam: 2, menit: 15 });
    expect(pecahMenit(Number.NaN)).toEqual({ jam: 0, menit: 0 });
  });
});
