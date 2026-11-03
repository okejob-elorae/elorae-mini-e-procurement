import { Prisma, prisma, sqlId, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatRupiah } from "@/lib/format/rupiah";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { capNotificationText, NOTIFICATION_TEXT_MAX } from "@/lib/notifications/text";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { rangkaiDalamBatas } from "./antaran";
import { bacaJenisTokoBeban, bebanSudahDiganti, nilaiBebanReturPembeli, periksaBesarBeban, REF_BEBAN_KE_UTANG, type KeputusanBarangBeban } from "./beban-spg";
import { batalkanBebanTx, bisaBatalkanBebanTx, buatBebanReturPembeliTx, putuskanBarangBebanTx } from "./beban-spg-writer";
import { kunciFotoReturPembeliSah } from "./foto-retur-pembeli-kunci";
import { kabariTitipanTersedia } from "./titip-tersedia";
import { RETUR_PEMBELI_BERLAKU, qtyDitahanBebanPerBaris, qtyMenungguPerBaris } from "./retur-pembeli-berlaku";
import {
  BATAS_ALASAN_RETUR_PEMBELI,
  ENTITAS_RETUR_PEMBELI,
  KATEGORI_NOTIF_RETUR_PEMBELI,
  bacaStatusReturPembeli,
  keadaanUangRetur,
  sisaReturPembeli,
  uangReturTercatat,
  type KeadaanUangRetur,
  type StatusReturPembeli,
} from "./retur-pembeli-status";

/**
 * Barang kembali dari pembeli di counter SPG (`SpgSaleReturn`).
 *
 * Keputusan pemilik 2026-11-02 (P12–P14, P77–P83):
 *
 * 1. LAPOR (`catatReturPembeli`, dari HP — langsung atau lewat antrean tanpa
 *    sinyal): foto barang WAJIB, dan SPG menjawab apakah kasir sudah
 *    mengembalikan uang pembeli. "Belum" adalah jalan yang benar (P13a);
 *    "Sudah" wajib foto struk dan mencatat `refundedAt`. Satu laporan MENUNGGU +
 *    barisnya, jejak, lonceng kantor ke pemegang `spg_returns:approve`. TIDAK
 *    ADA yang lain bergerak; barangnya DISISIHKAN (P12) — tidak ke rak, tidak
 *    dijual, tidak dihitung opname.
 * 2. PUTUSKAN (kantor, `spg_returns:approve`; bawaannya admin dan Admin
 *    Penjualan; tidak pernah pelapornya sendiri — `PELAPOR_SAMA`):
 *    - `setujuiReturPembeli` menerapkan pengaruhnya (`terapkanPengaruhSetujuTx`):
 *      `SpgSaleLine.returnedQty` naik, buku stok toko `RETUR_PEMBELI` +qty untuk
 *      SETIAP potong LAYAK (barang yang disisihkan tidak pernah di rak, jadi
 *      tidak ada opname yang sudah melihatnya), `SalesHistory` nota itu, jejak.
 *      HP lalu menyuruh SPG mengembalikan uangnya (kecuali sudah).
 *    - `tolakReturPembeli`: tanpa uang dikembalikan → tidak ada yang bergerak,
 *      barang dikembalikan ke pembeli (P83). Uang sudah dikembalikan (dicatat
 *      SPG, atau ditandai kantor saat menolak dengan alasan — P78) → satu beban
 *      SPG di transaksi yang sama (P13, P81), potongnya DITAHAN.
 * 3. UANG (`catatUangDikembalikan`): SPG mencatat uang sudah dikembalikan, foto
 *    struk wajib (P77) — selama menunggu (salahnya sendiri, P13) atau sesudah
 *    disetujui; laporan yang sudah ditolak atau ditarik tidak. Laporan yang
 *    uangnya sudah tercatat tidak bisa ditarik SPG.
 * 4. SESUDAH DITOLAK dengan beban, hanya dua jalan keluar: penolakan keliru
 *    dibatalkan (`batalkanPenolakanReturPembeli`, P82) selama bebannya belum
 *    dipotong sama sekali, atau sesudah SPG mengganti penuh kantor memilih barangnya
 *    (`putuskanBarangReturPembeli`, P79): kembali ke stok (laporan DISETUJUI,
 *    uang SPG dikembalikan) atau dibeli SPG (tidak ada yang bergerak).
 *
 * Tanpa kredit apa pun ke toko (P80). Pengaruh yang disetujui bertanggal saat
 * DILAPORKAN (`createdAt`) — lihat `./retur-pembeli-berlaku`.
 *
 * Penjaga balapan: setiap penulis mengunci baris `SpgSale` notanya `FOR UPDATE`
 * SEBELUM membaca apa pun dari nota atau laporannya, di dalam `runSerializable`;
 * keputusan memakai compare-and-swap status. Toko ditetapkan pemanggil dari
 * `User.assignedStoreId`, tidak pernah dari HP.
 */

export type KondisiRetur = "LAYAK" | "RUSAK" | "EXPIRED";
const KONDISI: readonly KondisiRetur[] = ["LAYAK", "RUSAK", "EXPIRED"];

export type BarisReturPembeli = { saleLineId: string; qty: number; condition?: KondisiRetur };

export type AlasanTolakReturPembeli =
  | "TANPA_BARIS"
  | "ALASAN_WAJIB"
  | "JUMLAH_TIDAK_VALID"
  | "NOTA_TIDAK_DITEMUKAN"
  | "BARIS_TIDAK_DITEMUKAN"
  | "MELEBIHI_SISA"
  | "KUNCI_DIPAKAI"
  | "KUNCI_WAJIB"
  | "FOTO_BARANG_WAJIB"
  | "FOTO_STRUK_WAJIB"
  | "JAWABAN_UANG_WAJIB";

export type HasilReturPembeli = { ok: true; returnId: string } | { ok: false; alasan: AlasanTolakReturPembeli };

/**
 * Saringan "retur pembeli yang berlaku" sebagai KONSTANTA, untuk pemuat yang
 * menyebarkannya — `saleReturn: { ...returPembeliBerlaku, storeId, createdAt }`
 * (pemuat komisi). Nilainya `RETUR_PEMBELI_BERLAKU`; statusnya hanya dieja di
 * `./retur-pembeli-berlaku`. Pembaca yang menambah saringan sendiri bisa juga
 * memakai FUNGSI `returPembeliBerlaku(where)` dari modul itu (statusnya ditulis
 * terakhir, jadi tidak bisa ditimpa). Jangan menyebarkan fungsi itu: menyebar
 * sebuah fungsi menghasilkan objek kosong tanpa galat apa pun — tes cakupan
 * (`retur-pembeli-berlaku-cakupan.test.ts`) menolaknya.
 */
export const returPembeliBerlaku: Prisma.SpgSaleReturnWhereInput = RETUR_PEMBELI_BERLAKU;

/** Gabungkan per baris nota + kondisi; tolak qty yang bukan bilangan bulat positif. */
export function rapikanBarisReturPembeli(
  baris: BarisReturPembeli[],
): { ok: true; baris: (BarisReturPembeli & { condition: KondisiRetur })[] } | { ok: false; alasan: "TANPA_BARIS" | "JUMLAH_TIDAK_VALID" } {
  const peta = new Map<string, BarisReturPembeli & { condition: KondisiRetur }>();
  for (const b of baris) {
    if (!b.saleLineId) continue;
    if (!Number.isInteger(b.qty) || b.qty < 0) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    if (b.qty === 0) continue;
    const condition = KONDISI.includes(b.condition as KondisiRetur) ? (b.condition as KondisiRetur) : "LAYAK";
    const k = `${b.saleLineId}::${condition}`;
    const ada = peta.get(k);
    if (ada) ada.qty += b.qty;
    else peta.set(k, { saleLineId: b.saleLineId, qty: b.qty, condition });
  }
  if (peta.size === 0) return { ok: false, alasan: "TANPA_BARIS" };
  return { ok: true, baris: [...peta.values()] };
}

