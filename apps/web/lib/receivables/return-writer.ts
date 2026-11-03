import { moveMainStock, Prisma, type prisma, type StockLedgerRefType } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { hariIniWib } from "@/lib/tanggal-isian";
import { bentrokKunciKiriman } from './idempoten';
import { denganNomorUnik } from './nomor';
import { generateDocNumber } from '@/lib/docNumber';
import { bacaSisaPiutang, hitungUlangPiutang } from './writer';
import { catatJejak, JEJAK } from './jejak';
import { bentrokPengganti, catatDiganti, periksaReturLama, type AlasanPengganti } from './pengganti';
import { computeStorePrice } from "@elorae/db/pricing";
import { variantDetailForSku } from "@/lib/items/variants";
import { masukkanGudangRusakDariNri } from "@/lib/spg/gudang-rusak-writer";
import { returPembeliSudahBerlaku } from "@/lib/spg/retur-pembeli-status";
import { kunciStokReturMasuk } from "@/lib/finance/lapangan/aturan";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { fotoBolehDipakai } from "./foto-pencatat";
import { periksaFotoKembar } from "@/lib/foto/kembar";
import { PERMISSIONS } from "@/lib/rbac";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { hitungSisaPiutang, returTertahan, STATUS_KLAIM_HIDUP, statusBebanSales, type CekSelisih, type StatusKlaim } from "./rules";
import { nilaiFisikNota, PILIH_POTONGAN, potonganRetur } from "./deductions";
import { keluarBukuSusulan, kunciBarangRetur, kurangPerBarang, sisaSelisih } from "./selisih-retur";
import { BATAS_TEKS_HILANG } from "@/lib/spg/hilang";
import { capNotificationText } from "@/lib/notifications/text";
import { formatIDR } from "@/lib/sales-orders/format";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

/**
 * Penulis retur toko — dua dokumen, dua tangan.
 *
 * NRT adalah klaim toko: "kami kembalikan barang senilai sekian". Nomornya
 * **nomor toko**, bukan nomor kita — itulah yang dicari pemilik di arsip.
 * NRI adalah hitungan gudang: "yang sampai senilai sekian". Nomornya milik kita.
 *
 * Keduanya tabel terpisah karena keduanya bisa hidup sendiri: barang bisa datang
 * lewat ekspedisi mendahului notanya, dan penerimaan itu harus bisa dicatat
 * sebelum ada yang tahu ia milik nota yang mana.
 *
 * Aturannya: **retur diakui sebesar fisik, bukan sebesar klaim.** Selama gudang
 * belum menutup hitungan, seluruh klaim ditahan; setelah ditutup, yang ditahan
 * tinggal selisihnya sampai ada yang ditetapkan menanggungnya.
 *
 * Tidak ada satu pun jalur di sini yang menulis `outstanding` sendiri. Setiap
 * perubahan memicu perhitungan ulang piutang yang tersentuh.
 */

type Klien = Prisma.TransactionClient;

const angka = (v: unknown): number => Number(v ?? 0);
const D = (n: number) => new Prisma.Decimal(n);

export type KondisiBarang = "LAYAK" | "RUSAK" | "EXPIRED";

export type BarisBarang = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
  /** Varian barang katalog. Kosong = barang tanpa varian (atau baris yang hanya diketik namanya). */
  variantSku?: string | null;
  /** Kondisi fisik. Hanya `LAYAK` yang kembali jadi stok jual di gudang. */
  condition?: KondisiBarang;
};

/**
 * Baris retur dari HP SPG: barang + varian + qty + kondisi, TANPA harga dan
 * tanpa nama — keduanya disusun server dari master barang, supaya harga
 * konsinyasi tidak pernah berasal dari (atau kembali ke) HP.
 */
export type BarisReturSpg = {
  itemId: string;
  variantSku?: string | null;
  qty: number;
  condition?: KondisiBarang;
  /**
   * Barang yang tiba RUSAK di kiriman ke toko dan diputuskan gudang
   * `KEMBALI_GUDANG` (`lib/spg/rusak.ts`): baris tanda terima yang dikirim
   * balik. Barang itu tidak pernah masuk buku stok toko, jadi barisnya TIDAK
   * menulis `RETUR_KELUAR` (dan pembatalannya pun tidak membalik apa pun).
   */
  storeReceiptLineId?: string | null;
  /**
   * Barang yang dikembalikan pembeli di konter dalam keadaan RUSAK/EXPIRED
   * (`SpgSaleReturnLine`) dan dikirim balik ke gudang barang rusak. Barang itu
   * tidak pernah kembali ke rak (retur pembeli rusak tidak menulis buku), jadi
   * barisnya juga TIDAK menulis `RETUR_KELUAR`. Hanya retur pembeli yang sudah
   * disetujui kantor yang boleh ditunjuk (`periksaBarisReturPembeli`).
   */
  spgSaleReturnLineId?: string | null;
};

/** Baris yang sudah disusun server; penunjuk baris tanda terima hanya dari jalur SPG. */
type BarisTersusun = BarisBarang & { storeReceiptLineId?: string | null; spgSaleReturnLineId?: string | null };

/**
 * Baris retur yang TIDAK menyentuh buku stok toko: barang yang tidak pernah
 * masuk (atau sudah keluar dari) buku toko —
 * - `storeReceiptLineId`: barang rusak kiriman yang dikirim balik ke gudang
 *   (`lib/spg/rusak.ts`); ia ditahan di luar buku sejak diterima;
 * - `spgSaleReturnLineId`: barang rusak yang dikembalikan pembeli di konter.
 * Baris seperti itu tidak menulis `RETUR_KELUAR`, jadi pembatalannya pun tidak
 * membalik apa pun (`balikkanBukuRetur` hanya membalik baris yang ada).
 */
export function barisTanpaBukuToko(item: { storeReceiptLineId?: string | null; spgSaleReturnLineId?: string | null }): boolean {
  return Boolean(item.storeReceiptLineId || item.spgSaleReturnLineId);
}

const KONDISI: readonly KondisiBarang[] = ["LAYAK", "RUSAK", "EXPIRED"];
const kondisiSah = (k: unknown): KondisiBarang => (KONDISI.includes(k as KondisiBarang) ? (k as KondisiBarang) : "LAYAK");

/**
 * Nilai dari rincian, atau angka yang diketik.
 *
 * Rincian yang berharga menang atas angka yang diketik di sampingnya — dua
 * kebenaran untuk satu nota tidak boleh ada. TAPI rincian yang seluruh harganya
 * nol (NRT SPG toko putus: barisnya hanya qty, nilainya total nota toko; atau
 * hitungan gudang yang nilainya diketik) tidak membawa nilai sama sekali, jadi
 * angka yang diketik yang berlaku. Tanpa ini nilainya terbaca nol.
 */
export function nilaiDariRincian(items: { qty: number; price: number }[], diketik: number | undefined): number {
  if (items.length === 0 || items.every((b) => !(b.price > 0))) return diketik ?? 0;
  return items.reduce((s, b) => s + b.qty * b.price, 0);
}

export type AlasanGagalRetur =
  | 'TIDAK_DITEMUKAN'
  | 'NILAI_TIDAK_VALID'
  | 'NOMOR_WAJIB'
  | 'NOMOR_SUDAH_DIPAKAI'
  | 'SUDAH_DIBATALKAN'
  | 'SUDAH_DIHITUNG'
  | 'SUDAH_DIJODOHKAN'
  | 'BUKAN_YATIM'
  | 'BEDA_TOKO'
  | 'TIDAK_ADA_SELISIH'
  | 'SUDAH_DIPUTUSKAN'
  | 'BEBAN_SUDAH_DIPUTUSKAN'
  | 'BELUM_DIPUTUSKAN'
  | 'SUDAH_LUNAS'
  | 'ALASAN_WAJIB'
  | 'NOMOR_BENTROK'
  | 'KUNCI_DIPAKAI'
  /** Foto nota `/api/foto/<id>` diunggah orang lain, dan pencatat bukan pengelola piutang. */
  | "FOTO_BUKAN_MILIK"
  /** Foto nota sama persis dengan foto orang lain yang sudah dipakai dokumen lain (foto dicuci). */
  | "FOTO_SUDAH_DIPAKAI"
  /** NRT dari SPG wajib membawa baris barang. */
  | "BARIS_WAJIB"
  | "BARANG_TIDAK_DITEMUKAN"
  | "TOKO_TIDAK_DITEMUKAN"
  /**
   * NRT SPG toko konsinyasi tanpa markup yang sah: nilai klaimnya tidak bisa
   * dihitung, dan harga katalog bukan penggantinya.
   */
  | "HARGA_KONSI_TIDAK_SAH"
  /** NRT SPG toko putus: foto nota toko wajib. */
  | "FOTO_WAJIB"
  /**
   * Baris yang menunjuk barang rusak kiriman tidak sah: bukan milik toko ini,
   * belum/tidak diputuskan KEMBALI_GUDANG, barangnya lain, atau kondisinya LAYAK.
   */
  | "RUSAK_TIDAK_SAH"
  /** Jumlah yang dikirim balik melebihi sisa barang rusak yang belum dikembalikan. */
  | "RUSAK_MELEBIHI"
  /**
   * Baris yang menunjuk retur pembeli tidak sah: bukan retur pembeli toko ini,
   * kondisinya LAYAK (di retur pembeli atau di baris nota), barangnya lain,
   * atau sekaligus menunjuk baris tanda terima.
   */
  | "RETUR_PEMBELI_TIDAK_SAH"
  /** Jumlah yang dikirim balik melebihi barang rusak dari pembeli yang belum dikirim. */
  | "RETUR_PEMBELI_MELEBIHI"
  /** Yang menghitung fisik adalah orang yang melaporkan nota itu — dua tangan jadi satu. */
  | "PENGHITUNG_SAMA_PELAPOR"
  /** Ada baris hitungan yang jumlahnya belum diisi (nol boleh, asal diketik). */
  | "HITUNGAN_KOSONG"
  /** Beban ke SALES tanpa orangnya: tuduhan tanpa alamat. */
  | "PENANGGUNG_WAJIB"
  /**
   * Toko konsinyasi tidak punya nota asal untuk retur (retur toko konsi tidak
   * pernah menjadi potongan BKM), jadi selisihnya tidak bisa "tetap terbuka di
   * nota asal" — pilihan ditanggung toko ditolak di sana.
   */
  | "TOKO_KONSI"
  /**
   * Beban yang ditanggung toko dibayar lewat nota asalnya (BKM berikutnya), tidak
   * ditandai lunas di sini (keputusan 1, 2026-10-29: "nota itu tidak bisa ditandai lunas").
   */
  | "DITAGIH_LEWAT_PIUTANG"
  /** Yang melapor hasil cek selisih bukan salesman pemegang toko itu SEKARANG (P85). */
  | "BUKAN_PEMEGANG"
  /** Nota retur ini punya hitungan susulan — lepas susulannya dulu. */
  | "ADA_SUSULAN"
  /** Hitungan asli gudang nota ini belum ada atau belum final. */
  | "BELUM_DIHITUNG"
  /** Laporan "tidak ditemukan" wajib membawa jawaban toko dan SPG. */
  | "CATATAN_WAJIB"
  | "CATATAN_TERLALU_PANJANG"
  | "HASIL_TIDAK_SAH"
  /** Beban yang ditanggung sales dipotong dari komisinya (Laporan → Komisi salesman), bukan ditandai lunas. */
  | "POTONG_LEWAT_KOMISI"
  /**
   * Sudah ada yang dipotong dari penanggungnya: bebannya tidak bisa dialihkan,
   * dan barang yang ketemu tidak lagi dicatat sebagai susulan nota ini (P87,
   * bawaan tercatat) — gudang menerimanya sebagai penerimaan tanpa nota.
   */
  | "SUDAH_DIPOTONG"
  /**
   * Baris nota baru ini sama dengan barang yang dilaporkan sales DITEMUKAN untuk
   * selisih nota lain di toko yang sama — barangnya dikirim balik sebagai
   * susulan nota itu, tanpa nota baru (P22a), kecuali pelapornya menyatakan ini
   * retur lain (`returLain`).
   */
  | "ADA_SELISIH_DITEMUKAN"
  /** Bebannya berubah di antara baca dan tulis (keputusan atau potongan yang bersamaan). */
  | "BEBAN_BERUBAH"
  /**
   * Toko sudah membayar bagian selisih yang ditanggungnya lewat BKM berikutnya:
   * melepas tahanannya sekarang membuat toko kelebihan bayar, yang tidak boleh
   * terjadi diam-diam.
   */
  | "TOKO_SUDAH_MEMBAYAR";

type Gagal = { ok: false; alasan: AlasanGagalRetur };
type Berhasil = { ok: true; piutangDihitungUlang: number };

/**
 * Nomor NRI berikutnya: `NRI/26/08/0001`, direset tiap bulan (WIB).
 *
 * Tanggal terima disimpan tengah malam WIB — 1 September WIB adalah 31 Agustus
 * 17.00 UTC, dan server produksi berjalan di UTC. `getMonth()` di sana memberi
 * Agustus, jadi bulan dan tahunnya dibaca di kalender Jakarta.
 */
