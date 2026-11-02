/**
 * Riwayat HPP satu barang — murni (tanpa Prisma), aman untuk komponen klien.
 * Pembacanya ada di `./riwayat-hpp-queries.ts` (khusus server).
 *
 * Keputusan pemilik 2026-11-01: yang tampil adalah HPP SEBENARNYA setiap
 * peristiwa biaya ("jika 50.000 maka tampak 50.000, jika 55.000 maka tampak
 * 55.000"), beserta tanggalnya — bukan rata-rata. Setiap baris membaca angka
 * yang TERSIMPAN saat barang masuk; tidak ada yang dihitung ulang dari
 * rata-rata stok hari ini.
 *
 * - Penerimaan barang jadi (`FGReceipt`): HPP per pcs = bahan + jasa langkah WO
 *   + biaya tambahan per pcs WO, sebagaimana dibukukan `receiveFG`
 *   (`rincianBiayaPenerimaan`). Per varian dari entri buku stok
 *   (`totalCost ÷ qty`); penerimaan dari sebelum buku stok bernilai memakai
 *   `avgCostPerUnit` penerimaan itu.
 * - Pembelian (GRN): nilai yang masuk persediaan per satuan, dari entri buku
 *   stok (`totalCost ÷ qty`) — harga PO tanpa PPN Masukan; PPN yang
 *   dikapitalisasi saat belum PKP ikut, karena memang masuk nilai persediaan.
 *   Entri tanpa nilai (sebelum kolom nilai ada) jatuh ke `unitCost` baris GRN
 *   tersimpan, yang SUDAH memuat PPN yang dikapitalisasi. Semua baris satu GRN
 *   memakai satu waktu: entri terbarunya.
 * - Rata-rata sesudahnya = `balanceValue ÷ balanceQty` entri buku stok; tidak
 *   ada → null (layar menulis "—", bukan Rp 0).
 *
 * Halaman ("Muat lagi") memakai penunjuk waktu, bukan batas yang membesar:
 * halaman berikutnya hanya membaca peristiwa SEBELUM waktu baris terakhir
 * (`berikutnya`), jadi riwayat sepanjang apa pun bisa dibuka sampai habis.
 * Satu peristiwa tidak pernah terbelah antarhalaman.
 *
 * HPP terbaru (`hppTerbaruDari`, dasar rekomendasi harga) = peristiwa terbaru
 * di tingkat barang, kecuali penerimaan tanpa bahan (lebih produksi sesudah WO
 * lengkap, sama dengan `bacaHppBarang`) dan GRN yang ditolak pemilik (stoknya
 * sudah dikeluarkan lagi).
 */
import { Decimal } from "decimal.js";

/** Baris per halaman layar riwayat HPP ("Muat lagi" menambah sebanyak ini). */
export const HALAMAN_RIWAYAT_HPP = 50;

/** Angka dari Prisma (Decimal), teks, atau angka biasa. */
export type AngkaTersimpan = Decimal.Value | { toString(): string } | null | undefined;

export type JenisPeristiwaHpp = "PRODUKSI" | "PEMBELIAN";

/** TANPA_BAHAN = penerimaan yang tidak memikul bahan; DITOLAK_PEMILIK = GRN lebih terima yang ditolak. */
export type CatatanRiwayatHpp = "TANPA_BAHAN" | "DITOLAK_PEMILIK";

export type BarisRiwayatHpp = {
  kunci: string;
  jenis: JenisPeristiwaHpp;
  /** id penerimaan barang jadi atau GRN; baris satu dokumen berbagi id ini. */
  dokumenId: string;
  dokumen: string;
  tautan: string | null;
  /** Nomor WO (penerimaan) atau PO (pembelian). */
  induk: string | null;
  tautanInduk: string | null;
  /** Waktu peristiwa, ISO. */
  tanggal: string;
  varianSku: string | null;
  /** Label varian (warna · ukuran) bila dikenali; null = pakai SKU-nya. */
  varianLabel: string | null;
  jumlah: number;
  /** HPP per satuan baris ini; null = nilainya tidak tercatat. */
  hppPerPcs: number | null;
  /** HPP per satuan dokumen ini di tingkat barang (semua varian). */
  hppDokumen: number | null;
  rataRataSesudah: number | null;
  catatan: CatatanRiwayatHpp | null;
};

