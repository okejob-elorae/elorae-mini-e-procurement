/**
 * Penyandi Code 128 — murni, tanpa dependensi, aman di klien dan di server.
 *
 * Dipakai untuk label barcode barang: kode kita (barcode varian dari templat,
 * SKU varian, SKU barang) berisi huruf dan tanda hubung, jadi EAN-13 (angka
 * saja) tidak bisa. Code 128 dibaca pemindai Bluetooth/USB mana pun dan
 * pembaca kamera di HP SPG (`lib/barcode/detektor.ts` memasukkan `code_128`).
 *
 * Yang didukung: karakter ASCII yang bisa dicetak (spasi sampai `~`, 32–126),
 * lewat set B. Deret angka panjang dipadatkan dengan set C (dua angka per
 * simbol) memakai aturan ISO/IEC 15417 Lampiran E:
 *   - mulai di set C bila data diawali ≥ 4 angka, atau datanya tepat 2 angka;
 *   - di set B, pindah ke set C bila ada ≥ 4 angka di AKHIR data, atau ≥ 6
 *     angka di tengah; deret ganjil menyandikan angka pertamanya di set B dulu;
 *   - di set C, kembali ke set B begitu tersisa < 2 angka berturut-turut.
 * Karakter kendali (0–31, 127) dan karakter di luar ASCII (é, emoji) DITOLAK —
 * label tidak pernah membutuhkannya, dan diam-diam membuangnya menghasilkan
 * batang yang membaca kode lain.
 *
 * Checksum: (nilai start + Σ posisi × nilai simbol) mod 103, posisi mulai 1.
 * Setiap simbol 11 modul (3 batang + 3 celah), stop 13 modul. Zona tenang
 * (bawaan 10 modul di kiri dan kanan) wajib kosong agar pemindai menemukan
 * awal dan akhir kode — `svgCode128` menyertakannya.
 */

/** Lebar 6 elemen (batang, celah, batang, celah, batang, celah) per nilai 0–105; 106 = stop (7 elemen). */
export const POLA_CODE128: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Pindah ke set C (dari set B). */
export const CODE128_KE_C = 99;
/** Pindah ke set B (dari set C). */
export const CODE128_KE_B = 100;
export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
export const CODE128_STOP = 106;

/** Zona tenang minimum menurut standar: 10 kali lebar modul, di kiri dan kanan. */
export const ZONA_TENANG_MODUL = 10;
/** Batas praktis panjang kode; label kita tidak pernah sepanjang ini. */
export const MAKS_PANJANG_CODE128 = 80;

export type AlasanTolakCode128 = "KOSONG" | "KARAKTER_TIDAK_DIDUKUNG" | "TERLALU_PANJANG";

export class GalatCode128 extends Error {
  constructor(
    readonly alasan: AlasanTolakCode128,
    /** Posisi (0-based) karakter pertama yang ditolak, untuk `KARAKTER_TIDAK_DIDUKUNG`. */
    readonly posisi: number | null = null,
  ) {
    super(
      alasan === "KOSONG"
        ? "Kode kosong"
        : alasan === "TERLALU_PANJANG"
          ? `Kode lebih dari ${MAKS_PANJANG_CODE128} karakter`
          : `Karakter ke-${(posisi ?? 0) + 1} tidak bisa disandikan Code 128 (hanya ASCII 32–126)`,
    );
    this.name = "GalatCode128";
  }
}

const bisaDicetak = (c: number) => c >= 32 && c <= 126;
const adalahAngka = (c: number) => c >= 48 && c <= 57;

/** Alasan kode tidak bisa disandikan; null = bisa. Tidak melempar. */
export function periksaCode128(teks: string): AlasanTolakCode128 | null {
  if (teks.length === 0) return "KOSONG";
  if (teks.length > MAKS_PANJANG_CODE128) return "TERLALU_PANJANG";
  for (let i = 0; i < teks.length; i++) if (!bisaDicetak(teks.charCodeAt(i))) return "KARAKTER_TIDAK_DIDUKUNG";
  return null;
}

function kodeKarakter(teks: string): number[] {
  if (teks.length === 0) throw new GalatCode128("KOSONG");
  if (teks.length > MAKS_PANJANG_CODE128) throw new GalatCode128("TERLALU_PANJANG");
  const hasil: number[] = [];
  for (let i = 0; i < teks.length; i++) {
    const c = teks.charCodeAt(i);
    if (!bisaDicetak(c)) throw new GalatCode128("KARAKTER_TIDAK_DIDUKUNG", i);
    hasil.push(c);
  }
  return hasil;
}

