import { Prisma, prisma, transferKonsiStock, type KonsiTransferShortLine } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { denganNomorUnik } from '@/lib/receivables/nomor';
import { bagiKomisi } from './aturan';
import { catatJejak, JEJAK, type IsiJejak } from '@/lib/receivables/jejak';
import { endOfTodayJakarta, formatDateOnlyJakarta } from "@/lib/date-only";
import { keSen } from "./promo-elorae";
import { ringkasanBayarToko, totalTagihanBeku } from "./queries";
import { bebanHilangUntukSiklus, lepasBebanHilangSiklus } from "@/lib/spg/hilang-tagihan";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { lepasPotonganHilang, potongBebanHilang } from "@/lib/spg/hilang-potong";
import { promoEloraeSiklus } from "./promo-elorae-queries";
import { labelVarian } from "./varian-kirim";

/**
 * Penulis siklus konsinyasi.
 *
 * Yang dijaga paling ketat: ANGKA RESMI. Setelah dikunci, ia dipakai menagih
 * toko, membayar komisi, dan mengurangi stok titipan — tiga hal yang tidak bisa
 * ditarik kembali begitu saja.
 */

type Klien = Prisma.TransactionClient;
const angka = (v: unknown): number => Number(v ?? 0);
const D = (n: number) => new Prisma.Decimal(n);

export type BarisKirim = {
  itemId?: string | null;
  /**
   * Varian barang katalog. Wajib bila barangnya punya lebih dari satu baris stok gudang
   * (stok barang bervarian disimpan per varian); kosong untuk barang tanpa varian.
   */
  variantSku?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type BarisLaporan = { itemId?: string | null; itemName: string; qty: number };

export type BarisResmi = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type AlasanGagalKonsi =
  | 'TIDAK_DITEMUKAN'
  | 'TOKO_BUKAN_KONSI'
  | 'SIKLUS_SUDAH_ADA'
  | 'PERIODE_TIDAK_VALID'
  | 'SUDAH_DIKUNCI'
  | 'BELUM_DIKUNCI'
  | 'LAPORAN_BELUM_LENGKAP'
  | 'ADA_GAJI_SUDAH_DIBAYAR'
  | 'TANPA_BARIS'
  | 'NILAI_TIDAK_VALID'
  | 'NOMOR_WAJIB'
  | 'SUDAH_DIBAYAR'
  | 'NOMOR_BENTROK'
  | "ADA_NOTA"
  | "ADA_FAKTUR_PAJAK"
  | "ADA_PEMBAYARAN_TOKO"
  | "MELEBIHI_SISA"
  | "CARA_BAYAR_TIDAK_VALID"
  | "TANGGAL_TIDAK_VALID"
  | "TANGGAL_DI_DEPAN"
  | "ALASAN_WAJIB"
  | "SUDAH_DIBATALKAN"
  | "PEMBAYARAN_TIDAK_DITEMUKAN"
  | "STOK_KURANG"
  | "VARIAN_WAJIB";

type Gagal = { ok: false; alasan: AlasanGagalKonsi };

/**
 * Satu barang/varian yang stok gudangnya tidak cukup untuk kiriman titipan. Baris kiriman
 * dengan barang & varian yang sama DIJUMLAH: yang ditampilkan adalah seluruh permintaan
 * kiriman itu atas varian tersebut, dibanding stok tersedia (stok − cadangan) sebelum dikirim.
 */
export type BarisKurangKirim = KonsiTransferShortLine & { itemName: string; variantLabel: string | null };

/**
 * Stok gudang tidak cukup untuk satu baris kiriman. Dilempar DI DALAM transaksi supaya kiriman
 * yang sudah dibuat dan baris lain yang sudah terpotong ikut batal — kiriman separuh bukan kiriman.
 */
class StokGudangKurang extends Error {
  constructor(readonly kurang: BarisKurangKirim[]) {
    super('STOK_KURANG');
    this.name = 'StokGudangKurang';
  }
}

/** Kunci stok satu baris kiriman: barang + varian ("" = tanpa varian). */
const kunciStok = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/** Batas umur jejak yang diperiksa untuk kunci kiriman: kiriman ulang terjadi dalam hitungan menit. */
const UMUR_KUNCI_KIRIM_MS = 14 * 86_400_000;

/**
 * Kiriman titipan yang sudah dicatat dengan kunci formulir ini, oleh orang yang sama.
 *
 * Tanpa kolom baru: kuncinya ikut di metadata jejak `KONSI_DIKIRIM` (pola yang sama dengan
 * kunci kirim mutasi toko), dicocokkan di JS karena penyaringan jalur JSON tidak andal di
 * semua adaptor. Dibaca di dalam `runSerializable`: dua klik bersamaan sama-sama membaca
 * "belum ada" lalu sama-sama menulis jejak — basis data menolak salah satunya, dan percobaan
 * ulangnya menemukan kiriman pemenang di sini.
 *
 * Kiriman ulang = kunci yang sama KE TOKO YANG SAMA. Formulir hanya mengganti kuncinya sesudah
 * simpan berhasil, jadi sesudah jawaban hilang admin bisa mengganti tokonya lalu menyimpan lagi
 * dengan kunci lama. Itu kiriman lain (barangnya ke toko lain): tanpa syarat toko, kiriman ke
 * toko kedua tertelan sebagai "sudah tercatat" dengan nomor kiriman toko pertama, dan barang
 * yang benar-benar berangkat ke toko kedua tidak pernah tercatat.
 */
async function kirimanDenganKunci(
  db: Klien | typeof prisma,
  kunci: string,
  olehUserId: string,
  storeId: string,
): Promise<{ id: string; noKirim: string } | null> {
  const jejak = await db.auditLog.findMany({
    where: {
      userId: olehUserId,
      action: JEJAK.KONSI_DIKIRIM,
      entityType: 'ConsignmentShipment',
      createdAt: { gte: new Date(Date.now() - UMUR_KUNCI_KIRIM_MS) },
    },
    select: { entityId: true, metadata: true },
  });
  const ids = jejak
    .filter((j) => (j.metadata as { kunciKirim?: unknown } | null)?.kunciKirim === kunci)
    .map((j) => j.entityId);
  if (ids.length === 0) return null;
  return db.consignmentShipment.findFirst({
    where: { id: { in: ids }, storeId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, noKirim: true },
  });
}

/** Baris stok yang akan dipotong untuk satu kunci — kueri yang sama dengan `transferKonsiStock`. */
function barisStokKirim(tx: Klien, itemId: string, variantSku: string) {
  return variantSku === ''
    ? tx.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: '' }] } })
    : tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
}

