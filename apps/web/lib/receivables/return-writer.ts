import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { hariIniWib } from "@/lib/tanggal-isian";
import { bentrokKunciKiriman } from './idempoten';
import { denganNomorUnik } from './nomor';
import { generateDocNumber } from '@/lib/docNumber';
import { hitungUlangPiutang, pemakaianRetur } from './writer';
import { tulisPiutangManual } from "./manual-writer";
import { catatJejak, JEJAK } from './jejak';
import { bentrokPengganti, catatDiganti, periksaReturLama, type AlasanPengganti } from './pengganti';
import { computeStorePrice } from "@elorae/db/pricing";
import { variantDetailForSku } from "@/lib/items/variants";
import { masukkanGudangRusakDariNri } from "@/lib/spg/gudang-rusak-writer";
import { fotoBolehDipakai } from "./foto-pencatat";
import { periksaFotoKembar } from "@/lib/foto/kembar";
import { PERMISSIONS } from "@/lib/rbac";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { AWALAN_PENANDA_BEBAN, idBebanDariCatatan, penandaBebanRetur } from "./penanda-beban";
import { bebanDitagihKeToko } from "./rules";
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
   * barisnya juga TIDAK menulis `RETUR_KELUAR`.
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

/** Kunci baris per barang + varian; baris yang hanya diketik namanya memakai namanya. */
function kunciBarang(b: { itemId?: string | null; variantSku?: string | null; itemName: string }): string {
  return b.itemId ? `${b.itemId}::${b.variantSku?.trim() ?? ""}` : `nama::${b.itemName.trim()}`;
}

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
  /** Toko konsinyasi tidak punya piutang, jadi bebannya tidak bisa ditagihkan ke toko. */
  | "TOKO_KONSI"
  /** Faktur beban toko sudah dipakai di BKM/kontrabon/tugas tagih — tidak bisa dihapus lagi. */
  | "PIUTANG_BEBAN_SUDAH_DITAGIH"
  /** Beban toko ditagih lewat fakturnya; lunasnya mengikuti BKM yang terverifikasi. */
  | "DITAGIH_LEWAT_PIUTANG";

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
  if (!storeReturnId) return 0;
  const potongan = await tx.paymentClaimDeduction.findMany({
    where: { storeReturnId },
    select: { paymentClaimId: true },
  });
  if (potongan.length === 0) return 0;

  const links = await tx.paymentClaimReceivable.findMany({
    where: { paymentClaimId: { in: [...new Set(potongan.map((p) => p.paymentClaimId))] } },
    select: { receivableId: true },
  });
  const ids = [...new Set(links.map((l) => l.receivableId))];
  for (const id of ids) await hitungUlangPiutang(tx, id);
  return ids.length;
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
 * Per varian: varian yang disebut dicari persis. Baris RUSAK/EXPIRED dilewati —
 * tercatat di hitungan gudang, tapi bukan stok jual: barang itu masuk gudang
 * barang rusak (`masukkanGudangRusakDariNri`, keputusan pemilik 2026-10-03).
 */
async function masukkanKeStok(
  tx: Klien,
  input: {
    items: BarisBarang[];
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
    // baris hantu kedua.
    const stok = await tx.inventoryValue.findFirst({
      where: varian
        ? { itemId: b.itemId, variantSku: varian }
        : { itemId: b.itemId, OR: [{ variantSku: null }, { variantSku: '' }] },
      select: { id: true, qtyOnHand: true, avgCost: true },
    });

    let qtyLama = stok ? Number(stok.qtyOnHand) : 0;
    const hargaRata = stok ? Number(stok.avgCost) : 0;
    let qtyBaru = qtyLama + b.qty;

    if (stok) {
      // Tambah atom, bukan tulis ulang angka yang dibaca: baris stok ini juga digerakkan
      // penulis lain (kiriman konsinyasi, pengiriman putus, webhook Jubelio) pada saat yang sama.
      const sesudah = await tx.inventoryValue.update({
        where: { id: stok.id },
        data: {
          qtyOnHand: { increment: b.qty },
          totalValue: { increment: b.qty * hargaRata },
          lastUpdated: new Date(),
        },
        select: { qtyOnHand: true },
      });
      qtyBaru = Number(sesudah.qtyOnHand);
      qtyLama = qtyBaru - b.qty;
    } else {
      await tx.inventoryValue.create({
        data: {
          itemId: b.itemId,
          variantSku: varian,
          qtyOnHand: qtyBaru,
          reservedQty: 0,
          avgCost: hargaRata,
          totalValue: qtyBaru * hargaRata,
        },
      });
    }

    await tx.stockAdjustment.create({
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
      },
    });
    jumlahBarisStok += 1;
    barang.push(b.itemId);
  }

  return { baris: jumlahBarisStok, barang };
}