export type InputReturPembeli = {
  spgSaleId: string;
  /** Toko tetap SPG — dari server. */
  storeId: string;
  /** SPG yang melapor; hanya notanya sendiri. */
  userId: string;
  baris: BarisReturPembeli[];
  alasan: string;
  idempotencyKey: string;
  /**
   * Retur yang dicatat TANPA sinyal: jam ia dilakukan di HP (sudah dijepit
   * pemanggil). Laporannya bertanggal jam itu — dan kalau disetujui, baris
   * bukunya juga — karena itulah saat pembeli mengembalikannya. Uang yang
   * dijawab "sudah dikembalikan" juga bertanggal jam itu.
   */
  waktuTangkap?: Date | null;
  /** Kunci R2 foto barang (wajib) — `spg-sale-returns/<storeId>/<idempotencyKey>/barang.<ext>`. */
  fotoBarangKey?: string | null;
  /** Jawaban "apakah kasir sudah mengembalikan uang pembeli?" — wajib, tanpa isian bawaan. */
  uangSudahDikembalikan?: boolean | null;
  /** Kunci R2 foto struk pengembalian — wajib bila `uangSudahDikembalikan`. */
  fotoStrukKey?: string | null;
  /** Jam server, ditetapkan SEKALI di luar transaksi (percobaan ulang memakai jam yang sama). */
  sekarang?: Date;
};

/**
 * Kunci baris `SpgSale` nota ini sampai transaksi selesai. Setiap penulis retur
 * pembeli memanggilnya SEBELUM membaca nota atau laporannya: dua laporan atas
 * potong yang sama, atau setuju vs tolak atas laporan yang sama, berbaris di
 * sini alih-alih saling menunggu kunci baca yang dinaikkan (S→X, yang di
 * MariaDB SERIALIZABLE berakhir sebagai deadlock lalu diulang). `false` bila
 * notanya tidak ada.
 */
async function kunciNotaSpg(tx: Prisma.TransactionClient, spgSaleId: string): Promise<boolean> {
  const baris = await tx.$queryRaw<{ id: string }[]>`
    SELECT ${sqlId("id")} FROM ${sqlId("SpgSale")} WHERE ${sqlId("id")} = ${spgSaleId} FOR UPDATE
  `;
  return baris.length > 0;
}

const namaOrang = (u: { name: string | null; email: string } | null | undefined) => u?.name?.trim() || u?.email || "—";

/** Penjaga meleset di tengah transaksi (sesudah ada yang ditulis): ulangi seluruhnya. */
function ulangi(pesan: string): never {
  throw new Prisma.PrismaClientKnownRequestError(pesan, { code: "P2034", clientVersion: "retur-pembeli" });
}

const kabar = (bagian: readonly (string | readonly string[] | null)[]) => rangkaiDalamBatas(bagian, NOTIFICATION_TEXT_MAX);
const potongTeks = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);
const kalimatAlasan = (alasan: string) => [`Alasan: ${alasan}`, `Alasan: ${potongTeks(alasan, 60)}`];

const KALIMAT_UANG_TELANJUR = "Uang sudah dikembalikan kasir sebelum disetujui — kalau ditolak, menjadi beban SPG.";

/* ------------------------------------------------------------------ lapor */

type HasilLaporTx =
  | { ok: true; returnId: string; ulang: boolean; notifikasi: AdminNotification | null }
  | { ok: false; alasan: AlasanTolakReturPembeli };

export async function catatReturPembeli(input: InputReturPembeli): Promise<HasilReturPembeli> {
  const kunci = input.idempotencyKey?.trim();
  if (!kunci) return { ok: false, alasan: "KUNCI_WAJIB" };
  const isi: InputReturPembeli = { ...input, sekarang: input.sekarang ?? new Date() };

  // Lonceng kantor dibuat DI DALAM transaksi; yang disebar hanya milik percobaan
  // yang tersimpan — nilai kembalian `runSerializable`, bukan percobaan yang diulang.
  const simpan = () => runSerializable((tx) => catatReturPembeliTx(tx, isi, kunci));
  let hasil: HasilLaporTx;
  try {
    hasil = await simpan();
  } catch (err) {
    // Kiriman kembar yang tiba bersamaan: yang kalah menemukan milik pemenang.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") hasil = await simpan();
    else throw err;
  }
  if (!hasil.ok) return hasil;
  if (!hasil.ulang && hasil.notifikasi) void fanOutAdminNotification(hasil.notifikasi);
  return { ok: true, returnId: hasil.returnId };
}

/**
 * Badan transaksi `catatReturPembeli`. Pemanggil WAJIB menjalankannya di dalam
 * `runSerializable`; `kunci` sudah dirapikan pemanggil. Menyebar lonceng
 * (`notifikasi`) sesudah transaksi tersimpan tetap urusan pemanggil — kiriman
 * ulang (`ulang`) tidak membawa lonceng.
 *
 * Tukar ukuran TIDAK dilayani di konter (keputusan pemilik 2026-10-03): SPG
 * tidak menerima barang kembali dari pembeli untuk ditukar ukuran, jadi tidak
 * ada nota pengganti yang ditautkan ke retur ini.
 */
