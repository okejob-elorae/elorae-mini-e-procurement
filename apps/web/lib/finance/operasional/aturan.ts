import type { PostingRole } from "@/lib/constants/journal-roles";
import type { AutoJournalLine } from "@/lib/finance/journal";
import { KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { nilaiPerPeranPersediaan, peranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { gabungBaris, jumlahSen, keSen, type BarisBertanda } from "@/lib/finance/lapangan/aturan";
import { memoPeranDpp } from "@/lib/finance/pajak/jurnal-ppn";
import { pisahPpn, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * Aturan jurnal OPERASIONAL — konsinyasi, komisi, barang hilang, gudang
 * rusak, stok manual, retur ke pemasok, biaya perjalanan. MURNI (tanpa
 * Prisma): aman untuk komponen klien dan dites tanpa basis data. Pembaca data
 * dan penulisnya di `jurnal.ts`, kait pasca-commit di `kait.ts`, sapuan di
 * `sapuan.ts`.
 *
 * Nilai persediaan SELALU nilai yang bergerak di kartu stok (penyesuaian stok
 * yang ditulis dokumennya, qty × harga rata-rata saat itu), supaya buku besar
 * = kartu stok. Persediaan di toko konsinyasi bernilai BIAYA SAAT DIKIRIM
 * (rata-rata tertimbang kiriman barang itu, `biaya-konsi.ts`).
 *
 * Penjualan SPG TIDAK dijurnal sendiri (keputusan sementara pemilik no. 37):
 * di toko putus barangnya sudah milik toko sejak nota tagihan, di toko
 * konsinyasi pendapatannya diakui lewat siklus yang dikunci.
 */

export const SUMBER_OPERASIONAL = {
  KIRIM_KONSI: "CONSIGNMENT_SHIPMENT",
  PESANAN_KONSI: "CONSIGNMENT_ORDER",
  RETUR_KONSI: "CONSIGNMENT_RETURN",
  SIKLUS_KONSI: "CONSIGNMENT_CYCLE",
  KOMISI_KONSI: "CONSIGNMENT_COMMISSION",
  BAYAR_GAJI_KONSI: "CONSIGNMENT_COMMISSION_PAYMENT",
  BAYAR_TOKO_KONSI: "CONSIGNMENT_PAYMENT",
  KOMISI_SPG: "SPG_COMMISSION",
  BAYAR_KOMISI_SPG: "SPG_COMMISSION_PAYMENT",
  BARANG_HILANG: "STOCK_LOSS",
  POTONG_SALES: "LOSS_SALES_DEDUCTION",
  GUDANG_RUSAK: "DAMAGED_STOCK",
  STOK_MANUAL: "STOCK_ADJUSTMENT",
  RETUR_PEMASOK: "VENDOR_RETURN",
  BIAYA_PERJALANAN: "TRAVEL_CLAIM",
  BAYAR_BIAYA_PERJALANAN: "TRAVEL_CLAIM_PAYMENT",
} as const;

export type SumberOperasional = (typeof SUMBER_OPERASIONAL)[keyof typeof SUMBER_OPERASIONAL];

export const SEMUA_SUMBER_OPERASIONAL: readonly SumberOperasional[] = Object.values(SUMBER_OPERASIONAL);

/**
 * Sumber yang jurnalnya DISELARASKAN bergenerasi (`<id>`, `<id>#2`, … lewat
 * `lib/finance/lapangan/selaras.ts`): keadaannya bisa berubah sesudah dijurnal
 * (kunci siklus dibuka, pembayaran dibatalkan, keputusan barang hilang
 * dibatalkan, komisi ditetapkan ulang, hitungan retur dipindah toko).
 */
export const SUMBER_BERGENERASI_OPERASIONAL: readonly SumberOperasional[] = [
  SUMBER_OPERASIONAL.RETUR_KONSI,
  SUMBER_OPERASIONAL.SIKLUS_KONSI,
  SUMBER_OPERASIONAL.KOMISI_KONSI,
  SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI,
  SUMBER_OPERASIONAL.KOMISI_SPG,
  SUMBER_OPERASIONAL.BARANG_HILANG,
];

/**
 * `kind` di metadata `JOURNAL_PENDING` (`{ docId, kind, reason, role }`).
 * KONTRAK dengan `lib/finance/jurnal-tertunda.ts` dan
 * `lib/notifications/navigation.ts` — keduanya memetakan kind yang sama.
 */
export const JENIS_TERTUNDA_OPERASIONAL: Readonly<Record<SumberOperasional, string>> = {
  CONSIGNMENT_SHIPMENT: "konsi_kirim",
  CONSIGNMENT_ORDER: "konsi_pesanan",
  CONSIGNMENT_RETURN: "konsi_retur",
  CONSIGNMENT_CYCLE: "konsi_siklus",
  CONSIGNMENT_COMMISSION: "konsi_komisi",
  CONSIGNMENT_COMMISSION_PAYMENT: "konsi_gaji_bayar",
  CONSIGNMENT_PAYMENT: "konsi_bayar_toko",
  SPG_COMMISSION: "komisi_spg",
  SPG_COMMISSION_PAYMENT: "komisi_spg_bayar",
  STOCK_LOSS: "barang_hilang",
  LOSS_SALES_DEDUCTION: "potong_sales",
  DAMAGED_STOCK: "gudang_rusak",
  STOCK_ADJUSTMENT: "stok_manual",
  VENDOR_RETURN: "retur_pemasok",
  TRAVEL_CLAIM: "biaya_perjalanan",
  TRAVEL_CLAIM_PAYMENT: "biaya_perjalanan_bayar",
};

/** Nama jenis dokumen untuk kalimat notifikasi (Bahasa Indonesia). */
export const NAMA_SUMBER_OPERASIONAL: Readonly<Record<SumberOperasional, string>> = {
  CONSIGNMENT_SHIPMENT: "kiriman titipan konsinyasi",
  CONSIGNMENT_ORDER: "kiriman pesanan konsinyasi",
  CONSIGNMENT_RETURN: "retur toko konsinyasi",
  CONSIGNMENT_CYCLE: "siklus konsinyasi",
  CONSIGNMENT_COMMISSION: "gaji & komisi SPG konsinyasi",
  CONSIGNMENT_COMMISSION_PAYMENT: "pembayaran gaji SPG konsinyasi",
  CONSIGNMENT_PAYMENT: "pembayaran toko konsinyasi",
  SPG_COMMISSION: "komisi SPG toko putus",
  SPG_COMMISSION_PAYMENT: "pembayaran komisi SPG",
  STOCK_LOSS: "barang hilang",
  LOSS_SALES_DEDUCTION: "potongan beban barang hilang sales",
  DAMAGED_STOCK: "keputusan gudang barang rusak",
  STOCK_ADJUSTMENT: "penyesuaian stok manual",
  VENDOR_RETURN: "retur ke pemasok",
  TRAVEL_CLAIM: "biaya perjalanan",
  TRAVEL_CLAIM_PAYMENT: "pembayaran biaya perjalanan",
};

export function sumberOperasionalDariJenis(kind: string): SumberOperasional | null {
  for (const s of SEMUA_SUMBER_OPERASIONAL) if (JENIS_TERTUNDA_OPERASIONAL[s] === kind) return s;
  return null;
}

export function bacaSumberOperasional(v: unknown): SumberOperasional | null {
  return typeof v === "string" && (SEMUA_SUMBER_OPERASIONAL as readonly string[]).includes(v) ? (v as SumberOperasional) : null;
}

// ── Tanggal ─────────────────────────────────────────────────────────────────

const WIB_MS = 7 * 3_600_000;

/** Hari terakhir bulan (tahun, bulan 1–12) pukul 00.00 WIB. */
export function akhirBulanWib(tahun: number, bulan: number): Date {
  return new Date(Date.UTC(tahun, bulan, 0) - WIB_MS);
}

/** "YYYY-MM" → [tahun, bulan], atau null. */
export function bacaPeriode(periode: string): [number, number] | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periode);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Id dokumen jurnal komisi SPG toko putus: satu per toko × bulan. */
export function idKomisiSpg(storeId: string, periode: string): string {
  return `${storeId}:${periode}`;
}

export function bacaIdKomisiSpg(id: string): { storeId: string; periode: string } | null {
  const i = id.lastIndexOf(":");
  if (i <= 0) return null;
  const storeId = id.slice(0, i);
  const periode = id.slice(i + 1);
  return bacaPeriode(periode) ? { storeId, periode } : null;
}

/**
 * Tanggal jurnal siklus konsinyasi / komisi bulanan: akhir bulan periodenya
 * (penjualannya terjadi di bulan itu), tetapi tidak sesudah saat angkanya
 * dikunci — siklus yang dikunci sebelum bulannya habis dijurnal saat dikunci.
 */
export function tanggalPeriode(tahun: number, bulan: number, dikunci: Date | null): Date {
  const akhir = akhirBulanWib(tahun, bulan);
  return dikunci && dikunci.getTime() < akhir.getTime() ? dikunci : akhir;
}

// ── Baris jurnal ────────────────────────────────────────────────────────────

const KONSI: KanalJurnal = KANAL_JURNAL.KONSINYASI;

type NilaiBarang = { tipeBarang: string | null | undefined; nilai: number };

/** Barang keluar/masuk persediaan menurut tipenya (`peranPersediaan`), dalam sen. */
function barisPersediaan(nilai: readonly NilaiBarang[], arah: 1 | -1): BarisBertanda[] {
  return nilaiPerPeranPersediaan(nilai).map((p) => ({ role: p.role, sen: arah * keSen(p.nilai) }));
}

/**
 * Barang dikirim ke toko konsinyasi (kiriman titipan, atau pesanan konsinyasi
 * yang disetujui): pindah gudang, bukan penjualan.
 *   DR INVENTORY_CONSIGNMENT / CR persediaan gudang (biaya kartu stok)
 */
export function barisPindahKonsi(b: { storeId: string; keluar: readonly NilaiBarang[] }): BarisBertanda[] {
  const keluar = barisPersediaan(b.keluar, -1);
  const nilai = -jumlahSen(keluar);
  if (nilai === 0 && keluar.length === 0) return [];
  return gabungBaris([{ role: "INVENTORY_CONSIGNMENT", sen: nilai, storeId: b.storeId }, ...keluar]);
}

/**
 * Barang kembali dari toko konsinyasi (hitungan gudang/NRI):
 *   DR persediaan gudang (barang layak, nilai kartu stok)
 *   DR INVENTORY_DAMAGED (barang rusak/kedaluwarsa, nilai gudang rusak)
 *   CR INVENTORY_CONSIGNMENT (biaya saat dikirim)
 *   selisih harga rata-rata → INVENTORY_VARIANCE
 */
export function barisReturKonsi(b: {
  storeId: string | null;
  stokLayak: readonly NilaiBarang[];
  rusak: number;
  biayaKonsi: number;
}): BarisBertanda[] {
  const masuk = barisPersediaan(b.stokLayak, 1);
  const rusak = keSen(b.rusak);
  if (rusak !== 0) masuk.push({ role: "INVENTORY_DAMAGED", sen: rusak });
  const konsi = keSen(b.biayaKonsi);
  const selisih = jumlahSen(masuk) - konsi;
  return gabungBaris([
    ...masuk,
    { role: "INVENTORY_CONSIGNMENT", sen: -konsi, storeId: b.storeId },
    { role: "INVENTORY_VARIANCE", sen: -selisih },
  ]);
}

/**
 * Siklus konsinyasi DIKUNCI (keputusan sementara pemilik no. 36: pendapatan =
 * NETO harga terima Elorae, diakui dari angka resmi siklus):
 *   DR AR_CONSIGNMENT (tagihan = laku resmi − promo Elorae)
 *   DR SALES_DISCOUNT (bagian DPP promo yang ditanggung Elorae)
 *   CR SALES_REVENUE (DPP laku resmi) / CR PPN_KELUARAN (PPN atas tagihan)
 *   DR AR_CONSIGNMENT / CR LOSS_RECOVERY (beban barang hilang ditagihkan ke toko)
 *   DR COGS / CR INVENTORY_CONSIGNMENT (biaya saat dikirim)
 * Angka konsinyasi selalu dibaca TERMASUK PPN: tagihan modul adalah yang
 * dibayar toko, jadi piutang buku besar sama persis dengan tagihannya.
 */
export function barisSiklusKonsi(b: {
  storeId: string;
  lakuResmi: number;
  promoElorae: number;
  bebanHilang: number;
  hpp: number;
  pengaturanPpn: PengaturanPpn;
  tanggal: Date;
}): BarisBertanda[] {
  const baris: BarisBertanda[] = [];
  const laku = keSen(b.lakuResmi);
  const bersih = laku - keSen(b.promoElorae);
  if (laku !== 0 || bersih !== 0) {
    const opsi = { termasukPpn: true, pengaturan: b.pengaturanPpn, tanggal: b.tanggal };
    const pLaku = pisahPpn(laku / 100, opsi);
    const pBersih = pisahPpn(bersih / 100, opsi);
    baris.push({ role: "AR_CONSIGNMENT", sen: keSen(pBersih.total), storeId: b.storeId });
    baris.push({ role: "SALES_REVENUE", sen: -keSen(pLaku.dpp), channel: KONSI, storeId: b.storeId });
    baris.push({ role: "SALES_DISCOUNT", sen: keSen(pLaku.dpp) - keSen(pBersih.dpp), channel: KONSI, storeId: b.storeId });
    if (keSen(pBersih.ppn) !== 0) baris.push({ role: "PPN_KELUARAN", sen: -keSen(pBersih.ppn) });
  }
  const beban = keSen(b.bebanHilang);
  if (beban !== 0) {
    baris.push({ role: "AR_CONSIGNMENT", sen: beban, storeId: b.storeId });
    baris.push({ role: "LOSS_RECOVERY", sen: -beban, channel: KONSI, storeId: b.storeId });
  }
  const hpp = keSen(b.hpp);
  if (hpp !== 0) {
    baris.push({ role: "COGS", sen: hpp, channel: KONSI, storeId: b.storeId });
    baris.push({ role: "INVENTORY_CONSIGNMENT", sen: -hpp, storeId: b.storeId });
  }
  return gabungBaris(baris);
}

/**
 * Komisi (dan gaji pokok SPG konsinyasi) DITETAPKAN:
 *   DR beban komisi (bruto) / CR COMMISSION_PAYABLE
 *   DR COMMISSION_PAYABLE / CR LOSS_RECOVERY (potongan beban barang hilang)
 */
export function barisKomisi(b: {
  peranBeban: Extract<PostingRole, "SPG_COMMISSION_EXPENSE" | "SALES_COMMISSION_EXPENSE">;
  bruto: number;
  potongan: number;
  storeId?: string | null;
  kanal?: KanalJurnal | null;
}): BarisBertanda[] {
  const bruto = keSen(b.bruto);
  const potong = keSen(b.potongan);
  return gabungBaris([
    { role: b.peranBeban, sen: bruto, channel: b.kanal ?? null, storeId: b.storeId ?? null },
    { role: "COMMISSION_PAYABLE", sen: -bruto },
    { role: "COMMISSION_PAYABLE", sen: potong },
    { role: "LOSS_RECOVERY", sen: -potong, channel: b.kanal ?? null, storeId: b.storeId ?? null },
  ]);
}

/**
 * Gaji/komisi DIBAYAR (yang diterima = bruto − potongan):
 *   DR COMMISSION_PAYABLE / CR BANK.
 * Keputusan sementara: komisi dibayar lewat bank — dokumennya tidak menyimpan rekening.
 */
export function barisBayarKomisi(nilai: number): BarisBertanda[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: "COMMISSION_PAYABLE", sen },
    { role: "BANK", sen: -sen },
  ]);
}