/**
 * Selaraskan keadaan NRT dengan hitungan gudang, dan buka beban kalau kurang.
 *
 * Beban dibuat dengan status `TERBUKA` — tercatat ada selisihnya, tapi belum ada
 * yang menanggung. Itu keadaan yang menahan faktur, dan yang membuatnya muncul
 * di daftar kerja sebagai giliran admin keuangan.
 */
async function selaraskanSetelahHitung(tx: Klien, storeReturnId: string): Promise<void> {
  const nrt = await tx.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      id: true,
      storeId: true,
      claimedAmount: true,
      status: true,
      warehouseReturn: { select: { id: true, physicalAmount: true, status: true } },
      charges: { select: { id: true, status: true } },
    },
  });
  if (!nrt || nrt.status === 'BATAL') return;

  const nri = nrt.warehouseReturn;
  if (!nri || nri.status !== 'FINAL') {
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'MENUNGGU' } });
    return;
  }

  const selisih = angka(nrt.claimedAmount) - angka(nri.physicalAmount);
  if (selisih <= 0) {
    // Gudang menerima sama banyak atau lebih. Tidak ada yang perlu dibebankan,
    // dan beban terbuka yang tersisa dari pasangan sebelumnya dihapus.
    await tx.returnCharge.deleteMany({ where: { storeReturnId: nrt.id, status: 'TERBUKA' } });
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'COCOK' } });
    return;
  }

  const terbuka = nrt.charges.find((c) => c.status === 'TERBUKA');
  if (terbuka) {
    await tx.returnCharge.update({
      where: { id: terbuka.id },
      data: { amount: D(selisih), warehouseReturnId: nri.id, storeId: nrt.storeId },
    });
  } else if (!nrt.charges.some((c) => c.status !== 'TERBUKA')) {
    await tx.returnCharge.create({
      data: {
        storeReturnId: nrt.id,
        warehouseReturnId: nri.id,
        storeId: nrt.storeId,
        amount: D(selisih),
        status: 'TERBUKA',
      },
    });
  }
  await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'SELISIH' } });
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
 * retur pembeli yang ditunjuk harus milik retur pembeli DI TOKO INI, berkondisi
 * RUSAK/EXPIRED, barang + varian yang sama, baris NRT-nya bukan LAYAK, dan
 * jumlahnya tidak melebihi qty rusaknya dikurangi yang sudah ada di nota retur
 * lain yang TIDAK batal. Baris yang sekaligus menunjuk baris tanda terima
 * ditolak — satu barang hanya punya satu asal. Dibaca di dalam transaksi
 * serializable pemanggil (pola `periksaBarisRusakKiriman`).
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
      select: { id: true, itemId: true, variantSku: true, qty: true, condition: true, saleReturn: { select: { storeId: true } } },
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
    if (!l || l.saleReturn.storeId !== storeId || l.condition === "LAYAK") return "RETUR_PEMBELI_TIDAK_SAH";
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
 * KONSI: harga = harga konsinyasi toko (`computeStorePrice` KONSI, gross-up yang
 * sama dengan dokumen konsinyasi lain) — nilai klaimnya dihitung server, tidak
 * pernah diketik dan tidak pernah tampil di HP. PUTUS: harga 0 — barisnya hanya
 * qty, nilainya total nota toko yang diketik (`nilaiDariRincian`).
 */