export async function catatReturPembeliTx(tx: Prisma.TransactionClient, input: InputReturPembeli, kunci: string): Promise<HasilLaporTx> {
  // Kunci nota dulu — sebelum kunci kiriman pun — supaya dua laporan atas nota
  // yang sama berbaris di sini, bukan di indeks kunci kiriman.
  if (input.spgSaleId) await kunciNotaSpg(tx, input.spgSaleId);

  // Kiriman ulang dikenali PALING DULU di antara pemeriksaan — sebelum foto, uang,
  // atau sisa, karena kiriman pertamanya sendiri sudah memakai sisa itu. Statusnya
  // sekarang tidak penting: antrean HP cukup tahu laporannya sudah sampai.
  const ada = await tx.spgSaleReturn.findUnique({
    where: { idempotencyKey: kunci },
    select: { id: true, createdById: true },
  });
  if (ada) {
    return ada.createdById === input.userId
      ? { ok: true, returnId: ada.id, ulang: true, notifikasi: null }
      : { ok: false, alasan: "KUNCI_DIPAKAI" };
  }

  const alasan = input.alasan?.trim();
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  const rapi = rapikanBarisReturPembeli(input.baris);
  if (!rapi.ok) return rapi;
  // Foto terikat ke toko tetap dan kunci laporan ini: foto struk di tempat foto
  // barang, atau foto laporan lain, ditolak.
  if (!kunciFotoReturPembeliSah(input.fotoBarangKey, { storeId: input.storeId, kunci, jenis: "barang" })) {
    return { ok: false, alasan: "FOTO_BARANG_WAJIB" };
  }
  if (typeof input.uangSudahDikembalikan !== "boolean") return { ok: false, alasan: "JAWABAN_UANG_WAJIB" };
  const uangSudah = input.uangSudahDikembalikan;
  if (uangSudah && !kunciFotoReturPembeliSah(input.fotoStrukKey, { storeId: input.storeId, kunci, jenis: "struk" })) {
    return { ok: false, alasan: "FOTO_STRUK_WAJIB" };
  }

  const nota = await tx.spgSale.findFirst({
    where: { id: input.spgSaleId, salesmanId: input.userId, storeId: input.storeId },
    select: {
      id: true,
      docNo: true,
      createdAt: true,
      lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, returnedQty: true } },
    },
  });
  if (!nota) return { ok: false, alasan: "NOTA_TIDAK_DITEMUKAN" };
  const perId = new Map(nota.lines.map((l) => [l.id, l]));
  if (rapi.baris.some((b) => !perId.has(b.saleLineId))) return { ok: false, alasan: "BARIS_TIDAK_DITEMUKAN" };

  const mintaPerBaris = new Map<string, number>();
  for (const b of rapi.baris) mintaPerBaris.set(b.saleLineId, (mintaPerBaris.get(b.saleLineId) ?? 0) + b.qty);
  // Dibaca SESUDAH kunci nota: laporan lain atas nota ini tidak bisa menyelip di antaranya.
  const [menunggu, ditahan] = await Promise.all([
    qtyMenungguPerBaris(tx, [...mintaPerBaris.keys()]),
    qtyDitahanBebanPerBaris(tx, [...mintaPerBaris.keys()]),
  ]);
  for (const [id, minta] of mintaPerBaris) {
    const l = perId.get(id)!;
    if (minta > sisaReturPembeli({ qty: l.qty, returnedQty: l.returnedQty, menunggu: menunggu.get(id) ?? 0, ditahan: ditahan.get(id) ?? 0 })) {
      return { ok: false, alasan: "MELEBIHI_SISA" };
    }
  }

  // Retur tidak pernah mendahului notanya sendiri, walau jam HP salah.
  const sekarang = input.sekarang ?? new Date();
  const luring = Boolean(input.waktuTangkap);
  const waktu = input.waktuTangkap ? new Date(Math.max(input.waktuTangkap.getTime(), nota.createdAt.getTime())) : sekarang;

  const retur = await tx.spgSaleReturn.create({
    data: {
      createdAt: waktu,
      spgSaleId: nota.id,
      storeId: input.storeId,
      createdById: input.userId,
      reason: alasan,
      idempotencyKey: kunci,
      status: "MENUNGGU",
      decidedById: null,
      decidedAt: null,
      goodsPhotoR2Key: input.fotoBarangKey ?? null,
      refundedAt: uangSudah ? waktu : null,
      refundSlipR2Key: uangSudah ? (input.fotoStrukKey ?? null) : null,
      lines: {
        create: rapi.baris.map((b) => {
          const l = perId.get(b.saleLineId)!;
          return { spgSaleLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: b.qty, condition: b.condition };
        }),
      },
    },
    select: { id: true },
  });

  const pcs = rapi.baris.reduce((s, b) => s + b.qty, 0);
  const [toko, pelapor] = await Promise.all([
    tx.store.findUnique({ where: { id: input.storeId }, select: { name: true } }),
    tx.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } }),
  ]);
  const notifikasi = await tx.adminNotification.create({
    data: {
      category: KATEGORI_NOTIF_RETUR_PEMBELI,
      severity: "WARNING",
      title: capNotificationText(`Retur pembeli menunggu persetujuan — ${toko?.name ?? "toko"}`),
      message:
        `${pcs} potong dari nota ${nota.docNo}, dilaporkan ${namaOrang(pelapor)}. ` +
        `Alasan pembeli: ${alasan}. ` +
        (uangSudah ? `${KALIMAT_UANG_TELANJUR} ` : "") +
        `Setujui atau tolak di SPG → Retur pembeli.`,
      metadata: { returnId: retur.id, spgSaleId: nota.id, storeId: input.storeId, pcs, ...(uangSudah ? { uangSudahDikembalikan: true } : {}) },
    },
  });

  await catatJejak(tx, {
    userId: input.userId,
    action: JEJAK.RETUR_PEMBELI_DILAPORKAN,
    entityType: ENTITAS_RETUR_PEMBELI,
    entityId: retur.id,
    changes: {
      after: {
        status: "MENUNGGU",
        baris: rapi.baris.map((b) => ({ saleLineId: b.saleLineId, qty: b.qty, condition: b.condition })),
        uangSudahDikembalikan: uangSudah,
        refundedAt: uangSudah ? waktu.toISOString() : null,
        goodsPhotoR2Key: input.fotoBarangKey ?? null,
        refundSlipR2Key: uangSudah ? (input.fotoStrukKey ?? null) : null,
      },
    },
    metadata: {
      spgSaleId: nota.id,
      docNo: nota.docNo,
      storeId: input.storeId,
      baris: rapi.baris.map((b) => ({ ...b, productName: perId.get(b.saleLineId)!.productName })),
      luring,
    },
    reason: alasan,
  });

  return { ok: true, returnId: retur.id, ulang: false, notifikasi };
}

/* --------------------------------------------------------------- putuskan */

export type AlasanTolakPutusanReturPembeli =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "PELAPOR_SAMA"
  | "BUKAN_MILIK"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "MELEBIHI_SISA"
  | "UANG_SUDAH_DIKEMBALIKAN"
  | "ALASAN_UANG_KEMBALI_WAJIB"
  | "BESAR_BEBAN_TIDAK_VALID"
  | "ALASAN_BESAR_BEBAN_WAJIB";

export type HasilPutusanReturPembeli =
  | { ok: true; returnId: string; spgSaleId: string; status: "DISETUJUI" | "DITOLAK" | "DIBATALKAN" }
  | { ok: false; alasan: AlasanTolakPutusanReturPembeli };

const PILIH_LAPORAN = {
  id: true,
  status: true,
  spgSaleId: true,
  storeId: true,
  createdById: true,
  createdAt: true,
  idempotencyKey: true,
  decidedAt: true,
  rejectReason: true,
  refundedAt: true,
  refundSlipR2Key: true,
  refundMarkedById: true,
  lines: { select: { id: true, spgSaleLineId: true, itemId: true, variantSku: true, qty: true, condition: true } },
  spgSale: {
    select: {
      docNo: true,
      lines: {
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          productName: true,
          qty: true,
          returnedQty: true,
          lineTotal: true,
          unitPrice: true,
          item: { select: { sku: true } },
        },
      },
    },
  },
} satisfies Prisma.SpgSaleReturnSelect;

type LaporanTerkunci = Prisma.SpgSaleReturnGetPayload<{ select: typeof PILIH_LAPORAN }>;

/**
 * Nota sebuah laporan, dibaca DI LUAR transaksi (nota laporan tidak pernah
 * berubah), supaya transaksi keputusan bisa mengunci nota itu sebagai
 * pernyataan PERTAMA-nya — tanpa kunci baca atas laporannya yang nanti harus
 * dinaikkan. `null` = laporannya tidak ada.
 */
async function notaLaporan(returnId: string): Promise<string | null> {
  if (!returnId) return null;
  const r = await prisma.spgSaleReturn.findUnique({ where: { id: returnId }, select: { spgSaleId: true } });
  return r?.spgSaleId ?? null;
}

async function bacaLaporanTerkunci(tx: Prisma.TransactionClient, returnId: string, spgSaleId: string): Promise<LaporanTerkunci | null> {
  await kunciNotaSpg(tx, spgSaleId);
  return tx.spgSaleReturn.findUnique({ where: { id: returnId }, select: PILIH_LAPORAN });
}

/**
 * Compare-and-swap status laporan `dari` → keputusan baru. Hanya sah di dalam
 * `runSerializable` (Prisma `updateMany` sendiri bukan compare-and-swap).
 */
async function ubahStatusLaporan(
  tx: Prisma.TransactionClient,
  returnId: string,
  dari: "MENUNGGU" | "DITOLAK",
  data: Prisma.SpgSaleReturnUpdateManyMutationInput,
): Promise<boolean> {
  const ubah = await tx.spgSaleReturn.updateMany({ where: { id: returnId, status: dari }, data });
  return ubah.count === 1;
}

/** Alasan menolak/menarik/membatalkan: wajib, paling banyak `BATAS_ALASAN_RETUR_PEMBELI` huruf. Diperiksa sebelum transaksi. */
function periksaAlasanPutusan(alasan: unknown): { ok: true; alasan: string } | { ok: false; alasan: "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" } {
  const teks = typeof alasan === "string" ? alasan.trim() : "";
  if (!teks) return { ok: false, alasan: "ALASAN_WAJIB" };
  if (Array.from(teks).length > BATAS_ALASAN_RETUR_PEMBELI) return { ok: false, alasan: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, alasan: teks };
}

const pcsLaporan = (r: { lines: { qty: number }[] }) => r.lines.reduce((s, l) => s + l.qty, 0);

const mintaPerBarisNota = (r: LaporanTerkunci) => {
  const m = new Map<string, number>();
  for (const b of r.lines) m.set(b.spgSaleLineId, (m.get(b.spgSaleLineId) ?? 0) + b.qty);
  return m;
};

/** Besar beban yang dihitung sistem untuk laporan ini (P81): harga bersih baris notanya. */
function dihitungDariLaporan(r: LaporanTerkunci): number {
  const perId = new Map(r.spgSale.lines.map((l) => [l.id, l]));
  return nilaiBebanReturPembeli(
    r.lines.map((b) => {
      const l = perId.get(b.spgSaleLineId);
      const total = l ? l.lineTotal : null;
      return {
        qty: b.qty,
        saleLine: { qty: l?.qty ?? 0, lineTotal: total === null ? null : Number(total), unitPrice: Number(l?.unitPrice ?? 0) },
      };
    }),
  );
}