/** Peran kas untuk cara bayar toko: tunai → kas, transfer/giro → bank. */
export function peranKasCaraBayar(cara: string): Extract<PostingRole, "BANK" | "CASH"> {
  return cara === "tunai" ? "CASH" : "BANK";
}

/** Pembayaran toko konsinyasi: DR BANK/CASH / CR AR_CONSIGNMENT. Dibatalkan → nol. */
export function barisBayarTokoKonsi(b: { storeId: string; nilai: number; cara: string; batal: boolean }): BarisBertanda[] {
  if (b.batal) return [];
  const sen = keSen(b.nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: peranKasCaraBayar(b.cara), sen },
    { role: "AR_CONSIGNMENT", sen: -sen, storeId: b.storeId },
  ]);
}

/**
 * Barang hilang di toko konsinyasi DIPUTUSKAN (barangnya masih milik Elorae):
 *   DR LOSS_EXPENSE / CR INVENTORY_CONSIGNMENT (biaya saat dikirim)
 * Bagian yang ditanggung toko/SPG/sales menjadi LOSS_RECOVERY di dokumen yang
 * menagih atau memotongnya (siklus, komisi), bukan di sini.
 */
export function barisBarangHilang(b: { storeId: string; biaya: number }): BarisBertanda[] {
  const sen = keSen(b.biaya);
  if (sen === 0) return [];
  return gabungBaris([
    { role: "LOSS_EXPENSE", sen, channel: KONSI, storeId: b.storeId },
    { role: "INVENTORY_CONSIGNMENT", sen: -sen, storeId: b.storeId },
  ]);
}