/** Label varian dari katalog barang untuk rincian kurang stok. */
async function lengkapiKurang(
  tx: Klien,
  kurang: KonsiTransferShortLine[],
  namaPerKunci: Map<string, string>,
): Promise<BarisKurangKirim[]> {
  const barang = await tx.item.findMany({
    where: { id: { in: [...new Set(kurang.map((k) => k.itemId))] } },
    select: { id: true, variants: true },
  });
  const varianPerBarang = new Map(barang.map((b) => [b.id, b.variants]));
  return kurang.map((k) => ({
    ...k,
    itemName: namaPerKunci.get(kunciStok(k.itemId, k.variantSku)) ?? '',
    variantLabel: labelVarian(varianPerBarang.get(k.itemId) ?? null, k.variantSku),
  }));
}

/** `KONSI/26/07/0002` — dinomori menurut periode siklusnya, bukan hari dibuat. */
async function nomorKonsi(tx: Klien, tahun: number, bulan: number): Promise<string> {
  const depan = `KONSI/${String(tahun).slice(-2)}/${String(bulan).padStart(2, '0')}/`;
  const terakhir = await tx.consignmentCycle.findFirst({
    where: { noKonsi: { startsWith: depan } },
    orderBy: { noKonsi: 'desc' },
    select: { noKonsi: true },
  });
  const urutan = terakhir ? Number(terakhir.noKonsi.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/** Buka siklus untuk satu toko konsinyasi pada satu bulan. */
export async function bukaSiklus(input: {
  storeId: string;
  periodYear: number;
  periodMonth: number;
  olehUserId: string;
  spgDueDate?: Date | null;
}): Promise<{ ok: true; id: string; noKonsi: string } | Gagal> {
  if (input.periodMonth < 1 || input.periodMonth > 12 || input.periodYear < 2000) {
    return { ok: false, alasan: 'PERIODE_TIDAK_VALID' };
  }

  try {
    return await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        const toko = await tx.store.findUnique({
          where: { id: input.storeId },
          select: { id: true, termsType: true },
        });
        if (!toko) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
        // Siklus konsinyasi hanya berarti untuk toko konsinyasi. Membukanya untuk
        // toko putus akan menghitung "stok titipan" atas barang yang sudah dijual.
        if (toko.termsType !== 'KONSI') {
          return { ok: false as const, alasan: 'TOKO_BUKAN_KONSI' as const };
        }

        const siklus = await tx.consignmentCycle.create({
          data: {
            noKonsi: await nomorKonsi(tx, input.periodYear, input.periodMonth),
            storeId: input.storeId,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            spgDueDate: input.spgDueDate ?? null,
          },
          select: { id: true, noKonsi: true },
        });

        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.KONSI_DIBUKA,
          entityType: 'ConsignmentCycle',
          entityId: siklus.id,
          changes: {
            after: {
              noKonsi: siklus.noKonsi,
              storeId: input.storeId,
              periode: `${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`,
            },
          },
        });

        return { ok: true as const, id: siklus.id, noKonsi: siklus.noKonsi };
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      /*
       * Yang sampai ke sini pasti kunci (toko, tahun, bulan) — bentrok `noKonsi`
       * sudah diulang oleh `denganNomorUnik` di atas. Sebelum pengulangan itu
       * ada, dua penyimpanan bersamaan dilaporkan sebagai "siklus bulan ini
       * sudah ada", padahal belum: yang bentrok hanya nomornya.
       *
       * Dua siklus untuk bulan yang sama akan memecah angka terjual dan setiap
       * total di bawahnya diam-diam separuh.
       */
      return { ok: false, alasan: 'SIKLUS_SUDAH_ADA' };
    }
    throw err;
  }
}

/**
 * Kirim barang titipan ke toko.
 *
 * Toko konsinyasi = gudang lain milik kita (keputusan pemilik): barang yang dikirim KELUAR dari
 * stok gudang utama di transaksi yang sama (`KONSI_TRANSFER`, satu penyesuaian per baris, kunci
 * idempotensi per baris kiriman) dan menjadi stok toko (titipan / buku toko). Kembali ke gudang
 * hanya lewat retur (NRI); penjualan di toko tidak pernah menyentuh gudang utama.
 *
 * - `idempotencyKey` dibuat formulir SEKALI per isian dan diperiksa PALING DULU — sebelum
 *   validasi apa pun, lalu sekali lagi di dalam transaksi. Klik ganda atau kiriman ulang
 *   sesudah jawaban hilang mendapat kiriman yang sama (`ulang: true`): satu kiriman, satu
 *   potongan stok. Kunci yang pernah DITOLAK boleh dipakai lagi — tidak ada yang tersimpan.
 * - Baris yang hanya diketik namanya (tanpa `itemId`) tercatat di kiriman tapi tidak
 *   menggerakkan stok — tidak ada baris gudang yang bisa dipotong.
 * - Barang dengan lebih dari satu baris stok (bervarian) wajib menyebut variannya
 *   (`VARIAN_WAJIB`); barang dengan tepat satu baris stok memakai baris itu.
 * - Stok tersedia (stok − cadangan) kurang untuk satu barang/varian saja = seluruh kiriman
 *   ditolak (`STOK_KURANG`) dengan rinciannya (`kurang`, baris sama dijumlah); tidak ada yang
 *   tersimpan.
 * - `barangBerubah`: barang yang stok gudangnya bergerak, untuk push stok Jubelio SESUDAH commit.
 */
