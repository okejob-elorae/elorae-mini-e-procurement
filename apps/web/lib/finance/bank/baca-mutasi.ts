/**
 * Membaca mutasi rekening bank dari isi berkas (CSV/Excel yang sudah diubah
 * menjadi kisi sel) — MURNI, tanpa Prisma, aman untuk klien dan dites.
 *
 * Format yang dikenali:
 * - BCA (KlikBCA/myBCA CSV): blok kepala "No. rekening / Periode : dd/mm/yyyy -
 *   dd/mm/yyyy", lalu "Tanggal Transaksi, Keterangan, Cabang, Jumlah, <DB/CR>,
 *   Saldo"; tanggal hanya "dd/mm" (tahun diambil dari Periode); jumlah memakai
 *   koma ribuan; ekor "Saldo Awal / Mutasi Kredit / Mutasi Debet / Saldo Akhir".
 * - Mandiri (Livin/MCM CSV): "Account No, Date, Val. Date, Transaction Code,
 *   Description, …, Debit, Credit".
 * - Umum: baris kepala apa pun yang punya kolom tanggal, keterangan, dan salah
 *   satu dari (debit + kredit) atau (jumlah [+ jenis DB/CR]); saldo dan nomor
 *   referensi opsional.
 *
 * Tanda jumlah: UANG MASUK positif, uang keluar negatif — sama dengan arah
 * baris jurnal akun bank (debit − kredit), supaya pencocokan cukup
 * membandingkan dua angka.
 *
 * Berkas Excel/CSV WAJIB dibaca dengan `XLSX.read(..., { raw: true })` (lihat
 * `./berkas.ts`): tanpanya SheetJS membaca "900.000" sebagai sembilan ratus.
 */

export type Sel = string | number | boolean | Date | null | undefined;
export type Kisi = readonly (readonly Sel[])[];

export type FormatMutasi = "BCA" | "MANDIRI" | "UMUM";

export type BarisMutasi = {
  /** "YYYY-MM-DD". */
  tanggal: string;
  keterangan: string;
  /** Masuk positif, keluar negatif. */
  jumlahSen: number;
  saldoSen: number | null;
  referensi: string | null;
  /** Baris ke-n di berkas (1 = baris pertama), untuk pesan galat. */
  nomorBaris: number;
};

export type HasilBacaMutasi =
  | {
      ok: true;
      format: FormatMutasi;
      baris: BarisMutasi[];
      periodeDari: string | null;
      periodeSampai: string | null;
      saldoAwalSen: number | null;
      saldoAkhirSen: number | null;
      /** Baris data yang dilewati (tanggal kosong/PEND, jumlah nol atau tidak terbaca). */
      dilewati: number;
    }
  | { ok: false; kode: "KEPALA_TIDAK_DITEMUKAN" | "TANPA_BARIS" | "TAHUN_TIDAK_DIKETAHUI" | "TERLALU_BANYAK_BARIS" };

export const MAKS_BARIS_MUTASI = 5000;

const BULAN: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, ags: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

const dua = (n: number) => String(n).padStart(2, "0");