/**
 * Beban barang hilang SALES dipotong dari komisinya. Komisi salesman dibayar
 * di luar sistem (tanpa hutang komisi tercatat), jadi potongan ini dicatat
 * sebagai bagian komisi bruto yang dipakai menutup beban:
 *   DR SALES_COMMISSION_EXPENSE / CR LOSS_RECOVERY.
 */
export function barisPotongSales(nilai: number): BarisBertanda[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: "SALES_COMMISSION_EXPENSE", sen },
    { role: "LOSS_RECOVERY", sen: -sen },
  ]);
}

export type KeputusanRusak = "PERBAIKI" | "JUAL_OBRAL" | "MUSNAHKAN";

/**
 * Keputusan gudang barang rusak (nilai keluar = rata-rata gudang rusak):
 * - MUSNAHKAN: DR LOSS_EXPENSE / CR INVENTORY_DAMAGED
 * - PERBAIKI: DR persediaan (nilai masuk kartu stok) / CR INVENTORY_DAMAGED,
 *   selisihnya ke INVENTORY_VARIANCE
 * - JUAL_OBRAL: DR COGS / CR INVENTORY_DAMAGED; hasil jual (bila dicatat)
 *   DR CASH / CR SALES_REVENUE (DPP) / CR PPN_KELUARAN, kanal Lainnya.
 */