function deretAngka(k: readonly number[], dari: number): number {
  let n = 0;
  while (dari + n < k.length && adalahAngka(k[dari + n])) n++;
  return n;
}

/** Nilai simbol data, diawali simbol start; TANPA checksum dan stop. */
function nilaiData(k: readonly number[]): number[] {
  const awal = deretAngka(k, 0);
  let set: "B" | "C" = awal >= 4 || (awal === 2 && k.length === 2) ? "C" : "B";
  const nilai: number[] = [set === "C" ? CODE128_START_C : CODE128_START_B];
  let i = 0;
  while (i < k.length) {
    if (set === "C") {
      if (deretAngka(k, i) >= 2) {
        nilai.push((k[i] - 48) * 10 + (k[i + 1] - 48));
        i += 2;
      } else {
        nilai.push(CODE128_KE_B);
        set = "B";
      }
      continue;
    }
    const deret = deretAngka(k, i);
    if ((deret >= 4 && i + deret === k.length) || deret >= 6) {
      // Deret ganjil: angka pertama tetap di set B, sisanya berpasangan.
      if (deret % 2 === 1) {
        nilai.push(k[i] - 32);
        i += 1;
      }
      nilai.push(CODE128_KE_C);
      set = "C";
      continue;
    }
    nilai.push(k[i] - 32);
    i += 1;
  }
  return nilai;
}

/** Checksum mod 103 atas simbol start + data (posisi start berbobot 1, data mulai bobot 1). */
export function checksumCode128(nilaiStartDanData: readonly number[]): number {
  let jumlah = nilaiStartDanData[0] ?? 0;
  for (let i = 1; i < nilaiStartDanData.length; i++) jumlah += i * nilaiStartDanData[i];
  return jumlah % 103;
}

export type HasilCode128 = {
  /** Start, data, checksum, stop — urutan simbol yang dicetak. */
  simbol: number[];
  checksum: number;
  /** Lebar elemen bergantian batang/celah dalam modul, mulai dari batang, termasuk stop. */
  lebar: number[];
  /** Jumlah modul tanpa zona tenang. */
  modul: number;
};

/** Sandikan teks; melempar `GalatCode128` bila tidak bisa. */
export function sandikanCode128(teks: string): HasilCode128 {
  const data = nilaiData(kodeKarakter(teks));
  const checksum = checksumCode128(data);
  const simbol = [...data, checksum, CODE128_STOP];
  const lebar = simbol.flatMap((s) => POLA_CODE128[s].split("").map(Number));
  return { simbol, checksum, lebar, modul: lebar.reduce((a, b) => a + b, 0) };
}

/** Lebar kode dalam modul TERMASUK zona tenang di kedua sisi; null bila tidak bisa disandikan. */
export function jumlahModulCode128(teks: string, zonaTenang = ZONA_TENANG_MODUL): number | null {
  if (periksaCode128(teks) !== null) return null;
  return sandikanCode128(teks).modul + 2 * zonaTenang;
}

const escAtribut = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * SVG batang (hitam di atas latar transparan) dengan zona tenang. Koordinatnya
 * dalam modul dan `preserveAspectRatio="none"`, jadi ukuran fisiknya diatur
 * CSS pemanggil (lebar & tinggi kotak penampungnya) — semua modul tetap sama
 * lebar. Satu `<path>` per kode supaya lembar berisi ribuan label tetap ringan.
 * Melempar `GalatCode128` bila tidak bisa disandikan.
 */
export function svgCode128(teks: string, opsi: { zonaTenang?: number; kelas?: string } = {}): string {
  const { lebar, modul } = sandikanCode128(teks);
  const z = opsi.zonaTenang ?? ZONA_TENANG_MODUL;
  const tinggi = 10;
  let x = z;
  let d = "";
  lebar.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x} 0h${w}v${tinggi}h-${w}z`;
    x += w;
  });
  const kelas = opsi.kelas ? ` class="${escAtribut(opsi.kelas)}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${kelas} viewBox="0 0 ${modul + 2 * z} ${tinggi}" preserveAspectRatio="none"` +
    ` shape-rendering="crispEdges" role="img" aria-label="${escAtribut(teks)}"><path d="${d}" fill="#000"/></svg>`
  );
}