async function nomorNri(tx: Klien, saat: Date): Promise<string> {
  const { yy, mm } = tahunBulanWib(saat);
  const depan = `NRI/${yy}/${mm}/`;
  const terakhir = await tx.warehouseReturn.findFirst({
    where: { noNri: { startsWith: depan } },
    orderBy: { noNri: 'desc' },
    select: { noNri: true },
  });
  const urutan = terakhir ? Number(terakhir.noNri.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/**
 * Hitung ulang setiap piutang yang tersentuh sebuah nota retur toko.
 *
 * Jalurnya panjang dan itu memang bentuk datanya: NRT → potongan yang
 * menunjuknya → klaim pembayaran → piutang yang dilunasi klaim itu.
 */
async function hitungUlangTersentuh(tx: Klien, storeReturnId: string | null): Promise<number> {
  const ids = await idPiutangTersentuh(tx, storeReturnId);
  for (const id of ids) await hitungUlangPiutang(tx, id);
  return ids.length;
}

/** Piutang yang dilunasi BKM yang memotong nota retur ini. */
async function idPiutangTersentuh(
  tx: Klien | typeof prisma,
  storeReturnId: string | null,
): Promise<string[]> {
  if (!storeReturnId) return [];
  const potongan = await tx.paymentClaimDeduction.findMany({
    where: { storeReturnId },
    select: { paymentClaimId: true },
  });
  if (potongan.length === 0) return [];

  const links = await tx.paymentClaimReceivable.findMany({
    where: { paymentClaimId: { in: [...new Set(potongan.map((p) => p.paymentClaimId))] } },
    select: { receivableId: true },
  });
  return [...new Set(links.map((l) => l.receivableId))];
}

/** Penggeser supaya `hitungSisaPiutang` (yang melantai di nol) bisa membaca kelebihan bayar. */
const GESER_SISA = 1_000_000_000_000;

/**
 * Sisa MENTAH setiap piutang yang tersentuh nota retur ini, dalam rupiah —
 * belum dilantai nol, jadi kelebihan bayar terbaca negatif.
 *
 * Dihitung dengan rumus yang sama dengan penulis piutang (`hitungSisaPiutang`
 * atas potongan yang diterjemahkan `potonganRetur`), hanya digeser: satu rumus,
 * bukan salinan kedua. Piutang yang dibatalkan atau dihapusbukukan dilewati.
 */
async function sisaMentahTersentuh(tx: Klien, storeReturnId: string | null): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  for (const id of await idPiutangTersentuh(tx, storeReturnId)) {
    const p = await tx.receivable.findUnique({
      where: { id },
      select: {
        amount: true,
        paidBeforeImport: true,
        paidAmount: true,
        status: true,
        claimLinks: {
          select: {
            settledAmount: true,
            paymentClaim: { select: { status: true, invoiceAmount: true, deductions: { select: PILIH_POTONGAN } } },
          },
        },
      },
    });
    if (!p || p.status === "VOIDED" || p.status === "WRITTEN_OFF") continue;
    const klaim = p.claimLinks.map((l) => ({
      status: l.paymentClaim.status as StatusKlaim,
      nilaiFaktur: angka(l.paymentClaim.invoiceAmount),
      potonganRetur: potonganRetur(l.paymentClaim.deductions),
      nilaiDilunasiPiutangIni: angka(l.settledAmount),
    }));
    hasil.set(
      id,
      hitungSisaPiutang(angka(p.amount) + GESER_SISA, klaim, angka(p.paidBeforeImport), angka(p.paidAmount)) - GESER_SISA,
    );
  }
  return hasil;
}

/**
 * Piutang yang menjadi KELEBIHAN BAYAR karena perubahan ini: sisanya negatif
 * sesudahnya dan lebih rendah dari sebelumnya. Kelebihan bayar yang sudah ada
 * sebelum perubahan bukan akibatnya. Murni, dites tanpa basis data.
 */
export function lebihBayarBaru(
  sebelum: ReadonlyMap<string, number>,
  sesudah: ReadonlyMap<string, number>,
): string[] {
  return [...sesudah].filter(([id, s]) => s < 0 && s < (sebelum.get(id) ?? 0)).map(([id]) => id);
}

/**
 * Dilempar di dalam transaksi sesudah ada yang ditulis — `runSerializable`
 * meng-commit kalau callback-nya kembali normal, jadi penolakan sesudah tulis
 * harus melempar supaya semuanya dibatalkan.
 */
class TolakSesudahTulis extends Error {
  constructor(public readonly alasan: AlasanGagalRetur) {
    super(alasan);
  }
}

/**
 * Masukkan barang retur ke stok.
 *
 * NRI **MENAMBAH** stok, tidak mengurangi — barangnya kembali ke gudang. Ini
 * pernah salah arah dan dikoreksi pemilik, jadi tandanya sengaja ditulis
 * eksplisit di sini dan di jenis penyesuaiannya (`POSITIVE`).
 *
 * Hanya baris yang menunjuk barang katalog (`itemId`) yang menggerakkan stok.
 * Baris yang cuma diketik namanya tidak punya tempat di buku stok — dan
 * memaksanya masuk akan menciptakan barang hantu tiap kali ada salah ketik.
 *
 * Harga rata-ratanya TIDAK digeser: barang kembali dicatat sebesar biaya
 * bukunya sendiri. Retur bukan pembelian, jadi ia tidak membawa harga baru
 * yang boleh mengubah rata-rata.
 *
 * Stok bergerak lewat `moveMainStock`: buku stok (`StockLedgerEntry`) mendapat
 * satu baris per baris hitungan, menunjuk penyesuaian stoknya.
 *
 * Per varian: varian yang disebut dicari persis. Baris RUSAK/EXPIRED dilewati —
 * tercatat di hitungan gudang, tapi bukan stok jual: barang itu masuk gudang
 * barang rusak (`masukkanGudangRusakDariNri`, keputusan pemilik 2026-10-03).
 */
async function masukkanKeStok(
  tx: Klien,
  input: {
    /** Baris hitungan gudang yang sudah tersimpan — id-nya menjadi kunci penyesuaian stoknya. */
    items: { id: string; itemId: string | null; variantSku: string | null; itemName: string; qty: number; condition: string | null }[];
    noNri: string;
    olehUserId: string;
  },
): Promise<{ baris: number; barang: string[] }> {
  let jumlahBarisStok = 0;
  // Barang yang stok jualnya bertambah — diteruskan ke Jubelio sesudah commit.
  const barang: string[] = [];

  for (const b of input.items) {
    if (!b.itemId || !(b.qty > 0)) continue;
    // Barang rusak atau kedaluwarsa tetap tercatat di hitungan gudang, tapi
    // tidak kembali jadi stok JUAL — ia tidak bisa dijual lagi.
    if (b.condition && b.condition !== "LAYAK") continue;

    const varian = b.variantSku?.trim() ?? "";
    // Varian yang disebut dicari PERSIS: barang kembali ke varian asalnya, bukan
    // ke baris pukul-rata. Baris tanpa varian memakai `variantSku: null` di
    // sebagian data dan `""` di sebagian lain — pencarian yang toleran mencegah
    // baris hantu kedua, dan barisnya dipatok ke penggerak stok di bawah.
    const stok = await findExistingInventoryValueRow(tx, b.itemId, varian || null);

    const qtyLama = stok ? Number(stok.qtyOnHand) : 0;
    const hargaRata = stok ? Number(stok.avgCost) : 0;
    const qtyBaru = qtyLama + b.qty;

    const adj = await tx.stockAdjustment.create({
      data: {
        docNumber: await generateDocNumber('ADJ', tx),
        itemId: b.itemId,
        type: 'POSITIVE',
        qtyChange: b.qty,
        reason: `Retur toko ${input.noNri} — ${b.itemName}${varian ? ` (${varian})` : ""}`,
        prevQty: qtyLama,
        newQty: qtyBaru,
        prevAvgCost: hargaRata,
        newAvgCost: hargaRata,
        createdById: input.olehUserId,
        source: 'STORE_RETURN_RECEIVE',
        // Per baris hitungan: jurnal retur membaca biaya kartu stok SETIAP baris lewat kunci ini,
        // untuk membandingkannya dengan HPP saat barang itu dijual (`hppJualTerakhir`).
        idempotencyKey: kunciStokReturMasuk(b.id),
      },
      select: { id: true, docNumber: true },
    });

    // Qty bertambah atom di dalam penggerak (baris stok ini juga digerakkan kiriman konsinyasi,
    // pengiriman putus, webhook Jubelio). Nilainya dihitung dari bacaan di atas — aman karena
    // hitungan gudang berjalan di `runSerializable`, yang mengunci bacaan itu sampai commit.
    await moveMainStock(tx, {
      itemId: b.itemId,
      variantSku: varian || null,
      qtyDelta: b.qty,
      inventoryValueId: stok?.id,
      createIfMissing: !stok,
      unitCost: hargaRata,
      totalCost: b.qty * hargaRata,
      totalValue: qtyBaru * hargaRata,
      balanceValue: qtyBaru * hargaRata,
      refType: 'StockAdjustment' satisfies StockLedgerRefType,
      refId: adj.id,
      refDocNumber: adj.docNumber,
      createdById: input.olehUserId,
    });
    jumlahBarisStok += 1;
    barang.push(b.itemId);
  }

  return { baris: jumlahBarisStok, barang };
}

/** Apa yang terjadi pada beban sebuah nota sesudah hitungannya berubah. */
export type KejadianSelaras = "TANPA_HITUNGAN" | "COCOK" | "BARU" | "BERUBAH" | "PULIH" | "TETAP";

export type HasilSelaras = {
  kejadian: KejadianSelaras;
  chargeId: string | null;
  sebelum: { amount: number; status: string } | null;
  sesudah: { amount: number; status: string } | null;
};

const sen = (n: number) => Math.round(n * 100);

/**
 * Selaraskan keadaan NRT dan bebannya dengan seluruh hitungan gudangnya —
 * hitungan asli DITAMBAH setiap hitungan susulan yang final (`nilaiFisikNota`).
 *
 * Dipanggil sesudah hitungan asli, penjodohan, hitungan susulan, menjadikan
 * hitungan tanpa nota sebagai susulan, dan melepas susulan.
 *
 * - Sisa selisih nol: beban yang masih TERBUKA dihapus (aturan lama); beban
 *   yang SUDAH diputuskan tetap barisnya dengan nilai 0 (`PULIH` — keputusannya
 *   dan potongannya tetap terbaca), dan notanya `COCOK`.
 * - Masih kurang: beban dibuat `TERBUKA` kalau belum ada (`BARU` — keadaan yang
 *   menahan faktur, dan yang membuat manager dikabari), atau besarnya
 *   disesuaikan (`BERUBAH`). Beban sales mengikuti `statusBebanSales`; penanggung
 *   lain tidak berubah statusnya.
 *
 * Setiap perubahan besar beban yang sudah ada dicatat di jejaknya
 * (`BEBAN_DISESUAIKAN`) di transaksi yang sama, kalau pelakunya diberikan.
 */
export async function selaraskanSelisih(tx: Klien, storeReturnId: string, olehUserId?: string): Promise<HasilSelaras> {
  const kosong: HasilSelaras = { kejadian: "TANPA_HITUNGAN", chargeId: null, sebelum: null, sesudah: null };
  const nrt = await tx.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      id: true,
      storeId: true,
      claimedAmount: true,
      status: true,
      warehouseReturn: { select: { id: true, physicalAmount: true, status: true } },
      followUps: { where: { status: "FINAL" }, select: { physicalAmount: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, amount: true, bearer: true, settledAmount: true },
      },
    },
  });
  if (!nrt || nrt.status === "BATAL") return kosong;

  const nri = nrt.warehouseReturn;
  const fisik = nilaiFisikNota({ warehouseReturn: nri, followUps: nrt.followUps });
  if (!nri || fisik === null) {
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: "MENUNGGU" } });
    return kosong;
  }

  const sisa = sisaSelisih(angka(nrt.claimedAmount), fisik);
  const beban = nrt.charges[0] ?? null;
  const sebelum = beban ? { amount: angka(beban.amount), status: beban.status as string } : null;

  /** Status beban sesudah besarnya berubah: hanya beban sales yang mengikuti potongannya. */
  const statusUntuk = (amount: number): string => {
    if (!beban) return "TERBUKA";
    if (beban.bearer === "SALES" && (beban.status === "DITETAPKAN" || beban.status === "LUNAS")) {
      return statusBebanSales(amount, angka(beban.settledAmount), beban.status);
    }
    return beban.status;
  };
  const jejakSesuai = async (sesudah: { amount: number; status: string } | null) => {
    if (!beban || !olehUserId) return;
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.BEBAN_DISESUAIKAN,
      entityType: "ReturnCharge",
      entityId: beban.id,
      changes: { before: sebelum, after: sesudah },
      metadata: { storeReturnId: nrt.id, nilaiFisik: fisik },
    });
  };

  if (sen(sisa) <= 0) {
    // Gudang sudah menerima sama banyak atau lebih (asli + susulan).
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: "COCOK" } });
    if (!beban || !sebelum) return { kejadian: "COCOK", chargeId: null, sebelum: null, sesudah: null };
    if (beban.status === "TERBUKA") {
      await tx.returnCharge.deleteMany({ where: { id: beban.id, status: "TERBUKA" } });
      await jejakSesuai(null);
      return { kejadian: "COCOK", chargeId: beban.id, sebelum, sesudah: null };
    }
    if (sen(sebelum.amount) === 0) return { kejadian: "TETAP", chargeId: beban.id, sebelum, sesudah: sebelum };
    const status = statusUntuk(0);
    await tx.returnCharge.update({
      where: { id: beban.id },
      data: { amount: D(0), status: status as "TERBUKA" | "DITETAPKAN" | "LUNAS" },
    });
    const sesudah = { amount: 0, status };
    await jejakSesuai(sesudah);
    return { kejadian: "PULIH", chargeId: beban.id, sebelum, sesudah };
  }

  await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: "SELISIH" } });
  if (!beban || !sebelum) {
    const dibuat = await tx.returnCharge.create({
      data: {
        storeReturnId: nrt.id,
        warehouseReturnId: nri.id,
        storeId: nrt.storeId,
        amount: D(sisa),
        status: "TERBUKA",
      },
      select: { id: true },
    });
    return { kejadian: "BARU", chargeId: dibuat?.id ?? null, sebelum: null, sesudah: { amount: sisa, status: "TERBUKA" } };
  }
  if (sen(sebelum.amount) === sen(sisa)) {
    return { kejadian: "TETAP", chargeId: beban.id, sebelum, sesudah: sebelum };
  }
  const status = statusUntuk(sisa);
  await tx.returnCharge.update({
    where: { id: beban.id },
    data: {
      amount: D(sisa),
      status: status as "TERBUKA" | "DITETAPKAN" | "LUNAS",
      ...(beban.status === "TERBUKA" ? { warehouseReturnId: nri.id, storeId: nrt.storeId } : {}),
    },
  });
  const sesudah = { amount: sisa, status };
  await jejakSesuai(sesudah);
  return { kejadian: "BERUBAH", chargeId: beban.id, sebelum, sesudah };
}

/** `AdminNotification` yang ditulis di dalam transaksi penulis, disebar sesudah commit. */
export type NotifikasiKantor = { id: string; category: string; title: string; message: string; metadata: Prisma.JsonValue };

/**
 * Kategori `AdminNotification` selisih retur toko — penerimanya yang memutuskan
 * penanggung selisih retur (`store_returns:decide_shortfall`, `admin-fanout.ts`).
 * Ditulis saat selisih BARU lahir (keputusan 2, 2026-10-29: "mengabari manager
 * kalau ada selisih") dan saat pemegang toko melaporkan barangnya tidak ditemukan.
 */
export const KATEGORI_NOTIF_RETUR_SELISIH = "RETUR_SELISIH";

/**
 * Tulis catatan kantor selisih retur di dalam transaksi pemanggil. Rupiah boleh
 * tampil untuk toko konsinyasi: penerimanya orang kantor.
 */
