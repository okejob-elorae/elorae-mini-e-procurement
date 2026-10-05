/**
 * Bantuan — penjelasan setiap halaman, DIKELUARKAN dari layar (keputusan
 * pemilik 2026-10-05: "saya tidak suka banyak keterangan … masukkan ke dalam
 * sidebar seperti wikipedia sehingga bisa saya check sendiri, namun tidak
 * tampil di UI").
 *
 * Satu entri per rute. Ikon ⓘ di samping judul halaman membuka entri rute
 * yang sedang dibuka; halaman Bantuan (`/backoffice/bantuan`, `/pwa/bantuan`)
 * menampilkan semuanya, dikelompokkan seperti menu samping.
 *
 * Yang masuk ke sini: untuk apa halamannya, siapa yang memakainya, kapan, dan
 * arti tiap kartu. Yang TETAP di layar: keterangan isian, peringatan, pesan
 * galat, keadaan kosong, dan angka/status — itu data, bukan penjelasan.
 *
 * Murni (tanpa React, tanpa Prisma) supaya bisa dites dan dimuat dari klien.
 */

/** Teks biasa (bahasa Indonesia) atau kunci i18n yang sudah ada. */
export type Teks = string | { kunci: string };

/**
 * Kelompok di halaman Bantuan. Nama kelompok kantor sama dengan kunci
 * `navigation.*` grup menu samping, jadi judulnya selalu sama dengan menunya.
 */
export const BAGIAN_KANTOR = [
  "dashboard",
  "navGroupMasterData",
  "inventory",
  "sales",
  "navGroupFieldTeam",
  "navGroupSpg",
  "production",
  "navGroupReceivables",
  "konsinyasi",
  "navGroupCreative",
  "navGroupLedger",
  "navGroupReports",
  "jubelio",
  "navGroupArchive",
  "settings",
] as const;

export const BAGIAN_HP = ["pwaBersama", "pwaSalesman", "pwaSpg"] as const;

export type BagianKantor = (typeof BAGIAN_KANTOR)[number];
export type BagianHp = (typeof BAGIAN_HP)[number];
export type BagianBantuan = BagianKantor | BagianHp;

export type KartuBantuan = { judul: Teks; isi: Teks | Teks[] };

export type EntriBantuan = {
  /** Pola rute Next: "/backoffice/barang-hilang/[id]". Tanpa garis miring akhir. */
  rute: string;
  bagian: BagianBantuan;
  judul: Teks;
  /** Satu paragraf atau beberapa. */
  isi: Teks | Teks[];
  /** Penjelasan kartu/bagian halaman, berurutan seperti di layar. */
  kartu?: KartuBantuan[];
};

export function sebagaiDaftar(t: Teks | Teks[]): Teks[] {
  return Array.isArray(t) ? t : [t];
}

function rapikan(path: string): string {
  const tanpaQuery = path.split(/[?#]/)[0] ?? "";
  return tanpaQuery.length > 1 ? tanpaQuery.replace(/\/+$/, "") : tanpaQuery;
}

function cocokRute(pola: string, path: string): boolean {
  const a = pola.split("/");
  const b = path.split("/");
  const sisaSemua = a.length > 0 && /^\[\.\.\.\w+\]$/.test(a[a.length - 1] ?? "");
  if (sisaSemua ? b.length < a.length : a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    if (/^\[\.\.\.\w+\]$/.test(s)) return true;
    if (/^\[\w+\]$/.test(s)) {
      if (!b[i]) return false;
      continue;
    }
    if (s !== b[i]) return false;
  }
  return true;
}

/** Banyaknya segmen dinamis — makin sedikit, makin spesifik. */
function kedinamisan(pola: string): number {
  return pola.split("/").filter((s) => s.startsWith("[")).length;
}

/**
 * Entri untuk alamat yang sedang dibuka. Segmen statis mengalahkan dinamis:
 * `/backoffice/stores/usulan` memilih entrinya sendiri, bukan
 * `/backoffice/stores/[id]`.
 */
export function cariEntri<T extends Pick<EntriBantuan, "rute">>(pathname: string, daftar: readonly T[]): T | null {
  const path = rapikan(pathname);
  let terbaik: T | null = null;
  for (const e of daftar) {
    if (!cocokRute(e.rute, path)) continue;
    if (!terbaik || kedinamisan(e.rute) < kedinamisan(terbaik.rute)) terbaik = e;
  }
  return terbaik;
}

/**
 * Jangkar di halaman Bantuan: "/backoffice/barang-hilang/[id]" →
 * "barang-hilang-id", "/pwa/stores/[id]" → "hp-stores-id". Rute HP diberi
 * awalan karena halaman Bantuan kantor juga memuat bagian HP, dan
 * `/backoffice/stores` serta `/pwa/stores` tidak boleh berbagi jangkar.
 */
export function jangkarEntri(rute: string): string {
  const hp = rute === "/pwa" || rute.startsWith("/pwa/");
  const inti = rute
    .replace(/^\/(backoffice|pwa)\/?/, "")
    .replace(/\[(?:\.\.\.)?(\w+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dasar = inti || "beranda";
  return hp ? `hp-${dasar}` : dasar;
}

/** Rute tanpa segmen dinamis bisa dibuka langsung dari halaman Bantuan. */
export function bisaDibuka(rute: string): boolean {
  return !rute.includes("[");
}

export function untukHp(e: Pick<EntriBantuan, "rute">): boolean {
  return e.rute === "/pwa" || e.rute.startsWith("/pwa/");
}

/** Pencarian bebas di halaman Bantuan: setiap kata harus ada (tanpa beda huruf besar/kecil). */
export function cocokPencarian(teksGabungan: string, kueri: string): boolean {
  const kata = kueri.toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const isi = teksGabungan.toLowerCase();
  return kata.every((k) => isi.includes(k));
}