async function susunBarisSpg(
  tx: Klien,
  baris: ReturnType<typeof rapikanBarisSpg>,
  toko: { termsType: "PUTUS" | "KONSI"; marginPercent: unknown },
): Promise<BarisTersusun[] | null> {
  const ids = [...new Set(baris.map((b) => b.itemId))];
  const barang = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, nameId: true, sellingPrice: true, variants: true },
  });
  if (barang.length !== ids.length) return null;
  const perId = new Map(barang.map((b) => [b.id, b]));
  const margin = toko.marginPercent === null || toko.marginPercent === undefined ? null : angka(toko.marginPercent);

  return baris.map((b) => {
    const item = perId.get(b.itemId)!;
    const label = variantDetailForSku(item.variants, b.variantSku || null);
    let price = 0;
    if (toko.termsType === "KONSI") {
      const jual = item.sellingPrice === null ? null : angka(item.sellingPrice);
      const harga = computeStorePrice({ sellingPrice: jual, termsType: "KONSI", marginPercent: margin }).price;
      price = harga === null ? 0 : Math.round(harga * 100) / 100;
    }
    return {
      itemId: b.itemId,
      variantSku: b.variantSku,
      itemName: label ? `${item.nameId} — ${label}` : item.nameId,
      qty: b.qty,
      price,
      condition: b.condition,
      ...(b.storeReceiptLineId ? { storeReceiptLineId: b.storeReceiptLineId } : {}),
      ...(b.spgSaleReturnLineId ? { spgSaleReturnLineId: b.spgSaleReturnLineId } : {}),
    };
  });
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

type NotifikasiKantor = { id: string; category: string; title: string; message: string; metadata: Prisma.JsonValue };

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
}): Promise<{ ok: true; id: string; noNrt: string } | Gagal | { ok: false; alasan: AlasanPengganti }> {
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
            select: { termsType: true, marginPercent: true, name: true, salesmanId: true },
          });
          if (!toko) return { ok: false as const, alasan: "TOKO_TIDAK_DITEMUKAN" as const };
          tokoSpg = { name: toko.name, salesmanId: toko.salesmanId };
          const susun = await susunBarisSpg(tx, barisSpg, toko);
          if (!susun) return { ok: false as const, alasan: "BARANG_TIDAK_DITEMUKAN" as const };
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
  try {
    const hasil = await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        barangStok = [];
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
            const k = kunciBarang(i);
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
                const k = kunciBarang(b);
                const pertama = items.findIndex((x) => kunciBarang(x) === k) === i;
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
          items,
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

        if (input.storeReturnId) await selaraskanSetelahHitung(tx, input.storeReturnId);

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
        };
      }),
    );
    // Sesudah commit: stok jual gudang bertambah, Jubelio harus tahu sebelum
    // webhook stoknya menimpa angka ERP. Best-effort, tidak pernah melempar.
    if (hasil.ok && barangStok.length > 0) {
      await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `retur toko ${hasil.noNri}`, userId: input.warehouseUserId });
    }
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
}): Promise<Berhasil | Gagal> {
  return runSerializable(async (tx) => {
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: { id: true, storeReturnId: true, storeId: true, physicalAmount: true, warehouseUserId: true },
    });
    if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nri.storeReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };

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
    await selaraskanSetelahHitung(tx, nrt.id);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIJODOHKAN,
      entityType: 'WarehouseReturn',
      entityId: nri.id,
      changes: { before: { storeReturnId: null }, after: { storeReturnId: nrt.id } },
      metadata: { storeId: nrt.storeId },
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nrt.id) };
  });
}

