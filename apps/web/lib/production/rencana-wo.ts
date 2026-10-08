// Bukan aksi server: aturan formulir perintah kerja baru dan ubah (aman untuk klien).
//
// Formulir baru dan formulir ubah dulu punya salinan aturan masing-masing;
// formulir ubah tidak punya pilihan "ketik jumlah pcs". Keduanya kini memakai
// fungsi di sini.

/** Cara mengisi jumlah: ketik pcs langsung, atau hitung pcs dari bahan utama yang tersedia. */
export type CaraIsiWo = "pcs" | "bahan";

/** `expectedConsumption` disimpan Decimal(10,2): selisih pembulatan paling besar setengah sen. */
const TOLERANSI_SIMPAN = 0.005 + 1e-9;

/**
 * Cara isi yang dipakai saat membuka WO draf yang sudah ada.
 *
 * WO yang dibuat dengan "ketik jumlah pcs" menyimpan kebutuhan = pcs × konsumsi
 * per pcs; WO yang dibuat dari jumlah bahan menyimpan jumlah bahan yang
 * diketik (biasanya bersisa). Membuka WO dengan cara yang sama menjaga
 * angkanya tidak berubah saat disimpan ulang tanpa diubah.
 */
export function caraIsiAwalWo(m: {
  plannedQty: number;
  expectedConsumption: number | null | undefined;
  konsumsiPerPcs: number | null | undefined;
}): CaraIsiWo {
  if (m.expectedConsumption == null || !Number.isFinite(m.expectedConsumption)) return "pcs";
  if (m.konsumsiPerPcs == null || !(m.konsumsiPerPcs > 0)) return "bahan";
  const dariPcs = m.plannedQty * m.konsumsiPerPcs;
  return Math.abs(m.expectedConsumption - dariPcs) <= TOLERANSI_SIMPAN ? "pcs" : "bahan";
}

export type KeadaanFormulirWo = {
  vendor: boolean;
  barangJadi: boolean;
  /** Mode hasil "SKU (per varian)". */
  modeSku: boolean;
  /** Barang jadi sudah selesai dimuat variannya dan ternyata tidak punya varian. */
  tanpaVarian: boolean;
  /** Lebih dari satu varian: isi rasio %, bukan memilih satu. */
  pakaiRasio: boolean;
  totalRasio: number;
  varianTerpilih: boolean;
  /** Barang jadi punya aturan konsumsi (BOM). */
  adaBom: boolean;
  bahanUtama: boolean;
  caraIsi: CaraIsiWo;
  pcs: number;
  jumlahBahan: number;
  menghitung: boolean;
  /** Hasil hitungan sudah ada. */
  adaHasil: boolean;
  jumlahRencana: number;
  stokKurang: boolean;
  rollCukup: boolean;
};

export type AlasanSimpanWo =
  | "VENDOR"
  | "BARANG_JADI"
  | "TANPA_VARIAN"
  | "RASIO"
  | "VARIAN"
  | "BOM"
  | "BAHAN_UTAMA"
  | "JUMLAH_PCS"
  | "JUMLAH_BAHAN"
  | "MENGHITUNG"
  | "BAHAN_KURANG_SATU_PCS"
  | "STOK"
  | "ROLL";

/**
 * Kekurangan PERTAMA menurut urutan isian formulir, atau null bila perintah
 * kerja boleh disimpan. Tombol simpan aktif tepat saat fungsi ini null, jadi
 * kalimat di bawah tombol tidak pernah berbeda dengan keadaan tombolnya.
 */
export function alasanSimpanWo(k: KeadaanFormulirWo): AlasanSimpanWo | null {
  if (!k.vendor) return "VENDOR";
  if (!k.barangJadi) return "BARANG_JADI";
  if (k.modeSku) {
    if (k.tanpaVarian) return "TANPA_VARIAN";
    if (k.pakaiRasio) {
      if (Math.abs(k.totalRasio - 100) >= 0.01) return "RASIO";
    } else if (!k.varianTerpilih) {
      return "VARIAN";
    }
  }
  if (!k.adaBom) return "BOM";
  if (!k.bahanUtama) return "BAHAN_UTAMA";
  if (k.caraIsi === "pcs" && !(k.pcs > 0)) return "JUMLAH_PCS";
  if (k.caraIsi === "bahan" && !(k.jumlahBahan > 0)) return "JUMLAH_BAHAN";
  if (k.menghitung || !k.adaHasil) return "MENGHITUNG";
  if (!(k.jumlahRencana > 0)) return "BAHAN_KURANG_SATU_PCS";
  if (k.stokKurang) return "STOK";
  if (!k.rollCukup) return "ROLL";
  return null;
}