export type PenerimaanRiwayatHpp = {
  id: string;
  docNumber: string;
  receivedAt: Date;
  woId: string;
  woDocNumber: string;
  qtyAccepted: AngkaTersimpan;
  avgCostPerUnit: AngkaTersimpan;
  totalCostValue: AngkaTersimpan;
  materialCost: AngkaTersimpan;
  skuBreakdown: unknown;
};

export type EntriBukuHpp = {
  id: string;
  refId: string;
  refDocNumber: string;
  /** "" = tanpa varian (konvensi buku stok). */
  variantSku: string;
  qty: AngkaTersimpan;
  totalCost: AngkaTersimpan;
  balanceQty: AngkaTersimpan;
  balanceValue: AngkaTersimpan;
  createdAt: Date;
};

export type GrnRiwayatHpp = {
  id: string;
  docNumber: string;
  poId: string | null;
  poDocNumber: string | null;
  ownerDeclinedAt: Date | null;
  items: unknown;
};

export type MasukanRiwayatHpp = {
  itemId: string;
  /** Terbaru dulu, paling banyak `ambil`. */
  penerimaan: PenerimaanRiwayatHpp[];
  /** Entri buku stok (FGReceipt, MAIN, masuk) milik penerimaan di atas. */
  entriPenerimaan: EntriBukuHpp[];
  /**
   * SEMUA entri buku stok (GRN, MAIN, masuk) barang ini milik GRN yang terbaca
   * — paling banyak `ambil` GRN, dan tiap GRN lengkap, tidak pernah terbelah.
   */
  entriPembelian: EntriBukuHpp[];
  grn: GrnRiwayatHpp[];
  labelVarian: Record<string, string>;
  /** Baris per halaman (bisa sedikit lebih: peristiwa terakhir tidak dipotong). */
  batas: number;
  /**
   * Penerimaan dan GRN yang diminta per sumber. Sumber yang mengembalikan
   * sebanyak ini mungkin masih menyimpan peristiwa yang lebih lama.
   */
  ambil: number;
};

export type RiwayatHpp = {
  baris: BarisRiwayatHpp[];
  adaLagi: boolean;
  /**
   * Penunjuk "Muat lagi": waktu (ISO) baris terakhir; halaman berikutnya hanya
   * peristiwa SEBELUM waktu ini. null = tidak ada lagi.
   */
  berikutnya: string | null;
};

export type HppTerbaru = {
  perPcs: number;
  jenis: JenisPeristiwaHpp;
  dokumen: string;
  tautan: string | null;
  tanggal: string;
  jumlah: number;
};

const NOL = new Decimal(0);

function angka(v: AngkaTersimpan): Decimal | null {
  if (v == null) return null;
  const d = new Decimal(typeof v === "number" || typeof v === "string" || v instanceof Decimal ? v : v.toString());
  return d.isFinite() ? d : null;
}

const duaDesimal = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

function bagi(atas: Decimal | null, bawah: Decimal | null): number | null {
  if (atas == null || bawah == null || bawah.lte(0)) return null;
  return duaDesimal(atas.div(bawah));
}

const varianKosong = (v: string | null | undefined) => (v ?? "").trim();

function bacaJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Rincian varian penerimaan (`FGReceipt.skuBreakdown`): `[{ variantSku, qty }]`, qty > 0. */
function rincianVarian(raw: unknown): Array<{ variantSku: string; qty: Decimal }> {
  const v = bacaJson(raw);
  if (!Array.isArray(v)) return [];
  const hasil: Array<{ variantSku: string; qty: Decimal }> = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const baris = r as { variantSku?: unknown; qty?: unknown };
    const sku = typeof baris.variantSku === "string" ? baris.variantSku.trim() : "";
    const qty = angka(typeof baris.qty === "number" || typeof baris.qty === "string" ? baris.qty : null);
    if (sku && qty && qty.gt(0)) hasil.push({ variantSku: sku, qty });
  }
  return hasil;
}