/**
 * Lepas pasangan NRT–NRI.
 *
 * Ditolak kalau bebannya sudah diputuskan: seseorang sudah ditetapkan
 * menanggung selisih pasangan ini, dan melepasnya meninggalkan beban yang
 * menunjuk perbandingan yang tidak ada lagi.
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

// Penanda faktur beban tinggal di `penanda-beban.ts`; diekspor ulang di sini
// untuk pemanggil lama.
export { AWALAN_PENANDA_BEBAN, idBebanDariCatatan, penandaBebanRetur };

type FakturBeban = { id: string; invoiceNo: string; amount: number; storeId: string };

/** Faktur yang lahir dari beban ini, kalau ada. */
async function cariFakturBeban(tx: Klien, chargeId: string): Promise<FakturBeban | null> {
  const r = await tx.receivable.findFirst({
    where: { source: "MANUAL", note: { contains: penandaBebanRetur(chargeId) } },
    select: { id: true, invoiceNo: true, amount: true, storeId: true },
  });
  return r ? { id: r.id, invoiceNo: r.invoiceNo, amount: angka(r.amount), storeId: r.storeId } : null;
}

/** Tengah malam WIB hari ini, ditambah `hari` hari kalender. */
function tengahMalamWib(hari = 0): Date {
  const d = new Date(`${hariIniWib()}T00:00:00+07:00`);
  return new Date(d.getTime() + hari * 86_400_000);
}

/** Rincian angka keputusan beban ke toko — ikut tersimpan di jejaknya. */
type RincianTagihToko = {
  /** Selisih NRT − fisik (nilai bebannya). */
  selisih: number;
  /** Potongan atas NRT ini di BKM yang masih hidup saat diputuskan. */
  dipotongToko: number;
  /** Yang ditagihkan lewat faktur beban (`bebanDitagihKeToko`). */
  ditagihKeToko: number;
};

/**
 * Tagihkan beban ke toko: lahirkan faktur sebesar yang benar-benar diambil toko.
 *
 * Tanpa ini, menetapkan TOKO melepas tahanan sehingga faktur asli lunas, dan
 * utang toko hanya hidup sebagai baris beban yang tidak pernah muncul di
 * penagihan, di batas kredit, atau di layar piutang siapa pun.
 *
 * KEPUTUSAN SEMENTARA PEMILIK 2026-10-06 (`ATURAN_BEBAN_TOKO` di rules.ts):
 * jumlahnya bukan seluruh selisih, melainkan yang dipotong toko melebihi barang
 * yang sampai — NRT 300 rb, fisik 100 rb, belum dipotong → TIDAK ada faktur
 * (dulu 200 rb, sehingga toko tertagih 1,2 jt atas faktur 1 jt). Sesudahnya NRT
 * itu hanya boleh dipotong sebesar fisik + yang ditagih (`batasPotongNota`),
 * jadi selisih yang belum diambil tidak bisa diambil belakangan tanpa ditagih.
 *
 * Nomornya menunjuk NRT (`BEBAN/<nomor nota toko>`, berakhiran `/2` dst. kalau
 * nomor itu sudah dipakai toko lain), jatuh tempo = hari ini + tempo toko.
 * Ditagih oleh pemegang toko; selama toko belum punya pemegang, oleh sales yang
 * melaporkan notanya (bukan SPG — SPG tidak menagih).
 *
 * Faktur yang sudah ada dikembalikan apa adanya (keputusan ulang ke toko tidak
 * menagih dua kali). Tidak menulis apa pun kalau gagal — pemanggil boleh
 * menulis bebannya sesudah.
 */
