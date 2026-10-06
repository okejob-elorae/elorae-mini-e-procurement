/**
 * Pembebanan biaya bahan perintah kerja (WO) ke penerimaan barang jadi.
 *
 * Murni (tanpa Prisma) supaya bisa diuji dengan angka. Aturannya:
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

export interface MasukanBiayaPenerimaan {
  /** Σ biaya bahan yang sudah dikeluarkan ke WO. */
  totalBiayaBahan: Decimal.Value;
  qtyRencana: Decimal.Value;
  /** Σ biaya (totalCostValue) penerimaan sebelumnya. */
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