export function barisGudangRusak(b: {
  keputusan: KeputusanRusak;
  biaya: number;
  /** PERBAIKI: nilai yang masuk kartu stok jual. */
  masuk?: NilaiBarang | null;
  /** JUAL_OBRAL: hasil jual (termasuk PPN bila PKP), null = tidak dicatat. */
  hasilJual?: number | null;
  pengaturanPpn: PengaturanPpn;
  tanggal: Date;
}): BarisBertanda[] {
  const biaya = keSen(b.biaya);
  const baris: BarisBertanda[] = [];
  if (b.keputusan === "MUSNAHKAN") {
    baris.push({ role: "LOSS_EXPENSE", sen: biaya }, { role: "INVENTORY_DAMAGED", sen: -biaya });
  } else if (b.keputusan === "PERBAIKI") {
    const masuk = b.masuk ? keSen(b.masuk.nilai) : 0;
    baris.push(
      { role: peranPersediaan(b.masuk?.tipeBarang), sen: masuk },
      { role: "INVENTORY_DAMAGED", sen: -biaya },
      { role: "INVENTORY_VARIANCE", sen: biaya - masuk },
    );
  } else {
    const lain: KanalJurnal = KANAL_JURNAL.LAINNYA;
    baris.push({ role: "COGS", sen: biaya, channel: lain }, { role: "INVENTORY_DAMAGED", sen: -biaya });
    const hasil = keSen(b.hasilJual ?? 0);
    if (hasil > 0) {
      const p = pisahPpn(hasil / 100, { termasukPpn: true, pengaturan: b.pengaturanPpn, tanggal: b.tanggal });
      baris.push({ role: "CASH", sen: keSen(p.total) }, { role: "SALES_REVENUE", sen: -keSen(p.dpp), channel: lain });
      if (keSen(p.ppn) !== 0) baris.push({ role: "PPN_KELUARAN", sen: -keSen(p.ppn) });
    }
  }
  return gabungBaris(baris);
}