type BarisGrnTersimpan = { harga: Decimal; avgBaru: Decimal | null };

/**
 * Baris barang ini di `GRN.items` tersimpan — cadangan bila entri buku stok
 * tidak bernilai. `unitCost` tersimpan adalah harga per satuan yang masuk
 * persediaan: harga PO + bagian PPN yang dikapitalisasi (`app/actions/grn.ts`).
 * `hargaPo` dan `ppnDikapitalisasi` hanya penjelasnya — jangan dijumlah lagi.
 */
function barisGrnTersimpan(items: unknown, itemId: string, variantSku: string): BarisGrnTersimpan | null {
  const v = bacaJson(items);
  if (!Array.isArray(v)) return null;
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const b = r as Record<string, unknown>;
    if (b.itemId !== itemId) continue;
    if (varianKosong(typeof b.variantSku === "string" ? b.variantSku : null) !== varianKosong(variantSku)) continue;
    const qty = angka(b.qty as AngkaTersimpan);
    const harga = angka(b.unitCost as AngkaTersimpan);
    if (!qty || qty.lte(0) || !harga) return null;
    return { harga, avgBaru: angka(b.newAvgCost as AngkaTersimpan) };
  }
  return null;
}

/** Penerimaan yang memikul bahan — aturan yang sama dengan `bacaHppBarang`. */
function memikulBahan(p: PenerimaanRiwayatHpp): boolean {
  const bahan = angka(p.materialCost);
  if (bahan != null) return bahan.gt(0);
  const nilai = angka(p.totalCostValue);
  return nilai != null && nilai.gt(0);
}

function barisPenerimaan(m: MasukanRiwayatHpp): BarisRiwayatHpp[] {
  const entriPer = new Map<string, EntriBukuHpp[]>();
  for (const e of m.entriPenerimaan) {
    const daftar = entriPer.get(e.refId) ?? [];
    daftar.push(e);
    entriPer.set(e.refId, daftar);
  }
  const hasil: BarisRiwayatHpp[] = [];
  for (const p of m.penerimaan) {
    const qtyDok = angka(p.qtyAccepted);
    const hppDokD = angka(p.avgCostPerUnit);
    const hppDokumen = hppDokD != null ? duaDesimal(hppDokD) : bagi(angka(p.totalCostValue), qtyDok);
    const tautan = `/backoffice/work-orders/${encodeURIComponent(p.woId)}?tab=receipts`;
    const umum = {
      jenis: "PRODUKSI" as const,
      dokumenId: p.id,
      dokumen: p.docNumber,
      tautan,
      induk: p.woDocNumber,
      tautanInduk: `/backoffice/work-orders/${encodeURIComponent(p.woId)}`,
      tanggal: p.receivedAt.toISOString(),
      hppDokumen,
      catatan: memikulBahan(p) ? null : ("TANPA_BAHAN" as const),
    };
    const label = (sku: string) => (sku ? (m.labelVarian[sku] ?? null) : null);
    const entri = [...(entriPer.get(p.id) ?? [])].sort(
      (a, b) => a.variantSku.localeCompare(b.variantSku) || a.id.localeCompare(b.id),
    );
    if (entri.length > 0) {
      for (const e of entri) {
        const qty = angka(e.qty) ?? NOL;
        const sku = varianKosong(e.variantSku);
        hasil.push({
          ...umum,
          kunci: `P:${p.id}:${e.id}`,
          varianSku: sku || null,
          varianLabel: label(sku),
          jumlah: duaDesimal(qty),
          hppPerPcs: bagi(angka(e.totalCost), qty) ?? hppDokumen,
          rataRataSesudah: bagi(angka(e.balanceValue), angka(e.balanceQty)),
        });
      }
      continue;
    }
    // Penerimaan dari sebelum buku stok: tanpa rata-rata sesudahnya.
    const varian = rincianVarian(p.skuBreakdown);
    if (varian.length > 0) {
      varian.forEach((v, i) =>
        hasil.push({
          ...umum,
          kunci: `P:${p.id}:${i}`,
          varianSku: v.variantSku,
          varianLabel: label(v.variantSku),
          jumlah: duaDesimal(v.qty),
          hppPerPcs: hppDokumen,
          rataRataSesudah: null,
        }),
      );
      continue;
    }
    hasil.push({
      ...umum,
      kunci: `P:${p.id}`,
      varianSku: null,
      varianLabel: null,
      jumlah: qtyDok ? duaDesimal(qtyDok) : 0,
      hppPerPcs: hppDokumen,
      rataRataSesudah: null,
    });
  }
  return hasil;
}