export type HasilKirimTitipan =
  | { ok: true; id: string; noKirim: string; ulang: boolean; barangBerubah: string[] }
  | Gagal
  | { ok: false; alasan: 'STOK_KURANG'; kurang: BarisKurangKirim[] };

export async function kirimTitipan(input: {
  storeId: string;
  olehUserId: string;
  cycleId?: string | null;
  shippedAt: Date;
  items: BarisKirim[];
  note?: string | null;
  idempotencyKey?: string | null;
}): Promise<HasilKirimTitipan> {
  const kunci = input.idempotencyKey?.trim() || null;
  // Kiriman pertama sudah sah dan stoknya sudah terpotong: memvalidasi ulang kiriman ulangnya
  // akan menolaknya dengan alasan palsu ("stok kurang") padahal barangnya sudah jalan.
  if (kunci) {
    const lama = await kirimanDenganKunci(prisma, kunci, input.olehUserId, input.storeId);
    if (lama) return { ok: true, id: lama.id, noKirim: lama.noKirim, ulang: true, barangBerubah: [] };
  }

  const items = input.items.filter((b) => b.itemName.trim() && b.qty > 0);
  if (items.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };

  try {
    return await denganNomorUnik(() =>
      runSerializable(async (tx): Promise<HasilKirimTitipan> => {
        // Lagi, di dalam transaksi: percobaan ulang sesudah balapan dua klik (yang kalah diulang
        // runSerializable / denganNomorUnik) harus mendapat kiriman pemenangnya.
        if (kunci) {
          const lama = await kirimanDenganKunci(tx, kunci, input.olehUserId, input.storeId);
          if (lama) return { ok: true, id: lama.id, noKirim: lama.noKirim, ulang: true, barangBerubah: [] };
        }

        // Titipan hanya dihitung untuk toko KONSI (stok-di-toko.ts). Kiriman ke toko lain akan
        // mengeluarkan barang dari gudang tanpa pernah tercatat di stok toko mana pun.
        const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { termsType: true } });
        if (!toko || toko.termsType !== 'KONSI') return { ok: false, alasan: 'TOKO_BUKAN_KONSI' };

        // Varian per baris DULU, sebelum menulis apa pun: penolakan di sini tidak bergantung
        // pada pembatalan transaksi.
        const varian: string[] = [];
        for (const b of items) {
          const diminta = b.variantSku?.trim() ?? '';
          if (!b.itemId || diminta) {
            varian.push(diminta);
            continue;
          }
          const baris = await tx.inventoryValue.findMany({ where: { itemId: b.itemId }, select: { variantSku: true } });
          // null dan "" sama-sama baris tanpa varian (lihat findFieldSalesInventory).
          const kunciBaris = [...new Set(baris.map((r) => r.variantSku ?? ''))];
          if (kunciBaris.length > 1) return { ok: false, alasan: 'VARIAN_WAJIB' };
          varian.push(kunciBaris[0] ?? '');
        }

        // Permintaan per barang/varian DIJUMLAH dan dibandingkan dengan stok tersedia sebelum
        // menulis apa pun, supaya rincian kurangnya utuh ("M: diminta 16, tersedia 12"), bukan
        // sisa sesudah baris pertama terpotong.
        const minta = new Map<string, { itemId: string; variantSku: string; qty: number }>();
        const nama = new Map<string, string>();
        items.forEach((b, i) => {
          if (!b.itemId) return;
          const k = kunciStok(b.itemId, varian[i]);
          const ada = minta.get(k);
          if (ada) ada.qty += b.qty;
          else minta.set(k, { itemId: b.itemId, variantSku: varian[i], qty: b.qty });
          if (!nama.has(k)) nama.set(k, b.itemName.trim());
        });
        const kurang: KonsiTransferShortLine[] = [];
        for (const m of minta.values()) {
          const inv = await barisStokKirim(tx, m.itemId, m.variantSku);
          const tersedia = inv ? angka(inv.qtyOnHand) - angka(inv.reservedQty) : 0;
          if (tersedia < m.qty) kurang.push({ itemId: m.itemId, variantSku: m.variantSku, requested: m.qty, available: tersedia });
        }
        if (kurang.length > 0) return { ok: false, alasan: 'STOK_KURANG', kurang: await lengkapiKurang(tx, kurang, nama) };

        // Tahun WIB, bukan tahun zona proses: prod berjalan UTC, dan kiriman 1 Januari (tengah
        // malam WIB = 31 Desember UTC) akan bernomor tahun sebelumnya.
        const depan = `KKIRIM/${formatDateOnlyJakarta(input.shippedAt).slice(0, 4)}/`;
        const terakhir = await tx.consignmentShipment.findFirst({
          where: { noKirim: { startsWith: depan } },
          orderBy: { noKirim: 'desc' },
          select: { noKirim: true },
        });
        const urutan = terakhir ? Number(terakhir.noKirim.slice(depan.length)) + 1 : 1;

        const kirim = await tx.consignmentShipment.create({
          data: {
            noKirim: `${depan}${String(urutan).padStart(4, '0')}`,
            storeId: input.storeId,
            cycleId: input.cycleId ?? null,
            shippedAt: input.shippedAt,
            note: input.note?.trim() || null,
            items: {
              create: items.map((b, i) => ({
                itemId: b.itemId ?? null,
                variantSku: b.itemId && varian[i] ? varian[i] : null,
                itemName: b.itemName.trim(),
                qty: b.qty,
                price: D(b.price),
                amount: D(b.qty * b.price),
              })),
            },
          },
          select: { id: true, noKirim: true, items: { select: { id: true, itemId: true, variantSku: true, qty: true } } },
        });

        const pindah = kirim.items.flatMap((i) =>
          i.itemId
            ? [
                {
                  itemId: i.itemId,
                  variantSku: i.variantSku ?? '',
                  qty: i.qty,
                  idempotencyKey: `konsi-kirim-${i.id}`,
                  docNumber: `${kirim.noKirim}-${i.id}`,
                  reason: `Kirim titipan ${kirim.noKirim} ke toko (stok pindah ke toko)`,
                  externalRef: `konsi-kirim:${kirim.noKirim}`,
                  createdById: input.olehUserId,
                },
              ]
            : [],
        );
        // Penjaga sebenarnya tetap UPDATE bersyarat di transferKonsiStock: penulis lain bisa
        // mengambil stok di antara bacaan di atas dan pemotongan ini.
        const hasilPindah = await transferKonsiStock(tx, { lines: pindah });
        if (hasilPindah.shortLines.length > 0) {
          throw new StokGudangKurang(await lengkapiKurang(tx, hasilPindah.shortLines, nama));
        }

        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.KONSI_DIKIRIM,
          entityType: 'ConsignmentShipment',
          entityId: kirim.id,
          // Kiriman menentukan sisi "dikirim" dari stok titipan. Kiriman yang
          // salah membuat sisa titipan salah selamanya, tanpa ada yang menghitung.
          changes: {
            after: {
              noKirim: kirim.noKirim,
              storeId: input.storeId,
              nilai: items.reduce((s, b) => s + b.qty * b.price, 0),
            },
          },
          metadata: {
            jumlahBaris: items.length,
            barisStokGudang: hasilPindah.transferred,
            // Kunci formulir — tanpa kolom baru; dibaca `kirimanDenganKunci`.
            ...(kunci ? { kunciKirim: kunci } : {}),
          },
        });

        return {
          ok: true,
          id: kirim.id,
          noKirim: kirim.noKirim,
          ulang: false,
          barangBerubah: [...new Set(pindah.map((p) => p.itemId))],
        };
      }),
    );
  } catch (err) {
    if (err instanceof StokGudangKurang) return { ok: false, alasan: 'STOK_KURANG', kurang: err.kurang };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/**
 * Catat salah satu dari dua laporan.
 *
 * Boleh dicatat ulang selama angkanya belum dikunci: laporan yang salah ketik
 * harus bisa dibetulkan, dan sebelum dikunci tidak ada apa pun yang bergantung
 * padanya. Sesudah dikunci, tidak.
 */
export async function catatLaporan(input: {
  cycleId: string;
  source: 'SPG' | 'TOKO';
  reportedAt: Date;
  /** Yang mencatat laporan. Wajib — laporan tanpa pencatat tak bisa ditanyakan. */
  olehUserId: string;
  reportedById?: string | null;
  items: BarisLaporan[];
  note?: string | null;
}): Promise<{ ok: true } | Gagal> {
  const items = input.items.filter((b) => b.itemName.trim() && b.qty >= 0);
  if (items.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: { id: true, lockedAt: true },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (siklus.lockedAt) return { ok: false as const, alasan: 'SUDAH_DIKUNCI' as const };

    const lama = await tx.consignmentReport.findUnique({
      where: { cycleId_source: { cycleId: siklus.id, source: input.source } },
      select: { id: true },
    });
    if (lama) {
      await tx.consignmentReportItem.deleteMany({ where: { reportId: lama.id } });
      await tx.consignmentReport.update({
        where: { id: lama.id },
        data: {
          reportedAt: input.reportedAt,
          reportedById: input.reportedById ?? null,
          note: input.note?.trim() || null,
          items: {
            create: items.map((b) => ({
              itemId: b.itemId ?? null,
              itemName: b.itemName.trim(),
              qty: b.qty,
            })),
          },
        },
      });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONSI_LAPORAN,
        entityType: 'ConsignmentCycle',
        entityId: siklus.id,
        // Laporan boleh ditimpa selama belum dikunci. Yang lama hanya hidup
        // di sini setelah ditimpa.
        changes: { before: { source: input.source, diganti: true }, after: { items } },
        metadata: { source: input.source },
      });
      return { ok: true as const };
    }

    await tx.consignmentReport.create({
      data: {
        cycleId: siklus.id,
        source: input.source,
        reportedAt: input.reportedAt,
        reportedById: input.reportedById ?? null,
        note: input.note?.trim() || null,
        items: {
          create: items.map((b) => ({
            itemId: b.itemId ?? null,
            itemName: b.itemName.trim(),
            qty: b.qty,
          })),
        },
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_LAPORAN,
      entityType: 'ConsignmentCycle',
      entityId: siklus.id,
      changes: { after: { items } },
      metadata: { source: input.source },
    });

    return { ok: true as const };
  });
}