/**
 * Penyesuaian stok manual (nilai = perubahan nilai kartu stok, bertanda):
 *   tambah: DR persediaan / CR INVENTORY_VARIANCE; kurang: sebaliknya.
 */
export function barisStokManual(b: { tipeBarang: string | null | undefined; nilai: number }): BarisBertanda[] {
  const sen = keSen(b.nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: peranPersediaan(b.tipeBarang), sen },
    { role: "INVENTORY_VARIANCE", sen: -sen },
  ]);
}

/**
 * Retur ke pemasok SELESAI:
 *   DR AP (kredit PO, harga beli + PPN baris "Exclude PPN")
 *   CR PPN_MASUKAN (bagian PPN, hanya bila PPN masukan GRN-nya dikreditkan)
 *   CR persediaan (nilai yang keluar dari kartu stok saat diproses)
 *   selisih → INVENTORY_VARIANCE
 * Tanpa kredit PO (retur produksi): seluruh nilai keluar ke INVENTORY_VARIANCE.
 */
export function barisReturPemasok(b: { kredit: number; ppnMasukan: number; keluar: readonly NilaiBarang[] }): BarisBertanda[] {
  const kredit = keSen(b.kredit);
  const ppn = kredit > 0 ? keSen(b.ppnMasukan) : 0;
  const keluar = barisPersediaan(b.keluar, -1);
  const selisih = kredit - ppn + jumlahSen(keluar);
  if (kredit === 0 && keluar.length === 0) return [];
  return gabungBaris([
    { role: "AP", sen: kredit },
    { role: "PPN_MASUKAN", sen: -ppn },
    ...keluar,
    { role: "INVENTORY_VARIANCE", sen: -selisih },
  ]);
}