/**
 * Laporan DITOLAK yang dibuka lagi (P82 atau P79 KEMBALI_STOK): potongnya
 * masih muat? Yang sudah kembali + yang menunggu + yang ditahan laporan LAIN +
 * laporan ini ≤ terjual.
 */
async function muatLagi(tx: Prisma.TransactionClient, r: LaporanTerkunci): Promise<boolean> {
  const minta = mintaPerBarisNota(r);
  const ids = [...minta.keys()];
  const [menunggu, ditahan] = await Promise.all([qtyMenungguPerBaris(tx, ids), qtyDitahanBebanPerBaris(tx, ids, { kecualiReturnId: r.id })]);
  const perId = new Map(r.spgSale.lines.map((l) => [l.id, l]));
  for (const [id, n] of minta) {
    const l = perId.get(id);
    if (!l || l.returnedQty + (menunggu.get(id) ?? 0) + (ditahan.get(id) ?? 0) + n > l.qty) return false;
  }
  return true;
}

/**
 * Pengaruh laporan yang (akhirnya) disetujui — SATU penerap untuk persetujuan
 * biasa, penolakan yang dibatalkan (P82), dan "barang masuk stok" (P79):
 * `returnedQty` naik dari angka yang baru dibaca (selisih = penulis lain
 * menyelip → lempar P2034, transaksi diulang), buku stok toko `RETUR_PEMBELI`
 * +qty untuk SETIAP potong LAYAK bertanggal saat dilaporkan atas nama
 * pelapornya (yang rusak tercatat di dokumennya, tidak di rak), dan
 * `SalesHistory` nota itu. Hanya di dalam `runSerializable`, SESUDAH
 * compare-and-swap statusnya.
 */
async function terapkanPengaruhSetujuTx(
  tx: Prisma.TransactionClient,
  r: LaporanTerkunci,
): Promise<{ bukuDitulis: number; riwayatTakDitemukan: number; sebelum: Record<string, number>; sesudah: Record<string, number> }> {
  const perId = new Map(r.spgSale.lines.map((l) => [l.id, l]));
  const minta = mintaPerBarisNota(r);
  for (const [id, n] of minta) {
    const l = perId.get(id);
    if (!l) ulangi("baris nota hilang");
    const ubah = await tx.spgSaleLine.updateMany({
      where: { id, returnedQty: l.returnedQty },
      data: { returnedQty: { increment: n } },
    });
    if (ubah.count !== 1) ulangi("returnedQty berubah");
  }

  const layak = r.lines.filter((b) => b.condition === "LAYAK" && b.qty > 0);
  if (layak.length) {
    await tx.storeStockMovement.createMany({
      data: layak.map((b) => ({
        storeId: r.storeId,
        itemId: b.itemId,
        variantSku: b.variantSku,
        qty: b.qty,
        kind: "RETUR_PEMBELI" as const,
        refType: ENTITAS_RETUR_PEMBELI,
        refId: r.id,
        createdById: r.createdById,
        createdAt: r.createdAt,
      })),
    });
  }

  // `SalesHistory` nota ini berkunci (OFFLINE, nomor nota, SKU varian — atau
  // SKU barang untuk barang tanpa varian), sama dengan cara `recordSpgSale`
  // menyusunnya. Baris yang tidak ditemukan tidak menggagalkan persetujuan:
  // dicatat di jejak.
  let riwayatTakDitemukan = 0;
  for (const [id, n] of minta) {
    const l = perId.get(id)!;
    const ubah = await tx.salesHistory.updateMany({
      where: { channel: "OFFLINE", orderId: r.spgSale.docNo, variantSku: l.variantSku || l.item.sku },
      data: { returnedQuantity: { increment: n }, netQuantity: { decrement: n } },
    });
    if (ubah.count === 0) riwayatTakDitemukan += 1;
  }

  return {
    bukuDitulis: layak.reduce((s, b) => s + b.qty, 0),
    riwayatTakDitemukan,
    sebelum: Object.fromEntries([...minta.keys()].map((id) => [id, perId.get(id)!.returnedQty])),
    sesudah: Object.fromEntries([...minta.entries()].map(([id, n]) => [id, perId.get(id)!.returnedQty + n])),
  };
}

/**
 * Kantor menyetujui laporan: baru sekarang retur berpengaruh — bertanggal saat
 * DILAPORKAN. Jumlah yang boleh kembali diperiksa ulang (sudah kembali +
 * laporan ini ≤ terjual). Persetujuan kedua atas laporan yang sama tidak
 * menerapkan apa pun (`SUDAH_DIPUTUSKAN`). Kabar ke SPG menurut keadaan uang
 * yang dibaca DI transaksi ini: belum dikembalikan → "silakan kembalikan uang
 * pembeli lewat kasir, lalu foto struknya" (P13a).
 *
 * Bulan yang sudah ditutup tidak menghalangi — komisi bulan nota ASLINYA yang
 * sudah dicek (putus) atau dikunci (siklus konsi), P9, maupun siklus konsi
 * bulan laporannya yang sudah dikunci (R25): angka yang tersimpan tidak
 * berubah, hitungan ulangnya yang turun, dan koreksi komisi menyusul di
 * pembayaran berikutnya.
 */
export async function setujuiReturPembeli(input: { returnId: string; olehUserId: string; sekarang?: Date }): Promise<HasilPutusanReturPembeli> {
  const spgSaleId = await notaLaporan(input.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = input.sekarang ?? new Date();

  type Setuju =
    | { ok: true; returnId: string; docNo: string; storeId: string; pelaporId: string; pcs: number; bukuDitulis: number; uangSudah: boolean }
    | { ok: false; alasan: AlasanTolakPutusanReturPembeli };

  const hasil = await runSerializable(async (tx): Promise<Setuju> => {
    const r = await bacaLaporanTerkunci(tx, input.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.status !== "MENUNGGU") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (r.createdById === input.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };

    const perId = new Map(r.spgSale.lines.map((l) => [l.id, l]));
    for (const [id, minta] of mintaPerBarisNota(r)) {
      const l = perId.get(id);
      // Baris nota yang hilang, atau sudah kembali penuh lewat jalur lain: tidak bisa diterapkan.
      if (!l || l.returnedQty + minta > l.qty) return { ok: false, alasan: "MELEBIHI_SISA" };
    }

    // Sampai sini belum ada yang ditulis. Penjaga keadaan dulu, baru pengaruhnya.
    if (!(await ubahStatusLaporan(tx, r.id, "MENUNGGU", { status: "DISETUJUI", decidedById: input.olehUserId, decidedAt: sekarang }))) {
      return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    }
    const pengaruh = await terapkanPengaruhSetujuTx(tx, r);
    const uangSudah = uangReturTercatat(r);
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_PEMBELI_DISETUJUI,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: {
        before: { status: "MENUNGGU", returnedQty: pengaruh.sebelum },
        after: { status: "DISETUJUI", returnedQty: pengaruh.sesudah },
      },
      metadata: {
        spgSaleId: r.spgSaleId,
        docNo: r.spgSale.docNo,
        storeId: r.storeId,
        bukuDitulis: pengaruh.bukuDitulis,
        uangSudahDikembalikan: uangSudah,
        ...(pengaruh.riwayatTakDitemukan > 0 ? { riwayatTakDitemukan: pengaruh.riwayatTakDitemukan } : {}),
      },
    });

    return {
      ok: true,
      returnId: r.id,
      docNo: r.spgSale.docNo,
      storeId: r.storeId,
      pelaporId: r.createdById,
      pcs: pcsLaporan(r),
      bukuDitulis: pengaruh.bukuDitulis,
      uangSudah,
    };
  });

  if (!hasil.ok) return hasil;
  // Barang LAYAK yang kembali ke rak bisa jadi yang sedang dititip-pesankan pembeli lain.
  if (hasil.bukuDitulis > 0) void kabariTitipanTersedia(hasil.storeId);
  void kabariPengguna(hasil.pelaporId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DISETUJUI,
    judul: "Retur pembeli disetujui",
    isi: hasil.uangSudah
      ? kabar([`Nota ${hasil.docNo}: ${hasil.pcs} potong disetujui kantor.`, "Uang pembeli sudah dikembalikan; barang yang layak boleh kembali ke rak."])
      : kabar([
          `Nota ${hasil.docNo}: ${hasil.pcs} potong disetujui kantor.`,
          [
            "Silakan kembalikan uang pembeli lewat kasir toko, lalu foto struk pengembaliannya di Laporan barang kembali.",
            "Kembalikan uang pembeli lewat kasir, lalu foto struknya di Laporan barang kembali.",
          ],
          "Barang yang layak boleh kembali ke rak.",
        ]),
    data: { returnId: hasil.returnId, spgSaleId },
  });
  return { ok: true, returnId: hasil.returnId, spgSaleId, status: "DISETUJUI" };
}