/**
 * Kunci angka resmi, dan hitung komisi SPG dari angka itu.
 *
 * Inilah titik tidak-bisa-kembali. Dari sini angka resminya yang menagih toko,
 * membayar komisi, dan mengurangi stok titipan — bukan salah satu laporan
 * mentahnya.
 *
 * Menuntut kedua laporan sudah masuk: mengunci dengan satu laporan berarti
 * mengunci angka yang belum pernah dibandingkan dengan apa pun.
 */
export async function kunciAngka(input: {
  cycleId: string;
  olehUserId: string;
  baris: BarisResmi[];
  gajiPokokPerSpg?: number;
}): Promise<{ ok: true; totalKomisi: number; jumlahSpg: number } | Gagal> {
  const baris = input.baris.filter((b) => b.itemName.trim() && b.qty >= 0);
  if (baris.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };
  if (baris.some((b) => b.qty < 0 || b.price < 0)) {
    return { ok: false, alasan: 'NILAI_TIDAK_VALID' };
  }

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: {
        id: true,
        noKonsi: true,
        storeId: true,
        periodYear: true,
        periodMonth: true,
        lockedAt: true,
        promoBorneByElorae: true,
        lossChargedToStore: true,
        reports: { select: { source: true } },
        commissions: { select: { id: true, spgUserId: true, total: true, deduction: true, paidAt: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (siklus.lockedAt) return { ok: false as const, alasan: 'SUDAH_DIKUNCI' as const };
    const sumber = new Set(siklus.reports.map((r) => r.source));
    if (!sumber.has('SPG') || !sumber.has('TOKO')) {
      return { ok: false as const, alasan: 'LAPORAN_BELUM_LENGKAP' as const };
    }

    // Tarif komisi diambil dari master barang saat mengunci, lalu DISALIN ke
    // baris resmi. Kalau tarifnya diubah bulan depan, komisi bulan ini tidak
    // ikut berubah — yang sudah dibayarkan harus tetap bisa dijelaskan.
    const idBarang = baris.map((b) => b.itemId).filter((x): x is string => Boolean(x));
    const tarif = new Map<string, number>();
    if (idBarang.length > 0) {
      const rows = await tx.item.findMany({
        where: { id: { in: idBarang } },
        select: { id: true, commissionPerPcs: true },
      });
      for (const r of rows) tarif.set(r.id, angka(r.commissionPerPcs));
    }

    await tx.consignmentSold.deleteMany({ where: { cycleId: siklus.id } });
    await tx.consignmentSold.createMany({
      data: baris.map((b) => ({
        cycleId: siklus.id,
        itemId: b.itemId ?? null,
        itemName: b.itemName.trim(),
        qty: b.qty,
        price: D(b.price),
        amount: D(b.qty * b.price),
        commissionPerPcs: D(b.itemId ? (tarif.get(b.itemId) ?? 0) : 0),
      })),
    });

    /*
     * SPG toko ini = pengguna yang toko tugasnya toko ini. `User` di Elorae
     * tidak punya penanda aktif, jadi tidak ada yang bisa disaring lebih jauh —
     * kalau seorang SPG berhenti, tugas tokonya harus dilepas, bukan dibiarkan
     * dan diharapkan disaring di sini.
     */
    const spg = await tx.user.findMany({
      where: { assignedStoreId: siklus.storeId },
      orderBy: { name: 'asc' },
      select: { id: true },
    });

    /*
     * Baris gaji SPG yang tidak lagi bertugas di toko ini (pindah toko, berhenti)
     * DIHAPUS — sesudah potongan barang hilangnya dilepas, di transaksi ini.
     * Kalau dibiarkan, baris itu tetap bisa dibayar dengan angka lama, dan
     * siklusnya tersangkut di "gaji SPG belum dibayar" selamanya. Baris yang
     * SUDAH dibayar tidak disentuh: uangnya sudah keluar.
     */
    const idSpg = new Set(spg.map((s) => s.id));
    const komisiDihapus: { id: string; spgUserId: string; total: number; potonganHilangDilepas: number }[] = [];
    for (const k of siklus.commissions) {
      if (idSpg.has(k.spgUserId) || k.paidAt !== null) continue;
      const dilepas = await lepasPotonganHilang(tx, { refType: REF_KOMISI_KONSI, refId: k.id, userId: input.olehUserId });
      await tx.consignmentCommission.delete({ where: { id: k.id } });
      komisiDihapus.push({ id: k.id, spgUserId: k.spgUserId, total: angka(k.total), potonganHilangDilepas: dilepas });
    }
    // Baris yang sudah dibayar (data lama: dibayar selagi kunci terbuka) dibekukan,
    // tidak dihitung ulang — angka yang sudah dibayarkan harus tetap bisa dijelaskan.
    const sudahDibayar = new Set(siklus.commissions.filter((k) => k.paidAt !== null).map((k) => k.spgUserId));

    const { totalKomisi, perSpg } = bagiKomisi(
      baris.map((b) => ({
        qty: b.qty,
        commissionPerPcs: b.itemId ? (tarif.get(b.itemId) ?? 0) : 0,
      })),
      spg.length,
    );

    /*
     * Beban barang hilang milik SPG dipotong dari gaji + komisinya DI SINI dan
     * dibekukan di `deduction` (`StockLossDeduction` dengan `refId` baris
     * gajinya), paling banyak `spg.barangHilang.maksPotongPersen` dari total —
     * sisanya dicicil di siklus berikutnya. `total` tetap gaji + komisi; yang
     * dibayarkan = `total − deduction`. Membuka kunci melepasnya lagi.
     */
    let totalPotonganHilang = 0;
    for (const [i, s] of spg.entries()) {
      if (sudahDibayar.has(s.id)) continue;
      const komisi = perSpg[i] ?? 0;
      const pokok = input.gajiPokokPerSpg ?? 0;
      const gaji = await tx.consignmentCommission.upsert({
        where: { cycleId_spgUserId: { cycleId: siklus.id, spgUserId: s.id } },
        create: {
          cycleId: siklus.id,
          spgUserId: s.id,
          baseSalary: D(pokok),
          commission: D(komisi),
          total: D(pokok + komisi),
        },
        update: {
          baseSalary: D(pokok),
          commission: D(komisi),
          total: D(pokok + komisi),
        },
        select: { id: true },
      });
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_KONSI, refId: gaji.id, userId: input.olehUserId });
      const potong = await potongBebanHilang(tx, {
        userId: s.id,
        bruto: pokok + komisi,
        refType: REF_KOMISI_KONSI,
        refId: gaji.id,
        createdById: input.olehUserId,
        note: `Gaji/komisi ${siklus.noKonsi}`,
      });
      await tx.consignmentCommission.update({ where: { id: gaji.id }, data: { deduction: D(potong) } });
      totalPotonganHilang += potong;
    }

    /*
     * Dua pengurang/penambah tagihan dibekukan DI transaksi yang sama dengan
     * angka resmi: potongan promo konter yang ditanggung Elorae (dari nota SPG
     * bulan itu — `promo-elorae.ts`) dan beban barang hilang yang ditetapkan ke
     * toko. Sesudah dikunci, nota yang menyusul tidak mengubah tagihan diam-diam;
     * membetulkannya berarti membuka kunci, dan itu meninggalkan jejak.
     */
    const promo = await promoEloraeSiklus(tx, {
      storeId: siklus.storeId,
      periodYear: siklus.periodYear,
      periodMonth: siklus.periodMonth,
    });
    const bebanHilang = await bebanHilangUntukSiklus(tx, {
      cycleId: siklus.id,
      noKonsi: siklus.noKonsi,
      storeId: siklus.storeId,
      periodYear: siklus.periodYear,
      periodMonth: siklus.periodMonth,
      userId: input.olehUserId,
    });

    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: {
        lockedAt: new Date(),
        lockedById: input.olehUserId,
        promoBorneByElorae: D(promo.total),
        lossChargedToStore: D(bebanHilang),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_DIKUNCI,
      entityType: 'ConsignmentCycle',
      entityId: siklus.id,
      /*
       * Angka inilah yang menagih toko dan membayar komisi. Ia bisa dibuka lagi
       * selama belum ada gaji dibayar, dan barisnya hanya menyimpan yang
       * terakhir — jadi angka yang tergantikan hanya ada di sini.
       */
      changes: {
        before: {
          promoBorneByElorae: angka(siklus.promoBorneByElorae),
          lossChargedToStore: angka(siklus.lossChargedToStore),
          komisiDihapus,
        },
        after: {
          baris,
          totalKomisi,
          gajiPokokPerSpg: input.gajiPokokPerSpg ?? 0,
          promoBorneByElorae: promo.total,
          lossChargedToStore: bebanHilang,
          potonganHilangSpg: Math.round(totalPotonganHilang * 100) / 100,
        },
      },
      metadata: { jumlahSpg: spg.length, jumlahBaris: baris.length, komisiDihapus: komisiDihapus.length },
    });

    return { ok: true as const, totalKomisi, jumlahSpg: spg.length };
  });
}

