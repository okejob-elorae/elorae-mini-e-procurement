import { dariLinear, deltaE2000, hexKeLab, keLinear, linearKeLab, type Lab } from '../palet/pantone';
import { hexKeRgb, rgbKeHex } from '../palet/warna';

/**
 * Perkiraan campuran tinta sablon.
 *
 * Model: Kubelka-Munk satu-konstanta, per kanal cahaya linear. Tinta tidak
 * bercampur seperti cahaya — kuning dan biru menjadi hijau, bukan abu-abu —
 * karena yang bertambah adalah daya serapnya. K/S tiap tinta dihitung dari
 * pantulannya, K/S campuran adalah rata-rata berbobot, lalu dikembalikan ke
 * pantulan.
 *
 * INI PERKIRAAN AWAL, BUKAN RESEP PASTI. Model satu-konstanta menganggap
 * semua tinta sama kuat menghamburkan cahaya; kenyataannya putih jauh lebih
 * kuat, jadi campuran dengan putih di dunia nyata biasanya lebih terang dari
 * perkiraan ini. Kekuatan pigmen, jenis tinta (plastisol, rubber), dan kain
 * juga tidak ikut dihitung. Hanya tiga kanal warna layar yang diketahui,
 * bukan spektrum. Pakai resepnya untuk sampel kecil, lalu sesuaikan.
 */

/**
 * Pantulan terendah yang dianggap mungkin di satu kanal: 2%.
 *
 * Layar menulis Green C tanpa merah sama sekali (R = 0), tetapi tinta di kain
 * tidak pernah menyerap 100% — permukaannya saja sudah memantulkan sekitar
 * dua persen. Batas ini BUKAN hiasan. Dengan batas 0,05% (angka sebelumnya),
 * kanal nol menjadi ribuan kali lebih kuat menyerap, dan pencari resep
 * "menemukan" hijau tua dari 85% Warm Red + 6% Green: angkanya cocok, tukang
 * sablon mana pun tahu itu mustahil. Batas 4% melemahkan tinta terlalu jauh
 * (ΔE hijau tua naik ke 9). Dua persen memberi resep yang masuk akal di
 * seluruh contoh yang diperiksa.
 *
 * Batasnya DIPETAKAN, bukan dijepit: pantulan 0–1 dipadatkan ke 0,02–1
 * sebelum menjadi K/S, lalu dibentangkan kembali sesudah dicampur. Menjepit
 * membuat tinta murni 100% tidak lagi menghasilkan warnanya sendiri (Rubine
 * Red meleset ΔE 2,1, karena kanal birunya ikut terangkat); memetakan
 * mempertahankannya persis, sambil tetap membatasi kekuatan kanal nol.
 */
const PANTUL_MIN = 0.02;

function ksDari(pantul: number): number {
  const R = PANTUL_MIN + (1 - PANTUL_MIN) * Math.min(1, Math.max(0, pantul));
  return (1 - R) ** 2 / (2 * R);
}

function pantulDari(ks: number): number {
  const R = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
  return Math.max(0, (R - PANTUL_MIN) / (1 - PANTUL_MIN));
}

function ksTinta(hex: string): [number, number, number] {
  const { r, g, b } = hexKeRgb(hex);
  return [ksDari(keLinear(r)), ksDari(keLinear(g)), ksDari(keLinear(b))];
}

function campurKs(ks: readonly (readonly [number, number, number])[], bobot: readonly number[]): [number, number, number] {
  const total = bobot.reduce((s, w) => s + w, 0);
  const hasil: [number, number, number] = [0, 0, 0];
  ks.forEach((k, i) => {
    const w = bobot[i] / total;
    hasil[0] += w * k[0];
    hasil[1] += w * k[1];
    hasil[2] += w * k[2];
  });
  return [pantulDari(hasil[0]), pantulDari(hasil[1]), pantulDari(hasil[2])];
}

/** Warna perkiraan hasil campuran. Bobot boleh skala apa saja (persen, gram, bagian). */
export function campurTinta(hexs: readonly string[], bobot: readonly number[]): string {
  const [R, G, B] = campurKs(hexs.map(ksTinta), bobot);
  return rgbKeHex(dariLinear(R), dariLinear(G), dariLinear(B));
}

export type ResepCampur = {
  /**
   * `indeks` menunjuk urutan tinta dasar yang diberikan. Urut dari yang
   * terbanyak, total 100, kelipatan 0,1.
   */
  bagian: { indeks: number; persen: number }[];
  hasilHex: string;
  /** Jarak CIEDE2000 antara hasil perkiraan dan target. */
  deltaE: number;
};

/** Semua cara membagi `total` menjadi `n` bilangan bulat positif. */
function komposisi(total: number, n: number): number[][] {
  if (n === 1) return [[total]];
  const hasil: number[][] = [];
  for (let pertama = 1; pertama <= total - (n - 1); pertama++) {
    for (const sisa of komposisi(total - pertama, n - 1)) hasil.push([pertama, ...sisa]);
  }
  return hasil;
}

function himpunanBagian(k: number, maks: number): number[][] {
  const hasil: number[][] = [];
  const jalan = (mulai: number, isi: number[]) => {
    if (isi.length > 0) hasil.push(isi);
    if (isi.length === maks) return;
    for (let i = mulai; i < k; i++) jalan(i + 1, [...isi, i]);
  };
  jalan(0, []);
  return hasil;
}

