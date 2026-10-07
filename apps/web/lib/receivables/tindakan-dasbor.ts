/**
 * Daftar "Perlu tindakan hari ini" di beranda piutang — dirakit murni dari
 * baris yang sudah dibaca `muatDasbor`, supaya urutan dan tautannya bisa diuji
 * tanpa basis data.
 *
 * Setiap baris menaut ke daftar yang SUDAH TERSARING pada dokumennya, bukan ke
 * daftar penuh: orang yang mengklik "INV/2026/0103 lewat janji bayar" harus
 * mendarat di faktur itu, bukan mencarinya di antara ratusan baris.
 */

import type { KeadaanPiutang, LangkahRetur } from './rules';
import type { KeadaanTampil } from './jatuh-tempo';

export type JenisTindakan = 'lewat' | 'jatuh_tempo' | 'klaim' | 'tertahan' | 'cek' | 'keputusan' | 'jodoh';

export type TindakanHariIni = {
  jenis: JenisTindakan;
  /** Makin besar makin mendesak. Dipakai mengurutkan, tidak ditampilkan. */
  risiko: number;
  judul: string;
  tautan: string;
  nilai: number;
  /** Bahan kalimat; kalimatnya dirakit di klien supaya ikut berganti bahasa. */
  konteks: {
    toko?: string;
    hari?: number;
    doc?: string;
    /** Siapa yang melaporkan/mencatat BKM ini. */
    pelapor?: string | null;
    /**
     * Penonton sendiri yang melaporkan/mencatat BKM ini — ia tidak boleh
     * memutuskannya (PEMERIKSA_SAMA), jadi barisnya berbunyi "menunggu rekan".
     */
    milikSaya?: boolean;
    /**
     * Nota retur yang belum dihitung, dibaca orang yang boleh menghitungnya:
     * nilainya (= klaim toko) tidak dikirim — hitungan gudang harus buta.
     */
    klaimTersembunyi?: boolean;
  };
};

/** Bentuk minimum yang dibutuhkan dari `BarisPiutang`. */
type PiutangTindakan = {
  invoiceNo: string;
  storeName: string;
  dueDate: string;
  outstanding: number;
  keadaan: KeadaanPiutang;
  keadaanTampil: KeadaanTampil;
  alasan: { nilaiTertahan?: number; hariTerlambat?: number; hariLewatJatuhTempo?: number };
};

export type KlaimMenungguTindakan = {
  id: string;
  docNo: string;
  receivedAmount: number;
  createdAt: Date;
  storeName: string;
  salesmanId: string | null;
  createdById: string | null;
  pelapor: string | null;
};

type ReturTindakan = {
  id: string;
  jenis: 'NRT' | 'GUDANG_YATIM';
  salesmanId: string | null;
  nomor: string;
  storeName: string | null;
  langkah: LangkahRetur;
  selisih: number;
  nilaiKlaim: number | null;
  nilaiFisik: number | null;
};

export type BahanTindakan = {
  piutang: PiutangTindakan[];
  klaimMenunggu: KlaimMenungguTindakan[];
  retur: ReturTindakan[];
  /** Pengguna yang membuka beranda; '' kalau tidak diketahui. */
  penontonId: string;
  /** Penonton boleh menghitung retur (inventory_opname:count). */
  bolehMenghitung?: boolean;
  hariIni: Date;
};

/**
 * Batas daftar. Daftar tindakan yang panjangnya ratusan bukan daftar tindakan
 * lagi — ia jadi laporan, dan tidak ada yang mengerjakannya.
 */
export const BATAS_TINDAKAN = 20;

const HARI_MS = 86_400_000;
const selisihHari = (dari: Date, sampai: Date) => Math.floor((sampai.getTime() - dari.getTime()) / HARI_MS);
const bobotNilai = (n: number) => Math.log10(Math.max(n, 1));

/** Alamat daftar piutang dengan saringannya. */
export function tautanPiutang(s: { keadaan?: KeadaanTampil; cari?: string }): string {
  const p = new URLSearchParams();
  if (s.keadaan) p.set('keadaan', s.keadaan);
  if (s.cari) p.set('cari', s.cari);
  const qs = p.toString();
  return qs ? `/backoffice/piutang?${qs}` : '/backoffice/piutang';
}

