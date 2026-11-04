/**
 * Pengenalan kolom impor faktur.
 *
 * Berkas yang dikirim toko dan kantor tidak pernah memakai judul kolom yang
 * sama. Alih-alih menuntut satu format, judulnya dinormalkan lalu dicocokkan ke
 * daftar sinonim — dan yang tidak dikenali dibiarkan lewat, bukan menggagalkan
 * seluruh berkas.
 */

export type Kolom =
  | 'no_faktur'
  | 'kode_toko'
  | 'toko'
  | 'tgl_faktur'
  | 'jatuh_tempo'
  | 'nilai'
  | 'sisa'
  | 'sales';

const SINONIM: Record<Kolom, string[]> = {
  no_faktur: ['nofaktur', 'nomorfaktur', 'noinvoice', 'invoice', 'nonota', 'faktur', 'nofakturjual', 'nobukti'],
  kode_toko: ['kodetoko', 'kodecustomer', 'kodepelanggan', 'kodelangganan', 'kdcust', 'kodecust'],
  toko: ['toko', 'namatoko', 'customer', 'pelanggan', 'namapelanggan', 'langganan', 'namacustomer'],
  tgl_faktur: ['tglfaktur', 'tanggalfaktur', 'tanggal', 'tgl', 'tglnota', 'tanggalnota', 'date'],
  jatuh_tempo: ['jatuhtempo', 'tgljatuhtempo', 'tanggaljatuhtempo', 'duedate', 'tempo', 'jthtempo'],
  nilai: ['nilai', 'total', 'grandtotal', 'totalfaktur', 'jumlah', 'nilaifaktur', 'netto', 'amount', 'totalnota'],
  sisa: ['sisa', 'sisapiutang', 'outstanding', 'saldo', 'sisatagihan'],
  sales: ['sales', 'salesman', 'namasales', 'salesname'],
};

/** Huruf kecil, buang apa pun selain a–z dan 0–9. */
export function normalisasiJudul(teks: unknown): string {
  return String(teks ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Cari baris judul.
 *
 * Baris pertama (dari 20 baris teratas) yang punya minimal 3 sel terisi.
 * Berkas nyata sering diawali kop, nama perusahaan, dan baris kosong — memaksa
 * judul di baris pertama akan menolak hampir semua berkas yang benar.
 */
export function cariBarisJudul(baris: unknown[][]): number {
  const batas = Math.min(20, baris.length);
  for (let i = 0; i < batas; i++) {
    const terisi = (baris[i] ?? []).filter((sel) => String(sel ?? '').trim() !== '').length;
    if (terisi >= 3) return i;
  }
  return -1;
}

/** Peta kolom → indeks. Judul yang tidak dikenali diabaikan, bukan digagalkan. */
export function petakanKolom(judul: unknown[]): Partial<Record<Kolom, number>> {
  const peta: Partial<Record<Kolom, number>> = {};
  judul.forEach((sel, i) => {
    const n = normalisasiJudul(sel);
    if (!n) return;
    for (const [kolom, daftar] of Object.entries(SINONIM) as [Kolom, string[]][]) {
      // Kolom pertama yang cocok yang dipakai. Berkas yang punya "total" dan
      // "grandtotal" sekaligus memakai yang lebih kiri, yang biasanya benar.
      if (peta[kolom] === undefined && daftar.includes(n)) {
        peta[kolom] = i;
        return;
      }
    }
  });
  return peta;
}