async function tulisNotifSelisih(
  tx: Klien,
  input: { storeReturnId: string; chargeId: string; jenis: "BARU" | "TIDAK_DITEMUKAN"; catatan?: string | null },
): Promise<NotifikasiKantor | null> {
  const nota = await tx.storeReturn.findUnique({
    where: { id: input.storeReturnId },
    select: {
      noNrt: true,
      storeId: true,
      store: { select: { name: true, salesman: { select: { name: true, email: true } } } },
      items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
      warehouseReturn: { select: { status: true, items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
      followUps: { where: { status: "FINAL" }, select: { items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
      charges: { where: { id: input.chargeId }, select: { amount: true } },
    },
  });
  if (!nota) return null;
  const hitungan = [
    ...(nota.warehouseReturn?.status === "FINAL" ? nota.warehouseReturn.items : []),
    ...nota.followUps.flatMap((f) => f.items),
  ];
  const pcs = kurangPerBarang(nota.items, hitungan).reduce((n, k) => n + k.qtyKurang, 0);
  const nilai = formatIDR(angka(nota.charges[0]?.amount));
  const pemegang = nota.store.salesman ? (nota.store.salesman.name ?? nota.store.salesman.email) : null;
  const tindak = pemegang
    ? `Salesman pemegang (${pemegang}) diminta menanyakan ke toko dan SPG.`
    : "Toko ini belum punya salesman pemegang — kantor yang menindaklanjuti.";
  const isi =
    input.jenis === "BARU"
      ? {
          title: `Selisih retur ${nota.noNrt} — ${nota.store.name}`,
          message: `${pcs} pcs kurang (${nilai}). ${tindak}`,
        }
      : {
          title: `Sales tidak menemukan barang retur ${nota.noNrt} — putuskan beban`,
          message: `${nota.store.name} · ${pcs} pcs kurang (${nilai}). Kata toko dan SPG: ${input.catatan?.trim() ?? ""}`,
        };
  return tx.adminNotification.create({
    data: {
      category: KATEGORI_NOTIF_RETUR_SELISIH,
      severity: "WARNING",
      title: capNotificationText(isi.title),
      message: capNotificationText(isi.message, 1000),
      metadata: { storeReturnId: input.storeReturnId, chargeId: input.chargeId, storeId: nota.storeId, noNrt: nota.noNrt },
    },
    select: { id: true, category: true, title: true, message: true, metadata: true },
  });
}

/**
 * Lepaskan nomor toko dari nota BATAL yang memegangnya, kalau ada.
 *
 * Nomor nota milik toko dan unik per toko — nota yang dibatalkan tetap
 * memegangnya. Padahal alasan paling umum membatalkan adalah salah ketik lalu
 * mencatat ulang nota yang SAMA, atau salah toko lalu memindahkannya ke toko
 * yang pernah punya nota batal bernomor itu. Nota batal diberi akhiran
 * "(batal)" — tetap ada, tetap terbaca — dan nomor aslinya hidup di jejaknya.
 *
 * Nota yang masih hidup tidak pernah disentuh: itu bentrok sungguhan.
 * Mengembalikan pencatat jejak, dipanggil SESUDAH nota pengganti punya id.
 */
export async function lepaskanNomorBatal(
  tx: Prisma.TransactionClient,
  storeId: string,
  noNrt: string,
): Promise<((penggantiId: string, olehUserId: string) => Promise<void>) | null> {
  const batal = await tx.storeReturn.findFirst({
    where: { storeId, noNrt, status: 'BATAL' },
    select: { id: true },
  });
  if (!batal) return null;
  const sudah = await tx.storeReturn.count({
    where: { storeId, noNrt: { startsWith: `${noNrt} (batal` } },
  });
  const nomorBatal = sudah === 0 ? `${noNrt} (batal)` : `${noNrt} (batal ${sudah + 1})`;
  await tx.storeReturn.update({ where: { id: batal.id }, data: { noNrt: nomorBatal } });
  return (penggantiId, olehUserId) =>
    catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.RETUR_NOMOR_DILEPAS,
      entityType: 'StoreReturn',
      entityId: batal.id,
      changes: { before: { noNrt }, after: { noNrt: nomorBatal } },
      metadata: { digantikanOleh: penggantiId },
    });
}

/** Kalender Jakarta: tahun dua digit dan bulan, untuk awalan nomor. */
function tahunBulanWib(saat: Date): { yy: string; mm: string } {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" })
    .format(saat)
    .split("-");
  return { yy: y.slice(-2), mm: m };
}

/**
 * Nomor nota retur buatan sistem: `TRK/26/10/0001`, direset tiap bulan (WIB).
 *
 * Hanya untuk toko KONSI yang tidak menerbitkan nota returnya sendiri — barang
 * itu milik kita, dan SPG yang mengembalikannya tidak punya nomor toko untuk
 * diketik. Toko PUTUS selalu memakai nomor tokonya.
 *
 * Nota yang dibatalkan memegang akhiran "(batal)", jadi urutannya dibaca dengan
 * `parseInt` (yang berhenti di spasi), bukan `Number`.
 */
async function nomorTrk(tx: Klien, saat: Date): Promise<string> {
  const { yy, mm } = tahunBulanWib(saat);
  const depan = `TRK/${yy}/${mm}/`;
  const terakhir = await tx.storeReturn.findFirst({
    where: { noNrt: { startsWith: depan } },
    orderBy: { noNrt: "desc" },
    select: { noNrt: true },
  });
  const urutan = terakhir ? (parseInt(terakhir.noNrt.slice(depan.length), 10) || 0) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, "0")}`;
}

/** Galat unik pada nomor nota (bukan pada kunci kiriman atau penunjuk pengganti). */
function bentrokNomorNota(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  return !bentrokKunciKiriman(err) && !bentrokPengganti(err);
}

type BarisSpgRapi = BarisReturSpg & {
  variantSku: string;
  condition: KondisiBarang;
  storeReceiptLineId: string | null;
  spgSaleReturnLineId: string | null;
};

/**
 * Gabungkan baris SPG yang sama (barang + varian + kondisi + baris tanda terima
 * rusak / retur pembeli yang ditunjuk); buang yang tidak sah. Baris barang
 * rusak kiriman atau rusak dari pembeli tidak pernah digabung dengan baris
 * biasa — yang satu menulis buku, yang lain tidak.
 */
function rapikanBarisSpg(baris: BarisReturSpg[]): BarisSpgRapi[] {
  const peta = new Map<string, BarisSpgRapi>();
  for (const b of baris) {
    if (!b.itemId?.trim() || !Number.isInteger(b.qty) || b.qty <= 0) continue;
    const variantSku = b.variantSku?.trim() ?? "";
    const condition = kondisiSah(b.condition);
    const storeReceiptLineId = b.storeReceiptLineId?.trim() || null;
    const spgSaleReturnLineId = b.spgSaleReturnLineId?.trim() || null;
    const k = `${b.itemId}::${variantSku}::${condition}::${storeReceiptLineId ?? ""}::${spgSaleReturnLineId ?? ""}`;
    const ada = peta.get(k);
    if (ada) ada.qty += b.qty;
    else peta.set(k, { itemId: b.itemId.trim(), variantSku, qty: b.qty, condition, storeReceiptLineId, spgSaleReturnLineId });
  }
  return [...peta.values()];
}

/**
 * Baris NRT SPG yang mengirim balik barang rusak kiriman: setiap baris tanda
 * terima yang ditunjuk harus milik toko ini, diputuskan `KEMBALI_GUDANG`,
 * barang + varian yang sama, kondisi bukan LAYAK, dan jumlahnya tidak melebihi
 * `qtyDamaged` dikurangi yang sudah ada di nota retur lain yang TIDAK batal.
 * Dibaca di dalam transaksi serializable pemanggil — dua nota bersamaan untuk
 * baris yang sama tidak bisa sama-sama lolos.
 */
async function periksaBarisRusakKiriman(
  tx: Klien,
  storeId: string,
  items: BarisTersusun[],
): Promise<"RUSAK_TIDAK_SAH" | "RUSAK_MELEBIHI" | null> {
  const perBaris = new Map<string, number>();
  for (const b of items) {
    if (!b.storeReceiptLineId) continue;
    if (b.condition === "LAYAK") return "RUSAK_TIDAK_SAH";
    perBaris.set(b.storeReceiptLineId, (perBaris.get(b.storeReceiptLineId) ?? 0) + b.qty);
  }
  if (perBaris.size === 0) return null;
  const ids = [...perBaris.keys()];
  const [baris, sudah] = await Promise.all([
    tx.storeReceiptLine.findMany({
      where: { id: { in: ids } },
      select: { id: true, itemId: true, variantSku: true, qtyDamaged: true, damageStatus: true, receipt: { select: { storeId: true } } },
    }),
    tx.storeReturnItem.groupBy({
      by: ["storeReceiptLineId"],
      where: { storeReceiptLineId: { in: ids }, storeReturn: { status: { not: "BATAL" } } },
      _sum: { qty: true },
    }),
  ]);
  const perId = new Map(baris.map((l) => [l.id, l]));
  const terpakai = new Map(sudah.map((g) => [g.storeReceiptLineId as string, g._sum.qty ?? 0]));
  for (const b of items) {
    if (!b.storeReceiptLineId) continue;
    const l = perId.get(b.storeReceiptLineId);
    if (!l || l.receipt.storeId !== storeId || l.damageStatus !== "KEMBALI_GUDANG") return "RUSAK_TIDAK_SAH";
    if (l.itemId !== b.itemId || l.variantSku !== (b.variantSku?.trim() ?? "")) return "RUSAK_TIDAK_SAH";
  }
  for (const [id, qty] of perBaris) {
    const l = perId.get(id)!;
    if (qty > l.qtyDamaged - (terpakai.get(id) ?? 0)) return "RUSAK_MELEBIHI";
  }
  return null;
}

/**
 * Baris NRT SPG yang mengirim balik barang rusak dari pembeli: setiap baris
 * retur pembeli yang ditunjuk harus milik retur pembeli DI TOKO INI yang SUDAH
 * BERLAKU (disetujui kantor — keputusan pemilik 2026-11-02; laporan yang masih
 * menunggu, ditolak, atau ditarik SPG tidak pernah membawa barangnya ke toko),
 * berkondisi RUSAK/EXPIRED, barang + varian yang sama, baris NRT-nya bukan
 * LAYAK, dan jumlahnya tidak melebihi qty rusaknya dikurangi yang sudah ada di
 * nota retur lain yang TIDAK batal. Baris yang sekaligus menunjuk baris tanda
 * terima ditolak — satu barang hanya punya satu asal. Penolakan statusnya sama
 * dengan retur pembeli toko lain (`RETUR_PEMBELI_TIDAK_SAH`): penulis ini yang
 * menahannya, bukan hanya layar yang tidak menawarkannya. Dibaca di dalam
 * transaksi serializable pemanggil (pola `periksaBarisRusakKiriman`); laporan
 * yang sudah disetujui tidak pernah kembali menunggu, jadi bacaan ini tidak
 * bisa usang sebelum NRT-nya tertulis.
 */
async function periksaBarisReturPembeli(
  tx: Klien,
  storeId: string,
  items: BarisTersusun[],
): Promise<"RETUR_PEMBELI_TIDAK_SAH" | "RETUR_PEMBELI_MELEBIHI" | null> {
  const perBaris = new Map<string, number>();
  for (const b of items) {
    if (!b.spgSaleReturnLineId) continue;
    if (b.condition === "LAYAK" || b.storeReceiptLineId) return "RETUR_PEMBELI_TIDAK_SAH";
    perBaris.set(b.spgSaleReturnLineId, (perBaris.get(b.spgSaleReturnLineId) ?? 0) + b.qty);
  }
  if (perBaris.size === 0) return null;
  const ids = [...perBaris.keys()];
  const [baris, sudah] = await Promise.all([
    tx.spgSaleReturnLine.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        itemId: true,
        variantSku: true,
        qty: true,
        condition: true,
        saleReturn: { select: { storeId: true, status: true } },
      },
    }),
    tx.storeReturnItem.groupBy({
      by: ["spgSaleReturnLineId"],
      where: { spgSaleReturnLineId: { in: ids }, storeReturn: { status: { not: "BATAL" } } },
      _sum: { qty: true },
    }),
  ]);
  const perId = new Map(baris.map((l) => [l.id, l]));
  const terpakai = new Map(sudah.map((g) => [g.spgSaleReturnLineId as string, g._sum.qty ?? 0]));
  for (const b of items) {
    if (!b.spgSaleReturnLineId) continue;
    const l = perId.get(b.spgSaleReturnLineId);
    if (!l || l.saleReturn.storeId !== storeId || !returPembeliSudahBerlaku(l.saleReturn.status)) {
      return "RETUR_PEMBELI_TIDAK_SAH";
    }
    if (l.condition === "LAYAK") return "RETUR_PEMBELI_TIDAK_SAH";
    if (l.itemId !== b.itemId || l.variantSku !== (b.variantSku?.trim() ?? "")) return "RETUR_PEMBELI_TIDAK_SAH";
  }
  for (const [id, qty] of perBaris) {
    const l = perId.get(id)!;
    if (qty > l.qty - (terpakai.get(id) ?? 0)) return "RETUR_PEMBELI_MELEBIHI";
  }
  return null;
}

/**
 * Susun baris NRT SPG dari master barang, di dalam transaksi.
 *
 * KONSI: harga = harga konsinyasi toko (`computeStorePrice` KONSI, markup yang
 * sama dengan dokumen konsinyasi lain) — nilai klaimnya dihitung server, tidak
 * pernah diketik dan tidak pernah tampil di HP. Barang berharga jual di toko
 * tanpa markup yang sah ditolak (`HARGA_KONSI_TIDAK_SAH`): `computeStorePrice`
 * lalu memberi harga katalog bertanda, dan klaim senilai harga katalog
 * diam-diam mengecilkan barang titipan yang kembali. PUTUS: harga 0 — barisnya
 * hanya qty, nilainya total nota toko yang diketik (`nilaiDariRincian`).
 */
async function susunBarisSpg(
  tx: Klien,
  baris: ReturnType<typeof rapikanBarisSpg>,
  toko: { termsType: "PUTUS" | "KONSI"; markupPercent: unknown },
): Promise<BarisTersusun[] | "BARANG_TIDAK_DITEMUKAN" | "HARGA_KONSI_TIDAK_SAH"> {
  const ids = [...new Set(baris.map((b) => b.itemId))];
  const barang = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, nameId: true, sellingPrice: true, variants: true },
  });
  if (barang.length !== ids.length) return "BARANG_TIDAK_DITEMUKAN";
  const perId = new Map(barang.map((b) => [b.id, b]));
  const markup = toko.markupPercent === null || toko.markupPercent === undefined ? null : angka(toko.markupPercent);

  const hasil: BarisTersusun[] = [];
  for (const b of baris) {
    const item = perId.get(b.itemId)!;
    const label = variantDetailForSku(item.variants, b.variantSku || null);
    let price = 0;
    if (toko.termsType === "KONSI") {
      const jual = item.sellingPrice === null ? null : angka(item.sellingPrice);
      const harga = computeStorePrice({ sellingPrice: jual, termsType: "KONSI", markupPercent: markup, priceDiscountPercent: null });
      if (harga.flagged) return "HARGA_KONSI_TIDAK_SAH";
      price = harga.price === null ? 0 : Math.round(harga.price * 100) / 100;
    }
    hasil.push({
      itemId: b.itemId,
      variantSku: b.variantSku,
      itemName: label ? `${item.nameId} — ${label}` : item.nameId,
      qty: b.qty,
      price,
      condition: b.condition,
      ...(b.storeReceiptLineId ? { storeReceiptLineId: b.storeReceiptLineId } : {}),
      ...(b.spgSaleReturnLineId ? { spgSaleReturnLineId: b.spgSaleReturnLineId } : {}),
    });
  }
  return hasil;
}

/**
 * Tulis barang retur KELUAR dari buku stok toko (`RETUR_KELUAR`, −qty per baris).
 *
 * Dilewati — bukan ditolak — bila buku toko belum dimulai (toko tanpa satu
 * gerakan pun: saldo awalnya baru lahir dari opname pertama), atau bila tanggal
 * retur jatuh pada HARI (WIB) sebelum opname terakhir (hitungan opname itu sudah memuat
 * kepergian barangnya; mengurangi lagi menghitungnya dua kali). Saldo boleh
 * negatif; opname yang membereskan. Barang yang rusak tetap keluar dari rak.
 */
async function tulisBukuReturKeluar(
  tx: Klien,
  input: { storeId: string; storeReturnId: string; claimDate: Date; olehUserId: string; items: BarisBarang[] },
): Promise<{ buku: "DITULIS" | "BELUM_ADA_BUKU" | "SEBELUM_OPNAME"; melebihiSaldo: { itemId: string; variantSku: string; qty: number; saldo: number }[] }> {
  const ada = await tx.storeStockMovement.findFirst({ where: { storeId: input.storeId }, select: { id: true } });
  if (!ada) return { buku: "BELUM_ADA_BUKU", melebihiSaldo: [] };
  const opname = await tx.storeOpname.findFirst({
    where: { storeId: input.storeId },
    orderBy: { countedAt: "desc" },
    select: { countedAt: true },
  });
  // Dibandingkan per HARI WIB: tanggal nota tidak berjam (tengah malam), opname
  // berjam. Retur di hari yang sama dengan opname tetap keluar dari buku —
  // barangnya masih di rak saat dihitung.
  if (opname && hariIniWib(input.claimDate) < hariIniWib(opname.countedAt)) {
    return { buku: "SEBELUM_OPNAME", melebihiSaldo: [] };
  }

  const baris = input.items.filter((b): b is BarisBarang & { itemId: string } => Boolean(b.itemId) && b.qty > 0);
  // Saldo dibaca DI DALAM transaksi — yang melebihi saldo tidak ditolak (barangnya
  // memang kembali), tapi dicatat di jejak supaya kantor bisa menanyakannya.
  const grup = await tx.storeStockMovement.groupBy({
    by: ["itemId", "variantSku"],
    where: { storeId: input.storeId, itemId: { in: [...new Set(baris.map((b) => b.itemId))] } },
    _sum: { qty: true },
  });
  const saldo = new Map(grup.map((g) => [`${g.itemId}::${g.variantSku}`, g._sum.qty ?? 0]));
  const perVarian = new Map<string, { itemId: string; variantSku: string; qty: number }>();
  for (const b of baris) {
    const v = b.variantSku?.trim() ?? "";
    const k = `${b.itemId}::${v}`;
    const x = perVarian.get(k);
    if (x) x.qty += b.qty;
    else perVarian.set(k, { itemId: b.itemId, variantSku: v, qty: b.qty });
  }
  const melebihiSaldo = [...perVarian.entries()]
    .filter(([k, b]) => b.qty > (saldo.get(k) ?? 0))
    .map(([k, b]) => ({ ...b, saldo: saldo.get(k) ?? 0 }));

  await tx.storeStockMovement.createMany({
    data: baris.map((b) => ({
      storeId: input.storeId,
      itemId: b.itemId,
      variantSku: b.variantSku?.trim() ?? "",
      qty: -b.qty,
      kind: "RETUR_KELUAR" as const,
      refType: "StoreReturn",
      refId: input.storeReturnId,
      createdById: input.olehUserId,
    })),
  });
  return { buku: "DITULIS", melebihiSaldo };
}

/**
 * Batalkan gerakan buku toko sebuah nota retur: tulis pembalik +qty untuk
 * setiap `RETUR_KELUAR` yang masih bersisa. Baris lama TIDAK PERNAH dihapus —
 * buku hanya bertambah, dan pembaliknya yang membawa ceritanya.
 *
 * Idempoten: dijumlah dulu per toko + barang + varian, jadi memanggilnya dua
 * kali tidak menulis pembalik kedua. Mengembalikan jumlah baris pembalik.
 */
export async function balikkanBukuRetur(tx: Klien, storeReturnId: string, olehUserId: string): Promise<number> {
  const grup = await tx.storeStockMovement.groupBy({
    by: ["storeId", "itemId", "variantSku"],
    where: { refType: "StoreReturn", refId: storeReturnId, kind: "RETUR_KELUAR" },
    _sum: { qty: true },
  });
  const pembalik = grup
    .filter((g) => (g._sum.qty ?? 0) < 0)
    .map((g) => ({
      storeId: g.storeId,
      itemId: g.itemId,
      variantSku: g.variantSku,
      qty: -(g._sum.qty ?? 0),
      kind: "RETUR_KELUAR" as const,
      refType: "StoreReturn",
      refId: storeReturnId,
      createdById: olehUserId,
    }));
  if (pembalik.length) await tx.storeStockMovement.createMany({ data: pembalik });
  return pembalik.length;
}

/**
 * Kategori `AdminNotification` untuk nota retur yang dilaporkan SPG di toko
 * TANPA salesman pemegang (`Store.salesmanId` kosong). Tidak ada orang lapangan
 * yang menindaklanjuti notanya — mengantar barangnya ke gudang, memotongkannya
 * di BKM — jadi kantor (`receivables:manage`, `admin-fanout.ts`) yang diberi
 * tahu (KEPUTUSAN SEMENTARA PEMILIK 2026-10-06).
 */
export const KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG = "RETUR_SPG_TANPA_PEMEGANG";

type BentrokSelisih = { noNrt: string; itemId: string; variantSku: string; qty: number; qtyKurang: number };

/**
 * Baris nota baru yang bisa jadi barang selisih nota lain di toko yang sama —
 * barang yang sudah dilaporkan pemegang toko DITEMUKAN dan sedang dikirim balik
 * sebagai susulan (P22a "langsung di kirimkan saja"), sehingga tidak perlu nota
 * baru. Hanya baris yang jumlahnya tidak melebihi yang masih kurang untuk barang
 * itu; jumlah di atasnya jelas bukan (hanya) barang selisih itu. Dibaca di dalam
 * transaksi pemanggil.
 */
async function bentrokSelisihDitemukan(
  tx: Klien,
  storeId: string,
  items: { itemId?: string | null; variantSku?: string | null; itemName: string; qty: number }[],
): Promise<BentrokSelisih[]> {
  const perKunci = new Map<string, { itemId: string; variantSku: string; qty: number }>();
  for (const b of items) {
    if (!b.itemId || !(b.qty > 0)) continue;
    const k = kunciBarangRetur(b);
    const ada = perKunci.get(k);
    if (ada) ada.qty += b.qty;
    else perKunci.set(k, { itemId: b.itemId, variantSku: b.variantSku?.trim() ?? "", qty: b.qty });
  }
  if (perKunci.size === 0) return [];
  const beban = await tx.returnCharge.findMany({
    where: {
      status: "TERBUKA",
      checkStatus: "DITEMUKAN",
      amount: { gt: 0 },
      storeReturn: { storeId, status: { not: "BATAL" } },
    },
    select: {
      storeReturn: {
        select: {
          noNrt: true,
          items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
          warehouseReturn: { select: { status: true, items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
          followUps: { where: { status: "FINAL" }, select: { items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
        },
      },
    },
  });
  const hasil: BentrokSelisih[] = [];
  for (const b of beban) {
    const n = b.storeReturn;
    if (!n) continue;
    const hitungan = [
      ...(n.warehouseReturn?.status === "FINAL" ? n.warehouseReturn.items : []),
      ...n.followUps.flatMap((f) => f.items),
    ];
    for (const k of kurangPerBarang(n.items, hitungan)) {
      const baru = perKunci.get(k.kunci);
      if (!baru || k.qtyKurang <= 0 || baru.qty > k.qtyKurang) continue;
      hasil.push({ noNrt: n.noNrt, itemId: baru.itemId, variantSku: baru.variantSku, qty: baru.qty, qtyKurang: k.qtyKurang });
    }
  }
  return hasil;
}

/**
 * Catat klaim retur dari toko (NRT).
 *
 * Nomornya diketik, bukan dihasilkan: ia nomor milik toko. Unik per toko, bukan
 * global — dua toko boleh memakai nomor yang sama, dan memaksa unik global akan
 * menolak nota yang sah. Satu pengecualian: NRT SPG di toko KONSI boleh tanpa
 * nomor, dan sistem memberinya `TRK/YY/MM/NNNN`.
 *
 * NRT dari SPG (`reportedBySpg`) membawa baris barang dari HP (`barisSpg`) —
 * barang, varian, qty, kondisi — dan menulis `RETUR_KELUAR` ke buku stok toko di
 * transaksi yang sama (`tulisBukuReturKeluar`). Piutang tidak tersentuh di sini:
 * retur baru diakui sebesar hitungan fisik gudang.
 */
export async function catatReturToko(input: {
  noNrt: string;
  storeId: string;
  /** Yang mencatat. Wajib — sebuah nota tanpa pencatat tak bisa ditanyakan. */
  olehUserId: string;
  salesmanId?: string | null;
  claimDate: Date;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  claimedAmount?: number;
  items?: BarisBarang[];
  photoUrl?: string | null;
  note?: string | null;
  /** Kunci kiriman dari antrean offline HP. Catatan dari kantor tidak membawanya. */
  idempotencyKey?: string | null;
  /** Nota BATAL yang digantikan nota ini ("Laporkan ulang"). Hanya boleh punya satu pengganti. */
  menggantikanId?: string | null;
  /** Kantor boleh mengganti nota sales siapa pun; sales hanya miliknya sendiri. */
  lintasPelapor?: boolean;
  /** Dilaporkan SPG dari toko tetapnya. Ditetapkan aksi server, tidak pernah dari HP. */
  reportedBySpg?: boolean;
  /** Baris barang dari HP SPG. Hanya dibaca bila `reportedBySpg`. */
  barisSpg?: BarisReturSpg[];
  /**
   * Pelapor menyatakan barang di nota ini retur LAIN, bukan barang selisih nota
   * lain yang sedang dikirim balik (`ADA_SELISIH_DITEMUKAN`). Kecocokannya
   * tetap dicatat di jejak nota ini.
   */
  returLain?: boolean;
}): Promise<
  | { ok: true; id: string; noNrt: string }
  | Gagal
  | { ok: false; alasan: AlasanPengganti }
  | { ok: false; alasan: "ADA_SELISIH_DITEMUKAN"; noNrt: string }
> {
  const dariSpg = input.reportedBySpg === true;
  const nomorDiketik = input.noNrt?.trim() ?? "";
  // Nota SPG di toko KONSI boleh tanpa nomor — baru diketahui di dalam transaksi.
  if (!nomorDiketik && !dariSpg) return { ok: false, alasan: 'NOMOR_WAJIB' };

  const barisSpg = dariSpg ? rapikanBarisSpg(input.barisSpg ?? []) : [];
  if (dariSpg && barisSpg.length === 0) return { ok: false, alasan: "BARIS_WAJIB" };

  const itemsBiasa = dariSpg ? [] : (input.items ?? []).filter((b) => b.itemName.trim() && b.qty > 0);
  // Kalau rinciannya berharga, totalnya DIHITUNG dari rincian — bukan diketik di
  // samping rincian yang tidak menjumlah ke sana.
  if (!dariSpg && !(nilaiDariRincian(itemsBiasa, input.claimedAmount) > 0)) {
    return { ok: false, alasan: 'NILAI_TIDAK_VALID' };
  }

  const kunci = input.idempotencyKey?.trim() || null;
  let nomorDibuat = false;
  // Diisi di dalam transaksi; disetel ulang di setiap percobaan supaya
  // notifikasi dari transaksi yang batal tidak pernah disebar.
  let notifikasi: NotifikasiKantor | null = null;

  const simpan = () =>
    denganNomorUnik(() =>
      runSerializable(async (tx) => {
        nomorDibuat = false;
        notifikasi = null;
        /*
         * Kiriman ulang dari HP dikenali lebih dulu. Tanpa ini ia ditolak
         * "nomor sudah dipakai" — oleh notanya sendiri — dan sales mengira
         * laporannya gagal. Kunci milik sales lain tidak menyerahkan notanya.
         */
        if (kunci) {
          const ada = await tx.storeReturn.findUnique({
            where: { idempotencyKey: kunci },
            select: { id: true, noNrt: true, salesmanId: true },
          });
          if (ada) {
            return ada.salesmanId === (input.salesmanId ?? null)
              ? { ok: true as const, id: ada.id, noNrt: ada.noNrt }
              : { ok: false as const, alasan: 'KUNCI_DIPAKAI' as const };
          }
        }

        // Foto nota harus unggahan pencatatnya sendiri, kecuali pengelola
        // piutang — nota retur toko lain tidak boleh dilaporkan ulang di sini.
        const fotoSah = await fotoBolehDipakai(tx, {
          urls: [input.photoUrl],
          userId: input.olehUserId,
          izinKantor: [PERMISSIONS.RECEIVABLES_MANAGE],
        });
        if (!fotoSah) return { ok: false as const, alasan: "FOTO_BUKAN_MILIK" as const };
        const kembar = await periksaFotoKembar(tx, { urls: [input.photoUrl], userId: input.olehUserId });
        if (!kembar.boleh) return { ok: false as const, alasan: kembar.kode };

        let nomor = nomorDiketik;
        let items: BarisTersusun[] = itemsBiasa;
        let total = nilaiDariRincian(itemsBiasa, input.claimedAmount);
        let tokoSpg: { name: string; salesmanId: string | null } | null = null;

        if (dariSpg) {
          const toko = await tx.store.findUnique({
            where: { id: input.storeId },
            select: { termsType: true, markupPercent: true, name: true, salesmanId: true },
          });
          if (!toko) return { ok: false as const, alasan: "TOKO_TIDAK_DITEMUKAN" as const };
          tokoSpg = { name: toko.name, salesmanId: toko.salesmanId };
          const susun = await susunBarisSpg(tx, barisSpg, toko);
          if (typeof susun === "string") return { ok: false as const, alasan: susun };
          // Retur pembeli dulu: ia juga menolak baris yang menunjuk DUA asal.
          const pembeli = await periksaBarisReturPembeli(tx, input.storeId, susun);
          if (pembeli) return { ok: false as const, alasan: pembeli };
          const rusak = await periksaBarisRusakKiriman(tx, input.storeId, susun);
          if (rusak) return { ok: false as const, alasan: rusak };
          items = susun;
          if (toko.termsType === "PUTUS") {
            // Barang toko putus milik toko: yang berlaku nota TOKO — nomornya,
            // fotonya, dan totalnya. Barisnya hanya qty.
            if (!nomor) return { ok: false as const, alasan: 'NOMOR_WAJIB' as const };
            if (!input.photoUrl?.trim()) return { ok: false as const, alasan: "FOTO_WAJIB" as const };
            total = nilaiDariRincian(items, input.claimedAmount);
            if (!(total > 0)) return { ok: false as const, alasan: 'NILAI_TIDAK_VALID' as const };
          } else {
            // Barang konsinyasi milik kita: nilainya dihitung server. Barang
            // tanpa harga jual bernilai nol — barangnya tetap harus bisa kembali.
            total = items.reduce((s, b) => s + b.qty * b.price, 0);
            if (!nomor) {
              nomor = await nomorTrk(tx, input.claimDate);
              nomorDibuat = true;
            }
          }
        }

        const lama = input.menggantikanId
          ? await periksaReturLama(tx, {
              lamaId: input.menggantikanId,
              salesmanId: input.salesmanId ?? null,
              lintasPelapor: input.lintasPelapor,
            })
          : null;
        if (lama && !lama.ok) return { ok: false as const, alasan: lama.alasan };

        // Barang selisih nota lain yang sedang dikirim balik tidak butuh nota baru —
        // kecuali pelapornya menyatakan ini retur lain. Diperiksa sebelum menulis apa pun.
        const bentrok = await bentrokSelisihDitemukan(tx, input.storeId, items);
        if (bentrok.length > 0 && input.returLain !== true) {
          return { ok: false as const, alasan: "ADA_SELISIH_DITEMUKAN" as const, noNrt: bentrok[0].noNrt };
        }

        const catatLepas = nomorDibuat ? null : await lepaskanNomorBatal(tx, input.storeId, nomor);
        const nota = await tx.storeReturn.create({
          data: {
            noNrt: nomor,
            storeId: input.storeId,
            salesmanId: input.salesmanId ?? null,
            claimDate: input.claimDate,
            deliveryMethod: input.deliveryMethod,
            claimedAmount: D(total),
            photoUrl: input.photoUrl?.trim() || null,
            note: input.note?.trim() || null,
            idempotencyKey: kunci,
            replacesReturnId: lama ? input.menggantikanId : null,
            ...(dariSpg ? { reportedBySpg: true } : {}),
            status: 'MENUNGGU',
            items: {
              create: items.map((b) => ({
                itemId: b.itemId ?? null,
                itemName: b.itemName.trim(),
                qty: b.qty,
                price: D(b.price),
                amount: D(b.qty * b.price),
                ...(b.variantSku?.trim() ? { variantSku: b.variantSku.trim() } : {}),
                ...(b.condition ? { condition: b.condition } : {}),
                ...(dariSpg && b.storeReceiptLineId ? { storeReceiptLineId: b.storeReceiptLineId } : {}),
                ...(dariSpg && b.spgSaleReturnLineId ? { spgSaleReturnLineId: b.spgSaleReturnLineId } : {}),
              })),
            },
          },
          select: { id: true, noNrt: true },
        });

        // Barang yang tidak pernah ada di buku toko (rusak kiriman / rusak dari pembeli) tidak keluar dari buku.
        const itemsBuku = items.filter((b) => !barisTanpaBukuToko(b));
        const barisTanpaBuku = items.length - itemsBuku.length;
        const buku =
          dariSpg && itemsBuku.length > 0
            ? await tulisBukuReturKeluar(tx, {
                storeId: input.storeId,
                storeReturnId: nota.id,
                claimDate: input.claimDate,
                olehUserId: input.olehUserId,
                items: itemsBuku,
              })
            : null;

        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.RETUR_DICATAT,
          entityType: 'StoreReturn',
          entityId: nota.id,
          changes: { after: { noNrt: nota.noNrt, claimedAmount: total, storeId: input.storeId } },
          metadata: {
            deliveryMethod: input.deliveryMethod,
            jumlahBaris: items.length,
            // Dinyatakan retur lain padahal cocok dengan barang selisih yang sedang dikirim balik.
            ...(bentrok.length > 0 ? { returLainDariSelisih: bentrok } : {}),
            ...(dariSpg
              ? {
                  olehSpg: true,
                  nomorDibuatSistem: nomorDibuat,
                  bukuToko: buku?.buku ?? null,
                  ...(buku && buku.melebihiSaldo.length > 0 ? { melebihiSaldo: buku.melebihiSaldo } : {}),
                  ...(barisTanpaBuku > 0 ? { barisTanpaBuku } : {}),
                }
              : {}),
          },
        });
        if (catatLepas) await catatLepas(nota.id, input.olehUserId);
        if (lama && input.menggantikanId) {
          await catatDiganti(tx, {
            jenis: 'retur',
            lamaId: input.menggantikanId,
            baruId: nota.id,
            nomorBaru: nota.noNrt,
            olehUserId: input.olehUserId,
          });
        }

        // Toko tanpa pemegang: lonceng kantor, ditulis di transaksi yang sama
        // dengan notanya dan disebar sesudahnya. Tanpa rupiah — barisnya pcs.
        if (dariSpg && tokoSpg && !tokoSpg.salesmanId) {
          const pelapor = await tx.user.findUnique({ where: { id: input.olehUserId }, select: { name: true, email: true } });
          const potong = items.reduce((n, b) => n + b.qty, 0);
          notifikasi = await tx.adminNotification.create({
            data: {
              category: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG,
              severity: "INFO",
              title: `Nota retur SPG dari toko tanpa pemegang: ${tokoSpg.name}`,
              message: `${pelapor?.name ?? pelapor?.email ?? "SPG"} melaporkan nota retur ${nota.noNrt} (${items.length} barang, ${potong} potong) di ${tokoSpg.name}. Toko ini belum punya salesman pemegang, jadi kantor yang menindaklanjutinya.`,
              metadata: { storeReturnId: nota.id, storeId: input.storeId, noNrt: nota.noNrt },
            },
            select: { id: true, category: true, title: true, message: true, metadata: true },
          });
        }

        return { ok: true as const, id: nota.id, noNrt: nota.noNrt };
      }),
    );

  try {
    // Kiriman kembarnya menang lebih dulu → percobaan berikutnya menemukan notanya.
    // Nomor buatan sistem yang keburu diambil nota lain → ambil nomor berikutnya.
    for (let percobaan = 0; ; percobaan++) {
      try {
        const hasil = await simpan();
        // Sesudah transaksi, tidak pernah ditunggu (lihat `fanOutAdminNotification`).
        const kabar = notifikasi as NotifikasiKantor | null;
        if (hasil.ok && kabar) void fanOutAdminNotification(kabar);
        return hasil;
      } catch (err) {
        const ulangi = bentrokKunciKiriman(err) || (nomorDibuat && bentrokNomorNota(err));
        if (!ulangi || percobaan >= 2) throw err;
      }
    }
  } catch (err) {
    if (bentrokPengganti(err)) return { ok: false, alasan: 'SUDAH_DIGANTI' };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_SUDAH_DIPAKAI' };
    }
    throw err;
  }
}

/**
 * Catat hitungan fisik gudang (NRI).
 *
 * `storeReturnId` boleh kosong: barang datang lewat ekspedisi mendahului
 * notanya, dan penerimaan itu harus bisa dicatat sebelum ada yang tahu ia milik
 * nota yang mana. Yang begitu masuk daftar kerja sebagai "belum dijodohkan".
 *
 * Dicatat langsung `FINAL`. Keadaan `DRAFT` ada di skema untuk hitungan yang
 * disimpan setengah jalan, tapi belum ada layarnya — dan pembacanya sudah
 * memperlakukan DRAFT sebagai belum dihitung, jadi arah amannya sudah benar.
 */
export async function catatHitunganGudang(input: {
  storeReturnId?: string | null;
  storeId?: string | null;
  warehouseUserId: string;
  receivedAt: Date;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string | null;
}): Promise<
  | {
      ok: true;
      id: string;
      noNri: string;
      barisStok: number;
      barisGudangRusak: number;
      piutangDihitungUlang: number;
      /**
       * Klaim toko, baru diperlihatkan SESUDAH hitungan tersimpan — layar hitung
       * sengaja tidak menampilkannya supaya gudang menghitung barang, bukan
       * menyalin angka nota. `null` untuk penerimaan yatim.
       */
      klaim: { nilai: number; qty: number } | null;
      fisik: { nilai: number; qty: number };
      /** Hitungan ini melahirkan selisih baru — manager sudah dikabari, pemegang toko dikabari aksinya. */
      selisihBaru: { chargeId: string } | null;
    }
  | Gagal
> {
  // Baris tanpa nama adalah sisa penyunting; baris BERNAMA tanpa jumlah adalah
  // hitungan yang belum selesai. Yang kedua ditolak, bukan dibuang diam-diam:
  // membuangnya mencatat fisik lebih kecil dan membebankan selisihnya ke orang.
  // Nol sah — asal diketik.
  const terisi = (input.items ?? []).filter((b) => b.itemName?.trim());
  if (terisi.some((b) => typeof b.qty !== "number" || !Number.isInteger(b.qty) || b.qty < 0)) {
    return { ok: false, alasan: "HITUNGAN_KOSONG" };
  }
  const items = terisi.map((b) => ({ ...b, condition: b.condition ? kondisiSah(b.condition) : undefined }));
  // Nol sah — artinya tidak ada barang yang sampai. Itu berbeda dari belum
  // dihitung, dan menolaknya akan memaksa gudang berbohong. Rincian tanpa
  // harga (NRT SPG toko putus) membawa nilainya di angka yang diketik.
  const total = nilaiDariRincian(items, input.physicalAmount);
  if (!(total >= 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  // Barang yang stok jualnya bertambah di percobaan yang COMMIT (diulang dari nol tiap percobaan).
  let barangStok: string[] = [];
  // Catatan kantor selisih baru — disetel ulang tiap percobaan, disebar sesudah commit.
  let notifikasi: NotifikasiKantor | null = null;
  try {
    const hasil = await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        barangStok = [];
        notifikasi = null;
        let storeId = input.storeId ?? null;
        let klaim = 0;
        let qtyKlaimPerBarang = new Map<string, number>();

        if (input.storeReturnId) {
          const nrt = await tx.storeReturn.findUnique({
            where: { id: input.storeReturnId },
            select: {
              id: true,
              storeId: true,
              salesmanId: true,
              status: true,
              claimedAmount: true,
              warehouseReturn: { select: { id: true } },
              items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
            },
          });
          if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
          if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
          // Seluruh guna retur dua sisi adalah yang mengklaim dan yang menghitung
          // bukan orang yang sama. Izin saja tidak cukup: orang yang memegang
          // keduanya (admin) tetap tidak boleh menghitung notanya sendiri.
          if (nrt.salesmanId && nrt.salesmanId === input.warehouseUserId) {
            return { ok: false as const, alasan: "PENGHITUNG_SAMA_PELAPOR" as const };
          }
          // Menimpa hitungan berarti mengubah angka yang mungkin sudah dipakai
          // memutuskan siapa menanggung selisihnya. Yang salah dilepas dulu.
          if (nrt.warehouseReturn) return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };
          storeId = nrt.storeId;
          klaim = angka(nrt.claimedAmount);
          // Per barang + varian (baris tanpa barang katalog: per nama). Satu barang
          // bisa muncul dua kali di nota — layak dan rusak — jadi dijumlahkan.
          qtyKlaimPerBarang = new Map();
          for (const i of nrt.items) {
            const k = kunciBarangRetur(i);
            qtyKlaimPerBarang.set(k, (qtyKlaimPerBarang.get(k) ?? 0) + i.qty);
          }
        }

        const nri = await tx.warehouseReturn.create({
          data: {
            noNri: await nomorNri(tx, input.receivedAt),
            storeId,
            storeReturnId: input.storeReturnId ?? null,
            warehouseUserId: input.warehouseUserId,
            receivedAt: input.receivedAt,
            deliveryMethod: input.deliveryMethod,
            physicalAmount: D(total),
            claimedAmount: D(klaim),
            note: input.note?.trim() || null,
            status: 'FINAL',
            finalisedAt: new Date(),
            items: {
              create: items.map((b, i) => {
                // Qty klaim disalin dari NRT per barang + varian supaya selisihnya
                // terbaca per baris, bukan cuma sebagai total. Baris kedua untuk
                // barang yang sama (mis. sebagian rusak) tidak menyalinnya lagi.
                const k = kunciBarangRetur(b);
                const pertama = items.findIndex((x) => kunciBarangRetur(x) === k) === i;
                return {
                  itemId: b.itemId ?? null,
                  itemName: b.itemName.trim(),
                  qtyClaim: pertama ? (qtyKlaimPerBarang.get(k) ?? 0) : 0,
                  qty: b.qty,
                  price: D(b.price),
                  amount: D(b.qty * b.price),
                  ...(b.variantSku?.trim() ? { variantSku: b.variantSku.trim() } : {}),
                  ...(b.condition ? { condition: b.condition } : {}),
                };
              }),
            },
          },
          select: {
            id: true,
            noNri: true,
            items: { select: { id: true, itemId: true, variantSku: true, itemName: true, qty: true, condition: true } },
          },
        });

        const stokMasuk = await masukkanKeStok(tx, {
          items: nri.items,
          noNri: nri.noNri,
          olehUserId: input.warehouseUserId,
        });
        const barisStok = stokMasuk.baris;
        barangStok = stokMasuk.barang;
        // Barang RUSAK/EXPIRED tidak masuk stok jual, tapi masuk GUDANG BARANG
        // RUSAK (satu gerakan per baris NRI) — kantor yang memutuskan nasibnya.
        const barisGudangRusak = await masukkanGudangRusakDariNri(tx, {
          noNri: nri.noNri,
          olehUserId: input.warehouseUserId,
          baris: nri.items,
          // Nilai barang rusak = HPP saat dijual ke toko ini (fallback rata-rata sekarang),
          // sama dengan yang didebit jurnal returnya ke persediaan rusak.
          storeId,
          sebelum: new Date(),
        });

        await catatJejak(tx, {
          userId: input.warehouseUserId,
          action: JEJAK.RETUR_DIHITUNG,
          entityType: 'WarehouseReturn',
          entityId: nri.id,
          // Hitungan ini hanya bisa dicatat sekali dan menentukan berapa yang
          // ditahan dari piutang. Angkanya harus bisa ditelusuri ke orangnya.
          changes: { after: { noNri: nri.noNri, physicalAmount: total, claimedAmount: klaim } },
          metadata: {
            storeReturnId: input.storeReturnId ?? null,
            barisStok,
            ...(barisGudangRusak > 0 ? { barisGudangRusak } : {}),
          },
        });

        const selaras = input.storeReturnId
          ? await selaraskanSelisih(tx, input.storeReturnId, input.warehouseUserId)
          : null;
        // Selisih baru lahir: manager dikabari di transaksi yang sama (keputusan 2, 2026-10-29).
        const selisihBaru = selaras?.kejadian === "BARU" && selaras.chargeId ? { chargeId: selaras.chargeId } : null;
        if (selisihBaru && input.storeReturnId) {
          notifikasi = await tulisNotifSelisih(tx, { storeReturnId: input.storeReturnId, chargeId: selisihBaru.chargeId, jenis: "BARU" });
        }

        return {
          ok: true as const,
          id: nri.id,
          noNri: nri.noNri,
          barisStok,
          barisGudangRusak,
          piutangDihitungUlang: await hitungUlangTersentuh(tx, input.storeReturnId ?? null),
          klaim: input.storeReturnId
            ? { nilai: klaim, qty: [...qtyKlaimPerBarang.values()].reduce((a, b) => a + b, 0) }
            : null,
          fisik: { nilai: total, qty: items.reduce((a, b) => a + b.qty, 0) },
          selisihBaru,
        };
      }),
    );
    // Sesudah commit: stok jual gudang bertambah, Jubelio harus tahu sebelum
    // webhook stoknya menimpa angka ERP. Best-effort, tidak pernah melempar.
    if (hasil.ok && barangStok.length > 0) {
      await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `retur toko ${hasil.noNri}`, userId: input.warehouseUserId });
    }
    const kabar = notifikasi as NotifikasiKantor | null;
    if (hasil.ok && kabar) void fanOutAdminNotification(kabar);
    return hasil;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/** Jodohkan penerimaan gudang yatim dengan nota toko yang baru ditemukan. */
export async function jodohkanRetur(input: {
  warehouseReturnId: string;
  storeReturnId: string;
  olehUserId: string;
}): Promise<(Berhasil & { selisihBaru: { chargeId: string } | null }) | Gagal> {
  // Catatan kantor selisih baru — disetel ulang tiap percobaan, disebar sesudah commit.
  let notifikasi: NotifikasiKantor | null = null;
  const hasil = await runSerializable(async (tx) => {
    notifikasi = null;
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: {
        id: true,
        storeReturnId: true,
        followUpOfStoreReturnId: true,
        storeId: true,
        physicalAmount: true,
        warehouseUserId: true,
      },
    });
    if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    // Hitungan susulan nota lain juga bukan yatim: barangnya sudah menutup selisih nota itu.
    if (nri.storeReturnId || nri.followUpOfStoreReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };

    const nrt = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: {
        id: true,
        storeId: true,
        salesmanId: true,
        status: true,
        claimedAmount: true,
        warehouseReturn: { select: { id: true } },
      },
    });
    if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    if (nrt.warehouseReturn) return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };
    // Penerimaan yang sudah tahu tokonya tidak boleh dijodohkan ke toko lain —
    // itu memindahkan barang satu toko ke tagihan toko lain.
    if (nri.storeId && nri.storeId !== nrt.storeId) {
      return { ok: false as const, alasan: 'BEDA_TOKO' as const };
    }
    // Aturan dua tangan yang sama dengan `catatHitunganGudang`: hitungan "yatim"
    // yang dicatat pelapor nota tidak boleh menjadi hitungan notanya sendiri.
    if (nrt.salesmanId && nrt.salesmanId === nri.warehouseUserId) {
      return { ok: false as const, alasan: "PENGHITUNG_SAMA_PELAPOR" as const };
    }

    await tx.warehouseReturn.update({
      where: { id: nri.id },
      data: {
        storeReturnId: nrt.id,
        storeId: nrt.storeId,
        claimedAmount: nrt.claimedAmount,
      },
    });
    const selaras = await selaraskanSelisih(tx, nrt.id, input.olehUserId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIJODOHKAN,
      entityType: 'WarehouseReturn',
      entityId: nri.id,
      changes: { before: { storeReturnId: null }, after: { storeReturnId: nrt.id } },
      metadata: { storeId: nrt.storeId },
    });

    const selisihBaru = selaras.kejadian === "BARU" && selaras.chargeId ? { chargeId: selaras.chargeId } : null;
    if (selisihBaru) {
      notifikasi = await tulisNotifSelisih(tx, { storeReturnId: nrt.id, chargeId: selisihBaru.chargeId, jenis: "BARU" });
    }

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nrt.id), selisihBaru };
  });
  const kabar = notifikasi as NotifikasiKantor | null;
  if (hasil.ok && kabar) void fanOutAdminNotification(kabar);
  return hasil;
}

/**
 * Lepas pasangan NRT–NRI.
 *
 * Ditolak kalau bebannya sudah diputuskan: seseorang sudah ditetapkan
 * menanggung selisih pasangan ini, dan melepasnya meninggalkan beban yang
 * menunjuk perbandingan yang tidak ada lagi. Juga ditolak selama nota itu punya
 * hitungan susulan (`ADA_SUSULAN`): susulan menambah hitungan ASLI ini, dan tanpa
 * aslinya ia tidak menutup apa pun — lepas susulannya dulu.
 */
export async function lepasPasangan(input: {
  warehouseReturnId: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  return runSerializable(async (tx) => {
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: { id: true, storeReturnId: true },
    });
    if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (!nri.storeReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };

    const diputuskan = await tx.returnCharge.count({
      where: { storeReturnId: nri.storeReturnId, status: { not: 'TERBUKA' } },
    });
    if (diputuskan > 0) return { ok: false as const, alasan: 'BEBAN_SUDAH_DIPUTUSKAN' as const };
    const susulan = await tx.warehouseReturn.count({ where: { followUpOfStoreReturnId: nri.storeReturnId } });
    if (susulan > 0) return { ok: false as const, alasan: 'ADA_SUSULAN' as const };

    const storeReturnId = nri.storeReturnId;
    await tx.returnCharge.deleteMany({ where: { storeReturnId, status: 'TERBUKA' } });
    await tx.warehouseReturn.update({
      where: { id: nri.id },
      data: { storeReturnId: null, claimedAmount: D(0) },
    });
    // Nota yang sudah BATAL tetap batal: melepas pasangan tidak boleh
    // menghidupkan kembali nota yang sudah diputuskan salah.
    const nrtLama = await tx.storeReturn.findUnique({ where: { id: storeReturnId }, select: { status: true } });
    if (nrtLama && nrtLama.status !== 'BATAL') {
      await tx.storeReturn.update({ where: { id: storeReturnId }, data: { status: 'MENUNGGU' } });
    }

    // Pembalikan. Tanpa jejak, sebuah pasangan bisa dilepas dan dijodohkan ulang
    // ke nota lain tanpa ada yang bisa menunjukkan bahwa itu pernah terjadi.
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DILEPAS,
      entityType: 'WarehouseReturn',
      entityId: nri.id,
      changes: { before: { storeReturnId }, after: { storeReturnId: null } },
    });

    return {
      ok: true as const,
      piutangDihitungUlang: await hitungUlangTersentuh(tx, storeReturnId),
    };
  });
}

/** Hasil laporan sales pemegang toko atas selisih retur (P22, P88). */
export const HASIL_CEK_SELISIH = ["DITEMUKAN", "TIDAK_DITEMUKAN"] as const satisfies readonly CekSelisih[];

/**
 * Salesman pemegang toko melaporkan hasil mencari barang selisih retur: ditanyakan
 * ke toko DAN ke SPG-nya (P22, tambahan 2026-11-02 malam), lalu DITEMUKAN (barangnya
 * dikirim balik ke gudang, P22a) atau TIDAK_DITEMUKAN (dengan jawaban mereka).
 *
 * Hanya pemegang toko itu SEKARANG yang melapor (P85, bawaan tercatat: "pemegang
 * yang sekarang yang menanyakan") — SPG, salesman lain, dan kantor ditolak. Boleh
 * melapor ulang selama bebannya belum diputuskan; setiap laporan berjejak. Laporan
 * "tidak ditemukan" mengabari manager di transaksi yang sama; disebar pemanggil.
 */
export async function laporHasilCekSelisih(input: {
  chargeId: string;
  hasil: "DITEMUKAN" | "TIDAK_DITEMUKAN";
  catatan?: string | null;
  olehUserId: string;
}): Promise<{ ok: true; notifikasi: NotifikasiKantor | null } | Gagal> {
  if (!(HASIL_CEK_SELISIH as readonly string[]).includes(input.hasil)) return { ok: false, alasan: "HASIL_TIDAK_SAH" };
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (Array.from(catatan).length > BATAS_TEKS_HILANG) return { ok: false, alasan: "CATATAN_TERLALU_PANJANG" };
  if (input.hasil === "TIDAK_DITEMUKAN" && !catatan) return { ok: false, alasan: "CATATAN_WAJIB" };

  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: {
        id: true,
        status: true,
        checkStatus: true,
        checkNote: true,
        storeReturn: { select: { id: true, status: true, store: { select: { salesmanId: true } } } },
      },
    });
    if (!beban || !beban.storeReturn) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };
    if (beban.storeReturn.status === "BATAL") return { ok: false as const, alasan: "SUDAH_DIBATALKAN" as const };
    if (beban.storeReturn.store.salesmanId !== input.olehUserId) return { ok: false as const, alasan: "BUKAN_PEMEGANG" as const };
    if (beban.status !== "TERBUKA") return { ok: false as const, alasan: "SUDAH_DIPUTUSKAN" as const };

    // Bandingkan-lalu-tukar di dalam transaksi serializable: keputusan beban yang
    // bersamaan membuat salah satunya ditolak, tidak keduanya tertulis.
    const ubah = await tx.returnCharge.updateMany({
      where: { id: beban.id, status: "TERBUKA" },
      data: { checkStatus: input.hasil, checkNote: catatan || null, checkedById: input.olehUserId, checkedAt: new Date() },
    });
    if (ubah.count !== 1) return { ok: false as const, alasan: "SUDAH_DIPUTUSKAN" as const };

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_HASIL_CEK,
      entityType: "ReturnCharge",
      entityId: beban.id,
      changes: {
        before: { checkStatus: beban.checkStatus, checkNote: beban.checkNote },
        after: { checkStatus: input.hasil, checkNote: catatan || null },
      },
      metadata: { storeReturnId: beban.storeReturn.id },
    });

    const notifikasi =
      input.hasil === "TIDAK_DITEMUKAN"
        ? await tulisNotifSelisih(tx, { storeReturnId: beban.storeReturn.id, chargeId: beban.id, jenis: "TIDAK_DITEMUKAN", catatan })
        : null;
    return { ok: true as const, notifikasi };
  });
}

/**
 * Barang susulan yang sudah keluar dari buku stok toko sekali lagi.
 *
 * Saat nota retur SPG dicatat, seluruh klaimnya keluar dari buku toko
 * (`RETUR_KELUAR`). Barang yang ternyata tertinggal di toko baru kembali ke buku
 * kalau opname toko yang disetujui menemukannya sesudah itu — dan hanya sebanyak
 * itu yang dikeluarkan lagi saat susulannya dikirim (`keluarBukuSusulan`). Tanpa
 * opname di antaranya, buku toko sudah tidak memuatnya dan tidak ada yang ditulis.
 */
async function tulisBukuSusulan(
  tx: Klien,
  input: {
    storeId: string;
    storeReturnId: string;
    susulanId: string;
    olehUserId: string;
    items: { itemId: string | null; variantSku: string | null; qty: number }[];
  },
): Promise<number> {
  const keluar = await tx.storeStockMovement.findMany({
    where: { refType: "StoreReturn", refId: input.storeReturnId, kind: "RETUR_KELUAR", qty: { lt: 0 } },
    select: { itemId: true, variantSku: true, createdAt: true },
  });
  if (keluar.length === 0) return 0;
  const pertama = new Map<string, { itemId: string; variantSku: string; pertama: Date }>();
  for (const k of keluar) {
    const kunci = `${k.itemId}::${k.variantSku}`;
    const ada = pertama.get(kunci);
    if (!ada || k.createdAt < ada.pertama) pertama.set(kunci, { itemId: k.itemId, variantSku: k.variantSku, pertama: k.createdAt });
  }
  const susulan = input.items.flatMap((b) =>
    b.itemId && b.qty > 0 ? [{ itemId: b.itemId, variantSku: b.variantSku?.trim() ?? "", qty: b.qty }] : [],
  );
  if (susulan.length === 0) return 0;
  const sejak = new Date(Math.min(...[...pertama.values()].map((p) => p.pertama.getTime())));
  const [opname, lain] = await Promise.all([
    tx.storeStockMovement.findMany({
      where: {
        storeId: input.storeId,
        kind: "OPNAME",
        qty: { gt: 0 },
        itemId: { in: [...new Set(susulan.map((x) => x.itemId))] },
        createdAt: { gt: sejak },
      },
      select: { itemId: true, variantSku: true, qty: true, createdAt: true },
    }),
    tx.warehouseReturn.findMany({
      where: { followUpOfStoreReturnId: input.storeReturnId, id: { not: input.susulanId } },
      select: { id: true },
    }),
  ]);
  const sudah = lain.length
    ? await tx.storeStockMovement.groupBy({
        by: ["itemId", "variantSku"],
        where: { refType: "WarehouseReturn", refId: { in: lain.map((l) => l.id) }, kind: "RETUR_KELUAR" },
        _sum: { qty: true },
      })
    : [];
  const tulis = keluarBukuSusulan({
    susulan,
    keluarNrt: [...pertama.values()],
    opnamePlus: opname.map((o) => ({ itemId: o.itemId, variantSku: o.variantSku, qty: o.qty, pada: o.createdAt })),
    sudahSusulan: sudah.map((g) => ({ itemId: g.itemId, variantSku: g.variantSku, qty: Math.max(0, -(g._sum.qty ?? 0)) })),
  });
  if (tulis.length === 0) return 0;
  await tx.storeStockMovement.createMany({
    data: tulis.map((t) => ({
      storeId: input.storeId,
      itemId: t.itemId,
      variantSku: t.variantSku ?? "",
      qty: -t.qty,
      kind: "RETUR_KELUAR" as const,
      refType: "WarehouseReturn",
      refId: input.susulanId,
      createdById: input.olehUserId,
    })),
  });
  return tulis.length;
}

/** Balik koreksi buku toko sebuah hitungan susulan yang dilepas — tanpa menghapus barisnya (idempoten). */
async function balikkanBukuSusulan(tx: Klien, susulanId: string, olehUserId: string): Promise<number> {
  const grup = await tx.storeStockMovement.groupBy({
    by: ["storeId", "itemId", "variantSku"],
    where: { refType: "WarehouseReturn", refId: susulanId, kind: "RETUR_KELUAR" },
    _sum: { qty: true },
  });
  const pembalik = grup
    .filter((g) => (g._sum.qty ?? 0) < 0)
    .map((g) => ({
      storeId: g.storeId,
      itemId: g.itemId,
      variantSku: g.variantSku,
      qty: -(g._sum.qty ?? 0),
      kind: "RETUR_KELUAR" as const,
      refType: "WarehouseReturn",
      refId: susulanId,
      createdById: olehUserId,
    }));
  if (pembalik.length) await tx.storeStockMovement.createMany({ data: pembalik });
  return pembalik.length;
}

/**
 * Keadaan beban yang menentukan apakah barang yang ketemu masih boleh menjadi
 * susulan nota ini. Ditolak kalau penanggungnya sudah membayar sebagian atau
 * seluruhnya (P87, bawaan tercatat: "sistem menolak mencatatnya sebagai barang
 * susulan nota itu (barangnya tetap bisa diterima gudang sebagai penerimaan
 * tanpa nota)").
 */
function tolakSusulan(beban: { amount: unknown; status: string; settledAmount: unknown } | null): AlasanGagalRetur | null {
  if (!beban || !(angka(beban.amount) > 0)) return "TIDAK_ADA_SELISIH";
  if (beban.status === "LUNAS") return "SUDAH_LUNAS";
  if (sen(angka(beban.settledAmount)) !== 0) return "SUDAH_DIPOTONG";
  return null;
}

/**
 * Catat hitungan gudang atas barang SUSULAN sebuah nota retur — barang selisih
 * yang ketemu di toko dan dikirim balik (P22a "langsung di kirimkan saja").
 *
 * Hitungannya BUTA, seperti hitungan pertama (keputusan 2, 2026-10-29), dan
 * menjadi NRI-nya sendiri bernomor `NRI/yy/mm/nnnn`, `FINAL`, dengan
 * `followUpOfStoreReturnId` = notanya (bukan `storeReturnId`, yang milik hitungan
 * asli). Barang LAYAK masuk stok jual lewat `masukkanKeStok`; RUSAK/EXPIRED ke
 * gudang barang rusak. Sesudahnya selisih dan bebannya diselaraskan, dan piutang
 * yang tersentuh dihitung ulang — semuanya di satu transaksi.
 *
 * Dua tangan: pelapor nota, sales yang melaporkan hasil ceknya, sales yang
 * dibebani, dan pemegang toko sekarang tidak pernah menghitung susulannya.
 */
export async function catatHitunganSusulan(input: {
  storeReturnId: string;
  warehouseUserId: string;
  receivedAt: Date;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string | null;
}): Promise<
  | {
      ok: true;
      id: string;
      noNri: string;
      barisStok: number;
      barisGudangRusak: number;
      barisBukuToko: number;
      piutangDihitungUlang: number;
      fisik: { nilai: number; qty: number };
      /** Sisa selisih nota sesudah susulan ini — baru diperlihatkan sesudah tersimpan. */
      sisaSelisih: number;
      selaras: HasilSelaras;
    }
  | Gagal
> {
  // Aturan isian yang sama dengan hitungan pertama: baris bernama tanpa jumlah
  // ditolak, nol sah asal diketik.
  const terisi = (input.items ?? []).filter((b) => b.itemName?.trim());
  if (terisi.some((b) => typeof b.qty !== "number" || !Number.isInteger(b.qty) || b.qty < 0)) {
    return { ok: false, alasan: "HITUNGAN_KOSONG" };
  }
  const items = terisi.map((b) => ({ ...b, condition: b.condition ? kondisiSah(b.condition) : undefined }));
  const total = nilaiDariRincian(items, input.physicalAmount);
  if (!(total >= 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  let barangStok: string[] = [];
  try {
    const hasil = await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        barangStok = [];
        const nrt = await tx.storeReturn.findUnique({
          where: { id: input.storeReturnId },
          select: {
            id: true,
            noNrt: true,
            storeId: true,
            salesmanId: true,
            status: true,
            store: { select: { salesmanId: true } },
            warehouseReturn: { select: { status: true } },
            charges: {
              orderBy: { createdAt: "asc" },
              select: { id: true, status: true, amount: true, settledAmount: true, bearer: true, checkedById: true, bearerUserId: true },
            },
          },
        });
        if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
        if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
        if (!nrt.warehouseReturn || nrt.warehouseReturn.status !== 'FINAL') {
          return { ok: false as const, alasan: 'BELUM_DIHITUNG' as const };
        }
        const beban = nrt.charges[0] ?? null;
        const tolak = tolakSusulan(beban);
        if (tolak || !beban) return { ok: false as const, alasan: tolak ?? ("TIDAK_ADA_SELISIH" as const) };
        const dilarang = [nrt.salesmanId, beban.checkedById, beban.bearerUserId, nrt.store.salesmanId];
        if (dilarang.includes(input.warehouseUserId)) {
          return { ok: false as const, alasan: "PENGHITUNG_SAMA_PELAPOR" as const };
        }

        // Toko yang menanggung selisihnya mungkin sudah membayar bagian itu: susulan
        // yang mengecilkan tahanannya tidak boleh membuat toko kelebihan bayar diam-diam.
        const tokoMenanggung = beban.bearer === "TOKO" && beban.status !== "TERBUKA";
        const sisaSebelum = tokoMenanggung ? await sisaMentahTersentuh(tx, nrt.id) : null;

        // Tulisan pertama: bandingkan-lalu-tukar pada bebannya. Keputusan, potongan,
        // atau susulan lain yang bersamaan membuat salah satunya ditolak.
        const kunci = await tx.returnCharge.updateMany({
          where: { id: beban.id, status: beban.status, amount: D(angka(beban.amount)), settledAmount: D(0) },
          data: { updatedAt: new Date() },
        });
        if (kunci.count !== 1) return { ok: false as const, alasan: "BEBAN_BERUBAH" as const };

        const nri = await tx.warehouseReturn.create({
          data: {
            noNri: await nomorNri(tx, input.receivedAt),
            storeId: nrt.storeId,
            storeReturnId: null,
            followUpOfStoreReturnId: nrt.id,
            warehouseUserId: input.warehouseUserId,
            receivedAt: input.receivedAt,
            deliveryMethod: input.deliveryMethod,
            physicalAmount: D(total),
            claimedAmount: D(0),
            note: input.note?.trim() || null,
            status: 'FINAL',
            finalisedAt: new Date(),
            items: {
              create: items.map((b) => ({
                itemId: b.itemId ?? null,
                itemName: b.itemName.trim(),
                qtyClaim: 0,
                qty: b.qty,
                price: D(b.price),
                amount: D(b.qty * b.price),
                ...(b.variantSku?.trim() ? { variantSku: b.variantSku.trim() } : {}),
                ...(b.condition ? { condition: b.condition } : {}),
              })),
            },
          },
          select: {
            id: true,
            noNri: true,
            items: { select: { id: true, itemId: true, variantSku: true, itemName: true, qty: true, condition: true } },
          },
        });

        const stokMasuk = await masukkanKeStok(tx, { items: nri.items, noNri: nri.noNri, olehUserId: input.warehouseUserId });
        barangStok = stokMasuk.barang;
        const barisGudangRusak = await masukkanGudangRusakDariNri(tx, {
          noNri: nri.noNri,
          olehUserId: input.warehouseUserId,
          baris: nri.items,
          storeId: nrt.storeId,
          sebelum: new Date(),
        });
        const barisBukuToko = await tulisBukuSusulan(tx, {
          storeId: nrt.storeId,
          storeReturnId: nrt.id,
          susulanId: nri.id,
          olehUserId: input.warehouseUserId,
          items: nri.items,
        });

        await catatJejak(tx, {
          userId: input.warehouseUserId,
          action: JEJAK.RETUR_SUSULAN_DIHITUNG,
          entityType: 'WarehouseReturn',
          entityId: nri.id,
          changes: { after: { noNri: nri.noNri, physicalAmount: total, followUpOfStoreReturnId: nrt.id } },
          metadata: {
            storeReturnId: nrt.id,
            noNrt: nrt.noNrt,
            barisStok: stokMasuk.baris,
            ...(barisGudangRusak > 0 ? { barisGudangRusak } : {}),
            ...(barisBukuToko > 0 ? { barisBukuToko } : {}),
          },
        });

        const selaras = await selaraskanSelisih(tx, nrt.id, input.warehouseUserId);
        if (sisaSebelum && lebihBayarBaru(sisaSebelum, await sisaMentahTersentuh(tx, nrt.id)).length > 0) {
          throw new TolakSesudahTulis("TOKO_SUDAH_MEMBAYAR");
        }

        return {
          ok: true as const,
          id: nri.id,
          noNri: nri.noNri,
          barisStok: stokMasuk.baris,
          barisGudangRusak,
          barisBukuToko,
          piutangDihitungUlang: await hitungUlangTersentuh(tx, nrt.id),
          fisik: { nilai: total, qty: items.reduce((a, b) => a + b.qty, 0) },
          sisaSelisih: selaras.sesudah?.amount ?? 0,
          selaras,
        };
      }),
    );
    if (hasil.ok && barangStok.length > 0) {
      await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `retur toko susulan ${hasil.noNri}`, userId: input.warehouseUserId });
    }
    return hasil;
  } catch (err) {
    if (err instanceof TolakSesudahTulis) return { ok: false, alasan: err.alasan };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/**
 * Jadikan penerimaan gudang tanpa nota sebagai SUSULAN sebuah nota retur —
 * barang selisih yang ternyata sudah dihitung gudang sebagai penerimaan yatim.
 * Stok tidak bergerak lagi (hitungan yatimnya sudah menggerakkannya); selisih,
 * beban, buku toko, dan piutang diselaraskan di satu transaksi.
 */
export async function jadikanSusulan(input: {
  warehouseReturnId: string;
  storeReturnId: string;
  olehUserId: string;
}): Promise<(Berhasil & { selaras: HasilSelaras; notifikasi: NotifikasiKantor | null }) | Gagal> {
  try {
    return await runSerializable(async (tx) => {
      const nri = await tx.warehouseReturn.findUnique({
        where: { id: input.warehouseReturnId },
        select: {
          id: true,
          storeReturnId: true,
          followUpOfStoreReturnId: true,
          storeId: true,
          status: true,
          warehouseUserId: true,
          items: { select: { itemId: true, variantSku: true, qty: true } },
        },
      });
      if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (nri.storeReturnId || nri.followUpOfStoreReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };
      if (nri.status !== 'FINAL') return { ok: false as const, alasan: 'BELUM_DIHITUNG' as const };

      const nrt = await tx.storeReturn.findUnique({
        where: { id: input.storeReturnId },
        select: {
          id: true,
          storeId: true,
          salesmanId: true,
          status: true,
          store: { select: { salesmanId: true } },
          warehouseReturn: { select: { status: true } },
          charges: {
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true, amount: true, settledAmount: true, bearer: true, checkedById: true, bearerUserId: true },
          },
        },
      });
      if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
      if (nri.storeId && nri.storeId !== nrt.storeId) return { ok: false as const, alasan: 'BEDA_TOKO' as const };
      if (!nrt.warehouseReturn || nrt.warehouseReturn.status !== 'FINAL') {
        return { ok: false as const, alasan: 'BELUM_DIHITUNG' as const };
      }
      const beban = nrt.charges[0] ?? null;
      const tolak = tolakSusulan(beban);
      if (tolak || !beban) return { ok: false as const, alasan: tolak ?? ("TIDAK_ADA_SELISIH" as const) };
      if ([nrt.salesmanId, beban.checkedById, beban.bearerUserId, nrt.store.salesmanId].includes(nri.warehouseUserId)) {
        return { ok: false as const, alasan: "PENGHITUNG_SAMA_PELAPOR" as const };
      }

      const tokoMenanggung = beban.bearer === "TOKO" && beban.status !== "TERBUKA";
      const sisaSebelum = tokoMenanggung ? await sisaMentahTersentuh(tx, nrt.id) : null;

      // Tulisan pertama: penerimaannya masih yatim (penjodohan yang bersamaan kalah).
      const pasang = await tx.warehouseReturn.updateMany({
        where: { id: nri.id, storeReturnId: null, followUpOfStoreReturnId: null },
        data: { followUpOfStoreReturnId: nrt.id, storeId: nrt.storeId },
      });
      if (pasang.count !== 1) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };
      const kunci = await tx.returnCharge.updateMany({
        where: { id: beban.id, status: beban.status, amount: D(angka(beban.amount)), settledAmount: D(0) },
        data: { updatedAt: new Date() },
      });
      if (kunci.count !== 1) throw new TolakSesudahTulis("BEBAN_BERUBAH");

      const barisBukuToko = await tulisBukuSusulan(tx, {
        storeId: nrt.storeId,
        storeReturnId: nrt.id,
        susulanId: nri.id,
        olehUserId: input.olehUserId,
        items: nri.items,
      });
      const selaras = await selaraskanSelisih(tx, nrt.id, input.olehUserId);
      if (sisaSebelum && lebihBayarBaru(sisaSebelum, await sisaMentahTersentuh(tx, nrt.id)).length > 0) {
        throw new TolakSesudahTulis("TOKO_SUDAH_MEMBAYAR");
      }

      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.RETUR_SUSULAN_DIJODOHKAN,
        entityType: 'WarehouseReturn',
        entityId: nri.id,
        changes: {
          before: { followUpOfStoreReturnId: null, storeId: nri.storeId },
          after: { followUpOfStoreReturnId: nrt.id, storeId: nrt.storeId },
        },
        metadata: { storeReturnId: nrt.id, ...(barisBukuToko > 0 ? { barisBukuToko } : {}) },
      });

      return {
        ok: true as const,
        piutangDihitungUlang: await hitungUlangTersentuh(tx, nrt.id),
        selaras,
        notifikasi: null,
      };
    });
  } catch (err) {
    if (err instanceof TolakSesudahTulis) return { ok: false, alasan: err.alasan };
    throw err;
  }
}

/**
 * Lepas hitungan susulan dari notanya — susulan yang ternyata salah nota.
 *
 * Hanya selama selisih nota itu belum diputuskan (seperti `lepasPasangan`):
 * sesudah ada yang ditetapkan menanggung, keputusannya dialihkan dulu. Stok tidak
 * bergerak (barangnya memang sudah di gudang); koreksi buku toko susulan ini
 * dibalik, dan selisihnya bisa lahir lagi — manager dikabari, seperti selisih baru.
 */
export async function lepasSusulan(input: {
  warehouseReturnId: string;
  olehUserId: string;
}): Promise<(Berhasil & { selaras: HasilSelaras; notifikasi: NotifikasiKantor | null }) | Gagal> {
  try {
    return await runSerializable(async (tx) => {
      const nri = await tx.warehouseReturn.findUnique({
        where: { id: input.warehouseReturnId },
        select: { id: true, followUpOfStoreReturnId: true, storeId: true },
      });
      if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (!nri.followUpOfStoreReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };
      const storeReturnId = nri.followUpOfStoreReturnId;

      const beban = await tx.returnCharge.findFirst({
        where: { storeReturnId },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, amount: true },
      });
      if (beban && beban.status !== "TERBUKA") return { ok: false as const, alasan: 'BEBAN_SUDAH_DIPUTUSKAN' as const };

      const lepas = await tx.warehouseReturn.updateMany({
        where: { id: nri.id, followUpOfStoreReturnId: storeReturnId },
        data: { followUpOfStoreReturnId: null },
      });
      if (lepas.count !== 1) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };
      if (beban) {
        const kunci = await tx.returnCharge.updateMany({
          where: { id: beban.id, status: "TERBUKA", amount: D(angka(beban.amount)) },
          data: { updatedAt: new Date() },
        });
        if (kunci.count !== 1) throw new TolakSesudahTulis("BEBAN_BERUBAH");
      }

      const barisBukuDibalik = await balikkanBukuSusulan(tx, nri.id, input.olehUserId);
      const selaras = await selaraskanSelisih(tx, storeReturnId, input.olehUserId);

      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.RETUR_SUSULAN_DILEPAS,
        entityType: 'WarehouseReturn',
        entityId: nri.id,
        changes: { before: { followUpOfStoreReturnId: storeReturnId }, after: { followUpOfStoreReturnId: null } },
        metadata: { storeReturnId, storeId: nri.storeId, ...(barisBukuDibalik > 0 ? { barisBukuDibalik } : {}) },
      });

      const notifikasi =
        selaras.kejadian === "BARU" && selaras.chargeId
          ? await tulisNotifSelisih(tx, { storeReturnId, chargeId: selaras.chargeId, jenis: "BARU" })
          : null;

      return {
        ok: true as const,
        piutangDihitungUlang: await hitungUlangTersentuh(tx, storeReturnId),
        selaras,
        notifikasi,
      };
    });
  } catch (err) {
    if (err instanceof TolakSesudahTulis) return { ok: false, alasan: err.alasan };
    throw err;
  }
}

/** Syarat toko penanggung beban: toko konsinyasi tidak punya nota asal untuk menahannya. */
async function tokoKonsi(tx: Klien, storeId: string | null): Promise<boolean> {
  if (!storeId) return false;
  const toko = await tx.store.findUnique({ where: { id: storeId }, select: { termsType: true } });
  return toko?.termsType === "KONSI";
}

/**
 * Tetapkan siapa menanggung selisih.
 *
 * Sebelum ada yang menanggung, selisihnya menggantung di piutang dan tidak ada
 * seorang pun yang bertanggung jawab — keadaan yang bisa bertahan berbulan-bulan
 * justru karena tidak ada yang merasa ditagih.
 *
 * - SALES (bawaan bila barangnya tidak ketemu, P22/P84): melepas tahanan faktur
 *   toko; bebannya sebesar nilai di nota retur (P86) dipotong dari komisi sales
 *   itu di Laporan → Komisi salesman. Orangnya dipilih kantor saat memutuskan
 *   (P85, bawaan tercatat) — layar menyarankan pemegang toko saat nota itu.
 * - TOKO (P84 "boleh", keputusan 1 2026-10-29): selisihnya TETAP TERBUKA di nota
 *   asal (`deductions.ts`) dan ditagih sales; tidak ada faktur baru. Ditolak di
 *   toko konsinyasi.
 * - GUDANG / PERUSAHAAN: melepas tahanannya.
 */
export async function putuskanBeban(input: {
  chargeId: string;
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';
  bearerUserId?: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };
  // Beban ke sales melekat pada orang, bukan pada peran — itulah yang membuatnya
  // bisa dipotong dari komisinya nanti. Tanpa orang ia tidak sampai ke siapa pun.
  const orang = input.bearer === "SALES" ? input.bearerUserId?.trim() || null : null;
  if (input.bearer === "SALES" && !orang) return { ok: false, alasan: "PENANGGUNG_WAJIB" };

  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: {
        id: true,
        status: true,
        amount: true,
        storeReturnId: true,
        storeId: true,
        bearer: true,
        checkStatus: true,
        storeReturn: { select: { storeId: true } },
      },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status !== 'TERBUKA') return { ok: false as const, alasan: 'SUDAH_DIPUTUSKAN' as const };
    if (!(angka(beban.amount) > 0)) return { ok: false as const, alasan: 'TIDAK_ADA_SELISIH' as const };
    if (input.bearer === "TOKO" && (await tokoKonsi(tx, beban.storeReturn?.storeId ?? beban.storeId))) {
      return { ok: false as const, alasan: "TOKO_KONSI" as const };
    }

    const ubah = await tx.returnCharge.updateMany({
      where: { id: beban.id, status: 'TERBUKA' },
      data: {
        bearer: input.bearer,
        bearerUserId: orang,
        status: 'DITETAPKAN',
        note: input.alasan.trim(),
        decidedById: input.olehUserId,
        decidedAt: new Date(),
      },
    });
    if (ubah.count !== 1) return { ok: false as const, alasan: 'SUDAH_DIPUTUSKAN' as const };

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_DIPUTUSKAN,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      // Keputusan ini menetapkan siapa menanggung kerugian. Alasannya wajib di
      // penulis; di sini ia ikut tersimpan bersama nilainya.
      changes: {
        before: { status: beban.status, bearer: beban.bearer },
        after: { status: 'DITETAPKAN', bearer: input.bearer },
      },
      metadata: { amount: angka(beban.amount), bearerUserId: orang, checkStatus: beban.checkStatus },
      reason: input.alasan,
    });

    return {
      ok: true as const,
      piutangDihitungUlang: await hitungUlangTersentuh(tx, beban.storeReturnId),
    };
  });
}

/**
 * Tandai beban sudah diganti — hanya beban GUDANG dan PERUSAHAAN.
 *
 * Tidak mengubah piutang sedikit pun — faktur sudah dilepas saat bebannya
 * ditetapkan. Beban SALES dipotong dari komisinya lewat Laporan → Komisi salesman
 * (sebagian boleh, berjejak, dijurnal); beban TOKO dibayar lewat nota asalnya.
 * Yang ditandai lunas tercatat terbayar penuh (`settledAmount` = besarnya).
 */
export async function tandaiBebanLunas(input: {
  chargeId: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: { id: true, status: true, bearer: true, amount: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
    if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };
    if (beban.bearer === "TOKO") return { ok: false as const, alasan: "DITAGIH_LEWAT_PIUTANG" as const };
    if (beban.bearer === "SALES") return { ok: false as const, alasan: "POTONG_LEWAT_KOMISI" as const };
    if (!(angka(beban.amount) > 0)) return { ok: false as const, alasan: 'TIDAK_ADA_SELISIH' as const };

    const ubah = await tx.returnCharge.updateMany({
      where: { id: beban.id, status: 'DITETAPKAN' },
      data: { status: 'LUNAS', settledAt: new Date(), settledAmount: D(angka(beban.amount)) },
    });
    if (ubah.count !== 1) return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_LUNAS,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      changes: { before: { status: beban.status }, after: { status: 'LUNAS', settledAmount: angka(beban.amount) } },
    });

    return { ok: true as const };
  });
}

/**
 * Batalkan nota retur toko.
 *
 * Potongan yang menunjuk nota ini TIDAK ikut terhapus — kalau toko sudah
 * memotong pembayarannya, uang itu tetap kurang dan tetap harus ditagih.
 * Pembacanya memperlakukan nota batal sebagai fisik nol, jadi potongannya
 * ditahan penuh dan muncul di layar piutang sampai ada yang membetulkannya.
 */
export async function batalkanRetur(input: {
  storeReturnId: string;
  alasan: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: { id: true, noNrt: true, status: true, note: true, warehouseReturn: { select: { id: true } } },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    // Barangnya sudah dihitung dan stoknya sudah bertambah. Membatalkan notanya
    // meninggalkan hitungan itu menempel ke nota batal tanpa jalan keluar —
    // lepas pasangannya dulu, atau pindahkan ke toko yang benar.
    if (nota.warehouseReturn) return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };

    const diputuskan = await tx.returnCharge.count({
      where: { storeReturnId: nota.id, status: { not: 'TERBUKA' } },
    });
    if (diputuskan > 0) return { ok: false as const, alasan: 'BEBAN_SUDAH_DIPUTUSKAN' as const };

    await tx.returnCharge.deleteMany({ where: { storeReturnId: nota.id, status: 'TERBUKA' } });
    await tx.storeReturn.update({
      where: { id: nota.id },
      data: { status: 'BATAL', note: [nota.note, input.alasan.trim()].filter(Boolean).join('\n') },
    });
    // Barang yang dilaporkan SPG keluar dari rak tidak jadi keluar: buku toko
    // dibalik di transaksi yang sama (tanpa menghapus baris lamanya).
    const barisBukuDibalik = await balikkanBukuRetur(tx, nota.id, input.olehUserId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIBATALKAN,
      entityType: 'StoreReturn',
      entityId: nota.id,
      // Membatalkan TIDAK menghapus potongan yang menunjuknya — ia berubah jadi
      // tertahan penuh. Alasannya harus tercatat, karena angka piutang naik.
      changes: { before: { status: nota.status }, after: { status: 'BATAL' } },
      metadata: { noNrt: nota.noNrt, ...(barisBukuDibalik > 0 ? { barisBukuDibalik } : {}) },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nota.id) };
  });
}

/**
 * Alihkan beban yang sudah diputuskan ke penanggung lain — atau lengkapi orangnya.
 *
 * Ada karena beban ke SALES pernah tersimpan tanpa orangnya sama sekali:
 * tuduhan tanpa alamat, yang tidak akan pernah muncul di layar siapa pun.
 * Juga jalan "nota harus ditutup sebelum toko membayar" (keputusan 1,
 * 2026-10-29): beban TOKO dialihkan ke SALES, dan tahanan nota asalnya lepas.
 *
 * Ditolak kalau sudah ada yang dipotong atau dilunasi (`SUDAH_DIPOTONG`,
 * `SUDAH_LUNAS`): uangnya sudah diganti orang yang tercatat. Dari TOKO juga
 * ditolak kalau toko sudah membayar bagian itu lewat BKM berikutnya
 * (`TOKO_SUDAH_MEMBAYAR`) — melepasnya membuat toko kelebihan bayar diam-diam.
 * Piutang yang tersentuh dihitung ulang di transaksi yang sama, karena tahanan
 * faktur bergantung pada penanggungnya.
 */
export async function alihkanBeban(input: {
  chargeId: string;
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';
  bearerUserId?: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };
  const orang = input.bearer === "SALES" ? input.bearerUserId?.trim() || null : null;
  if (input.bearer === "SALES" && !orang) return { ok: false, alasan: "PENANGGUNG_WAJIB" };

  try {
    return await runSerializable(async (tx) => {
      const beban = await tx.returnCharge.findUnique({
        where: { id: input.chargeId },
        select: {
          id: true,
          status: true,
          bearer: true,
          bearerUserId: true,
          note: true,
          amount: true,
          settledAmount: true,
          storeReturnId: true,
          storeId: true,
          storeReturn: { select: { storeId: true } },
        },
      });
      if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
      if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };
      if (sen(angka(beban.settledAmount)) !== 0) return { ok: false as const, alasan: 'SUDAH_DIPOTONG' as const };
      if (input.bearer === "TOKO" && (await tokoKonsi(tx, beban.storeReturn?.storeId ?? beban.storeId))) {
        return { ok: false as const, alasan: "TOKO_KONSI" as const };
      }

      const dariToko = beban.bearer === "TOKO" && input.bearer !== "TOKO";
      const sisaSebelum = dariToko ? await sisaMentahTersentuh(tx, beban.storeReturnId) : null;

      const ubah = await tx.returnCharge.updateMany({
        where: { id: beban.id, status: beban.status, bearer: beban.bearer, settledAmount: D(0) },
        data: {
          bearer: input.bearer,
          bearerUserId: orang,
          note: input.alasan.trim(),
          decidedById: input.olehUserId,
          decidedAt: new Date(),
        },
      });
      if (ubah.count !== 1) return { ok: false as const, alasan: 'BEBAN_BERUBAH' as const };

      if (sisaSebelum) {
        const lebih = lebihBayarBaru(sisaSebelum, await sisaMentahTersentuh(tx, beban.storeReturnId));
        if (lebih.length > 0) throw new TolakSesudahTulis("TOKO_SUDAH_MEMBAYAR");
      }

      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.BEBAN_DIALIHKAN,
        entityType: 'ReturnCharge',
        entityId: beban.id,
        changes: {
          before: { bearer: beban.bearer, bearerUserId: beban.bearerUserId },
          after: { bearer: input.bearer, bearerUserId: orang },
        },
        reason: input.alasan,
      });

      return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, beban.storeReturnId) };
    });
  } catch (err) {
    if (err instanceof TolakSesudahTulis) return { ok: false, alasan: err.alasan };
    throw err;
  }
}

/**
 * Selisih yang ditanggung TOKO, dibaca untuk layar dan kabar: bagian yang tidak
 * dikreditkan ke toko di BKM yang masih hidup (`tertahan`), sisa faktur-faktur
 * yang membawanya (`sisaFaktur`, dihitung ulang — bukan kolom cache), dan yang
 * pantas ditampilkan sebagai "masih harus ditagih" (`tampil` = yang lebih kecil).
 * Tahanan tetap tidak mengecil saat toko membayarnya, jadi `tertahan` saja akan
 * terus menyebut toko berutang sesudah ia membayar. `tampil` 0 dengan `tertahan`
 * di atas 0 berarti sudah dibayar toko; `tertahan` 0 berarti toko belum memotong
 * nota retur ini, jadi tidak ada yang perlu ditagih.
 */
export async function bebanTokoDiNota(
  klien: Klien | typeof prisma,
  storeReturnId: string,
): Promise<{ tertahan: number; sisaFaktur: number; tampil: number }> {
  const potongan = await klien.paymentClaimDeduction.findMany({
    where: { storeReturnId, paymentClaim: { status: { in: [...STATUS_KLAIM_HIDUP] } } },
    select: PILIH_POTONGAN,
  });
  const tertahan = Math.round(returTertahan(potonganRetur(potongan).filter((p) => p.ditanggungToko)) * 100) / 100;
  if (!(tertahan > 0)) return { tertahan: 0, sisaFaktur: 0, tampil: 0 };
  let sisaFaktur = 0;
  for (const id of await idPiutangTersentuh(klien, storeReturnId)) sisaFaktur += (await bacaSisaPiutang(klien, id)) ?? 0;
  return { tertahan, sisaFaktur, tampil: Math.min(tertahan, sisaFaktur) };
}