export function susunTindakan(b: BahanTindakan): TindakanHariIni[] {
  const tindakan: TindakanHariIni[] = [];

  for (const p of b.piutang) {
    if (p.keadaanTampil === 'lewat') {
      const hari = p.alasan.hariTerlambat ?? Math.max(0, selisihHari(new Date(p.dueDate), b.hariIni));
      tindakan.push({
        jenis: 'lewat',
        // Makin lama lewat makin mendesak, dan nilainya ikut menimbang — sepuluh
        // hari atas sepuluh juta lebih genting dari sepuluh hari atas seratus ribu.
        risiko: 1000 + hari * 10 + bobotNilai(p.outstanding),
        judul: p.invoiceNo,
        tautan: tautanPiutang({ keadaan: 'lewat', cari: p.invoiceNo }),
        nilai: p.outstanding,
        konteks: { toko: p.storeName, hari },
      });
    } else if (p.keadaanTampil === 'jatuh_tempo') {
      const hari = p.alasan.hariLewatJatuhTempo ?? 0;
      tindakan.push({
        jenis: 'jatuh_tempo',
        // Di bawah janji yang diingkari (toko sudah berjanji), tapi naik terus
        // selama belum ditagih — setelah beberapa hari ia melampaui klaim menunggu.
        risiko: 850 + hari * 10 + bobotNilai(p.outstanding),
        judul: p.invoiceNo,
        tautan: tautanPiutang({ keadaan: 'jatuh_tempo', cari: p.invoiceNo }),
        nilai: p.outstanding,
        konteks: { toko: p.storeName, hari },
      });
    } else if (p.keadaanTampil === 'tertahan') {
      tindakan.push({
        jenis: 'tertahan',
        risiko: 800 + bobotNilai(p.alasan.nilaiTertahan ?? 1),
        judul: p.invoiceNo,
        tautan: '/backoffice/retur-toko',
        nilai: p.alasan.nilaiTertahan ?? 0,
        konteks: { toko: p.storeName },
      });
    }
  }

  for (const k of b.klaimMenunggu) {
    const hari = Math.max(0, selisihHari(k.createdAt, b.hariIni));
    const milikSaya = b.penontonId !== '' && (b.penontonId === k.salesmanId || b.penontonId === k.createdById);
    tindakan.push({
      jenis: 'klaim',
      // Klaim yang menunggu lama adalah uang yang mungkin sudah di rekening
      // tapi belum diakui. Yang dilaporkan penonton sendiri turun jauh: ia tidak
      // boleh memutuskannya, jadi ia tidak boleh menutupi pekerjaan yang bisa.
      risiko: (milikSaya ? 300 : 900) + hari * (milikSaya ? 1 : 10),
      judul: k.docNo,
      tautan: `/backoffice/pelunasan/${k.id}`,
      nilai: k.receivedAmount,
      konteks: { toko: k.storeName, hari, pelapor: k.pelapor, milikSaya },
    });
  }

  for (const r of b.retur) {
    if (r.langkah === 'beres' || r.langkah === 'batal') continue;
    // Aturan yang sama dengan daftar retur kantor (`app/backoffice/retur-toko/buta.ts`).
    const buta =
      r.langkah === 'cek' &&
      r.jenis === 'NRT' &&
      b.bolehMenghitung === true &&
      !(r.salesmanId !== null && r.salesmanId === b.penontonId);
    tindakan.push({
      jenis: r.langkah,
      risiko: r.langkah === 'keputusan' ? 950 : r.langkah === 'jodoh' ? 700 : 600,
      judul: r.nomor,
      tautan: r.jenis === 'NRT' ? `/backoffice/retur-toko/${r.id}` : '/backoffice/retur-toko',
      nilai: buta ? 0 : r.langkah === 'keputusan' ? r.selisih : (r.nilaiKlaim ?? r.nilaiFisik ?? 0),
      konteks: { toko: r.storeName ?? undefined, ...(buta ? { klaimTersembunyi: true } : {}) },
    });
  }

  tindakan.sort((a, b) => b.risiko - a.risiko);
  return tindakan.slice(0, BATAS_TINDAKAN);
}
