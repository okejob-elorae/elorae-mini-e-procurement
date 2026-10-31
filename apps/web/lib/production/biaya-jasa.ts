/**
 * Biaya jasa langkah perintah kerja (ongkos jahit/CMT, sablon, bordir, …) yang
 * masuk HPP barang jadi — keputusan sementara pemilik 34 (PSAK 14: biaya
 * konversi bagian dari biaya persediaan).
 *
 * Murni (tanpa Prisma), aman untuk komponen klien. PPN HANYA lewat `pisahPpn`
 * (`lib/finance/pajak/ppn.ts`).
 *
 * Aturannya:
 * - Jasa ditagih per pcs yang LOLOS QC (`WorkOrderStep.servicePrice` × qty
 *   lolos), sama dengan `WorkOrderStep.totalCost` yang sudah ada: barang cacat
 *   tidak dibayar ke pemasok jasa.
 * - "Belum termasuk PPN" (`servicePpnIncluded = false`) berarti pemasok
 *   menambahkan PPN di atas harga — konvensi yang sama dengan baris PO
 *   "Exclude PPN" (`lib/purchase-orders/ppn.ts`) dan kolom harga akhir laporan
 *   HPP. "Sudah termasuk PPN" berarti harga itu sudah memuat PPN. PPN pemasok
 *   dihitung dengan aturan Elorae (12% × DPP nilai lain 11/12) TANPA melihat
 *   status PKP Elorae: yang memungut adalah pemasok.
 * - Status PKP Elorae (`ppnBerlaku`) hanya menentukan perlakuannya: PKP → PPN
 *   jasa menjadi PPN Masukan dan persediaan memikul DPP; belum PKP / non-PKP →
 *   PPN jasa ikut biaya persediaan.
 * - Nilai per penerimaan = nilai kumulatif sesudahnya − nilai kumulatif
 *   sebelumnya, jadi Σ semua penerimaan = nilai seluruh pcs lolos sekaligus,
 *   tanpa sen hilang walau ada pembulatan rupiah PPN.
 */
