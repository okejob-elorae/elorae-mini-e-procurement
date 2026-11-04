import type { AccountType } from "@/lib/constants/enums";
import type { BalanceRow } from "./balances";
import type { RollupNode } from "./rollup";

/*
 * Baris tampilan pohon akun laporan (Laba Rugi, Neraca, perbandingan,
 * anggaran) — SATU aturan untuk layar, cetak, dan Excel. Murni, aman untuk
 * komponen klien.
 *
 * Audit G8: baris akun induk dulu menulis subtotalnya di kolom yang sama dan
 * dengan bobot yang sama dengan rinciannya, lalu angka yang sama diulang di
 * "Total …" — satu angka tampil 2–3 kali dan mudah dijumlah ganda. Aturannya
 * sekarang:
 * - induk = JUDUL kelompok tanpa angka;
 * - rincian (akun daun, atau mutasi langsung pada induk) = baris `akun`;
 * - subtotal induk = baris `jumlah` sesudah anak-anaknya, ditampilkan di kolom
 *   subtotal, HANYA bila isinya lebih dari satu baris (satu baris = angkanya
 *   sudah tertulis) dan bukan satu-satunya akar bagiannya (baris "Total …"
 *   bagian sudah menulisnya);
 * - akun bernilai nol disembunyikan kecuali `tampilkanNol`.
 */

/** Simpul pohon dengan satu nilai per kolom (satu kolom untuk laporan biasa, beberapa untuk perbandingan). */
export type SimpulNilai = {
  accountId: string;
  code: string;
  name: string;
  /** Saldo akun ini sendiri per kolom (tanpa anak). */
  sendiri: number[];
  /** Saldo akun ini + seluruh turunannya per kolom. */
  subtotal: number[];
  children: SimpulNilai[];
};

export type BarisPohon =
  | { jenis: "judul"; accountId: string; code: string; name: string; level: number }
  | {
      jenis: "akun";
      accountId: string;
      code: string;
      name: string;
      level: number;
      nilai: number[];
      /** Mutasi yang diposting langsung ke akun induk (jarang: akun yang belakangan diberi anak). */
      sendiriInduk?: boolean;
    }
  | { jenis: "jumlah"; accountId: string; code: string; name: string; level: number; nilai: number[] };

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));
const adaNilai = (nilai: number[]): boolean => nilai.some((v) => keSen(v) !== 0);

/** Pohon satu kolom dari `buildRollup`. */
export function dariRollup(nodes: RollupNode[]): SimpulNilai[] {
  return nodes.map((n) => ({
    accountId: n.accountId,
    code: n.code,
    name: n.name,
    sendiri: [n.signed],
    subtotal: [n.subtotal],
    children: dariRollup(n.children),
  }));
}

/**
 * Pohon banyak kolom: `kolom[i]` adalah saldo untuk kolom ke-i (mis. periode
 * ini, periode lalu, tahun lalu). Himpunan akun = GABUNGAN semua kolom — akun
 * yang hanya bergerak di satu kolom tetap tampil, bernilai nol di kolom lain.
 * Akun yang induknya tidak termasuk jenis yang diminta menjadi akar, sama
 * dengan `buildRollup`.
 */
export function rollupBanyak(kolom: BalanceRow[][], types: AccountType[]): SimpulNilai[] {
  const wanted = new Set(types);
  const n = kolom.length;
  const info = new Map<string, BalanceRow>();
  const nilai = new Map<string, number[]>();

  kolom.forEach((rows, i) => {
    for (const r of rows) {
      if (!wanted.has(r.type)) continue;
      if (!info.has(r.accountId)) info.set(r.accountId, r);
      const v = nilai.get(r.accountId) ?? new Array<number>(n).fill(0);
      v[i] = r.signed;
      nilai.set(r.accountId, v);
    }
  });

  const simpul = new Map<string, SimpulNilai>();
  for (const [id, r] of info) {
    simpul.set(id, {
      accountId: id,
      code: r.code,
      name: r.name,
      sendiri: nilai.get(id) ?? new Array<number>(n).fill(0),
      subtotal: new Array<number>(n).fill(0),
      children: [],
    });
  }

  const akar: SimpulNilai[] = [];
  for (const [id, r] of info) {
    const s = simpul.get(id)!;
    const induk = r.parentId ? simpul.get(r.parentId) : undefined;
    if (induk) induk.children.push(s);
    else akar.push(s);
  }

  const urut = (a: SimpulNilai, b: SimpulNilai) => a.code.localeCompare(b.code);
  const hitung = (s: SimpulNilai): number[] => {
    s.children.sort(urut);
    const sen = s.sendiri.map(keSen);
    for (const c of s.children) {
      const sub = hitung(c);
      sub.forEach((v, i) => {
        sen[i] += keSen(v);
      });
    }
    s.subtotal = sen.map((v) => v / 100 + 0);
    return s.subtotal;
  };
  akar.sort(urut);
  for (const a of akar) hitung(a);
  return akar;
}

/** Baris tampilan satu bagian laporan dari akar-akarnya. */
export function barisPohon(akar: SimpulNilai[], opsi: { tampilkanNol?: boolean } = {}): BarisPohon[] {
  const tampilkanNol = opsi.tampilkanNol ?? false;

  const terlihat = (s: SimpulNilai): boolean =>
    tampilkanNol || adaNilai(s.sendiri) || s.children.some(terlihat);

  const out: BarisPohon[] = [];
  const akarTerlihat = akar.filter(terlihat);
  const akarTunggal = akarTerlihat.length === 1;

  const tulis = (s: SimpulNilai, level: number, adalahAkarTunggal: boolean) => {
    const dasar = { accountId: s.accountId, code: s.code, name: s.name, level };
    if (s.children.length === 0) {
      out.push({ jenis: "akun", ...dasar, nilai: s.sendiri });
      return;
    }
    out.push({ jenis: "judul", ...dasar });
    let isi = 0;
    if (adaNilai(s.sendiri)) {
      out.push({ jenis: "akun", ...dasar, level: level + 1, nilai: s.sendiri, sendiriInduk: true });
      isi++;
    }
    for (const c of s.children) {
      if (!terlihat(c)) continue;
      tulis(c, level + 1, false);
      isi++;
    }
    if (isi > 1 && !adalahAkarTunggal) out.push({ jenis: "jumlah", ...dasar, nilai: s.subtotal });
  };

  for (const a of akarTerlihat) tulis(a, 0, akarTunggal);
  return out;
}

/** Jumlah semua akar per kolom (dalam sen) — total satu bagian laporan. */
export function totalAkar(akar: SimpulNilai[], kolom: number): number[] {
  const sen = new Array<number>(kolom).fill(0);
  for (const a of akar) a.subtotal.forEach((v, i) => (sen[i] += keSen(v)));
  return sen.map((v) => v / 100 + 0);
}