/** Biaya perjalanan DISETUJUI: DR TRAVEL_EXPENSE / CR REIMBURSE_PAYABLE. */
export function barisBiayaPerjalanan(nilai: number): BarisBertanda[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: "TRAVEL_EXPENSE", sen },
    { role: "REIMBURSE_PAYABLE", sen: -sen },
  ]);
}

/**
 * Biaya perjalanan DIBAYAR: DR REIMBURSE_PAYABLE / CR kas. Peran kas = CASH;
 * rekening yang dipilih saat membayar (`ExpenseClaim.paidAccountId`) menimpa
 * akun peran itu di penulisnya.
 */
export function barisBayarBiayaPerjalanan(nilai: number): BarisBertanda[] {
  const sen = keSen(nilai);
  if (sen === 0) return [];
  return gabungBaris([
    { role: "REIMBURSE_PAYABLE", sen },
    { role: "CASH", sen: -sen },
  ]);
}

// ── Ke baris jurnal ─────────────────────────────────────────────────────────

/**
 * Baris untuk `generateAutoJournal`. `memo` = nama peran (dibaca kembali per
 * PERAN oleh penyelaras). Baris PPN membawa DPP-nya (`memoPeranDpp`) supaya
 * rekap masa PPN membacanya persis: PPN keluaran = |pendapatan − potongan −
 * retur| di set yang sama; PPN masukan = `dppMasukan` yang diberikan.
 */
export function keBarisJurnalOperasional(baris: readonly BarisBertanda[], opsi: { dppMasukan?: number } = {}): AutoJournalLine[] {
  const gabung = gabungBaris(baris);
  const dppKeluaran = Math.abs(
    gabung.filter((b) => b.role === "SALES_REVENUE" || b.role === "SALES_DISCOUNT" || b.role === "SALES_RETURN").reduce((s, b) => s + b.sen, 0),
  );
  const dppMasukan = keSen(Math.abs(opsi.dppMasukan ?? 0));
  return gabung.map((b) => {
    const dpp = b.role === "PPN_KELUARAN" ? dppKeluaran : b.role === "PPN_MASUKAN" ? dppMasukan : 0;
    return {
      role: b.role,
      debit: b.sen > 0 ? b.sen / 100 : 0,
      credit: b.sen < 0 ? -b.sen / 100 : 0,
      memo: dpp > 0 ? memoPeranDpp(b.role, dpp / 100) : b.role,
      channel: b.channel ?? null,
      storeId: b.storeId ?? null,
    };
  });
}

// ── Biaya persediaan konsinyasi ─────────────────────────────────────────────

/**
 * Biaya per potong barang di toko konsinyasi = rata-rata tertimbang nilai
 * kiriman barang itu (Σ qty × harga rata-rata saat dikirim / Σ qty) sampai
 * suatu saat. Tanpa kiriman tercatat: harga cadangan (rata-rata gudang).
 */
export function rataRataKirim(kiriman: ReadonlyArray<{ qty: number; biaya: number }>): number | null {
  let qty = 0;
  let nilai = 0;
  for (const k of kiriman) {
    const q = Math.abs(k.qty);
    if (!Number.isFinite(q) || q === 0 || !Number.isFinite(k.biaya)) continue;
    qty += q;
    nilai += q * k.biaya;
  }
  return qty > 0 ? nilai / qty : null;
}

/** Σ qty × biaya per potong, dibulatkan ke sen per baris (rupiah). */
export function nilaiBiayaKonsi(baris: ReadonlyArray<{ itemId: string | null; qty: number }>, biaya: ReadonlyMap<string, number>): number {
  let sen = 0;
  for (const b of baris) {
    if (!b.itemId || !(b.qty > 0)) continue;
    sen += keSen(b.qty * (biaya.get(b.itemId) ?? 0));
  }
  return sen / 100;
}
