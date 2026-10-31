/**
 * Pembebanan biaya perintah kerja (WO) ke penerimaan barang jadi.
 *
 * Murni (tanpa Prisma) supaya bisa diuji dengan angka — dan aman untuk
 * komponen klien: pratinjau di layar Terima barang jadi memakai fungsi yang
 * sama dengan yang dicatat `receiveFG`.
 *
 * Biaya penerimaan = bahan + jasa langkah WO + biaya tambahan per pcs
 * (`rincianBiayaPenerimaan`, keputusan sementara pemilik 34 — ongkos jahit
 * masuk HPP, PSAK 14). Bahan dibebankan dengan aturan di bawah; jasa dan biaya
 * tambahan per pcs LOLOS (`./biaya-jasa.ts`).
 *
 * Aturan BAHAN:
 * - Kemajuan diukur dengan qty DITERIMA (lolos + reject): bahan untuk barang
 *   reject tetap habis, jadi biayanya dipikul barang yang lolos.
 * - Penerimaan ini memikul bagian sisa biaya sebanding sisa rencana:
 *   sisaBiaya × qtyDiterima ÷ sisaRencana, dibulatkan ke sen.
 * - Penerimaan yang menutup (atau melewati) rencana memikul SELURUH sisa biaya,
 *   jadi Σ biaya semua penerimaan = total biaya bahan, tanpa sen hilang.
 * - Penerimaan tanpa barang lolos tidak memikul apa pun; sisanya tetap
 *   menunggu penerimaan berikutnya.
 */