/**
 * Buka kunci untuk membetulkan angka.
 *
 * DITOLAK kalau ada gaji yang sudah dibayar. Membuka kunci setelah itu berarti
 * komisi bisa dihitung ulang lebih kecil dari yang sudah masuk kantong orang —
 * dan tidak ada jalan menariknya kembali.
 *
 * DITOLAK juga sesudah nomor nota atau faktur pajak dicatat (keduanya menyatakan
 * nilai tagihan yang sudah keluar ke toko / kantor pajak), dan selama ada
 * pembayaran toko yang belum dibatalkan (uangnya membayar angka yang dikunci).
 */
export async function bukaKunci(input: {
  cycleId: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: {
        id: true,
        noKonsi: true,
        lockedAt: true,
        promoBorneByElorae: true,
        lossChargedToStore: true,
        noNota: true,
        noFakturPajak: true,
        commissions: { select: { id: true, paidAt: true, deduction: true } },
        payments: { where: { cancelledAt: null }, select: { id: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };
    if (siklus.commissions.some((k) => k.paidAt !== null)) {
      return { ok: false as const, alasan: 'ADA_GAJI_SUDAH_DIBAYAR' as const };
    }
    if (siklus.noNota) return { ok: false as const, alasan: "ADA_NOTA" as const };
    if (siklus.noFakturPajak) return { ok: false as const, alasan: "ADA_FAKTUR_PAJAK" as const };
    if (siklus.payments.length > 0) return { ok: false as const, alasan: "ADA_PEMBAYARAN_TOKO" as const };

    // Potongan promo dan beban barang hilang dihitung ulang saat dikunci lagi;
    // beban hilang yang sudah ditandai ditagihkan di siklus ini dilepas dulu.
    await lepasBebanHilangSiklus(tx, { cycleId: siklus.id, noKonsi: siklus.noKonsi, userId: input.olehUserId });
    // Potongan beban barang hilang dari gaji SPG kembali menjadi sisa bebannya;
    // dipotong lagi saat dikunci ulang.
    for (const k of siklus.commissions) {
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_KONSI, refId: k.id, userId: input.olehUserId });
    }
    if (siklus.commissions.some((k) => angka(k.deduction) !== 0)) {
      await tx.consignmentCommission.updateMany({ where: { cycleId: siklus.id }, data: { deduction: D(0) } });
    }
    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: { lockedAt: null, lockedById: null, promoBorneByElorae: D(0), lossChargedToStore: D(0) },
    });

    // Pembalikan paling berbahaya di modul ini: setelah dibuka, komisi bisa
    // dihitung ulang. Penulis menolaknya kalau ada gaji sudah dibayar, tapi
    // yang lolos pun harus meninggalkan nama dan waktunya.
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_DIBUKA_KUNCI,
      entityType: 'ConsignmentCycle',
      entityId: siklus.id,
      changes: {
        before: {
          lockedAt: siklus.lockedAt?.toISOString() ?? null,
          promoBorneByElorae: angka(siklus.promoBorneByElorae),
          lossChargedToStore: angka(siklus.lossChargedToStore),
          potonganHilangSpg: siklus.commissions.reduce((n, k) => n + angka(k.deduction), 0),
        },
        after: { lockedAt: null, promoBorneByElorae: 0, lossChargedToStore: 0, potonganHilangSpg: 0 },
      },
      metadata: { noKonsi: siklus.noKonsi },
    });

    return { ok: true as const };
  });
}