/**
 * Kantor menolak laporan, dengan alasan (dikirim ke HP SPG).
 *
 * - Uang belum dikembalikan (dan tidak ditandai): tidak ada yang bergerak;
 *   potongnya lepas lagi; HP bilang "jangan kembalikan uang, kembalikan
 *   barangnya ke pembeli" (P83).
 * - Uang sudah dikembalikan — dicatat SPG, atau ditandai kantor sekarang
 *   (`uangTernyataDikembalikan` + `alasanUangKembali` wajib, P78): SATU beban
 *   SPG di transaksi ini, tepat sesudah compare-and-swap statusnya. Besarnya
 *   harga bersih di nota (P81) atau `besarBeban` (angka struk) dengan
 *   `alasanBesarBeban` bila berbeda. Potongnya DITAHAN sampai nasib bebannya.
 *   Tanda kantor tidak mengisi `refundedAt` — harinya tidak diketahui.
 */
export async function tolakReturPembeli(input: {
  returnId: string;
  olehUserId: string;
  alasan: string;
  uangTernyataDikembalikan?: boolean;
  alasanUangKembali?: string | null;
  besarBeban?: number | null;
  alasanBesarBeban?: string | null;
  sekarang?: Date;
}): Promise<HasilPutusanReturPembeli> {
  const cek = periksaAlasanPutusan(input.alasan);
  if (!cek.ok) return cek;
  let alasanTanda: string | null = null;
  if (input.uangTernyataDikembalikan) {
    const a = periksaAlasanPutusan(input.alasanUangKembali);
    if (!a.ok) return { ok: false, alasan: a.alasan === "ALASAN_WAJIB" ? "ALASAN_UANG_KEMBALI_WAJIB" : "ALASAN_TERLALU_PANJANG" };
    alasanTanda = a.alasan;
  }
  if (input.besarBeban !== undefined && input.besarBeban !== null) {
    // Bentuknya diperiksa sebelum transaksi; perbandingannya dengan angka sistem di dalamnya.
    const pra = periksaBesarBeban({ besar: input.besarBeban, dihitung: input.besarBeban, alasan: null });
    if (!pra.ok) return { ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" };
  }
  const spgSaleId = await notaLaporan(input.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = input.sekarang ?? new Date();

  type Tolak =
    | { ok: true; docNo: string; pelaporId: string; pcs: number; beban: { chargeId: string; jumlah: number } | null }
    | { ok: false; alasan: AlasanTolakPutusanReturPembeli };
  const hasil = await runSerializable(async (tx): Promise<Tolak> => {
    const r = await bacaLaporanTerkunci(tx, input.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.status !== "MENUNGGU") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (r.createdById === input.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };

    // Catatan SPG menang: tanda kantor hanya untuk laporan yang uangnya belum dicatat.
    const tandai = alasanTanda !== null && r.refundedAt === null;
    const dibebankan = r.refundedAt !== null || tandai;
    let besar: { besar: number; alasan: string | null } | null = null;
    const dihitung = dibebankan ? dihitungDariLaporan(r) : 0;
    if (dibebankan) {
      const b = periksaBesarBeban({ besar: input.besarBeban, dihitung, alasan: input.alasanBesarBeban });
      if (!b.ok) return { ok: false, alasan: b.alasan };
      besar = b;
    }

    const diputuskan = await ubahStatusLaporan(tx, r.id, "MENUNGGU", {
      status: "DITOLAK",
      decidedById: input.olehUserId,
      decidedAt: sekarang,
      rejectReason: cek.alasan,
      ...(tandai ? { refundMarkedById: input.olehUserId, refundMarkReason: alasanTanda } : {}),
    });
    if (!diputuskan) return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };

    let beban: { chargeId: string; jumlah: number } | null = null;
    if (dibebankan && besar) {
      const toko = await tx.store.findUnique({ where: { id: r.storeId }, select: { termsType: true } });
      const c = await buatBebanReturPembeliTx(tx, {
        returnId: r.id,
        spgUserId: r.createdById,
        storeId: r.storeId,
        jenisToko: bacaJenisTokoBeban(toko?.termsType),
        docNo: r.spgSale.docNo,
        spgSaleId: r.spgSaleId,
        dilaporkanPada: r.createdAt,
        dihitung,
        besar: besar.besar,
        alasanBesar: besar.alasan,
        olehUserId: input.olehUserId,
        waktu: sekarang,
      });
      beban = { chargeId: c.chargeId, jumlah: besar.besar };
    }

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_PEMBELI_DITOLAK,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: {
        before: { status: "MENUNGGU", refundMarkedById: null, refundMarkReason: null },
        after: {
          status: "DITOLAK",
          rejectReason: cek.alasan,
          refundMarkedById: tandai ? input.olehUserId : null,
          refundMarkReason: tandai ? alasanTanda : null,
        },
      },
      metadata: {
        spgSaleId: r.spgSaleId,
        docNo: r.spgSale.docNo,
        storeId: r.storeId,
        pcs: pcsLaporan(r),
        ...(beban ? { beban: { chargeId: beban.chargeId, jumlah: beban.jumlah, dihitung, alasanBesar: besar?.alasan ?? null } } : {}),
      },
      reason: cek.alasan,
    });
    return { ok: true, docNo: r.spgSale.docNo, pelaporId: r.createdById, pcs: pcsLaporan(r), beban };
  });

  if (!hasil.ok) return hasil;
  void kabariPengguna(hasil.pelaporId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DITOLAK,
    judul: "Retur pembeli ditolak",
    isi: hasil.beban
      ? kabar([
          `Nota ${hasil.docNo} ditolak kantor.`,
          `Uang yang sudah dikembalikan (${formatRupiah(hasil.beban.jumlah)}) menjadi beban Anda, dipotong dari komisi lalu gaji.`,
          "Barangnya tetap disisihkan sampai kantor memutuskan.",
          kalimatAlasan(cek.alasan),
        ])
      : kabar([
          `Nota ${hasil.docNo}: ${hasil.pcs} potong ditolak kantor.`,
          "Jangan kembalikan uang pembeli; kembalikan barangnya kepada pembeli.",
          kalimatAlasan(cek.alasan),
        ]),
    data: { returnId: input.returnId, spgSaleId, ...(hasil.beban ? { chargeId: hasil.beban.chargeId } : {}) },
  });
  return { ok: true, returnId: input.returnId, spgSaleId, status: "DITOLAK" };
}

/**
 * SPG menarik laporannya sendiri selama masih menunggu, dengan alasan —
 * misalnya salah catat. Hanya pelapornya, dan hanya untuk laporan di toko
 * tetapnya SEKARANG (`storeId` dari server). Laporan yang uangnya SUDAH
 * tercatat dikembalikan tidak bisa ditarik (`UANG_SUDAH_DIKEMBALIKAN`): kantor
 * yang memutuskannya (P78), supaya bebannya tidak bisa dihindari. Tidak ada yang
 * bergerak; potongnya bisa dilaporkan ulang dari nota. Tanpa kabar.
 */