import { Decimal } from "decimal.js";
import { pisahPpn, ppnBerlaku, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

export type LangkahJasa = {
  id: string;
  supplierId: string;
  /** Harga jasa per pcs. */
  servicePrice: Decimal.Value;
  /** true = harga sudah termasuk PPN; false = pemasok menambahkan PPN di atas harga. */
  servicePpnIncluded: boolean;
  /**
   * `Supplier.isPkp` pemasok jasanya. `false` = pemasok bukan PKP: ia tidak
   * memungut PPN, jadi tagihan = DPP = harga × qty (tanda termasuk/belum PPN
   * diabaikan). `null`/tidak diisi = perilaku lama (PPN dipungut) — layar
   * terima barang jadi dan formulir pemasok memperingatkan statusnya belum diisi.
   */
  pemasokPkp?: boolean | null;
  /** Nama pemasok jasanya (untuk peringatan di layar), opsional. */
  namaPemasok?: string;
};

export type NilaiJasa = {
  /** Nilai jasa tanpa PPN — dasar pemotongan PPh 23/21. */
  dpp: Decimal;
  /** PPN yang dipungut pemasok. */
  ppn: Decimal;
  /** Tagihan pemasok = dpp + ppn — yang menjadi hutang usaha. */
  tagihan: Decimal;
};

const NOL = new Decimal(0);
const NILAI_NOL: NilaiJasa = { dpp: NOL, ppn: NOL, tagihan: NOL };

/** Dari sisi pemasok jasa PPN selalu dipungut, sejak kapan pun. */
export function pengaturanPpnPemasok(p: PengaturanPpn): PengaturanPpn {
  return { ...p, statusPkp: "PKP", berlakuSejak: null };
}

/** Nilai jasa satu langkah untuk `qty` pcs lolos (kumulatif). */
export function nilaiJasaKumulatif(langkah: LangkahJasa, qty: Decimal.Value, pengaturan: PengaturanPpn): NilaiJasa {
  const dasar = new Decimal(langkah.servicePrice).mul(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (dasar.lte(0)) return NILAI_NOL;
  // Pemasok bukan PKP tidak boleh memungut PPN: seluruh harga adalah nilai jasa.
  if (langkah.pemasokPkp === false) return { dpp: dasar, ppn: NOL, tagihan: dasar };
  const r = pisahPpn(dasar.toNumber(), {
    termasukPpn: langkah.servicePpnIncluded,
    pengaturan: pengaturanPpnPemasok(pengaturan),
    tanggal: new Date(0),
  });
  return { dpp: new Decimal(r.dpp), ppn: new Decimal(r.ppn), tagihan: new Decimal(r.total) };
}

export type JasaPerLangkah = NilaiJasa & { id: string; supplierId: string };

export type HasilJasaPenerimaan = {
  perLangkah: JasaPerLangkah[];
  /** Σ tagihan pemasok untuk pcs lolos penerimaan ini — dikredit ke hutang usaha. */
  tagihan: Decimal;
  dpp: Decimal;
  ppn: Decimal;
  /** Elorae PKP pada tanggal penerimaan: PPN jasa boleh dikreditkan. */
  ppnDikreditkan: boolean;
  /** Bagian jasa yang masuk nilai persediaan: DPP bila PPN dikreditkan, tagihan bila tidak. */
  dikapitalisasi: Decimal;
  /** PPN Masukan atas jasa (0 bila tidak dikreditkan). */
  ppnMasukan: Decimal;
};

export function jasaPenerimaan(m: {
  langkah: readonly LangkahJasa[];
  /** Σ qty lolos penerimaan sebelumnya. */
  qtySebelum: Decimal.Value;
  /** Qty lolos penerimaan ini. */
  qtyLolos: Decimal.Value;
  pengaturan: PengaturanPpn;
  tanggal: Date;
}): HasilJasaPenerimaan {
  const sebelum = Decimal.max(NOL, new Decimal(m.qtySebelum));
  const lolos = Decimal.max(NOL, new Decimal(m.qtyLolos));
  const sesudah = sebelum.plus(lolos);
  const perLangkah: JasaPerLangkah[] = m.langkah.map((l) => {
    if (lolos.lte(0)) return { id: l.id, supplierId: l.supplierId, ...NILAI_NOL };
    const a = nilaiJasaKumulatif(l, sebelum, m.pengaturan);
    const b = nilaiJasaKumulatif(l, sesudah, m.pengaturan);
    return {
      id: l.id,
      supplierId: l.supplierId,
      dpp: b.dpp.minus(a.dpp),
      ppn: b.ppn.minus(a.ppn),
      tagihan: b.tagihan.minus(a.tagihan),
    };
  });
  const jumlah = (k: keyof NilaiJasa) => perLangkah.reduce((s, l) => s.plus(l[k]), NOL);
  const tagihan = jumlah("tagihan");
  const dpp = jumlah("dpp");
  const ppn = jumlah("ppn");
  const ppnDikreditkan = ppnBerlaku(m.pengaturan, m.tanggal);
  return {
    perLangkah,
    tagihan,
    dpp,
    ppn,
    ppnDikreditkan,
    dikapitalisasi: ppnDikreditkan ? dpp : tagihan,
    ppnMasukan: ppnDikreditkan ? ppn : NOL,
  };
}

/**
 * Bagi hutang jasa yang TERCATAT di buku (Σ `FGReceipt.serviceCost`) ke
 * langkah-langkah WO menurut hitungan ulang per langkah. Biasanya keduanya
 * sama persis; bila pengaturan PPN berubah di antara penerimaan, Σ dipaksa sama
 * dengan yang tercatat (sisa terbesar, dalam sen) supaya hutang per pemasok
 * menjumlah ke saldo hutang usaha yang dijurnal.
 */
export function bagiHutangJasaPerLangkah(
  tercatat: Decimal.Value,
  hitungan: ReadonlyArray<{ tagihan: Decimal; dpp: Decimal }>,
): Array<{ hutang: Decimal; dasarPotong: Decimal }> {
  if (hitungan.length === 0) return [];
  const totalSen = new Decimal(tercatat).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const senHitungan = hitungan.map((h) => h.tagihan.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
  const jumlahHitungan = senHitungan.reduce((s, x) => s.plus(x), NOL);
  if (jumlahHitungan.eq(totalSen)) {
    return hitungan.map((h) => ({ hutang: h.tagihan, dasarPotong: h.dpp }));
  }

  const bobot = jumlahHitungan.gt(0) ? senHitungan : hitungan.map(() => new Decimal(1));
  const totalBobot = bobot.reduce((s, x) => s.plus(x), NOL);
  const mentah = bobot.map((b) => totalSen.mul(b).div(totalBobot));
  const bulat = mentah.map((x) => x.floor());
  let sisa = totalSen.minus(bulat.reduce((s, x) => s.plus(x), NOL)).toNumber();
  const urutan = mentah
    .map((x, i) => ({ i, pecahan: x.minus(x.floor()) }))
    .sort((a, b) => b.pecahan.comparedTo(a.pecahan) || a.i - b.i);
  for (let k = 0; sisa > 0 && urutan.length > 0; k = (k + 1) % urutan.length) {
    bulat[urutan[k].i] = bulat[urutan[k].i].plus(1);
    sisa -= 1;
  }
  return hitungan.map((h, i) => {
    const hutang = bulat[i].div(100);
    const dasarPotong = h.tagihan.gt(0)
      ? h.dpp.mul(hutang).div(h.tagihan).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : hutang;
    return { hutang, dasarPotong };
  });
}