/**
 * Tandai gaji + komisi satu SPG sudah dibayar.
 *
 * Hanya untuk siklus yang TERKUNCI: sebelum dikunci (termasuk sesudah kuncinya
 * dibuka) baris gajinya masih bisa dihitung ulang atau dihapus, jadi angka yang
 * dibayarkan belum pasti.
 */
export async function bayarKomisi(input: {
  commissionId: string;
  olehUserId: string;
  catatan?: string | null;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const k = await tx.consignmentCommission.findUnique({
      where: { id: input.commissionId },
      select: {
        id: true,
        paidAt: true,
        cycleId: true,
        spgUserId: true,
        total: true,
        deduction: true,
        cycle: { select: { lockedAt: true } },
      },
    });
    if (!k) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (k.paidAt) return { ok: false as const, alasan: 'SUDAH_DIBAYAR' as const };
    if (!k.cycle.lockedAt) return { ok: false as const, alasan: "BELUM_DIKUNCI" as const };

    await tx.consignmentCommission.update({
      where: { id: k.id },
      data: { paidAt: new Date(), paidById: input.olehUserId, note: input.catatan?.trim() || null },
    });

    // Membayar mengunci siklusnya untuk selamanya: sesudah ini kuncinya tidak
    // bisa dibuka lagi. Titik itu harus punya nama dan waktu.
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_GAJI_DIBAYAR,
      entityType: 'ConsignmentCommission',
      entityId: k.id,
      changes: { before: { paidAt: null }, after: { paidAt: new Date().toISOString() } },
      metadata: {
        cycleId: k.cycleId,
        spgUserId: k.spgUserId,
        total: angka(k.total),
        potonganHilang: angka(k.deduction),
        dibayar: Math.max(0, angka(k.total) - angka(k.deduction)),
      },
      reason: input.catatan,
    });

    return { ok: true as const };
  });
}

