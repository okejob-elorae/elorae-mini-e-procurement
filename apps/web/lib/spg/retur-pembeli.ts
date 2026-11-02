import { Prisma, prisma, sqlId, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { capNotificationText } from "@/lib/notifications/text";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { kabariTitipanTersedia } from "./titip-tersedia";
import { kunciBaris } from "./stok";
import { terhitungSesudah } from "./opname-hitung";
import { RETUR_PEMBELI_BERLAKU, qtyMenungguPerBaris } from "./retur-pembeli-berlaku";
import {
  BATAS_ALASAN_RETUR_PEMBELI,
  ENTITAS_RETUR_PEMBELI,
  KATEGORI_NOTIF_RETUR_PEMBELI,
  bacaStatusReturPembeli,
  sisaReturPembeli,
  type StatusReturPembeli,
} from "./retur-pembeli-status";

/**
 * Barang kembali dari pembeli di counter SPG (`SpgSaleReturn`).
 *
 * Keputusan pemilik 2026-11-02: pembeli mestinya tidak mengembalikan barang ke
 * toko atau SPG; kalau terjadi, SPG MELAPORKANNYA dan laporan itu menunggu
 * konfirmasi kantor dulu. Jadi ada dua langkah:
 *
 * 1. LAPOR (`catatReturPembeli`, dari HP — langsung atau lewat antrean tanpa
 *    sinyal): satu `SpgSaleReturn` berstatus MENUNGGU + barisnya, jejak
 *    `SPG_SALE_RETURN_REPORTED`, dan lonceng kantor `RETUR_PEMBELI_MENUNGGU` ke
 *    pemegang `spg_returns:approve`. TIDAK ADA yang lain bergerak: buku stok
 *    toko, `SpgSaleLine.returnedQty`, `SalesHistory`, komisi, laporan
 *    konsinyasi — semuanya tetap seperti sebelum retur.
 * 2. PUTUSKAN (kantor, `spg_returns:approve`; bawaannya admin dan Admin
 *    Penjualan): `setujuiReturPembeli` menerapkan PERSIS yang dulu diterapkan
 *    saat mencatat —
 *    - `SpgSaleLine.returnedQty` naik (kolom ini = yang kembali DAN disetujui);
 *    - buku stok toko `RETUR_PEMBELI` +qty, HANYA barang LAYAK — itulah yang
 *      kembali ke rak; barang rusak tercatat di dokumennya, tidak di rak;
 *    - `SalesHistory` nota itu: `returnedQuantity` naik, `netQuantity` turun,
 *      untuk setiap kondisi;
 *    - jejak di transaksi yang sama.
 *    `tolakReturPembeli` (alasan wajib, dikirim ke HP SPG) dan
 *    `tarikReturPembeli` (SPG pelapor, selama masih menunggu) tidak menerapkan
 *    apa pun. Ketiganya final.
 *
 * Pengaruh yang disetujui bertanggal saat DILAPORKAN (`createdAt`), tidak
 * pernah saat disetujui — lihat `./retur-pembeli-berlaku`. Barang yang sudah
 * dihitung opname toko SESUDAH dilaporkan tidak ditambahkan lagi ke buku saat
 * disetujui: opname itu sudah melihatnya di rak.
 *
 * Yang masih menunggu ikut mengurangi yang bisa dilaporkan dari baris nota
 * (`qtyMenungguPerBaris`), jadi potong yang sama tidak bisa dilaporkan dua kali;
 * laporan yang ditolak atau ditarik melepasnya lagi.
 *
 * Penjaga balapan: setiap penulis (lapor, setujui, tolak, tarik) mengunci baris
 * `SpgSale` notanya `FOR UPDATE` SEBELUM membaca apa pun dari nota atau
 * laporannya, di dalam `runSerializable`; keputusan juga memakai
 * compare-and-swap status MENUNGGU. Tidak ada yang memutuskan laporan yang ia
 * buat sendiri, admin juga tidak (`PELAPOR_SAMA`).
 *
 * Uangnya dikembalikan KASIR TOKO, jadi tidak ada satu angka uang pun yang
 * dicatat di sini. Toko ditetapkan pemanggil dari `User.assignedStoreId`, tidak
 * pernah dari HP; hanya nota milik SPG itu sendiri di toko itu yang bisa diretur.
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
  | "KUNCI_WAJIB";

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
   * bukunya juga — karena itulah saat pembeli mengembalikannya.
   */
  waktuTangkap?: Date | null;
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

/* ------------------------------------------------------------------ lapor */

type HasilLaporTx =
  | { ok: true; returnId: string; ulang: boolean; notifikasi: AdminNotification | null }
  | { ok: false; alasan: AlasanTolakReturPembeli };

export async function catatReturPembeli(input: InputReturPembeli): Promise<HasilReturPembeli> {
  const kunci = input.idempotencyKey?.trim();
  if (!kunci) return { ok: false, alasan: "KUNCI_WAJIB" };

  // Lonceng kantor dibuat DI DALAM transaksi; yang disebar hanya milik percobaan
  // yang tersimpan — nilai kembalian `runSerializable`, bukan percobaan yang diulang.
  const simpan = () => runSerializable((tx) => catatReturPembeliTx(tx, input, kunci));
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

  // Kiriman ulang dikenali PALING DULU di antara pemeriksaan — sebelum memeriksa
  // sisa, karena kiriman pertamanya sendiri sudah memakai sisa itu. Statusnya
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
  const menunggu = await qtyMenungguPerBaris(tx, [...mintaPerBaris.keys()]);
  for (const [id, minta] of mintaPerBaris) {
    const l = perId.get(id)!;
    if (minta > sisaReturPembeli({ qty: l.qty, returnedQty: l.returnedQty, menunggu: menunggu.get(id) ?? 0 })) {
      return { ok: false, alasan: "MELEBIHI_SISA" };
    }
  }

  // Retur tidak pernah mendahului notanya sendiri, walau jam HP salah.
  const waktu = input.waktuTangkap ? new Date(Math.max(input.waktuTangkap.getTime(), nota.createdAt.getTime())) : null;

  const retur = await tx.spgSaleReturn.create({
    data: {
      ...(waktu ? { createdAt: waktu } : {}),
      spgSaleId: nota.id,
      storeId: input.storeId,
      createdById: input.userId,
      reason: alasan,
      idempotencyKey: kunci,
      // Selalu ditulis: isian bawaan kolomnya DISETUJUI (baris lama dan image lama di jendela penerapan).
      status: "MENUNGGU",
      decidedById: null,
      decidedAt: null,
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
        `Alasan pembeli: ${alasan}. Setujui atau tolak di SPG → Retur pembeli.`,
      metadata: { returnId: retur.id, spgSaleId: nota.id, storeId: input.storeId, pcs },
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
      },
    },
    metadata: {
      spgSaleId: nota.id,
      docNo: nota.docNo,
      storeId: input.storeId,
      baris: rapi.baris.map((b) => ({ ...b, productName: perId.get(b.saleLineId)!.productName })),
      luring: waktu !== null,
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
  | "MELEBIHI_SISA";

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
  lines: { select: { id: true, spgSaleLineId: true, itemId: true, variantSku: true, qty: true, condition: true } },
  spgSale: {
    select: {
      docNo: true,
      lines: {
        select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, returnedQty: true, item: { select: { sku: true } } },
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
 * Compare-and-swap status MENUNGGU → keputusan. Hanya sah di dalam
 * `runSerializable` (Prisma `updateMany` sendiri bukan compare-and-swap).
 */
async function putuskanStatus(
  tx: Prisma.TransactionClient,
  returnId: string,
  data: { status: "DISETUJUI" | "DITOLAK" | "DIBATALKAN"; decidedById: string; decidedAt: Date; rejectReason?: string },
): Promise<boolean> {
  const ubah = await tx.spgSaleReturn.updateMany({ where: { id: returnId, status: "MENUNGGU" }, data });
  return ubah.count === 1;
}

/** Alasan menolak/menarik: wajib, paling banyak `BATAS_ALASAN_RETUR_PEMBELI` huruf. Diperiksa sebelum transaksi. */
function periksaAlasanPutusan(alasan: unknown): { ok: true; alasan: string } | { ok: false; alasan: "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" } {
  const teks = typeof alasan === "string" ? alasan.trim() : "";
  if (!teks) return { ok: false, alasan: "ALASAN_WAJIB" };
  if (Array.from(teks).length > BATAS_ALASAN_RETUR_PEMBELI) return { ok: false, alasan: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, alasan: teks };
}

const pcsLaporan = (r: { lines: { qty: number }[] }) => r.lines.reduce((s, l) => s + l.qty, 0);

/**
 * Kantor menyetujui laporan: baru sekarang retur berpengaruh — persis yang dulu
 * diterapkan saat mencatat, bertanggal saat DILAPORKAN. Jumlah yang boleh
 * kembali diperiksa ulang (sudah kembali + laporan ini ≤ terjual). Persetujuan
 * kedua atas laporan yang sama tidak menerapkan apa pun (`SUDAH_DIPUTUSKAN`).
 *
 * Bulan laporannya yang sudah dicek (komisi putus) atau sudah dikunci (siklus
 * konsi) tidak menghalangi: angka yang tersimpan tidak berubah, hitungan
 * ulangnya yang turun, dan koreksi komisi menyusul di pembayaran berikutnya.
 */
export async function setujuiReturPembeli(input: { returnId: string; olehUserId: string; sekarang?: Date }): Promise<HasilPutusanReturPembeli> {
  const spgSaleId = await notaLaporan(input.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = input.sekarang ?? new Date();

  type Setuju =
    | { ok: true; returnId: string; docNo: string; storeId: string; pelaporId: string; pcs: number; bukuDitulis: number }
    | { ok: false; alasan: AlasanTolakPutusanReturPembeli };

  const hasil = await runSerializable(async (tx): Promise<Setuju> => {
    const r = await bacaLaporanTerkunci(tx, input.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.status !== "MENUNGGU") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (r.createdById === input.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };

    const perId = new Map(r.spgSale.lines.map((l) => [l.id, l]));
    const mintaPerBaris = new Map<string, number>();
    for (const b of r.lines) mintaPerBaris.set(b.spgSaleLineId, (mintaPerBaris.get(b.spgSaleLineId) ?? 0) + b.qty);
    for (const [id, minta] of mintaPerBaris) {
      const l = perId.get(id);
      // Baris nota yang hilang, atau sudah kembali penuh lewat jalur lain: tidak bisa diterapkan.
      if (!l || l.returnedQty + minta > l.qty) return { ok: false, alasan: "MELEBIHI_SISA" };
    }

    // Sampai sini belum ada yang ditulis. Penjaga keadaan dulu, baru pengaruhnya.
    if (!(await putuskanStatus(tx, r.id, { status: "DISETUJUI", decidedById: input.olehUserId, decidedAt: sekarang }))) {
      return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    }

    // Naik hanya dari angka yang baru dibaca. Selisih di sini berarti penulis
    // lain menyelip: LEMPAR (bukan `return` — status sudah ditulis) supaya
    // seluruh transaksi diulang dengan bacaan baru.
    for (const [id, minta] of mintaPerBaris) {
      const l = perId.get(id)!;
      const ubah = await tx.spgSaleLine.updateMany({
        where: { id, returnedQty: l.returnedQty },
        data: { returnedQty: { increment: minta } },
      });
      if (ubah.count !== 1) {
        throw new Prisma.PrismaClientKnownRequestError("returnedQty berubah", { code: "P2034", clientVersion: "retur-pembeli" });
      }
    }

    // Buku stok toko: hanya barang LAYAK, bertanggal saat dilaporkan. Barang
    // yang sudah DIHITUNG opname toko sesudah dilaporkan sudah terlihat di rak.
    // Per waktu hitung BARIS, bukan waktu opname disimpan: retur sesudah barang
    // dihitung tapi sebelum opname disimpan tetap kembali ke buku.
    const layak = r.lines.filter((b) => b.condition === "LAYAK" && b.qty > 0);
    const sudahDihitung = layak.length
      ? await terhitungSesudah(tx, r.storeId, [...new Set(layak.map((b) => b.itemId))], r.createdAt)
      : new Set<string>();
    const keRak = layak.filter((b) => !sudahDihitung.has(kunciBaris(b.itemId, b.variantSku)));
    if (keRak.length) {
      await tx.storeStockMovement.createMany({
        data: keRak.map((b) => ({
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
    for (const [id, minta] of mintaPerBaris) {
      const l = perId.get(id)!;
      const ubah = await tx.salesHistory.updateMany({
        where: { channel: "OFFLINE", orderId: r.spgSale.docNo, variantSku: l.variantSku || l.item.sku },
        data: { returnedQuantity: { increment: minta }, netQuantity: { decrement: minta } },
      });
      if (ubah.count === 0) riwayatTakDitemukan += 1;
    }

    const bukuDitulis = keRak.reduce((s, b) => s + b.qty, 0);
    const bukuDilewati = layak.reduce((s, b) => s + b.qty, 0) - bukuDitulis;
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_PEMBELI_DISETUJUI,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: {
        before: {
          status: "MENUNGGU",
          returnedQty: Object.fromEntries([...mintaPerBaris.keys()].map((id) => [id, perId.get(id)!.returnedQty])),
        },
        after: {
          status: "DISETUJUI",
          returnedQty: Object.fromEntries([...mintaPerBaris.entries()].map(([id, minta]) => [id, perId.get(id)!.returnedQty + minta])),
        },
      },
      metadata: {
        spgSaleId: r.spgSaleId,
        docNo: r.spgSale.docNo,
        storeId: r.storeId,
        bukuDitulis,
        bukuDilewati,
        ...(riwayatTakDitemukan > 0 ? { riwayatTakDitemukan } : {}),
      },
    });

    return { ok: true, returnId: r.id, docNo: r.spgSale.docNo, storeId: r.storeId, pelaporId: r.createdById, pcs: pcsLaporan(r), bukuDitulis };
  });

  if (!hasil.ok) return hasil;
  // Barang LAYAK yang kembali ke rak bisa jadi yang sedang dititip-pesankan pembeli lain.
  if (hasil.bukuDitulis > 0) void kabariTitipanTersedia(hasil.storeId);
  void kabariPengguna(hasil.pelaporId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DISETUJUI,
    judul: "Retur pembeli disetujui",
    isi: `Nota ${hasil.docNo}: ${hasil.pcs} potong disetujui kantor. Stok toko, penjualan bersih, dan komisi sudah memperhitungkannya.`,
    data: { returnId: hasil.returnId, spgSaleId },
  });
  return { ok: true, returnId: hasil.returnId, spgSaleId, status: "DISETUJUI" };
}

/** Kantor menolak laporan, dengan alasan (dikirim ke HP SPG). Tidak ada yang bergerak. */
export async function tolakReturPembeli(input: {
  returnId: string;
  olehUserId: string;
  alasan: string;
  sekarang?: Date;
}): Promise<HasilPutusanReturPembeli> {
  const cek = periksaAlasanPutusan(input.alasan);
  if (!cek.ok) return cek;
  const spgSaleId = await notaLaporan(input.returnId);
  if (!spgSaleId) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  const sekarang = input.sekarang ?? new Date();

  type Tolak = { ok: true; docNo: string; pelaporId: string; pcs: number } | { ok: false; alasan: AlasanTolakPutusanReturPembeli };
  const hasil = await runSerializable(async (tx): Promise<Tolak> => {
    const r = await bacaLaporanTerkunci(tx, input.returnId, spgSaleId);
    if (!r) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (r.status !== "MENUNGGU") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    if (r.createdById === input.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };
    const diputuskan = await putuskanStatus(tx, r.id, {
      status: "DITOLAK",
      decidedById: input.olehUserId,
      decidedAt: sekarang,
      rejectReason: cek.alasan,
    });
    if (!diputuskan) return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_PEMBELI_DITOLAK,
      entityType: ENTITAS_RETUR_PEMBELI,
      entityId: r.id,
      changes: { before: { status: "MENUNGGU" }, after: { status: "DITOLAK", rejectReason: cek.alasan } },
      metadata: { spgSaleId: r.spgSaleId, docNo: r.spgSale.docNo, storeId: r.storeId, pcs: pcsLaporan(r) },
      reason: cek.alasan,
    });
    return { ok: true, docNo: r.spgSale.docNo, pelaporId: r.createdById, pcs: pcsLaporan(r) };
  });

  if (!hasil.ok) return hasil;
  void kabariPengguna(hasil.pelaporId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DITOLAK,
    judul: "Retur pembeli ditolak",
    isi: `Nota ${hasil.docNo}: ${hasil.pcs} potong ditolak kantor. Alasan: ${cek.alasan}`,
    data: { returnId: input.returnId, spgSaleId },
  });
  return { ok: true, returnId: input.returnId, spgSaleId, status: "DITOLAK" };
}

/**
 * SPG menarik laporannya sendiri selama masih menunggu, dengan alasan —
 * misalnya salah catat. Hanya pelapornya, dan hanya untuk laporan di toko
 * tetapnya SEKARANG (`storeId` dari server). Tidak ada yang bergerak; potongnya
 * bisa dilaporkan ulang dari nota. Tanpa kabar (SPG sendiri yang menarik).
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
    const ditarik = await putuskanStatus(tx, r.id, {
      status: "DIBATALKAN",
      decidedById: input.userId,
      decidedAt: sekarang,
      rejectReason: cek.alasan,
    });
    if (!ditarik) return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
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
  /** Yang masih bisa dilaporkan: qty − returnedQty − menunggu. */
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
  const menunggu = await qtyMenungguPerBaris(
    prisma,
    n.lines.map((l) => l.id),
  );
  const baris = n.lines.map((l): BarisNotaKembali => {
    const m = menunggu.get(l.id) ?? 0;
    return {
      saleLineId: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      returnedQty: l.returnedQty,
      menunggu: m,
      sisa: sisaReturPembeli({ qty: l.qty, returnedQty: l.returnedQty, menunggu: m }),
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
  diputuskanOleh: string | null;
  /** ISO, atau null (baris lama, atau masih menunggu). */
  diputuskanPada: string | null;
  /** Alasan kantor menolak (DITOLAK), atau alasan SPG menarik (DIBATALKAN). */
  alasanTolak: string | null;
  /** Baris lama: berlaku langsung saat dicatat, sebelum persetujuan kantor ada. */
  langsungBerlaku: boolean;
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
      const status = bacaStatusReturPembeli(r.status) ?? "DISETUJUI";
      return {
        id: r.id,
        waktu: r.createdAt.toISOString(),
        alasan: r.reason,
        oleh: nama.get(r.createdById) ?? "—",
        status,
        diputuskanOleh: r.decidedById ? (nama.get(r.decidedById) ?? "—") : null,
        diputuskanPada: r.decidedAt ? r.decidedAt.toISOString() : null,
        alasanTolak: r.rejectReason,
        langsungBerlaku: status === "DISETUJUI" && r.decidedAt === null,
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