export async function tarikReturPembeli(input: {
  returnId: string;
  userId: string;
  storeId: string;
  alasan: string;
  sekarang?: Date;
}): Promise<HasilPutusanReturPembeli> {
  const cek = periksaAlasanPutusan(input.alasan);
  if (!cek.ok) return cek;
  const spgSaleId = await notaLaporan(input.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = input.sekarang ?? new Date();

  return runSerializable(async (tx): Promise<HasilPutusanReturPembeli> => {
    const r = await bacaLaporanTerkunci(tx, input.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.createdById !== input.userId || r.storeId !== input.storeId) return { ok: false, alasan: "BUKAN_MILIK" };
    if (r.status !== "MENUNGGU") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (uangReturTercatat(r)) return { ok: false, alasan: "UANG_SUDAH_DIKEMBALIKAN" };
    const ditarik = await tx.spgSaleReturn.updateMany({
      where: { id: r.id, status: "MENUNGGU", refundedAt: null, refundMarkedById: null },
      data: { status: "DIBATALKAN", decidedById: input.userId, decidedAt: sekarang, rejectReason: cek.alasan },
    });
    // Baris terkunci, jadi meleset berarti balapan yang lolos penguncian: ulangi, supaya
    // pembacaan ulang memberi alasan yang benar (mis. uangnya baru saja dicatat).
    if (ditarik.count !== 1) ulangi("laporan berubah");
    await catatJejak(tx, {
      userId: input.userId,
      action: JEJAK.RETUR_PEMBELI_DITARIK,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: { before: { status: "MENUNGGU" }, after: { status: "DIBATALKAN", rejectReason: cek.alasan } },
      metadata: { olehSpg: true, spgSaleId: r.spgSaleId, docNo: r.spgSale.docNo, storeId: r.storeId, pcs: pcsLaporan(r) },
      reason: cek.alasan,
    });
    return { ok: true, returnId: r.id, spgSaleId: r.spgSaleId, status: "DIBATALKAN" };
  });
}

/* -------------------------------------------------------- uang dikembalikan */

export type AlasanTolakUangKembali = "TIDAK_DITEMUKAN" | "BUKAN_MILIK" | "TIDAK_DISETUJUI" | "SUDAH_DICATAT" | "FOTO_STRUK_WAJIB";

export type HasilUangKembali =
  | { ok: true; returnId: string; spgSaleId: string; ulang: boolean }
  | { ok: false; alasan: AlasanTolakUangKembali };

const jepit = (t: Date, bawah: Date, atas: Date) => new Date(Math.min(Math.max(t.getTime(), bawah.getTime()), atas.getTime()));

/**
 * SPG mencatat kasir sudah mengembalikan uang pembeli, dengan foto struk (P77).
 * Hanya pelapornya di toko tetapnya. Boleh selama MENUNGGU (uang dikembalikan
 * sebelum disetujui — salahnya sendiri, P13; kantor diberi tahu) atau sesudah
 * DISETUJUI (jalan yang benar, P13a), selama uangnya belum tercatat atau
 * ditandai kantor. Laporan DITOLAK atau DIBATALKAN → `TIDAK_DISETUJUI` — juga
 * pencatatan tanpa sinyal yang baru sampai sesudah kantor menolak: belum ada
 * jawaban pemilik untuk uang yang keluar sesudah HP menyuruh "jangan kembalikan
 * uang" (pertanyaan terbuka), jadi tidak ada beban yang dibuat diam-diam. Foto
 * struk harus di folder laporan ini, bernama `struk`. Sudah tercatat: kunci
 * yang sama → ok (`ulang`, juga sesudah laporannya diputuskan), lain →
 * `SUDAH_DICATAT`.
 *
 * Tanpa sinyal: `waktuTangkap` = saat dicatat di HP (sudah dijepit pemanggil
 * ke batas antrean), dijepit lagi ke [dilaporkan — atau disetujui — ; sekarang].
 */
export async function catatUangDikembalikan(i: {
  returnId: string;
  userId: string;
  storeId: string;
  fotoStrukKey: string;
  waktuTangkap?: Date | null;
  sekarang?: Date;
}): Promise<HasilUangKembali> {
  const spgSaleId = await notaLaporan(i.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = i.sekarang ?? new Date();

  type Hasil = { ok: true; ulang: boolean; notifikasi: AdminNotification | null } | { ok: false; alasan: AlasanTolakUangKembali };

  const hasil = await runSerializable(async (tx): Promise<Hasil> => {
    const r = await bacaLaporanTerkunci(tx, i.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.createdById !== i.userId || r.storeId !== i.storeId) return { ok: false, alasan: "BUKAN_MILIK" };
    if (!kunciFotoReturPembeliSah(i.fotoStrukKey, { storeId: r.storeId, kunci: r.idempotencyKey, jenis: "struk" })) {
      return { ok: false, alasan: "FOTO_STRUK_WAJIB" };
    }
    // Ulangan kiriman yang jawabannya hilang: kunci yang sama sudah tercatat.
    if (r.refundedAt !== null) {
      return r.refundSlipR2Key === i.fotoStrukKey ? { ok: true, ulang: true, notifikasi: null } : { ok: false, alasan: "SUDAH_DICATAT" };
    }
    if (r.status !== "MENUNGGU" && r.status !== "DISETUJUI") return { ok: false, alasan: "TIDAK_DISETUJUI" };
    // Ditandai kantor saat menolak (P78) lalu penolakannya dibatalkan: uangnya sudah terhitung kembali.
    if (r.refundMarkedById !== null) return { ok: false, alasan: "SUDAH_DICATAT" };

    const tangkap = i.waktuTangkap ?? null;
    const waktu = jepit(tangkap ?? sekarang, r.status === "DISETUJUI" ? (r.decidedAt ?? r.createdAt) : r.createdAt, sekarang);

    const ubah = await tx.spgSaleReturn.updateMany({
      where: { id: r.id, status: { in: ["MENUNGGU", "DISETUJUI"] }, refundedAt: null, refundMarkedById: null },
      data: { refundedAt: waktu, refundSlipR2Key: i.fotoStrukKey },
    });
    if (ubah.count !== 1) ulangi("laporan berubah");

    await catatJejak(tx, {
      userId: i.userId,
      action: JEJAK.RETUR_PEMBELI_UANG_DIKEMBALIKAN,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: {
        before: { refundedAt: null, refundSlipR2Key: null },
        after: { refundedAt: waktu.toISOString(), refundSlipR2Key: i.fotoStrukKey },
      },
      metadata: { status: r.status, spgSaleId: r.spgSaleId, docNo: r.spgSale.docNo, storeId: r.storeId, luring: tangkap !== null },
    });

    let notifikasi: AdminNotification | null = null;
    if (r.status === "MENUNGGU") {
      const toko = await tx.store.findUnique({ where: { id: r.storeId }, select: { name: true } });
      notifikasi = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_RETUR_PEMBELI,
          severity: "WARNING",
          title: capNotificationText(`Uang retur pembeli sudah dikembalikan — ${toko?.name ?? "toko"}`),
          message: capNotificationText(`Uang pembeli nota ${r.spgSale.docNo} sudah dikembalikan kasir sebelum disetujui — kalau ditolak, menjadi beban SPG.`),
          metadata: { returnId: r.id, spgSaleId: r.spgSaleId, storeId: r.storeId, uangSudahDikembalikan: true },
        },
      });
    }
    return { ok: true, ulang: false, notifikasi };
  });

  if (!hasil.ok) return hasil;
  // Hanya baris dari percobaan yang KOMIT: `notifikasi` dibuat ulang di setiap percobaan.
  if (hasil.notifikasi) void fanOutAdminNotification(hasil.notifikasi);
  return { ok: true, returnId: i.returnId, spgSaleId, ulang: hasil.ulang };
}

/* ------------------------------------------------- penolakan keliru (P82) */

export type AlasanTolakBatalPenolakan =
  | "TIDAK_DITEMUKAN"
  | "BUKAN_DITOLAK"
  | "TANPA_BEBAN"
  | "SUDAH_DIPOTONG"
  | "SUDAH_DIUTANGKAN"
  | "BARANG_SUDAH_DIPUTUSKAN"
  | "PELAPOR_SAMA"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "MELEBIHI_SISA";

/**
 * Penolakan yang keliru dibatalkan kantor, dengan alasan (P82), selama belum
 * ada yang dipotong dari bebannya sama sekali (`bisaBatalkanBebanTx`). Dalam
 * satu transaksi: laporan DITOLAK → DISETUJUI, pengaruh persetujuannya
 * diterapkan, beban → BATAL, jejak keduanya. Beban yang sudah dipindah ke utang
 * SPG (`SUDAH_DIUTANGKAN`) belum bisa: utang SPG belum punya jalan pembatalan.
 * Penolakan TANPA beban tetap final — barangnya sudah dikembalikan ke pembeli
 * (P83).
 */