/**
 * Catat nomor nota (admin penjualan) atau nomor faktur pajak (admin pajak).
 *
 * Keduanya nomor MILIK ORANG LAIN — bukan yang kita hasilkan — dan boleh sama
 * sekali berbeda dari nomor konsi kita. Disimpan berdampingan justru supaya
 * admin pajak tidak lagi bertanya "nomor notanya yang mana".
 */
export async function catatNomorDokumen(input: {
  cycleId: string;
  jenis: 'NOTA' | 'PAJAK';
  nomor: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  const nomor = input.nomor?.trim();
  if (!nomor) return { ok: false, alasan: 'NOMOR_WAJIB' };

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: { id: true, lockedAt: true, noNota: true, noFakturPajak: true },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    // Nomor nota dan faktur pajak menyatakan nilai yang ditagihkan; sebelum
    // angkanya dikunci, nilai itu belum ada.
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };

    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data:
        input.jenis === 'NOTA'
          ? { noNota: nomor, notaAt: new Date() }
          : { noFakturPajak: nomor, fakturPajakAt: new Date() },
    });

    // Nomor milik orang lain, dan bisa ditimpa. Yang lama hanya hidup di sini.
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_NOMOR,
      entityType: 'ConsignmentCycle',
      entityId: siklus.id,
      changes:
        input.jenis === 'NOTA'
          ? { before: { noNota: siklus.noNota }, after: { noNota: nomor } }
          : { before: { noFakturPajak: siklus.noFakturPajak }, after: { noFakturPajak: nomor } },
      metadata: { jenis: input.jenis },
    });

    return { ok: true as const };
  });
}

/* ------------------------------------------------------------------ */
/* Pembayaran toko per siklus                                          */
/* ------------------------------------------------------------------ */

export const CARA_BAYAR_TOKO = ["transfer", "tunai", "giro"] as const;
export type CaraBayarToko = (typeof CARA_BAYAR_TOKO)[number];

/**
 * Nama tindakan pembayaran toko di `AuditLog`. Jangan ditulis sebagai string
 * bebas. (Belum masuk `JEJAK` di `lib/receivables/jejak.ts`.)
 */
export const JEJAK_BAYAR_TOKO = {
  DICATAT: "CONSIGNMENT_STORE_PAYMENT_RECORDED",
  DIBATALKAN: "CONSIGNMENT_STORE_PAYMENT_CANCELLED",
} as const;

async function jejakBayarToko(
  tx: Klien,
  isi: Omit<IsiJejak, "action"> & { action: (typeof JEJAK_BAYAR_TOKO)[keyof typeof JEJAK_BAYAR_TOKO] },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: isi.entityType,
      entityId: isi.entityId,
      changes: (isi.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (isi.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: isi.reason?.trim() || null,
    },
  });
}

