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
};

/**
 * Tahap siklus, diperiksa berurutan — yang pertama cocok itulah tahapnya.
 *
 * `bayar_spg` DILEWATI kalau tokonya belum punya SPG terdaftar. Kalau tidak,
 * siklus toko tanpa SPG menggantung di "menunggu bayar gaji" selamanya, dan
 * rantainya tidak pernah sampai ke nota maupun faktur pajak.
 */
export function tahapSiklus(b: BahanTahap): TahapSiklus {
  if (!b.adaLaporanSpg || !b.adaLaporanToko) return 'laporan';
  if (!b.terkunci) return 'cocok';
  if (b.adaSpg && !b.semuaKomisiDibayar) return 'bayar_spg';
  if (!b.adaNota) return 'nota';
  if (!b.adaFakturPajak) return 'pajak';
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
  spg: { itemName: string; qty: number }[],
  toko: { itemName: string; qty: number }[],
): BarisBanding[] {
  const peta = new Map<string, BarisBanding>();
  for (const i of spg) {
    peta.set(i.itemName, {
      itemName: i.itemName,
      qtySpg: i.qty,
      qtyToko: null,
      selisih: null,
    });
  }
  for (const i of toko) {
    const ada = peta.get(i.itemName);
    if (ada) ada.qtyToko = i.qty;
    else
      peta.set(i.itemName, {
        itemName: i.itemName,
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

export type BarisTerjual = { qty: number; commissionPerPcs: number };

/**
 * Bagi komisi antar SPG satu toko.
 *
 * Komisi dihitung dari angka RESMI yang sudah dikunci, bukan dari laporan mana
 * pun — itulah gunanya mengunci. Kalau satu toko punya lebih dari satu SPG,
 * komisinya dibagi rata; gaji pokok tetap utuh masing-masing.
 *
 * Sisa pembagian yang tidak habis diberikan ke SPG pertama, bukan dibuang.
 * Membuangnya berarti total yang dibayarkan tidak pernah sama dengan komisi
 * yang dihitung, dan selisih receh itu muncul lagi setiap bulan.
 */
export function bagiKomisi(
  terjual: BarisTerjual[],
  jumlahSpg: number,
): { totalKomisi: number; perSpg: number[] } {
  const totalKomisi = terjual.reduce((s, b) => s + b.qty * b.commissionPerPcs, 0);
  if (jumlahSpg <= 0) return { totalKomisi, perSpg: [] };

  const dasar = Math.floor(totalKomisi / jumlahSpg);
  const sisa = totalKomisi - dasar * jumlahSpg;
  return {
    totalKomisi,
    perSpg: Array.from({ length: jumlahSpg }, (_, i) => (i === 0 ? dasar + sisa : dasar)),
  };
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