function tanggalSah(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${dua(m)}-${dua(d)}`;
}

function teksSel(s: Sel): string {
  if (s == null) return "";
  if (s instanceof Date) return s.toISOString();
  return String(s).trim();
}

/**
 * Tanggal dari satu sel. `tahunCadangan` dipakai untuk "dd/mm" tanpa tahun
 * (BCA); bila ada `periode`, tahun dipilih supaya tanggalnya jatuh di dalam
 * periode (periode Desember–Januari).
 */
export function bacaTanggalMutasi(
  s: Sel,
  opsi: { periodeDari?: string | null; periodeSampai?: string | null } = {},
): string | null {
  if (s == null) return null;
  if (s instanceof Date) {
    if (Number.isNaN(s.getTime())) return null;
    return tanggalSah(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate());
  }
  if (typeof s === "number") {
    // Nomor seri Excel (1 = 1900-01-01, dengan bug tahun kabisat 1900): epoch 1899-12-30.
    if (s < 20000 || s > 80000) return null;
    const ms = Math.round(s) * 86_400_000 + Date.UTC(1899, 11, 30);
    const dt = new Date(ms);
    return tanggalSah(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const t = String(s).trim().replace(/^'+/, "");
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return tanggalSah(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return tanggalSah(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[-\s/]([A-Za-z]+)[-\s/,]+(\d{2}|\d{4})(?:\s.*)?$/.exec(t);
  if (m && BULAN[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return tanggalSah(y, BULAN[m[2].toLowerCase()], Number(m[1]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) {
    const hari = Number(m[1]);
    const bulan = Number(m[2]);
    const dari = opsi.periodeDari ?? null;
    const sampai = opsi.periodeSampai ?? null;
    const calonTahun = [...new Set([sampai, dari].filter((x): x is string => Boolean(x)).map((x) => Number(x.slice(0, 4))))];
    for (const y of calonTahun) {
      const hasil = tanggalSah(y, bulan, hari);
      if (hasil && (!dari || hasil >= dari) && (!sampai || hasil <= sampai)) return hasil;
    }
    return calonTahun.length > 0 ? tanggalSah(calonTahun[0], bulan, hari) : null;
  }
  return null;
}

/**
 * Rupiah dari satu sel → sen, BERTANDA. Mengenali "1,500,000.00",
 * "1.500.000,00", "1500000", "(1.000)", "-25.000", "25.000 CR", "25,000.00 DB".
 * Akhiran DB/D/DR membuat negatif, CR/K/KR positif. Null bila tidak terbaca.
 */
export function bacaJumlahMutasi(s: Sel): number | null {
  if (s == null || s === "") return null;
  if (typeof s === "number") return Number.isFinite(s) ? Math.round(Number((s * 100).toFixed(4))) : null;
  if (typeof s !== "string") return null;
  let t = s.trim().replace(/^'+/, "").replace(/\s+/g, " ").replace(/^rp\.?\s*/i, "").replace(/^idr\s*/i, "");
  if (!t) return null;
  let tanda = 1;
  const akhiran = /\s*(DB|DR|D|CR|KR|K)$/i.exec(t);
  if (akhiran) {
    const a = akhiran[1].toUpperCase();
    tanda = a === "DB" || a === "DR" || a === "D" ? -1 : 1;
    t = t.slice(0, akhiran.index).trim();
  }
  if (/^\(.*\)$/.test(t)) {
    tanda = -tanda;
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith("-")) {
    tanda = -tanda;
    t = t.slice(1).trim();
  } else if (t.startsWith("+")) {
    t = t.slice(1).trim();
  }
  t = t.replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(t)) return null;
  let bulat: string;
  let pecahan = "";
  const titik = t.lastIndexOf(".");
  const koma = t.lastIndexOf(",");
  if (titik >= 0 && koma >= 0) {
    const desimal = titik > koma ? "." : ",";
    const ribuan = desimal === "." ? "," : ".";
    const [a, b = ""] = t.split(desimal);
    if (t.split(desimal).length > 2) return null;
    bulat = a.split(ribuan).join("");
    pecahan = b;
  } else if (titik >= 0 || koma >= 0) {
    const pemisah = titik >= 0 ? "." : ",";
    const bagian = t.split(pemisah);
    const ribuanSah = bagian.length > 1 && bagian.slice(1).every((x) => x.length === 3) && bagian[0].length >= 1 && bagian[0].length <= 3;
    if (ribuanSah) {
      // "1,500" dan "1.500" sama-sama seribu lima ratus: mutasi bank tidak pernah memakai 3 desimal.
      bulat = bagian.join("");
    } else if (bagian.length === 2 && bagian[1].length <= 2) {
      bulat = bagian[0];
      pecahan = bagian[1];
    } else {
      return null;
    }
  } else {
    bulat = t;
  }
  if (!/^\d+$/.test(bulat) || !/^\d{0,2}$/.test(pecahan)) return null;
  const sen = Number(bulat) * 100 + Number(pecahan.padEnd(2, "0") || "0");
  return Number.isFinite(sen) ? tanda * sen : null;
}

type Kolom = {
  tanggal: number;
  keterangan: number[];
  jumlah: number | null;
  jenis: number | null;
  debit: number | null;
  kredit: number | null;
  saldo: number | null;
  referensi: number | null;
};

const norm = (s: Sel) => teksSel(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const POLA_KEPALA = {
  tanggal: /^(tanggal( transaksi)?|tgl( transaksi)?|date|transaction date|posting date|trx date|tanggal posting)$/,
  keterangan: /^(keterangan|description|deskripsi|uraian|remark|remarks|transaction description|keterangan transaksi|berita|detail)$/,
  jumlah: /^(jumlah|amount|nominal|mutasi|nilai|transaction amount)$/,
  jenis: /^(db cr|d k|tipe|type|jenis|dr cr|d c|debit credit|cr db)$/,
  debit: /^(debit|debet|db|keluar|withdrawal|withdrawals|dana keluar|mutasi debet|mutasi debit)$/,
  kredit: /^(kredit|credit|cr|masuk|deposit|deposits|dana masuk|mutasi kredit)$/,
  saldo: /^(saldo|balance|saldo akhir|running balance|ending balance)$/,
  referensi: /^(referensi|reference|ref|no ref|reference no|no referensi|nomor referensi|reference number)$/,
  kodeTransaksi: /^(transaction code|kode transaksi)$/,
};

function cariKolom(baris: readonly Sel[]): Kolom | null {
  const nama = baris.map(norm);
  const pertama = (pola: RegExp, kecuali: number[] = []) => nama.findIndex((n, i) => !kecuali.includes(i) && pola.test(n));
  const tanggal = pertama(POLA_KEPALA.tanggal);
  if (tanggal < 0) return null;
  const keterangan = nama.map((n, i) => (POLA_KEPALA.keterangan.test(n) ? i : -1)).filter((i) => i >= 0);
  if (keterangan.length === 0) return null;
  const debit = pertama(POLA_KEPALA.debit);
  const kredit = pertama(POLA_KEPALA.kredit);
  const jumlah = pertama(POLA_KEPALA.jumlah);
  if (jumlah < 0 && (debit < 0 || kredit < 0)) return null;
  let jenis = pertama(POLA_KEPALA.jenis);
  // BCA: kolom DB/CR tanpa judul tepat sesudah "Jumlah".
  if (jenis < 0 && jumlah >= 0 && nama[jumlah + 1] === "") jenis = jumlah + 1;
  return {
    tanggal,
    keterangan,
    jumlah: jumlah >= 0 && (debit < 0 || kredit < 0) ? jumlah : null,
    jenis: jenis >= 0 ? jenis : null,
    debit: debit >= 0 && kredit >= 0 ? debit : null,
    kredit: debit >= 0 && kredit >= 0 ? kredit : null,
    saldo: pertama(POLA_KEPALA.saldo) >= 0 ? pertama(POLA_KEPALA.saldo) : null,
    referensi:
      pertama(POLA_KEPALA.referensi) >= 0
        ? pertama(POLA_KEPALA.referensi)
        : pertama(POLA_KEPALA.kodeTransaksi) >= 0
          ? pertama(POLA_KEPALA.kodeTransaksi)
          : null,
  };
}

/** "Periode : 01/10/2026 - 31/10/2026" (BCA) atau "Period : …" di blok kepala. */
function cariPeriode(kisi: Kisi, sampaiBaris: number): { dari: string | null; sampai: string | null } {
  for (let i = 0; i < sampaiBaris; i++) {
    const teks = kisi[i].map(teksSel).join(" ");
    const m = /(periode|period)\s*:?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4})\s*(?:-|s\/d|sd|to|sampai)\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4})/i.exec(teks);
    if (m) return { dari: bacaTanggalMutasi(m[2]), sampai: bacaTanggalMutasi(m[3]) };
  }
  return { dari: null, sampai: null };
}

function deteksiFormat(kisi: Kisi, kepala: number): FormatMutasi {
  const blok = kisi.slice(0, kepala + 1).map((b) => b.map(norm).join(" ")).join(" ");
  if (/tanggal transaksi/.test(blok) && /cabang|branch/.test(blok)) return "BCA";
  if (/no rekening/.test(blok) && /kode mata uang/.test(blok)) return "BCA";
  if (/account no/.test(blok) && /val date/.test(blok)) return "MANDIRI";
  return "UMUM";
}

/** Ringkasan ekor BCA: "Saldo Awal", "Saldo Akhir" (dan versi Inggrisnya). */
function cariSaldoEkor(kisi: Kisi, mulai: number): { awal: number | null; akhir: number | null } {
  let awal: number | null = null;
  let akhir: number | null = null;
  for (let i = mulai; i < kisi.length; i++) {
    const sel = kisi[i];
    const label = norm(sel[0]);
    const angka = sel.slice(1).map(bacaJumlahMutasi).find((n) => n != null) ?? null;
    if (/^(saldo awal|starting balance|opening balance|beginning balance)$/.test(label)) awal = angka;
    if (/^(saldo akhir|ending balance|closing balance)$/.test(label)) akhir = angka;
  }
  return { awal, akhir };
}

export function bacaMutasiDariKisi(kisi: Kisi): HasilBacaMutasi {
  const batasCari = Math.min(kisi.length, 40);
  let kepala = -1;
  let kolom: Kolom | null = null;
  for (let i = 0; i < batasCari; i++) {
    const k = cariKolom(kisi[i] ?? []);
    if (k) {
      kepala = i;
      kolom = k;
      break;
    }
  }
  if (!kolom || kepala < 0) return { ok: false, kode: "KEPALA_TIDAK_DITEMUKAN" };
  const format = deteksiFormat(kisi, kepala);
  const periode = cariPeriode(kisi, kepala);
  const ekor = cariSaldoEkor(kisi, kepala + 1);

  const baris: BarisMutasi[] = [];
  let dilewati = 0;
  let butuhTahun = false;
  for (let i = kepala + 1; i < kisi.length; i++) {
    const sel = kisi[i] ?? [];
    if (sel.every((s) => teksSel(s) === "")) continue;
    const mentah = sel[kolom.tanggal];
    const teksTanggal = teksSel(mentah).replace(/^'+/, "");
    if (/^pend/i.test(teksTanggal)) {
      dilewati++;
      continue;
    }
    if (/^\d{1,2}[/.-]\d{1,2}$/.test(teksTanggal) && !periode.dari && !periode.sampai) {
      butuhTahun = true;
      continue;
    }
    const tanggal = bacaTanggalMutasi(mentah, { periodeDari: periode.dari, periodeSampai: periode.sampai });
    if (!tanggal) {
      // Ringkasan ekor dan baris bebas lain — bukan transaksi.
      if (teksTanggal) dilewati += /^(saldo|mutasi|starting|ending|credit|debet|debit|total)/i.test(teksTanggal) ? 0 : 1;
      continue;
    }
    let jumlahSen: number | null = null;
    if (kolom.debit != null && kolom.kredit != null) {
      const d = bacaJumlahMutasi(sel[kolom.debit]);
      const k = bacaJumlahMutasi(sel[kolom.kredit]);
      const ds = d == null ? 0 : Math.abs(d);
      const ks = k == null ? 0 : Math.abs(k);
      jumlahSen = ks - ds;
    } else if (kolom.jumlah != null) {
      const j = bacaJumlahMutasi(sel[kolom.jumlah]);
      if (j != null) {
        const jenis = kolom.jenis != null ? norm(sel[kolom.jenis]) : "";
        if (/^(db|d|dr|debit|debet|keluar)$/.test(jenis)) jumlahSen = -Math.abs(j);
        else if (/^(cr|k|kr|kredit|credit|masuk)$/.test(jenis)) jumlahSen = Math.abs(j);
        else jumlahSen = j;
      }
    }
    if (jumlahSen == null || jumlahSen === 0) {
      dilewati++;
      continue;
    }
    const keterangan = kolom.keterangan
      .map((c) => teksSel(sel[c]).replace(/^'+/, ""))
      .filter(Boolean)
      .join(" · ")
      .replace(/\s+/g, " ")
      .slice(0, 2000);
    const saldo = kolom.saldo != null ? bacaJumlahMutasi(sel[kolom.saldo]) : null;
    const ref = kolom.referensi != null ? teksSel(sel[kolom.referensi]).replace(/^'+/, "").slice(0, 191) : "";
    baris.push({ tanggal, keterangan: keterangan || "-", jumlahSen, saldoSen: saldo, referensi: ref || null, nomorBaris: i + 1 });
    if (baris.length > MAKS_BARIS_MUTASI) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  }
  if (baris.length === 0) return butuhTahun ? { ok: false, kode: "TAHUN_TIDAK_DIKETAHUI" } : { ok: false, kode: "TANPA_BARIS" };

  const tanggalUrut = baris.map((b) => b.tanggal).sort();
  const pertama = baris[0];
  const terakhir = baris[baris.length - 1];
  const saldoAwalSen = ekor.awal ?? (pertama.saldoSen != null ? pertama.saldoSen - pertama.jumlahSen : null);
  const saldoAkhirSen = ekor.akhir ?? terakhir.saldoSen ?? null;
  return {
    ok: true,
    format,
    baris,
    periodeDari: periode.dari ?? tanggalUrut[0],
    periodeSampai: periode.sampai ?? tanggalUrut[tanggalUrut.length - 1],
    saldoAwalSen,
    saldoAkhirSen,
    dilewati,
  };
}

/** Kunci baris untuk menolak baris yang sama diimpor dua kali (sebelum indeks kemunculan). */
export function kunciDasarMutasi(b: Pick<BarisMutasi, "tanggal" | "jumlahSen" | "saldoSen" | "keterangan">): string {
  return [b.tanggal, b.jumlahSen, b.saldoSen ?? "", b.keterangan.toLowerCase().replace(/\s+/g, " ").trim()].join("|");
}

/**
 * Kunci per baris + indeks kemunculannya: dua baris identik di hari yang sama
 * (mis. dua biaya admin Rp 6.500 tanpa saldo) mendapat kunci berbeda (#0, #1),
 * sedangkan mengimpor ulang berkas yang sama — atau berkas yang periodenya
 * bertumpuk — menghasilkan kunci yang sama untuk baris yang sama.
 */
export function kunciBerindeks(baris: readonly Pick<BarisMutasi, "tanggal" | "jumlahSen" | "saldoSen" | "keterangan">[]): string[] {
  const hitung = new Map<string, number>();
  return baris.map((b) => {
    const k = kunciDasarMutasi(b);
    const n = hitung.get(k) ?? 0;
    hitung.set(k, n + 1);
    return `${k}#${n}`;
  });
}