export async function batalkanPenolakanReturPembeli(i: {
  returnId: string;
  olehUserId: string;
  alasan: unknown;
  sekarang?: Date;
}): Promise<{ ok: true; returnId: string; spgSaleId: string } | { ok: false; alasan: AlasanTolakBatalPenolakan }> {
  const cek = periksaAlasanPutusan(i.alasan);
  if (!cek.ok) return cek;
  const spgSaleId = await notaLaporan(i.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = i.sekarang ?? new Date();

  type Hasil =
    | { ok: true; docNo: string; storeId: string; pelaporId: string; jumlah: number; bukuDitulis: number }
    | { ok: false; alasan: AlasanTolakBatalPenolakan };
  const hasil = await runSerializable(async (tx): Promise<Hasil> => {
    const r = await bacaLaporanTerkunci(tx, i.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.status !== "DITOLAK") return { ok: false, alasan: "BUKAN_DITOLAK" };
    if (r.createdById === i.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };
    const boleh = await bisaBatalkanBebanTx(tx, r.id);
    if (!boleh.boleh) return { ok: false, alasan: boleh.alasan };
    if (!(await muatLagi(tx, r))) return { ok: false, alasan: "MELEBIHI_SISA" };

    if (!(await ubahStatusLaporan(tx, r.id, "DITOLAK", { status: "DISETUJUI", decidedById: i.olehUserId, decidedAt: sekarang, rejectReason: null }))) {
      ulangi("laporan berubah");
    }
    const pengaruh = await terapkanPengaruhSetujuTx(tx, r);
    await batalkanBebanTx(tx, { cek: boleh, olehUserId: i.olehUserId, alasan: cek.alasan, waktu: sekarang });
    await catatJejak(tx, {
      userId: i.olehUserId,
      action: JEJAK.RETUR_PEMBELI_PENOLAKAN_DIBATALKAN,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: {
        before: { status: "DITOLAK", rejectReason: r.rejectReason, returnedQty: pengaruh.sebelum },
        after: { status: "DISETUJUI", rejectReason: null, returnedQty: pengaruh.sesudah },
      },
      metadata: {
        spgSaleId: r.spgSaleId,
        docNo: r.spgSale.docNo,
        storeId: r.storeId,
        chargeId: boleh.chargeId,
        bukuDitulis: pengaruh.bukuDitulis,
        ...(pengaruh.riwayatTakDitemukan > 0 ? { riwayatTakDitemukan: pengaruh.riwayatTakDitemukan } : {}),
      },
      reason: cek.alasan,
    });
    return { ok: true, docNo: r.spgSale.docNo, storeId: r.storeId, pelaporId: r.createdById, jumlah: boleh.amount, bukuDitulis: pengaruh.bukuDitulis };
  });

  if (!hasil.ok) return hasil;
  if (hasil.bukuDitulis > 0) void kabariTitipanTersedia(hasil.storeId);
  void kabariPengguna(hasil.pelaporId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DISETUJUI,
    judul: "Penolakan retur pembeli dibatalkan",
    isi: kabar([
      `Penolakan nota ${hasil.docNo} dibatalkan kantor — retur disetujui, beban ${formatRupiah(hasil.jumlah)} dibatalkan.`,
      "Barang yang layak boleh kembali ke rak.",
    ]),
    data: { returnId: i.returnId, spgSaleId },
  });
  return { ok: true, returnId: i.returnId, spgSaleId };
}

/* ------------------------------------------------------ barangnya (P79) */

export type AlasanTolakKeputusanBarang =
  | "TIDAK_DITEMUKAN"
  | "TANPA_BEBAN"
  | "BEBAN_BELUM_LUNAS"
  | "SUDAH_DIPUTUSKAN"
  | "PELAPOR_SAMA"
  | "MELEBIHI_SISA"
  | "CATATAN_TERLALU_PANJANG";

/**
 * Sesudah SPG mengganti penuh (`bebanSudahDiganti`), kantor memilih SEKALI
 * (P79, "sudah benar"):
 * - KEMBALI_STOK: laporan DITOLAK → DISETUJUI, pengaruh persetujuannya
 *   diterapkan (barang layak kembali ke rak), dan uang yang sudah ia ganti
 *   dikembalikan di pembayaran berikutnya — SPG yang pembayaran terakhirnya
 *   sudah lewat: mengurangi utangnya dulu (P67).
 * - DIBELI_SPG: tidak ada yang bergerak; penjualannya berdiri, bebannya harga barang itu.
 */