async function tagihkanBebanKeToko(
  tx: Klien,
  input: { chargeId: string; storeReturnId: string | null; storeId: string | null; olehUserId: string },
): Promise<{ ok: true; faktur: FakturBeban | null; baru: boolean; rincian: RincianTagihToko | null } | Gagal> {
  const ada = await cariFakturBeban(tx, input.chargeId);
  if (ada) return { ok: true, faktur: ada, baru: false, rincian: null };

  const nrt = input.storeReturnId
    ? await tx.storeReturn.findUnique({
        where: { id: input.storeReturnId },
        select: {
          noNrt: true,
          storeId: true,
          salesmanId: true,
          reportedBySpg: true,
          claimedAmount: true,
          warehouseReturn: { select: { physicalAmount: true, status: true } },
        },
      })
    : null;
  if (!nrt) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const storeId = input.storeId ?? nrt.storeId;
  const toko = await tx.store.findUnique({
    where: { id: storeId },
    select: { termsType: true, paymentTempo: true, salesmanId: true },
  });
  if (!toko) return { ok: false, alasan: "TOKO_TIDAK_DITEMUKAN" };
  // Toko konsinyasi tidak pernah punya piutang. Barang yang hilang di toko
  // konsi ditagih lewat siklusnya (Barang hilang, penanggung toko).
  if (toko.termsType === "KONSI") return { ok: false, alasan: "TOKO_KONSI" };
  // Beban hanya lahir dari hitungan gudang yang final; tanpanya tidak ada selisih.
  const nri = nrt.warehouseReturn;
  if (!nri || nri.status !== "FINAL") return { ok: false, alasan: "TIDAK_ADA_SELISIH" };

  const nilaiKlaim = angka(nrt.claimedAmount);
  const nilaiFisik = angka(nri.physicalAmount);
  const dipotongToko = input.storeReturnId
    ? ((await pemakaianRetur(tx, [input.storeReturnId])).get(input.storeReturnId)?.terpakai ?? 0)
    : 0;
  const ditagihKeToko = bebanDitagihKeToko({ nilaiKlaim, nilaiFisik, sudahDipotong: dipotongToko });
  const rincian: RincianTagihToko = {
    selisih: Math.max(0, Math.round((nilaiKlaim - nilaiFisik) * 100) / 100),
    dipotongToko: Math.round(dipotongToko * 100) / 100,
    ditagihKeToko,
  };
  // Toko belum mengambil lebih dari barang yang sampai: tidak ada yang ditagih.
  if (!(ditagihKeToko > 0)) return { ok: true, faktur: null, baru: false, rincian };

  const dasar = `BEBAN/${nrt.noNrt}`;
  let nomor = dasar;
  for (let n = 2; await tx.receivable.findFirst({ where: { invoiceNo: nomor }, select: { id: true } }); n += 1) {
    nomor = `${dasar}/${n}`;
  }

  const invoiceDate = tengahMalamWib();
  const hasil = await tulisPiutangManual(tx, {
    invoiceNo: nomor,
    storeId,
    salesmanId: toko.salesmanId ?? (nrt.reportedBySpg ? null : nrt.salesmanId),
    invoiceDate,
    dueDate: new Date(invoiceDate.getTime() + Math.max(0, toko.paymentTempo) * 86_400_000),
    olehUserId: input.olehUserId,
    total: ditagihKeToko,
    note: `Selisih retur ${nrt.noNrt} ditanggung toko. ${penandaBebanRetur(input.chargeId)}`,
    metadataJejak: {
      sumber: "BEBAN_RETUR",
      returnChargeId: input.chargeId,
      storeReturnId: input.storeReturnId,
      noNrt: nrt.noNrt,
      ...rincian,
    },
  });
  if (!hasil.ok) {
    if (hasil.alasan === "TOKO_KONSI") return { ok: false, alasan: "TOKO_KONSI" };
    if (hasil.alasan === "TOKO_TIDAK_DITEMUKAN") return { ok: false, alasan: "TOKO_TIDAK_DITEMUKAN" };
    if (hasil.alasan === "NOMOR_SUDAH_ADA") return { ok: false, alasan: "NOMOR_BENTROK" };
    return { ok: false, alasan: "NILAI_TIDAK_VALID" };
  }
  return {
    ok: true,
    faktur: { id: hasil.id, invoiceNo: nomor, amount: ditagihKeToko, storeId },
    baru: true,
    rincian,
  };
}