/** Siklus beserta tagihan bekunya dan pembayaran hidupnya, dibaca di dalam transaksi. */
async function bacaTagihanSiklus(tx: Klien, cycleId: string) {
  const c = await tx.consignmentCycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      noKonsi: true,
      lockedAt: true,
      promoBorneByElorae: true,
      lossChargedToStore: true,
      sold: { select: { amount: true } },
      payments: { where: { cancelledAt: null }, select: { id: true, amount: true } },
    },
  });
  if (!c) return null;
  const total = c.lockedAt ? totalTagihanBeku(c) : null;
  const pembayaran = c.payments.map((p) => angka(p.amount));
  return { ...c, total, pembayaran, ringkas: ringkasanBayarToko({ totalTagihan: total, pembayaran }) };
}

/**
 * Catat pembayaran toko atas tagihan satu siklus. Boleh dicicil.
 *
 * Hanya untuk siklus yang terkunci (tagihannya baru ada sesudah dikunci), dan
 * tidak boleh melebihi sisa: sisa = tagihan beku − pembayaran yang tidak
 * dibatalkan, dihitung ulang dari nol di setiap pencatatan, tidak pernah
 * disimpan. Dicatat oleh keuangan sesudah uangnya terlihat di rekening.
 */
export async function catatPembayaranToko(input: {
  cycleId: string;
  jumlah: number;
  tanggal: Date;
  cara: string;
  catatan?: string | null;
  olehUserId: string;
}): Promise<{ ok: true; id: string; sisa: number } | Gagal> {
  if (!Number.isFinite(input.jumlah) || keSen(input.jumlah) <= 0) return { ok: false, alasan: "NILAI_TIDAK_VALID" };
  if (!(CARA_BAYAR_TOKO as readonly string[]).includes(input.cara)) return { ok: false, alasan: "CARA_BAYAR_TIDAK_VALID" };
  if (!(input.tanggal instanceof Date) || Number.isNaN(input.tanggal.getTime())) {
    return { ok: false, alasan: "TANGGAL_TIDAK_VALID" };
  }
  if (input.tanggal > endOfTodayJakarta()) return { ok: false, alasan: "TANGGAL_DI_DEPAN" };
  const jumlahSen = keSen(input.jumlah);

  return runSerializable(async (tx) => {
    const c = await bacaTagihanSiklus(tx, input.cycleId);
    if (!c) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };
    if (!c.lockedAt) return { ok: false as const, alasan: "BELUM_DIKUNCI" as const };
    const sebelum = c.ringkas;
    if (jumlahSen > keSen(sebelum.sisa ?? 0)) return { ok: false as const, alasan: "MELEBIHI_SISA" as const };

    const p = await tx.consignmentPayment.create({
      data: {
        cycleId: c.id,
        amount: D(jumlahSen / 100),
        paidOn: input.tanggal,
        method: input.cara,
        note: input.catatan?.trim() || null,
        recordedById: input.olehUserId,
      },
      select: { id: true },
    });
    const sesudah = ringkasanBayarToko({ totalTagihan: c.total, pembayaran: [...c.pembayaran, jumlahSen / 100] });

    await jejakBayarToko(tx, {
      userId: input.olehUserId,
      action: JEJAK_BAYAR_TOKO.DICATAT,
      entityType: "ConsignmentCycle",
      entityId: c.id,
      changes: {
        before: { dibayar: sebelum.dibayar, sisa: sebelum.sisa },
        after: { dibayar: sesudah.dibayar, sisa: sesudah.sisa },
      },
      metadata: {
        paymentId: p.id,
        noKonsi: c.noKonsi,
        jumlah: jumlahSen / 100,
        tanggal: input.tanggal.toISOString(),
        cara: input.cara,
        totalTagihan: c.total,
      },
      reason: input.catatan,
    });

    return { ok: true as const, id: p.id, sisa: sesudah.sisa ?? 0 };
  });
}

/**
 * Batalkan pembayaran toko yang salah catat. Barisnya TIDAK dihapus — diberi
 * tanda batal dan alasannya, dan berhenti mengurangi tagihan. Alasan wajib.
 */
export async function batalkanPembayaranToko(input: {
  paymentId: string;
  alasan: string;
  olehUserId: string;
}): Promise<{ ok: true; sisa: number } | Gagal> {
  const alasan = input.alasan?.trim();
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };

  return runSerializable(async (tx) => {
    const p = await tx.consignmentPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, cycleId: true, amount: true, paidOn: true, method: true, cancelledAt: true },
    });
    if (!p) return { ok: false as const, alasan: "PEMBAYARAN_TIDAK_DITEMUKAN" as const };
    if (p.cancelledAt) return { ok: false as const, alasan: "SUDAH_DIBATALKAN" as const };
    const c = await bacaTagihanSiklus(tx, p.cycleId);
    if (!c) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };

    const sekarang = new Date();
    await tx.consignmentPayment.update({
      where: { id: p.id },
      data: { cancelledAt: sekarang, cancelledById: input.olehUserId, cancelReason: alasan },
    });
    const sebelum = c.ringkas;
    const sesudah = ringkasanBayarToko({
      totalTagihan: c.total,
      pembayaran: c.payments.filter((x) => x.id !== p.id).map((x) => angka(x.amount)),
    });

    await jejakBayarToko(tx, {
      userId: input.olehUserId,
      action: JEJAK_BAYAR_TOKO.DIBATALKAN,
      entityType: "ConsignmentCycle",
      entityId: c.id,
      changes: {
        before: { dibayar: sebelum.dibayar, sisa: sebelum.sisa, dibatalkanPada: null },
        after: { dibayar: sesudah.dibayar, sisa: sesudah.sisa, dibatalkanPada: sekarang.toISOString() },
      },
      metadata: {
        paymentId: p.id,
        noKonsi: c.noKonsi,
        jumlah: angka(p.amount),
        tanggal: p.paidOn.toISOString(),
        cara: p.method,
      },
      reason: alasan,
    });

    return { ok: true as const, sisa: sesudah.sisa ?? 0 };
  });
}
