// Bukan aksi server: satu definisi angka setoran perintah kerja (aman untuk klien).
//
// Rincian WO, layar terima barang jadi, rekonsiliasi dan daftar WO dulu membaca
// sumber berbeda: rincian dari kolom `WorkOrder.actualQty`, layar terima dari
// jumlah `qtyReceived` dokumen penerimaan (TERMASUK cacat). Untuk WO yang sama
// sisanya berbeda begitu ada cacat. Semua layar kini memakai fungsi ini.

/** Satu dokumen penerimaan barang jadi (`FGReceipt`), bentuk mentah atau sudah diserialisasi. */
export type BarisPenerimaanSetoran = {
  qtyReceived: unknown;
  qtyRejected?: unknown;
  qtyAccepted: unknown;
};

export type AngkaSetoranWo = {
  /** Jumlah rencana (pcs). */
  target: number;
  /** Semua yang diserahkan CMT, termasuk cacat (Σ `qtyReceived`). */
  disetor: number;
  /** Cacat (Σ `qtyRejected`). */
  cacat: number;
  /** Lolos QC dan masuk stok (Σ `qtyAccepted`). Penentu "selesai", sama dengan penulis penerimaan. */
  masukStok: number;
  /** Target − masuk stok (tidak pernah negatif): cacat harus diganti, jadi tetap dihitung kurang. */
  kurang: number;
  /** Masuk stok − target bila melebihi. */
  lebih: number;
  /** Masuk stok ÷ target, dibulatkan, 0–100. */
  persen: number;
  /** Jumlah dokumen penerimaan. */
  jumlahPenerimaan: number;
  /**
   * Setoran yang tercatat di kolom `actualQty` tetapi tidak punya dokumen
   * penerimaan (data lama/contoh). 0 bila kolom itu cocok dengan dokumennya.
   * Angka lain di objek ini hanya menghitung dokumen.
   */
  tanpaDokumen: number;
};

function angka(nilai: unknown): number {
  const n = Number(nilai);
  return Number.isFinite(n) ? n : 0;
}

/** Bulatkan ke 2 desimal supaya jumlah Decimal (mis. 0,1 + 0,2) tidak memunculkan ekor. */
function rapi(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Angka setoran WO dari dokumen penerimaannya.
 *
 * `actualQty` hanya dipakai untuk mendeteksi setoran tanpa dokumen; ia tidak
 * pernah menggantikan angka dokumen.
 */
export function angkaSetoranWo(masukan: {
  plannedQty: unknown;
  actualQty?: unknown;
  receipts?: readonly BarisPenerimaanSetoran[] | null;
}): AngkaSetoranWo {
  const target = Math.max(0, angka(masukan.plannedQty));
  const daftar = masukan.receipts ?? [];
  let disetor = 0;
  let cacat = 0;
  let masukStok = 0;
  for (const r of daftar) {
    disetor += angka(r.qtyReceived);
    cacat += angka(r.qtyRejected);
    masukStok += angka(r.qtyAccepted);
  }
  disetor = rapi(disetor);
  cacat = rapi(cacat);
  masukStok = rapi(masukStok);
  const tercatat = masukan.actualQty == null ? masukStok : rapi(angka(masukan.actualQty));
  return {
    target,
    disetor,
    cacat,
    masukStok,
    kurang: rapi(Math.max(0, target - masukStok)),
    lebih: rapi(Math.max(0, masukStok - target)),
    persen: target > 0 ? Math.min(100, Math.max(0, Math.round((masukStok / target) * 100))) : 0,
    jumlahPenerimaan: daftar.length,
    tanpaDokumen: rapi(tercatat - masukStok),
  };
}

/**
 * Berapa pcs dari setoran yang sedang diisi yang membuat masuk stok melewati
 * target (0 bila tidak). Peringatan di layar terima memakai ini.
 */
export function lebihDariTarget(angkaWo: AngkaSetoranWo, masukStokBaru: number): number {
  return rapi(Math.max(0, Math.max(0, masukStokBaru) - angkaWo.kurang));
}