/**
 * Hapus faktur beban toko ketika bebannya dialihkan dari toko.
 *
 * Hanya selama belum ada yang menyentuhnya: BKM (status apa pun — klaim yang
 * ditolak pun tetap menautkannya), kontrabon, atau tugas tagih yang masih
 * terbuka. Yang sudah ditagih ditolak: menghapusnya menghapus jejak uang yang
 * mungkin sudah diterima. Barisnya hidup di jejak keputusan pengalihan.
 */
async function hapusFakturBeban(tx: Klien, faktur: FakturBeban): Promise<{ ok: true } | Gagal> {
  const [klaim, kontrabon, tugas] = await Promise.all([
    tx.paymentClaimReceivable.count({ where: { receivableId: faktur.id } }),
    tx.collectionNoteReceivable.count({ where: { receivableId: faktur.id } }),
    tx.collectionTask.findMany({
      where: { storeId: faktur.storeId, status: "TERBUKA" },
      select: { receivableIds: true },
    }),
  ]);
  const diTugas = tugas.some((t) => Array.isArray(t.receivableIds) && (t.receivableIds as unknown[]).includes(faktur.id));
  if (klaim > 0 || kontrabon > 0 || diTugas) return { ok: false, alasan: "PIUTANG_BEBAN_SUDAH_DITAGIH" };

  await tx.receivableItem.deleteMany({ where: { receivableId: faktur.id } });
  await tx.receivable.delete({ where: { id: faktur.id } });
  return { ok: true };
}

/**
 * Tetapkan siapa menanggung selisih. Inilah yang melepas faktur.
 *
 * Sebelum ada yang menanggung, selisihnya menggantung di piutang dan tidak ada
 * seorang pun yang bertanggung jawab — keadaan yang bisa bertahan berbulan-bulan
 * justru karena tidak ada yang merasa ditagih.
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
      select: { id: true, status: true, amount: true, storeReturnId: true, storeId: true, bearer: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status !== 'TERBUKA') return { ok: false as const, alasan: 'SUDAH_DIPUTUSKAN' as const };
    if (!(angka(beban.amount) > 0)) return { ok: false as const, alasan: 'TIDAK_ADA_SELISIH' as const };

    // Ditanggung toko = toko berutang sebesar yang ia ambil melebihi barang
    // yang sampai (`tagihkanBebanKeToko`). Fakturnya lahir DULU, di transaksi
    // yang sama: kalau gagal, keputusannya pun tidak tertulis.
    let faktur: FakturBeban | null = null;
    let rincianToko: RincianTagihToko | null = null;
    if (input.bearer === "TOKO") {
      const t = await tagihkanBebanKeToko(tx, {
        chargeId: beban.id,
        storeReturnId: beban.storeReturnId,
        storeId: beban.storeId,
        olehUserId: input.olehUserId,
      });
      if (!t.ok) return t;
      faktur = t.faktur;
      rincianToko = t.rincian;
    }

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: {
        bearer: input.bearer,
        bearerUserId: orang,
        status: 'DITETAPKAN',
        note: input.alasan.trim(),
        decidedById: input.olehUserId,
        decidedAt: new Date(),
      },
    });

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
      metadata: {
        amount: angka(beban.amount),
        bearerUserId: orang,
        // Angka keputusan ke toko: selisih, yang sudah dipotong toko, yang ditagih.
        ...(rincianToko ?? {}),
        ...(faktur ? { receivableId: faktur.id, invoiceNo: faktur.invoiceNo } : {}),
      },
      reason: input.alasan,
    });

    return {
      ok: true as const,
      piutangDihitungUlang: await hitungUlangTersentuh(tx, beban.storeReturnId),
    };
  });
}

/**
 * Tandai beban sudah diganti.
 *
 * Tidak mengubah piutang sedikit pun — faktur sudah dilepas saat bebannya
 * ditetapkan. Ini penagihan pengganti yang berjalan sendiri, dan tanpa keadaan
 * ini tidak ada tempat mencatat bahwa sales sudah membayar balik.
 */