import { Decimal } from "decimal.js";
import type { PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { jasaPenerimaan, type HasilJasaPenerimaan, type LangkahJasa } from "./biaya-jasa";

export interface MasukanBiayaPenerimaan {
  /** Σ biaya bahan yang sudah dikeluarkan ke WO. */
  totalBiayaBahan: Decimal.Value;
  qtyRencana: Decimal.Value;
  /** Σ biaya BAHAN penerimaan sebelumnya (`bagianBahanPenerimaan`). */
  sudahDibebankan: Decimal.Value;
  /** Σ qty diterima (lolos + reject) penerimaan sebelumnya. */
  sudahDiterima: Decimal.Value;
  /** Penerimaan ini: lolos + reject. */
  qtyDiterima: Decimal.Value;
  /** Penerimaan ini: hanya yang lolos QC (masuk stok). */
  qtyLolos: Decimal.Value;
}

export interface HasilBiayaPenerimaan {
  /** Biaya bahan penerimaan ini, dua desimal. */
  biaya: Decimal;
  /** biaya ÷ qtyLolos, presisi penuh (bulatkan saat disimpan). */
  biayaPerUnit: Decimal;
  /** Penerimaan ini menutup sisa rencana dan memikul seluruh sisa biaya. */
  penerimaanTerakhir: boolean;
}

const NOL = new Decimal(0);

export function hitungBiayaPenerimaanFG(m: MasukanBiayaPenerimaan): HasilBiayaPenerimaan {
  const total = new Decimal(m.totalBiayaBahan);
  const sisaBiaya = Decimal.max(NOL, total.minus(m.sudahDibebankan));
  const sisaRencana = new Decimal(m.qtyRencana).minus(m.sudahDiterima);
  const qtyDiterima = new Decimal(m.qtyDiterima);
  const qtyLolos = new Decimal(m.qtyLolos);
  const penerimaanTerakhir = qtyDiterima.gte(sisaRencana);

  if (qtyLolos.lte(0)) {
    return { biaya: NOL, biayaPerUnit: NOL, penerimaanTerakhir };
  }

  const biaya = penerimaanTerakhir
    ? sisaBiaya.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : sisaBiaya.mul(qtyDiterima).div(sisaRencana).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return { biaya, biayaPerUnit: biaya.div(qtyLolos), penerimaanTerakhir };
}

/**
 * Bagi `biaya` (dua desimal) ke beberapa baris varian sebanding qty, dalam sen,
 * dengan metode sisa terbesar — Σ hasil selalu sama persis dengan `biaya`.
 */
export function bagiBiayaPerBaris(biaya: Decimal, qtys: Decimal.Value[]): Decimal[] {
  const q = qtys.map((x) => Decimal.max(NOL, new Decimal(x)));
  const totalQty = q.reduce((s, x) => s.plus(x), NOL);
  if (totalQty.lte(0)) return q.map(() => NOL);

  const totalSen = biaya.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const mentah = q.map((x) => totalSen.mul(x).div(totalQty));
  const bulat = mentah.map((x) => x.floor());
  let sisa = totalSen.minus(bulat.reduce((s, x) => s.plus(x), NOL)).toNumber();

  const urutan = mentah
    .map((x, i) => ({ i, pecahan: x.minus(x.floor()) }))
    .filter((r) => q[r.i].gt(0))
    .sort((a, b) => b.pecahan.comparedTo(a.pecahan) || a.i - b.i);
  for (let k = 0; sisa > 0 && urutan.length > 0; k = (k + 1) % urutan.length) {
    bulat[urutan[k].i] = bulat[urutan[k].i].plus(1);
    sisa -= 1;
  }
  return bulat.map((sen) => sen.div(100));
}

type AngkaTersimpan = Decimal.Value | { toString(): string } | null | undefined;

function angka(v: AngkaTersimpan): Decimal | null {
  if (v == null) return null;
  const d = new Decimal(typeof v === "number" || typeof v === "string" || v instanceof Decimal ? v : v.toString());
  return d.isFinite() ? d : null;
}

/**
 * Bagian BAHAN sebuah penerimaan yang sudah tercatat. Penerimaan sebelum
 * ongkos jahit masuk HPP hanya memikul bahan, jadi `totalCostValue`-nya bahan
 * seluruhnya (dan `materialCost`-nya sama). Sejak itu `totalCostValue` memuat
 * jasa dan biaya tambahan — pembebanan bahan berikutnya dan batas nilai bahan
 * yang kembali (`batasNilaiKembali`) WAJIB membaca angka ini, bukan
 * `totalCostValue`.
 */
export function bagianBahanPenerimaan(r: { materialCost: AngkaTersimpan; totalCostValue: AngkaTersimpan }): Decimal {
  return angka(r.materialCost) ?? angka(r.totalCostValue) ?? NOL;
}

/** Semua yang dibutuhkan untuk menghitung biaya penerimaan berikutnya satu WO. */
export type DasarBiayaPenerimaan = {
  /** Σ biaya bahan yang dikeluarkan ke WO − nilai bahan yang sudah kembali. */
  totalBiayaBahan: Decimal.Value;
  qtyRencana: Decimal.Value;
  /** Σ bagian bahan penerimaan sebelumnya. */
  bahanSudahDibebankan: Decimal.Value;
  /** Σ qty disetor (lolos + cacat) penerimaan sebelumnya. */
  sudahDiterima: Decimal.Value;
  /** Σ qty lolos penerimaan sebelumnya. */
  sudahLolos: Decimal.Value;
  /** Langkah jasa WO (`WorkOrderStep`), harga per pcs. */
  langkah: LangkahJasa[];
  /** `WorkOrder.hppAdditionalCost` — biaya tambahan per pcs (kemasan, dll.); null = tidak ada. */
  biayaTambahanPerPcs: Decimal.Value | null;
  pengaturanPpn: PengaturanPpn;
};

export type MasukanPenerimaan = {
  /** Disetor: lolos + cacat. */
  qtyDiterima: Decimal.Value;
  /** Lolos QC (masuk stok). */
  qtyLolos: Decimal.Value;
  /** Tanggal penerimaan — menentukan apakah PPN jasa boleh dikreditkan. */
  tanggal: Date;
};

export type RincianBiayaPenerimaan = {
  /** Biaya bahan penerimaan ini (dikredit dari persediaan bahan). */
  bahan: Decimal;
  /** Biaya bahan per pcs lolos — dasar harga jual otomatis (tidak ikut naik karena ongkos jahit). */
  bahanPerUnit: Decimal;
  jasa: HasilJasaPenerimaan;
  /** Biaya tambahan per pcs × pcs lolos. */
  tambahan: Decimal;
  /** Nilai persediaan barang jadi = bahan + jasa yang dikapitalisasi + tambahan. */
  total: Decimal;
  /** total ÷ pcs lolos (presisi penuh). */
  perUnit: Decimal;
  /** PPN Masukan atas jasa (0 bila Elorae belum/tidak PKP). */
  ppnMasukan: Decimal;
  penerimaanTerakhir: boolean;
};

/**
 * Biaya lengkap satu penerimaan. Σ semua penerimaan satu WO = biaya bahan WO +
 * Σ jasa langkah × pcs lolos + biaya tambahan × pcs lolos, tanpa sen hilang.
 */
export function rincianBiayaPenerimaan(dasar: DasarBiayaPenerimaan, m: MasukanPenerimaan): RincianBiayaPenerimaan {
  const bahan = hitungBiayaPenerimaanFG({
    totalBiayaBahan: dasar.totalBiayaBahan,
    qtyRencana: dasar.qtyRencana,
    sudahDibebankan: dasar.bahanSudahDibebankan,
    sudahDiterima: dasar.sudahDiterima,
    qtyDiterima: m.qtyDiterima,
    qtyLolos: m.qtyLolos,
  });
  const lolos = Decimal.max(NOL, new Decimal(m.qtyLolos));
  const sebelum = Decimal.max(NOL, new Decimal(dasar.sudahLolos));
  const jasa = jasaPenerimaan({
    langkah: dasar.langkah,
    qtySebelum: sebelum,
    qtyLolos: lolos,
    pengaturan: dasar.pengaturanPpn,
    tanggal: m.tanggal,
  });
  const tarifTambahan = dasar.biayaTambahanPerPcs == null ? NOL : Decimal.max(NOL, new Decimal(dasar.biayaTambahanPerPcs));
  const kumulatif = (q: Decimal) => tarifTambahan.mul(q).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const tambahan = lolos.gt(0) ? kumulatif(sebelum.plus(lolos)).minus(kumulatif(sebelum)) : NOL;
  const total = bahan.biaya.plus(jasa.dikapitalisasi).plus(tambahan);
  return {
    bahan: bahan.biaya,
    bahanPerUnit: bahan.biayaPerUnit,
    jasa,
    tambahan,
    total,
    perUnit: lolos.gt(0) ? total.div(lolos) : NOL,
    ppnMasukan: jasa.ppnMasukan,
    penerimaanTerakhir: bahan.penerimaanTerakhir,
  };
}

export type KomponenJurnalPenerimaan = {
  /** Debit persediaan barang jadi (`totalCostValue`). */
  persediaan: number;
  /** Debit PPN Masukan atas jasa. */
  ppnMasukan: number;
  /** Kredit persediaan bahan. */
  bahan: number;
  /** Kredit hutang usaha (tagihan jasa pemasok). */
  jasa: number;
  /** Kredit biaya yang masih harus dibayar (biaya tambahan per pcs). */
  tambahan: number;
};

/**
 * Komponen jurnal penerimaan barang jadi dari kolom yang TERSIMPAN — jurnal
 * selalu bisa dibuat ulang dari dokumennya tanpa membaca pengaturan PPN lagi.
 * Kolom `FGReceipt`:
 * - `materialCost` bahan, `serviceCost` TAGIHAN jasa (hutang, termasuk PPN yang
 *   dipungut pemasok), `additionalCost` biaya tambahan, `totalCostValue` nilai
 *   persediaan;
 * - PPN Masukan tidak punya kolom: = bahan + jasa + tambahan − persediaan
 *   (0 bila Elorae belum/tidak PKP).
 * Penerimaan lama (sebelum ongkos jahit masuk HPP; `serviceCost` dan
 * `additionalCost` null) hanya memindahkan bahan sebesar `totalCostValue`.
 * Rincian yang tidak masuk akal (persediaan melebihi Σ kredit) → null.
 */
export function komponenJurnalPenerimaan(r: {
  materialCost: AngkaTersimpan;
  serviceCost: AngkaTersimpan;
  additionalCost: AngkaTersimpan;
  totalCostValue: AngkaTersimpan;
}): KomponenJurnalPenerimaan | null {
  const sen = (d: Decimal | null) => (d ?? NOL).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const persediaan = sen(angka(r.totalCostValue));
  const jasaAda = angka(r.serviceCost);
  const tambahanAda = angka(r.additionalCost);
  if (jasaAda == null && tambahanAda == null) {
    return { persediaan: persediaan / 100, ppnMasukan: 0, bahan: persediaan / 100, jasa: 0, tambahan: 0 };
  }
  const bahan = sen(angka(r.materialCost));
  const jasa = sen(jasaAda);
  const tambahan = sen(tambahanAda);
  const ppnMasukan = bahan + jasa + tambahan - persediaan;
  if (ppnMasukan < 0) return null;
  return { persediaan: persediaan / 100, ppnMasukan: ppnMasukan / 100, bahan: bahan / 100, jasa: jasa / 100, tambahan: tambahan / 100 };
}