/** Waktu satu GRN (ms) = entri buku stok terbarunya untuk barang ini. */
function waktuPerGrn(entri: EntriBukuHpp[]): Map<string, number> {
  const hasil = new Map<string, number>();
  for (const e of entri) {
    const t = e.createdAt.getTime();
    if (t > (hasil.get(e.refId) ?? Number.NEGATIVE_INFINITY)) hasil.set(e.refId, t);
  }
  return hasil;
}

function barisPembelian(m: MasukanRiwayatHpp): BarisRiwayatHpp[] {
  const grnPer = new Map(m.grn.map((g) => [g.id, g]));
  const waktuGrn = waktuPerGrn(m.entriPembelian);
  type Sementara = { e: EntriBukuHpp; qty: Decimal; nilai: Decimal | null; rataRata: number | null };
  const sementara: Sementara[] = m.entriPembelian.map((e) => {
    const qty = angka(e.qty) ?? NOL;
    const tersimpan = barisGrnTersimpan(grnPer.get(e.refId)?.items, m.itemId, e.variantSku);
    const nilaiBuku = angka(e.totalCost);
    const nilai = nilaiBuku ?? (tersimpan ? tersimpan.harga.mul(qty) : null);
    const rataRata =
      bagi(angka(e.balanceValue), angka(e.balanceQty)) ?? (tersimpan?.avgBaru ? duaDesimal(tersimpan.avgBaru) : null);
    return { e, qty, nilai, rataRata };
  });

  // HPP dokumen = Σ nilai ÷ Σ qty atas baris barang ini di GRN yang sama (semua varian).
  const perDokumen = new Map<string, { qty: Decimal; nilai: Decimal | null }>();
  for (const s of sementara) {
    const lama = perDokumen.get(s.e.refId) ?? { qty: NOL, nilai: NOL };
    perDokumen.set(s.e.refId, {
      qty: lama.qty.plus(s.qty),
      nilai: lama.nilai != null && s.nilai != null ? lama.nilai.plus(s.nilai) : null,
    });
  }

  return sementara.map(({ e, qty, nilai, rataRata }) => {
    const g = grnPer.get(e.refId) ?? null;
    const dok = perDokumen.get(e.refId)!;
    const sku = varianKosong(e.variantSku);
    return {
      kunci: `B:${e.id}`,
      jenis: "PEMBELIAN" as const,
      dokumenId: e.refId,
      dokumen: g?.docNumber ?? (e.refDocNumber || e.refId),
      tautan: g ? `/backoffice/inventory/grn/${encodeURIComponent(g.id)}` : null,
      induk: g?.poDocNumber ?? null,
      tautanInduk: g?.poId ? `/backoffice/purchase-orders/${encodeURIComponent(g.poId)}` : null,
      tanggal: new Date(waktuGrn.get(e.refId) ?? e.createdAt.getTime()).toISOString(),
      varianSku: sku || null,
      varianLabel: sku ? (m.labelVarian[sku] ?? null) : null,
      jumlah: duaDesimal(qty),
      hppPerPcs: bagi(nilai, qty),
      hppDokumen: bagi(dok.nilai, dok.qty),
      rataRataSesudah: rataRata,
      catatan: g?.ownerDeclinedAt ? ("DITOLAK_PEMILIK" as const) : null,
    };
  });
}