export async function tandaiBebanLunas(input: {
  chargeId: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: { id: true, status: true, bearer: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
    if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };
    // Beban toko ditagih lewat fakturnya: lunasnya adalah BKM yang terverifikasi
    // (klaim bukan lunas). Menandainya di sini membuat dua kebenaran. Beban toko
    // lama yang diputuskan sebelum ada fakturnya tetap boleh ditandai.
    if (beban.bearer === "TOKO" && (await cariFakturBeban(tx, beban.id))) {
      return { ok: false as const, alasan: "DITAGIH_LEWAT_PIUTANG" as const };
    }

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: { status: 'LUNAS', settledAt: new Date() },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_LUNAS,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      changes: { before: { status: beban.status }, after: { status: 'LUNAS' } },
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
 * Alihkan beban yang sudah diputuskan ke orang lain — atau lengkapi orangnya.
 *
 * Ada karena beban ke SALES pernah tersimpan tanpa orangnya sama sekali:
 * tuduhan tanpa alamat, yang tidak akan pernah muncul di layar siapa pun. Baris
 * semacam itu tidak bisa dibetulkan lewat jalur mana pun sebelum ini.
 *
 * Beban yang SUDAH LUNAS tidak boleh dialihkan: uangnya sudah diganti orang
 * yang tercatat, dan memindahkannya membuat catatan pembayaran itu berbohong.
 */
export async function alihkanBeban(input: {
  chargeId: string;
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';
  bearerUserId?: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };
  const orang = input.bearer === "SALES" ? input.bearerUserId?.trim() || null : null;
  if (input.bearer === "SALES" && !orang) return { ok: false, alasan: "PENANGGUNG_WAJIB" };

  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: {
        id: true,
        status: true,
        bearer: true,
        bearerUserId: true,
        note: true,
        amount: true,
        storeReturnId: true,
        storeId: true,
      },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
    if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };

    // Faktur beban mengikuti keputusannya. Ke toko: pastikan fakturnya ada (ini
    // juga melengkapi beban toko lama yang diputuskan sebelum ada fakturnya).
    // Dari toko: fakturnya dihapus — hanya selama belum ditagih.
    let fakturDibuat: FakturBeban | null = null;
    let fakturDihapus: FakturBeban | null = null;
    let rincianToko: RincianTagihToko | null = null;
    if (input.bearer === "TOKO") {
      const t = await tagihkanBebanKeToko(tx, {
        chargeId: beban.id,
        storeReturnId: beban.storeReturnId,
        storeId: beban.storeId,
        olehUserId: input.olehUserId,
      });
      if (!t.ok) return t;
      if (t.baru) fakturDibuat = t.faktur;
      rincianToko = t.rincian;
    } else {
      const lama = await cariFakturBeban(tx, beban.id);
      if (lama) {
        const h = await hapusFakturBeban(tx, lama);
        if (!h.ok) return h;
        fakturDihapus = lama;
      }
    }

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: {
        bearer: input.bearer,
        bearerUserId: orang,
        note: input.alasan.trim(),
        decidedById: input.olehUserId,
        decidedAt: new Date(),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_DIALIHKAN,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      changes: {
        before: { bearer: beban.bearer, bearerUserId: beban.bearerUserId },
        after: { bearer: input.bearer, bearerUserId: orang },
      },
      // Faktur yang dihapus hanya hidup di sini sesudahnya — nomornya dan
      // nilainya ikut tersimpan supaya bisa dicari.
      ...(fakturDibuat || fakturDihapus || rincianToko
        ? {
            metadata: {
              ...(rincianToko ?? {}),
              ...(fakturDibuat ? { piutangDibuat: fakturDibuat } : {}),
              ...(fakturDihapus ? { piutangDihapus: fakturDihapus } : {}),
            },
          }
        : {}),
      reason: input.alasan,
    });

    return { ok: true as const };
  });
}
