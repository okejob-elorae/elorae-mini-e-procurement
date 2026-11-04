import { keRupiah, keTanggal } from './nilai';
import { cariBarisJudul, petakanKolom, type Kolom } from './kolom';

export type BarisImpor = {
  /** Nomor baris di berkas aslinya, untuk dilaporkan ke pengguna. */
  baris: number;
  noFaktur: string;
  kodeToko: string | null;
  namaToko: string | null;
  tglFaktur: Date | null;
  jatuhTempo: Date | null;
  nilai: number | null;
  /**
   * Sisa yang tertulis di berkas.
   *
   * `undefined` = kolomnya tidak ada, atau selnya kosong → tidak ada informasi,
   * pakai `nilai` sebagai sisa.
   * `0` = berkasnya benar-benar menulis nol → **fakturnya sudah lunas**.
   *
   * Menyamakan keduanya adalah cara termudah mengubah faktur lunas jadi tagihan
   * hidup, atau sebaliknya menghapus tagihan yang masih berjalan.
   */
  sisaTertulis: number | undefined;
  sales: string | null;
  /** Sisa yang dipakai setelah aturan di atas dan pembatasan ke nilai. */
  sisa: number | null;
  masalah: string[];
};

export type HasilBaca = {
  barisJudul: number;
  kolom: Partial<Record<Kolom, number>>;
  /** Kolom sisa memang ada di berkasnya. */
  adaKolomSisa: boolean;
  baris: BarisImpor[];
};

const teks = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Baca seluruh lembar menjadi baris siap tinjau.
 *
 * Tidak ada baris yang dibuang diam-diam: yang bermasalah tetap dikembalikan
 * beserta daftar masalahnya, supaya pengguna melihat apa yang tidak akan masuk
 * sebelum menekan simpan.
 */
export function bacaLembar(sel: unknown[][]): HasilBaca {
  const barisJudul = cariBarisJudul(sel);
  if (barisJudul === -1) {
    return { barisJudul: -1, kolom: {}, adaKolomSisa: false, baris: [] };
  }

  const kolom = petakanKolom(sel[barisJudul] ?? []);
  const adaKolomSisa = kolom.sisa !== undefined;
  const ambil = (r: unknown[], k: Kolom): unknown =>
    kolom[k] === undefined ? undefined : r[kolom[k]!];

  const baris: BarisImpor[] = [];
  for (let i = barisJudul + 1; i < sel.length; i++) {
    const r = sel[i] ?? [];
    // Baris kosong dilewati tanpa laporan — berkas Excel selalu punya ekor
    // baris kosong, dan melaporkannya membanjiri pratinjau dengan derau.
    if (r.every((c) => String(c ?? '').trim() === '')) continue;

    const noFaktur = teks(ambil(r, 'no_faktur'));
    const nilai = keRupiah(ambil(r, 'nilai'));
    const tglFaktur = keTanggal(ambil(r, 'tgl_faktur'));
    const jatuhTempo = keTanggal(ambil(r, 'jatuh_tempo'));

    const selSisa = ambil(r, 'sisa');
    const selSisaKosong = selSisa === undefined || String(selSisa ?? '').trim() === '';
    const sisaTertulis = selSisaKosong ? undefined : (keRupiah(selSisa) ?? undefined);

    const masalah: string[] = [];
    if (!noFaktur) masalah.push('NO_FAKTUR_KOSONG');
    if (nilai === null) masalah.push('NILAI_TIDAK_TERBACA');
    else if (nilai <= 0) masalah.push('NILAI_TIDAK_POSITIF');
    if (!teks(ambil(r, 'kode_toko')) && !teks(ambil(r, 'toko'))) masalah.push('TOKO_KOSONG');
    if (!jatuhTempo) masalah.push('JATUH_TEMPO_TIDAK_TERBACA');

    /*
     * Sisa dibatasi ke nilai fakturnya. Berkas nyata kadang membawa sisa yang
     * lebih besar dari nilainya (bunga, denda, salah ketik); memakainya apa
     * adanya akan menagih lebih dari yang pernah ditagihkan.
     */
    const sisa =
      nilai === null
        ? null
        : sisaTertulis === undefined
          ? nilai
          : Math.max(0, Math.min(sisaTertulis, nilai));

    baris.push({
      baris: i + 1,
      noFaktur: noFaktur ?? '',
      kodeToko: teks(ambil(r, 'kode_toko')),
      namaToko: teks(ambil(r, 'toko')),
      tglFaktur,
      jatuhTempo,
      nilai,
      sisaTertulis,
      sales: teks(ambil(r, 'sales')),
      sisa,
      masalah,
    });
  }

  return { barisJudul, kolom, adaKolomSisa, baris };
}

/** Faktur yang sisanya nol memang sudah lunas — bukan baris rusak. */
export function sudahLunas(b: BarisImpor): boolean {
  return b.sisaTertulis === 0;
}