export async function putuskanBarangReturPembeli(i: {
  returnId: string;
  keputusan: KeputusanBarangBeban;
  olehUserId: string;
  catatan?: string | null;
  sekarang?: Date;
}): Promise<{ ok: true; returnId: string; spgSaleId: string } | { ok: false; alasan: AlasanTolakKeputusanBarang }> {
  const catatan = typeof i.catatan === "string" && i.catatan.trim() ? i.catatan.trim() : null;
  if (catatan && Array.from(catatan).length > BATAS_ALASAN_RETUR_PEMBELI) return { ok: false, alasan: "CATATAN_TERLALU_PANJANG" };
  const spgSaleId = await notaLaporan(i.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = i.sekarang ?? new Date();

  type Hasil =
    | { ok: true; docNo: string; storeId: string; pelaporId: string; jumlah: number; kembali: number; imbang: number; bukuDitulis: number }
    | { ok: false; alasan: AlasanTolakKeputusanBarang };
  const hasil = await runSerializable(async (tx): Promise<Hasil> => {
    const r = await bacaLaporanTerkunci(tx, i.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    const c = await tx.spgCharge.findUnique({
      where: { source_sourceId: { source: "RETUR_PEMBELI", sourceId: r.id } },
      select: { id: true, status: true, amount: true, goodsDecision: true, deductions: { where: { paidRefType: REF_BEBAN_KE_UTANG }, select: { paidRefId: true } } },
    });
    if (!c || c.status === "BATAL" || r.status !== "DITOLAK") return { ok: false, alasan: "TANPA_BEBAN" };
    if (c.goodsDecision !== null) return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (r.createdById === i.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };
    const utangIds = c.deductions.map((d) => d.paidRefId);
    const utang = utangIds.length ? await tx.spgDebt.findMany({ where: { id: { in: utangIds } }, select: { status: true } }) : [];
    if (!bebanSudahDiganti({ status: c.status, utang: utang.map((u) => ({ lunas: u.status === "LUNAS" })) })) {
      return { ok: false, alasan: "BEBAN_BELUM_LUNAS" };
    }

    let bukuDitulis = 0;
    if (i.keputusan === "KEMBALI_STOK") {
      if (!(await muatLagi(tx, r))) return { ok: false, alasan: "MELEBIHI_SISA" };
      if (!(await ubahStatusLaporan(tx, r.id, "DITOLAK", { status: "DISETUJUI", decidedById: i.olehUserId, decidedAt: sekarang, rejectReason: null }))) {
        ulangi("laporan berubah");
      }
      const pengaruh = await terapkanPengaruhSetujuTx(tx, r);
      bukuDitulis = pengaruh.bukuDitulis;
      await catatJejak(tx, {
        userId: i.olehUserId,
        action: JEJAK.RETUR_PEMBELI_DITERIMA_SESUDAH_BEBAN,
        entityType: ENTITAS_RETUR_PEMBELI,
        entityId: r.id,
        changes: {
          before: { status: "DITOLAK", rejectReason: r.rejectReason, returnedQty: pengaruh.sebelum },
          after: { status: "DISETUJUI", rejectReason: null, returnedQty: pengaruh.sesudah },
        },
        metadata: {
          spgSaleId: r.spgSaleId,
          docNo: r.spgSale.docNo,
          storeId: r.storeId,
          chargeId: c.id,
          bukuDitulis,
          ...(pengaruh.riwayatTakDitemukan > 0 ? { riwayatTakDitemukan: pengaruh.riwayatTakDitemukan } : {}),
        },
        reason: catatan,
      });
    }
    const p = await putuskanBarangBebanTx(tx, {
      chargeId: c.id,
      keputusan: i.keputusan,
      olehUserId: i.olehUserId,
      catatan,
      waktu: sekarang,
      bulanBayar: bulanWib(sekarang),
    });
    if (!p.ok) ulangi("keputusan barang berubah");
    return {
      ok: true,
      docNo: r.spgSale.docNo,
      storeId: r.storeId,
      pelaporId: r.createdById,
      jumlah: Number(c.amount),
      kembali: p.kembali,
      imbang: p.imbang,
      bukuDitulis,
    };
  });

  if (!hasil.ok) return hasil;
  if (hasil.bukuDitulis > 0) void kabariTitipanTersedia(hasil.storeId);
  if (i.keputusan === "KEMBALI_STOK") {
    const sisa = Math.round((hasil.kembali - hasil.imbang) * 100) / 100;
    void kabariPengguna(hasil.pelaporId, {
      jenis: JENIS_KABAR.RETUR_PEMBELI_DISETUJUI,
      judul: "Retur pembeli diterima",
      isi: kabar([
        hasil.imbang > 0
          ? `Uang Anda ${formatRupiah(hasil.kembali)} untuk nota ${hasil.docNo}: ${formatRupiah(hasil.imbang)} mengurangi utang SPG Anda` +
            (sisa > 0 ? `, ${formatRupiah(sisa)} menunggu dibayarkan.` : ".")
          : `Uang Anda ${formatRupiah(hasil.kembali)} untuk nota ${hasil.docNo} dikembalikan di pembayaran berikutnya.`,
        "Barang yang layak boleh kembali ke rak.",
      ]),
      data: { returnId: i.returnId, spgSaleId },
    });
  } else {
    void kabariPengguna(hasil.pelaporId, {
      jenis: JENIS_KABAR.RETUR_PEMBELI_DITOLAK,
      judul: "Barang retur pembeli menjadi milik Anda",
      isi: kabar([`Barang nota ${hasil.docNo} menjadi milik Anda (${formatRupiah(hasil.jumlah)}).`, "Ambil dari barang yang disisihkan."]),
      data: { returnId: i.returnId, spgSaleId },
    });
  }
  return { ok: true, returnId: i.returnId, spgSaleId };
}

/* ------------------------------------------------------------------ bacaan */

export type BarisNotaKembali = {
  saleLineId: string;
  productName: string;
  variantSku: string;
  qty: number;
  /** Yang sudah kembali DAN disetujui kantor. */
  returnedQty: number;
  /** Potong di laporan yang masih menunggu kantor (laporan siapa pun). */
  menunggu: number;
  /** Potong di laporan ditolak yang uangnya sudah dikembalikan — menunggu nasib bebannya. */
  ditahan: number;
  /** Yang masih bisa dilaporkan: qty − returnedQty − menunggu − ditahan. */
  sisa: number;
};

export type NotaUntukKembali = {
  id: string;
  docNo: string;
  waktu: string;
  baris: BarisNotaKembali[];
  /** Σ `menunggu` semua baris. */
  menungguTotal: number;
};

/** Nota SPG untuk layar "laporkan retur pembeli" — hanya milik SPG itu, di tokonya. Tanpa harga. */
export async function notaUntukKembali(spgSaleId: string, userId: string, storeId: string): Promise<NotaUntukKembali | null> {
  const n = await prisma.spgSale.findFirst({
    where: { id: spgSaleId, salesmanId: userId, storeId },
    select: {
      id: true,
      docNo: true,
      createdAt: true,
      lines: { orderBy: { productName: "asc" }, select: { id: true, productName: true, variantSku: true, qty: true, returnedQty: true } },
    },
  });
  if (!n) return null;
  const ids = n.lines.map((l) => l.id);
  const [menunggu, ditahan] = await Promise.all([qtyMenungguPerBaris(prisma, ids), qtyDitahanBebanPerBaris(prisma, ids)]);
  const baris = n.lines.map((l): BarisNotaKembali => {
    const m = menunggu.get(l.id) ?? 0;
    const d = ditahan.get(l.id) ?? 0;
    return {
      saleLineId: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      returnedQty: l.returnedQty,
      menunggu: m,
      ditahan: d,
      sisa: sisaReturPembeli({ qty: l.qty, returnedQty: l.returnedQty, menunggu: m, ditahan: d }),
    };
  });
  return {
    id: n.id,
    docNo: n.docNo,
    waktu: n.createdAt.toISOString(),
    baris,
    menungguTotal: baris.reduce((s, b) => s + b.menunggu, 0),
  };
}

export type ReturPembeliRingkas = {
  id: string;
  /** Saat dilaporkan (ISO). */
  waktu: string;
  alasan: string;
  oleh: string;
  status: StatusReturPembeli;
  /** Keadaan uang pembeli laporan ini. */
  uang: KeadaanUangRetur;
  diputuskanOleh: string | null;
  /** ISO, atau null (masih menunggu). */
  diputuskanPada: string | null;
  /** Alasan kantor menolak (DITOLAK), atau alasan SPG menarik (DIBATALKAN). */
  alasanTolak: string | null;
  baris: { productName: string; variantSku: string; qty: number; condition: KondisiRetur }[];
};

export type KembaliPerNota = {
  /** Per baris nota (urutan nama barang): `returnedQty` = disetujui, `menunggu` = laporan yang belum diputuskan. */
  perBaris: { saleLineId: string; productName: string; variantSku: string; qty: number; returnedQty: number; menunggu: number }[];
  /** SEMUA laporan, apa pun statusnya, terlama dulu. */
  riwayat: ReturPembeliRingkas[];
};

/** Untuk rincian nota di backoffice: barang yang dikembalikan pembeli, per baris dan per laporan. */
export async function kembaliPerNota(spgSaleId: string): Promise<KembaliPerNota> {
  const [baris, riwayat] = await Promise.all([
    prisma.spgSaleLine.findMany({
      where: { spgSaleId },
      orderBy: { productName: "asc" },
      select: { id: true, productName: true, variantSku: true, qty: true, returnedQty: true },
    }),
    prisma.spgSaleReturn.findMany({
      where: { spgSaleId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        createdById: true,
        reason: true,
        status: true,
        decidedById: true,
        decidedAt: true,
        rejectReason: true,
        refundedAt: true,
        refundMarkedById: true,
        lines: { select: { qty: true, condition: true, saleLine: { select: { productName: true, variantSku: true } } } },
      },
    }),
  ]);
  const menunggu = await qtyMenungguPerBaris(
    prisma,
    baris.map((b) => b.id),
  );
  const idOrang = [...new Set(riwayat.flatMap((r) => [r.createdById, r.decidedById]).filter((x): x is string => Boolean(x)))];
  const orang = idOrang.length
    ? await prisma.user.findMany({ where: { id: { in: idOrang } }, select: { id: true, name: true, email: true } })
    : [];
  const nama = new Map(orang.map((o) => [o.id, namaOrang(o)]));
  return {
    perBaris: baris.map((b) => ({
      saleLineId: b.id,
      productName: b.productName,
      variantSku: b.variantSku,
      qty: b.qty,
      returnedQty: b.returnedQty,
      menunggu: menunggu.get(b.id) ?? 0,
    })),
    riwayat: riwayat.map((r): ReturPembeliRingkas => {
      const status = bacaStatusReturPembeli(r.status) ?? "MENUNGGU";
      return {
        id: r.id,
        waktu: r.createdAt.toISOString(),
        alasan: r.reason,
        oleh: nama.get(r.createdById) ?? "—",
        status,
        uang: keadaanUangRetur({ status, uangTercatat: uangReturTercatat(r) }),
        diputuskanOleh: r.decidedById ? (nama.get(r.decidedById) ?? "—") : null,
        diputuskanPada: r.decidedAt ? r.decidedAt.toISOString() : null,
        alasanTolak: r.rejectReason,
        baris: r.lines.map((l) => ({
          productName: l.saleLine.productName,
          variantSku: l.saleLine.variantSku,
          qty: l.qty,
          condition: l.condition,
        })),
      };
    }),
  };
}
