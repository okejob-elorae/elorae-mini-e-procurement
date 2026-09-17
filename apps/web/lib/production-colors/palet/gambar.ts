import { dariLinear, deltaE2000, keLinear, linearKeLab, type Lab } from './pantone';
import { rgbKeHex } from './warna';

/**
 * Mengambil warna dari gambar — screenshot desain, foto kain, moodboard.
 *
 * Semua hitungan berjalan di peramban atas piksel kanvas; gambarnya tidak
 * pernah dikirim ke server.
 */

/** Paling banyak sekian piksel yang dikelompokkan. Screenshot 4K berisi 8 juta; 24 ribu sampel sudah stabil. */
const SAMPEL_MAKS = 24_000;
const ITERASI = 14;
/** Dua kelompok yang pusatnya lebih dekat dari ini digabung — di bawah ~5 hampir tak terbedakan mata. */
const DE_GABUNG = 5;

/** PRNG kecil deterministik: gambar yang sama harus memberi tebakan yang sama. */
function acakBerbenih(benih: number) {
  let s = benih >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function jarakKuadrat(a: Lab, b: Lab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export type WarnaDominan = {
  hex: string;
  /** Bagian dari piksel tampak, 0–1. */
  bagian: number;
};

/**
 * Warna dominan gambar, dengan k-means di ruang Lab.
 *
 * Pengelompokan di Lab karena jaraknya mendekati mata; warna tiap kelompok
 * adalah RATA-RATA pikselnya dalam cahaya linear, bukan pusat Lab-nya yang
 * dibalik dan bukan kisi yang dibulatkan — jadi warna rata di gambar kembali
 * persis. Pusat awal dipilih k-means++ dengan benih tetap. Kelompok yang
 * nyaris sama digabung, jadi hasilnya bisa lebih sedikit dari yang diminta.
 */
export function warnaDominan(piksel: Uint8ClampedArray, opsi: { jumlah: number }): WarnaDominan[] {
  const tampak = Math.floor(piksel.length / 4);
  const langkah = Math.max(1, Math.floor(tampak / SAMPEL_MAKS));

  const lin: [number, number, number][] = [];
  const lab: Lab[] = [];
  const tabel = new Float64Array(256);
  for (let i = 0; i < 256; i++) tabel[i] = keLinear(i);
  for (let p = 0; p < tampak; p += langkah) {
    const i = p * 4;
    if (piksel[i + 3] < 128) continue;
    const R = tabel[piksel[i]];
    const G = tabel[piksel[i + 1]];
    const B = tabel[piksel[i + 2]];
    lin.push([R, G, B]);
    lab.push(linearKeLab(R, G, B));
  }
  const n = lab.length;
  if (n === 0) return [];
  const k = Math.max(1, Math.min(opsi.jumlah, n));

  // k-means++: pusat berikutnya dipilih sebanding jarak kuadrat ke pusat terdekat.
  const acak = acakBerbenih(n * 2654435761 + k);
  const pusat: Lab[] = [lab[Math.floor(acak() * n)]];
  const jarakMin = lab.map((x) => jarakKuadrat(x, pusat[0]));
  while (pusat.length < k) {
    const total = jarakMin.reduce((s, d) => s + d, 0);
    if (total === 0) break;
    let sasaran = acak() * total;
    let pilih = n - 1;
    for (let i = 0; i < n; i++) {
      sasaran -= jarakMin[i];
      if (sasaran <= 0) {
        pilih = i;
        break;
      }
    }
    pusat.push(lab[pilih]);
    for (let i = 0; i < n; i++) jarakMin[i] = Math.min(jarakMin[i], jarakKuadrat(lab[i], lab[pilih]));
  }

  const anggota = new Int32Array(n);
  for (let iterasi = 0; iterasi < ITERASI; iterasi++) {
    let berubah = false;
    for (let i = 0; i < n; i++) {
      let terbaik = 0;
      let dTerbaik = Infinity;
      for (let c = 0; c < pusat.length; c++) {
        const d = jarakKuadrat(lab[i], pusat[c]);
        if (d < dTerbaik) {
          dTerbaik = d;
          terbaik = c;
        }
      }
      if (anggota[i] !== terbaik || iterasi === 0) {
        berubah = berubah || anggota[i] !== terbaik;
        anggota[i] = terbaik;
      }
    }
    const jumlahLab = pusat.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = jumlahLab[anggota[i]];
      s[0] += lab[i][0];
      s[1] += lab[i][1];
      s[2] += lab[i][2];
      s[3] += 1;
    }
    for (let c = 0; c < pusat.length; c++) {
      const s = jumlahLab[c];
      if (s[3] > 0) pusat[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
    if (!berubah && iterasi > 0) break;
  }

  // Rata-rata cahaya linear per kelompok → warna yang benar-benar ada di gambar.
  let kelompok = pusat.map(() => ({ R: 0, G: 0, B: 0, n: 0 }));
  for (let i = 0; i < n; i++) {
    const g = kelompok[anggota[i]];
    g.R += lin[i][0];
    g.G += lin[i][1];
    g.B += lin[i][2];
    g.n += 1;
  }
  kelompok = kelompok.filter((g) => g.n > 0).sort((a, b) => b.n - a.n);

  // Gabungkan kelompok yang nyaris sama ke kelompok yang lebih besar.
  const gabungan: { R: number; G: number; B: number; n: number }[] = [];
  for (const g of kelompok) {
    const labG = linearKeLab(g.R / g.n, g.G / g.n, g.B / g.n);
    const induk = gabungan.find((h) => deltaE2000(linearKeLab(h.R / h.n, h.G / h.n, h.B / h.n), labG) < DE_GABUNG);
    if (induk) {
      induk.R += g.R;
      induk.G += g.G;
      induk.B += g.B;
      induk.n += g.n;
    } else {
      gabungan.push({ ...g });
    }
  }

  return gabungan
    .sort((a, b) => b.n - a.n)
    .map((g) => ({
      hex: rgbKeHex(dariLinear(g.R / g.n), dariLinear(g.G / g.n), dariLinear(g.B / g.n)),
      bagian: g.n / n,
    }));
}

/**
 * Warna di satu titik, dirata-ratakan dalam jendela (2r+1)² di cahaya linear.
 * Satu piksel screenshot atau foto bisa berupa derau kompresi; jendela kecil
 * memberi warna yang dilihat mata di titik itu.
 */
export function ambilWarnaTitik(
  piksel: Uint8ClampedArray,
  lebar: number,
  tinggi: number,
  x: number,
  y: number,
  jariJari: number,
): string {
  let R = 0;
  let G = 0;
  let B = 0;
  let n = 0;
  const cx = Math.min(lebar - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(tinggi - 1, Math.max(0, Math.round(y)));
  for (let yy = Math.max(0, cy - jariJari); yy <= Math.min(tinggi - 1, cy + jariJari); yy++) {
    for (let xx = Math.max(0, cx - jariJari); xx <= Math.min(lebar - 1, cx + jariJari); xx++) {
      const i = (yy * lebar + xx) * 4;
      if (piksel[i + 3] < 128) continue;
      R += keLinear(piksel[i]);
      G += keLinear(piksel[i + 1]);
      B += keLinear(piksel[i + 2]);
      n += 1;
    }
  }
  if (n === 0) return '#000000';
  return rgbKeHex(dariLinear(R / n), dariLinear(G / n), dariLinear(B / n));
}

/**
 * Bagian gambar (0–1, atau bobot apa saja) → porsi persen bulat berjumlah
 * tepat 100, dengan sisa terbesar. Warna yang ada di gambar mendapat minimal
 * 1% — porsi 0% untuk warna yang sengaja dipakai hanya membingungkan.
 */
export function porsiDariBagian(bagian: readonly number[]): number[] {
  const total = bagian.reduce((s, x) => s + x, 0);
  if (bagian.length === 0 || total <= 0) return bagian.map(() => 0);
  const mentah = bagian.map((x) => (x / total) * 100);
  const hasil = mentah.map(Math.floor);
  let kurang = 100 - hasil.reduce((s, x) => s + x, 0);
  const urut = mentah.map((m, i) => ({ i, pecahan: m - Math.floor(m) })).sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  for (const { i } of urut) {
    if (kurang <= 0) break;
    hasil[i] += 1;
    kurang -= 1;
  }
  // Baru sesudah dibagi rata, warna yang jatuh ke 0% diangkat ke 1% dengan
  // mengambil dari porsi terbesar. Menyisihkan 1% di depan menggeser SEMUA
  // porsi: 60/30/10 menjadi 59/30/11.
  bagian.forEach((x, i) => {
    if (x > 0 && hasil[i] === 0) {
      const terbesar = hasil.indexOf(Math.max(...hasil));
      hasil[terbesar] -= 1;
      hasil[i] = 1;
    }
  });
  return hasil;
}