/**
 * Takaran tinta dasar yang paling mendekati target, dalam persen bulat.
 *
 * Pencarian dua tahap. Kasar: setiap himpunan tinta sampai `maksTinta`,
 * dengan langkah 10% (20% untuk empat tinta, supaya 16 tinta dasar tetap
 * terhitung cepat). Halus: enam himpunan terbaik digeser berpasangan dari 5%
 * sampai 0,1% sampai tidak membaik.
 *
 * Kenapa sampai 0,1%: warna pucat adalah putih ditambah SETETES tinta. Dengan
 * persen bulat, 1% tinta merah sudah terlalu kuat untuk 9021 C, jadi pencari
 * menyerah pada putih murni (ΔE 5,6). Di adonan 1 kg, 0,1% adalah 1 gram —
 * masih bisa ditimbang.
 *
 * Resep dengan tinta lebih sedikit didahulukan kalau selisihnya kurang dari
 * 0,5 ΔE — tidak terlihat mata, tetapi berarti satu timbangan lebih sedikit.
 */
export function resepCampur(targetHex: string, tinta: readonly string[], maksTinta = 3): ResepCampur | null {
  if (tinta.length === 0) return null;
  const target: Lab = hexKeLab(targetHex);
  const ks = tinta.map(ksTinta);

  const nilai = (indeks: readonly number[], persen: readonly number[]): number => {
    const [R, G, B] = campurKs(
      indeks.map((i) => ks[i]),
      persen,
    );
    return deltaE2000(linearKeLab(R, G, B), target);
  };

  const batas = Math.max(1, Math.min(maksTinta, 4, tinta.length));
  const kasar: { indeks: number[]; persen: number[]; skor: number }[] = [];
  const cacheKomposisi = new Map<string, number[][]>();
  for (const indeks of himpunanBagian(tinta.length, batas)) {
    const bagianPer = indeks.length >= 4 ? 5 : 10;
    const kunci = `${bagianPer}|${indeks.length}`;
    if (!cacheKomposisi.has(kunci)) cacheKomposisi.set(kunci, komposisi(bagianPer, indeks.length));
    let terbaik: { persen: number[]; skor: number } | null = null;
    // Kisi 10% tidak pernah menyentuh "putih + setetes": untuk warna pucat,
    // himpunan yang benar kalah di tahap kasar dan tidak sempat dihaluskan.
    // Maka setiap tinta juga dicoba sebagai dominan dengan tetesan 1% sisanya.
    const tetes = indeks.map((_, d) => indeks.map((__, i) => (i === d ? 100 - (indeks.length - 1) : 1)));
    for (const persen of [...cacheKomposisi.get(kunci)!.map((k) => k.map((x) => (x * 100) / bagianPer)), ...tetes]) {
      const skor = nilai(indeks, persen);
      if (!terbaik || skor < terbaik.skor) terbaik = { persen, skor };
    }
    kasar.push({ indeks, ...terbaik! });
  }
  kasar.sort((a, b) => a.skor - b.skor);

  const halus = kasar.slice(0, 6).map((calon) => {
    const persen = [...calon.persen];
    let skor = calon.skor;
    for (const langkah of [5, 2, 1, 0.5, 0.2, 0.1]) {
      let membaik = true;
      while (membaik) {
        membaik = false;
        for (let i = 0; i < persen.length; i++) {
          for (let j = 0; j < persen.length; j++) {
            if (i === j || persen[i] - langkah < 0.1 - 1e-9) continue;
            const semulaI = persen[i];
            const semulaJ = persen[j];
            // Dibulatkan ke 0,1 setiap langkah supaya galat pecahan tidak
            // menumpuk menjadi 99,70000000000002.
            persen[i] = Math.round((semulaI - langkah) * 10) / 10;
            persen[j] = Math.round((semulaJ + langkah) * 10) / 10;
            const baru = nilai(calon.indeks, persen);
            if (baru < skor - 1e-9) {
              skor = baru;
              membaik = true;
            } else {
              persen[i] = semulaI;
              persen[j] = semulaJ;
            }
          }
        }
      }
    }
    return { indeks: calon.indeks, persen, skor };
  });

  halus.sort((a, b) => a.skor - b.skor);
  const ambang = halus[0].skor + 0.5;
  const dipilih = halus
    .filter((h) => h.skor <= ambang)
    .sort((a, b) => a.indeks.length - b.indeks.length || a.skor - b.skor)[0];

  const bagian = dipilih.indeks
    .map((indeks, i) => ({ indeks, persen: dipilih.persen[i] }))
    .sort((a, b) => b.persen - a.persen || a.indeks - b.indeks);
  const hasilHex = campurTinta(
    bagian.map((b) => tinta[b.indeks]),
    bagian.map((b) => b.persen),
  );
  return { bagian, hasilHex, deltaE: deltaE2000(hexKeLab(hasilHex), target) };
}

/**
 * Persen → gram untuk satu adonan, dibulatkan per gram dengan sisa terbesar,
 * supaya jumlahnya tepat sama dengan berat yang diminta. Pembulatan biasa bisa
 * membuat 1.000 g menjadi 999 g atau 1.001 g, dan penimbang mengira salah hitung.
 */
export function bagiGram(berat: number, persen: readonly number[]): number[] {
  const total = persen.reduce((s, p) => s + p, 0);
  if (total <= 0 || berat <= 0) return persen.map(() => 0);
  const utuh = Math.round(berat);
  const mentah = persen.map((p) => (utuh * p) / total);
  const hasil = mentah.map(Math.floor);
  let sisa = utuh - hasil.reduce((s, g) => s + g, 0);
  const urut = mentah.map((m, i) => ({ i, pecahan: m - Math.floor(m) })).sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  for (const { i } of urut) {
    if (sisa <= 0) break;
    hasil[i] += 1;
    sisa -= 1;
  }
  return hasil;
}
