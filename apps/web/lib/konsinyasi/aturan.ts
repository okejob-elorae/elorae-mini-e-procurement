/**
 * Aturan siklus konsinyasi. Murni — tidak menyentuh database.
 *
 * Satu siklus = satu toko × satu bulan, dan seluruh rantainya digantung pada
 * baris itu, termasuk tiga nomor dokumen yang selama ini tersimpan di kepala
 * tiga orang berbeda.
 */

export type TahapSiklus = 'laporan' | 'cocok' | 'bayar_spg' | 'nota' | 'pajak' | 'selesai';

export type BahanTahap = {
  adaLaporanSpg: boolean;
  adaLaporanToko: boolean;
  terkunci: boolean;
  /** Toko ini punya SPG terdaftar. */
  adaSpg: boolean;
  semuaKomisiDibayar: boolean;
  adaNota: boolean;
  adaFakturPajak: boolean;
  /**
   * Tagihan konsinyasi siklus ini memakai PPN (`ConsignmentCycle.vatApplied`,
   * sebelum dikunci `Store.consignmentVat`). Tanpa PPN tidak ada faktur pajak.
   */
  pakaiPpn: boolean;
};

/**
 * Tahap siklus, diperiksa berurutan — yang pertama cocok itulah tahapnya.
 *
 * `bayar_spg` DILEWATI kalau tokonya belum punya SPG terdaftar. Kalau tidak,
 * siklus toko tanpa SPG menggantung di "menunggu bayar gaji" selamanya, dan
 * rantainya tidak pernah sampai ke nota maupun faktur pajak.
 *
 * `pajak` DILEWATI kalau tagihan konsinyasinya tanpa PPN — sama alasannya:
 * faktur pajak untuk tagihan tanpa PPN tidak pernah ada.
 */
export function tahapSiklus(b: BahanTahap): TahapSiklus {
  if (!b.adaLaporanSpg || !b.adaLaporanToko) return 'laporan';
  if (!b.terkunci) return 'cocok';
  if (b.adaSpg && !b.semuaKomisiDibayar) return 'bayar_spg';
  if (!b.adaNota) return 'nota';
  if (b.pakaiPpn && !b.adaFakturPajak) return 'pajak';
  return 'selesai';
}

/** Giliran siapa mengerjakan sebuah tahap. */
export function giliranTahap(
  t: TahapSiklus,
): 'spg_dan_toko' | 'admin_konsi' | 'keuangan' | 'admin_penjualan' | 'admin_pajak' | 'tidak_ada' {
  switch (t) {
    case 'laporan':
      return 'spg_dan_toko';
    case 'cocok':
      return 'admin_konsi';
    case 'bayar_spg':
      return 'keuangan';
    case 'nota':
      return 'admin_penjualan';
    case 'pajak':
      return 'admin_pajak';
    default:
      return 'tidak_ada';
  }
}

export type BarisBanding = {
  itemName: string;
  /** Barang master dari laporan mana pun yang menyebutnya; null untuk baris ketikan. */
  itemId: string | null;
  qtySpg: number | null;
  qtyToko: number | null;
  /** Selisih absolut antara dua laporan; null kalau salah satunya belum ada. */
  selisih: number | null;
};

/**
 * Sandingkan dua laporan per barang.
 *
 * Digabung menurut NAMA barang, bukan urutan baris: SPG melapor lewat surel dan
 * toko lewat ekspedisi, keduanya menulis urutannya sendiri, dan barang yang
 * hanya muncul di satu laporan justru kasus yang paling perlu terlihat.
 */
export function bandingkanLaporan(
  spg: { itemName: string; itemId?: string | null; qty: number }[],
  toko: { itemName: string; itemId?: string | null; qty: number }[],
): BarisBanding[] {
  const peta = new Map<string, BarisBanding>();
  for (const i of spg) {
    peta.set(i.itemName, {
      itemName: i.itemName,
      itemId: i.itemId ?? null,
      qtySpg: i.qty,
      qtyToko: null,
      selisih: null,
    });
  }
  for (const i of toko) {
    const ada = peta.get(i.itemName);
    if (ada) {
      ada.qtyToko = i.qty;
      ada.itemId ??= i.itemId ?? null;
    } else
      peta.set(i.itemName, {
        itemName: i.itemName,
        itemId: i.itemId ?? null,
        qtySpg: null,
        qtyToko: i.qty,
        selisih: null,
      });
  }
  for (const b of peta.values()) {
    b.selisih = b.qtySpg === null || b.qtyToko === null ? null : Math.abs(b.qtySpg - b.qtyToko);
  }
  return [...peta.values()];
}

/** Stok titipan = dikirim − terjual. Dihitung, tidak disimpan. */
export function stokTitipan(
  dikirim: { itemName: string; qty: number }[],
  terjual: { itemName: string; qty: number }[],
): { itemName: string; dikirim: number; terjual: number; sisa: number }[] {
  const peta = new Map<string, { itemName: string; dikirim: number; terjual: number; sisa: number }>();
  for (const i of dikirim) {
    const ada = peta.get(i.itemName) ?? { itemName: i.itemName, dikirim: 0, terjual: 0, sisa: 0 };
    ada.dikirim += i.qty;
    peta.set(i.itemName, ada);
  }
  for (const i of terjual) {
    const ada = peta.get(i.itemName) ?? { itemName: i.itemName, dikirim: 0, terjual: 0, sisa: 0 };
    ada.terjual += i.qty;
    peta.set(i.itemName, ada);
  }
  for (const b of peta.values()) {
    // Sisa negatif dipertahankan apa adanya, tidak dinolkan: ia berarti toko
    // melaporkan menjual lebih banyak daripada yang pernah dikirim, dan itu
    // pertanyaan yang harus terlihat — bukan disembunyikan jadi nol.
    b.sisa = b.dikirim - b.terjual;
  }
  return [...peta.values()];
}

/**
 * Jatuh tempo tagihan siklus konsinyasi (P54, disetujui pemilik 2026-11-02 malam — "P52–P59:
 * setuju" atas usulan: "Tanggal tagihannya … akhir bulan siklus, sama dengan tanggal jurnalnya.
 * Jatuh temponya dihitung dari tanggal itu ditambah tempo bayar toko. Contoh: siklus Oktober dikunci
 * 5 November, tempo 30 hari → jatuh tempo 30 November"). `tanggalTagihan` = tanggal tagihan siklus
 * (`tanggalPeriode`: akhir bulan siklus, atau hari dikunci kalau dikunci sebelum bulannya habis);
 * jatuh tempo = pukul 00:00 WIB hari itu ditambah tempo pembayaran toko (hari bulat, tidak pernah
 * negatif). Siklus yang dikunci lebih lambat dari temponya lahir sudah lewat jatuh tempo — itu
 * akibat aturan yang disetujui, bukan galat. WIB tanpa jam musim panas, jadi satu hari =
 * 86.400.000 ms.
 */
export function jatuhTempoSiklus(tanggalTagihan: Date, tempoHari: number): Date {
  const hari = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(tanggalTagihan);
  const tempo = Number.isFinite(tempoHari) ? Math.max(0, Math.trunc(tempoHari)) : 0;
  return new Date(new Date(`${hari}T00:00:00+07:00`).getTime() + tempo * 86_400_000);
}