const urutan = (a: BarisRiwayatHpp, b: BarisRiwayatHpp) =>
  b.tanggal.localeCompare(a.tanggal) ||
  b.dokumen.localeCompare(a.dokumen) ||
  (a.varianSku ?? "").localeCompare(b.varianSku ?? "") ||
  a.kunci.localeCompare(b.kunci);

/**
 * Satu halaman, terbaru dulu, sekitar `batas` baris.
 *
 * - Sumber yang mengembalikan `ambil` peristiwa mungkin masih punya yang lebih
 *   lama, semuanya berwaktu ≤ peristiwa tertuanya yang terbaca. Baris pada
 *   atau sebelum waktu itu ditunda ke halaman berikutnya — kalau tidak,
 *   peristiwa yang belum terbaca di sela-selanya akan terlewat selamanya.
 * - Halaman dipotong di antara dua WAKTU, tidak di tengah satu waktu, jadi
 *   satu penerimaan atau GRN (semua barisnya berwaktu sama) tidak terbelah dan
 *   penunjuk `berikutnya` (eksklusif) tidak melompati apa pun.
 */
export function susunRiwayatHpp(m: MasukanRiwayatHpp): RiwayatHpp {
  const semua = [...barisPenerimaan(m), ...barisPembelian(m)].sort(urutan);
  const ambil = Math.max(1, Math.floor(m.ambil));
  const tepi: number[] = [];
  if (m.penerimaan.length >= ambil) tepi.push(Math.min(...m.penerimaan.map((p) => p.receivedAt.getTime())));
  const waktuGrn = waktuPerGrn(m.entriPembelian);
  if (waktuGrn.size >= ambil) tepi.push(Math.min(...waktuGrn.values()));
  const terpotong = tepi.length > 0;
  const tepiAman = terpotong ? Math.max(...tepi) : null;

  let calon = tepiAman == null ? semua : semua.filter((b) => Date.parse(b.tanggal) > tepiAman);
  if (calon.length === 0 && semua.length > 0) {
    // Hanya terjadi bila `ambil` peristiwa satu sumber berbagi milidetik yang
    // sama persis — tampilkan waktu terbaru itu daripada macet tanpa baris.
    calon = semua.filter((b) => b.tanggal === semua[0].tanggal);
  }

  let akhir = Math.min(Math.max(1, Math.floor(m.batas)), calon.length);
  while (akhir > 0 && akhir < calon.length && calon[akhir].tanggal === calon[akhir - 1].tanggal) akhir++;
  const baris = calon.slice(0, akhir);
  const adaLagi = baris.length > 0 && (akhir < calon.length || terpotong);
  return { baris, adaLagi, berikutnya: adaLagi ? baris[baris.length - 1].tanggal : null };
}

/** HPP terbaru di tingkat barang (dasar rekomendasi harga); null = belum ada. */
export function hppTerbaruDari(baris: BarisRiwayatHpp[]): HppTerbaru | null {
  const pilihan = baris.find((b) => b.catatan == null && b.hppDokumen != null && b.hppDokumen > 0);
  if (!pilihan || pilihan.hppDokumen == null) return null;
  const jumlah = baris
    .filter((b) => b.jenis === pilihan.jenis && b.dokumenId === pilihan.dokumenId)
    .reduce((s, b) => s.plus(b.jumlah), NOL);
  return {
    perPcs: pilihan.hppDokumen,
    jenis: pilihan.jenis,
    dokumen: pilihan.dokumen,
    tautan: pilihan.tautan,
    tanggal: pilihan.tanggal,
    jumlah: duaDesimal(jumlah),
  };
}
