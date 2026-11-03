import { Prisma, prisma, transferKonsiStock, type AdminNotification, type KonsiTransferShortLine } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { denganNomorUnik } from '@/lib/receivables/nomor';
import { catatJejak, JEJAK, type IsiJejak } from '@/lib/receivables/jejak';
import { penghalangBatalPiutang, type KodePenghalangBatal } from "@/lib/receivables/penghalang-batal";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { tanggalPeriode } from "@/lib/finance/operasional/aturan";
import { commissionRates, lockedKonsiReports, spgSaleMovements } from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, konsiReportKey, payoutMonth, salesMonthLabelId, salesMonthNoteId, toCommissionReport, type SalesReport } from "@/lib/spg-commission/payout";
import { resolveRate } from "@/lib/spg-commission/resolve-rate";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { totalTagihanBeku } from "./queries";
import { jatuhTempoSiklus } from "./aturan";
import { muatBulanSiklusPertama } from "./siklus-pertama";
import { sebelumSiklusPertama } from "./siklus-pertama-aturan";
import { bebanHilangUntukSiklus, lepasBebanHilangSiklus } from "@/lib/spg/hilang-tagihan";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { ingatkanCatatanHadirPerlu, sebarPengingatCatatan } from "@/lib/spg/absen-catatan-hadir-writer";
import { detailGajiUntukDisimpan, type AlasanTahanBayar, type HasilGaji } from "@/lib/spg/gaji-pokok";
import { kunciGaji, kunciTokoBulan, muatGajiPokok, muatPesertaGaji } from "@/lib/spg/gaji-pokok-queries";
import { bulanSudahSelesai } from "@/lib/spg/komisi";
import { terapkanPembayaran } from "@/lib/spg/komisi-bayar";
import { kalimatKoreksiKabar, kalimatPotongKabar } from "@/lib/spg/koreksi";
import { unitKomisiSpg } from "@/lib/spg/koreksi-queries";
import { catatHitungUlangSaatBayar, KomisiBerubahError, siapkanBayarKomisi } from "@/lib/spg/koreksi-writer";
import { rangkaiDalamBatas } from "@/lib/spg/antaran";
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
  | "TANGGAL_TIDAK_VALID"
  | "STOK_KURANG"
  | "VARIAN_WAJIB"
  /** Nomor faktur pajak untuk siklus yang tagihannya tanpa PPN. */
  | "TANPA_PPN"
  /** Gaji & komisi yang dibayarkan berbeda dari yang dilihat kantor — halaman dimuat ulang. */
  | "ANGKA_BERUBAH"
  /** Siklus tidak boleh dikunci sebelum bulannya selesai (P30). */
  | "BULAN_BELUM_SELESAI"
  /** Bulan siklus pertama konsinyasi belum diatur (P59). */
  | "SIKLUS_PERTAMA_BELUM_DIATUR"
  /** Siklus lebih dulu dari bulan siklus pertama — utangnya masuk lewat impor/ketik manual (P59). */
  | "SEBELUM_SIKLUS_PERTAMA"
  /** Toko konsi tanpa salesman pemegang — tagihannya tidak punya penagih (P47). */
  | "TOKO_TANPA_PEMEGANG"
  /** Nomor konsi sudah dipakai tagihan lain. */
  | "NOMOR_TAGIHAN_TERPAKAI"
  /** Tagihan siklus sudah disentuh uang toko — kunci tidak bisa dibuka. */
  | Exclude<KodePenghalangBatal, "ADA_PEMBAYARAN_TOKO">
  /** Dasar gaji SPG bulan itu belum pasti — seluruh pembayarannya menunggu (P60). */
  | AlasanTahanBayar;

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

/**
 * Baris stok yang akan dipotong untuk satu kunci — aturan pilih yang sama dengan
 * `transferKonsiStock`: tanpa varian, baris "" didahulukan, lalu baris null ber-id terkecil
 * (barang bisa punya keduanya; pencarian OR tanpa urutan bisa membaca kembaran yang lain).
 */
async function barisStokKirim(tx: Klien, itemId: string, variantSku: string) {
  if (variantSku !== "") return tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
  const kosong = await tx.inventoryValue.findFirst({ where: { itemId, variantSku: "" } });
  return kosong ?? tx.inventoryValue.findFirst({ where: { itemId, variantSku: null }, orderBy: { id: "asc" } });
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
        // Bulan sebelum siklus pertama: utangnya masuk lewat impor/ketik manual, bukan siklus (P59).
        const pertama = await muatBulanSiklusPertama(tx);
        const periode = `${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`;
        if (pertama.diatur && sebelumSiklusPertama(periode, pertama.bulan)) {
          return { ok: false as const, alasan: 'SEBELUM_SIKLUS_PERTAMA' as const };
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
          // null dan "" sama-sama baris tanpa varian (lihat barisStokKirim).
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
        // transferKonsiStock memeriksa lagi per baris sesudah baris sebelumnya terpotong (transaksi
        // serializable ini mengunci bacaannya), dan stok fisik tidak pernah negatif: lantai
        // moveMainStock membatalkan seluruh kiriman. Setiap potongan tercatat di buku stok.
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

/** Kategori yang membawa potong terkonfirmasi terbanyak pada satu barang (seri → kategori id terkecil, tanpa kategori terakhir). */
function kategoriDominan(laporan: SalesReport): Map<string, string | null> {
  const per = new Map<string, { categoryId: string | null; potong: number }>();
  for (const l of toCommissionReport(laporan).lines) {
    const ada = per.get(l.itemId);
    const potong = Math.min(l.billedQty, l.posQty);
    const lebih =
      !ada ||
      potong > ada.potong ||
      (potong === ada.potong && (ada.categoryId === null ? l.categoryId !== null : l.categoryId !== null && l.categoryId < ada.categoryId));
    if (lebih) per.set(l.itemId, { categoryId: l.categoryId, potong });
  }
  return new Map([...per].map(([itemId, v]) => [itemId, v.categoryId]));
}

/**
 * Gaji satu SPG × bulan sudah dihitung di baris TOKO PUTUS (toko yang berganti syarat): penunjuknya,
 * supaya baris konsinyasi menulis Rp 0 dan gaji sebulan tidak dibayar dua kali.
 */
async function gajiDiBarisPutus(tx: Klien, userIds: readonly string[], periode: string): Promise<Map<string, { refType: string; refId: string }>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.spgCommission.findMany({ where: { userId: { in: [...userIds] }, period: periode }, select: { id: true, userId: true, salaryDetail: true } });
  const hasil = new Map<string, { refType: string; refId: string }>();
  for (const r of rows) {
    if ((r.salaryDetail as { jenis?: unknown } | null)?.jenis === "DI_BARIS_LAIN") continue;
    hasil.set(r.userId, { refType: "SpgCommission", refId: r.id });
  }
  return hasil;
}

/** "<no> (batal)", lalu "<no> (batal 2)", … — nomor bebas untuk tagihan siklus yang dibatalkan. */
async function nomorTagihanBatal(tx: Klien, invoiceNo: string): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const calon = i === 1 ? `${invoiceNo} (batal)` : `${invoiceNo} (batal ${i})`;
    const ada = await tx.receivable.findUnique({ where: { invoiceNo: calon }, select: { id: true } });
    if (!ada) return calon;
  }
  return `${invoiceNo} (batal ${Date.now()})`;
}

/**
 * Kunci angka resmi, dan tetapkan gaji & komisi SPG dari angka itu.
 *
 * Inilah titik tidak-bisa-kembali. Dari sini angka resminya yang menagih toko (tagihan siklus di
 * Piutang, lahir di transaksi ini), membayar gaji & komisi, dan mengurangi stok titipan — bukan salah
 * satu laporan mentahnya.
 *
 * Ditolak, sebelum menulis apa pun: bulannya belum selesai (P30); bulan siklus pertama belum diatur
 * atau siklus ini lebih dulu darinya (P59); kedua laporan belum masuk; toko tanpa salesman pemegang
 * (P47, penagih tagihannya); nomor konsinya sudah dipakai tagihan lain.
 *
 * Gaji & komisi (B19, B21): SATU baris untuk SETIAP peserta gaji toko × bulan itu (penjual, pemegang
 * jadwal bulan itu, pemilik catatan check-in, dan SPG yang masa tugasnya di toko itu menyentuh bulan
 * itu), walau komisinya nol. Komisi = tarif kategori bulan penjualan × potong yang dijual SPG itu
 * sendiri, dibatasi angka resmi. Gaji pokok dari jadwal yang disetujui / catatan check-in yang
 * diperiksa (`lib/spg/gaji-pokok.ts`); baris yang dasar gajinya belum pasti tetap ditulis, tertahan,
 * dan kantor diingatkan (P7e). Tidak ada gaji yang diketik saat mengunci, dan tidak ada potongan
 * beban saat mengunci — beban dipotong penuh saat dibayar (P11a). Baris yang bukan peserta lagi dan
 * belum dibayar dihapus (jejaknya tetap). Setiap SPG dikabari sesudah transaksi.
 */
export async function kunciAngka(input: {
  cycleId: string;
  olehUserId: string;
  baris: BarisResmi[];
  sekarang?: Date;
}): Promise<{ ok: true; totalKomisi: number; jumlahSpg: number; receivableId: string | null } | Gagal> {
  const baris = input.baris.filter((b) => b.itemName.trim() && b.qty >= 0);
  if (baris.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };
  if (baris.some((b) => b.qty < 0 || b.price < 0)) {
    return { ok: false, alasan: 'NILAI_TIDAK_VALID' };
  }
  const sekarang = input.sekarang ?? new Date();

  let kabar: { userId: string; kabar: Kabar }[] = [];
  let pengingat: (AdminNotification | null)[] = [];
  const hasil = await runSerializable(async (tx) => {
    // Callback ini bisa diulang: kabar dan pengingat dari percobaan yang gagal tidak boleh ikut terkirim.
    kabar = [];
    pengingat = [];
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
        vatApplied: true,
        store: { select: { consignmentVat: true, name: true, salesmanId: true, paymentTempo: true } },
        reports: { select: { source: true } },
        commissions: { select: { id: true, spgUserId: true, baseSalary: true, commission: true, total: true, deduction: true, paidAt: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (siklus.lockedAt) return { ok: false as const, alasan: 'SUDAH_DIKUNCI' as const };
    const bulanJual = `${siklus.periodYear}-${String(siklus.periodMonth).padStart(2, "0")}`;
    if (!bulanSudahSelesai(bulanJual, bulanWib(sekarang))) return { ok: false as const, alasan: "BULAN_BELUM_SELESAI" as const };
    const pertama = await muatBulanSiklusPertama(tx);
    if (!pertama.diatur) return { ok: false as const, alasan: "SIKLUS_PERTAMA_BELUM_DIATUR" as const };
    if (sebelumSiklusPertama(bulanJual, pertama.bulan)) return { ok: false as const, alasan: "SEBELUM_SIKLUS_PERTAMA" as const };
    const sumber = new Set(siklus.reports.map((r) => r.source));
    if (!sumber.has('SPG') || !sumber.has('TOKO')) {
      return { ok: false as const, alasan: 'LAPORAN_BELUM_LENGKAP' as const };
    }
    if (!siklus.store.salesmanId) return { ok: false as const, alasan: "TOKO_TANPA_PEMEGANG" as const };
    const nomorDipakai = await tx.receivable.findUnique({ where: { invoiceNo: siklus.noKonsi }, select: { id: true } });
    if (nomorDipakai) return { ok: false as const, alasan: "NOMOR_TAGIHAN_TERPAKAI" as const };

    /*
     * Komisi SPG — satu hitungan untuk semua SPG (`lib/spg-commission/payout.ts`): tarif per
     * KATEGORI yang tersimpan di baris nota saat terjual (P8), berlaku di bulan penjualan siklus ini
     * × potong yang dijual masing-masing SPG di kasir, paling banyak angka resmi barang itu.
     * Mengunci = kantor mengecek laporannya, jadi bulan kunci = bulan pembayarannya.
     *
     * Tarif yang dipakai tiap barang DISALIN ke baris resmi (`commissionPerPcs`) hanya sebagai
     * riwayat: tarif kategori yang membawa potong terkonfirmasi terbanyak barang itu.
     */
    const waktuKunci = sekarang;
    const [tarifKategori, gerakSpg] = await Promise.all([commissionRates(tx), spgSaleMovements(tx, [siklus.storeId], bulanJual)]);
    const laporanKomisi: SalesReport = {
      key: konsiReportKey(siklus.id),
      kind: "KONSI",
      storeId: siklus.storeId,
      salesMonth: bulanJual,
      checkedAt: waktuKunci,
      official: baris.flatMap((b) => (b.itemId ? [{ itemId: b.itemId, qty: b.qty }] : [])),
      movements: gerakSpg.get(siklus.storeId) ?? [],
    };
    const komisiPerSpg = new Map(commissionPerSpg(laporanKomisi, tarifKategori).map((k) => [k.salesmanId, k]));
    const dominan = kategoriDominan(laporanKomisi);
    const tarifBarang = (itemId: string) => {
      const c = dominan.get(itemId) ?? null;
      return c ? (resolveRate(tarifKategori, c, bulanJual)?.amountPerPiece ?? 0) : 0;
    };

    await tx.consignmentSold.deleteMany({ where: { cycleId: siklus.id } });
    await tx.consignmentSold.createMany({
      data: baris.map((b) => ({
        cycleId: siklus.id,
        itemId: b.itemId ?? null,
        itemName: b.itemName.trim(),
        qty: b.qty,
        price: D(b.price),
        amount: D(b.qty * b.price),
        commissionPerPcs: D(b.itemId ? tarifBarang(b.itemId) : 0),
      })),
    });

    // Peserta gaji (B19): sama dengan toko putus, dari satu pemuat.
    const pesertaPer = await muatPesertaGaji(tx, [{ storeId: siklus.storeId, bulan: bulanJual }]);
    const penjual = [...komisiPerSpg.values()].filter((k) => k.pieces > 0).map((k) => k.salesmanId);
    const ikut = [...new Set([...(pesertaPer.get(kunciTokoBulan(siklus.storeId, bulanJual)) ?? []), ...penjual])].sort();
    const [gajiPer, diPutus] = await Promise.all([
      muatGajiPokok(tx, ikut.map((userId) => ({ userId, storeId: siklus.storeId, bulan: bulanJual }))),
      gajiDiBarisPutus(tx, ikut, bulanJual),
    ]);

    // Baris yang bukan peserta lagi dan belum dibayar dihapus. Baris yang SUDAH dibayar tidak pernah disentuh.
    const idIkut = new Set(ikut);
    const komisiDihapus: { id: string; spgUserId: string; total: number }[] = [];
    for (const k of siklus.commissions) {
      if (idIkut.has(k.spgUserId) || k.paidAt !== null) continue;
      await tx.consignmentCommission.delete({ where: { id: k.id } });
      komisiDihapus.push({ id: k.id, spgUserId: k.spgUserId, total: angka(k.total) });
    }
    const sudahDibayar = new Set(siklus.commissions.filter((k) => k.paidAt !== null).map((k) => k.spgUserId));
    const totalKomisi = ikut.reduce((n, id) => n + (komisiPerSpg.get(id)?.amount ?? 0), 0);

    const perSpg: { spgUserId: string; potong: number; komisi: number; gajiPokok: number; potongTanpaTarif: number; ditahan: AlasanTahanBayar | null; gajiDiBarisLain: boolean }[] = [];
    for (const spgUserId of ikut) {
      if (sudahDibayar.has(spgUserId)) continue;
      const hitung = komisiPerSpg.get(spgUserId);
      const komisi = hitung?.amount ?? 0;
      const lain = diPutus.get(spgUserId) ?? null;
      const g: HasilGaji | null = lain ? null : (gajiPer.get(kunciGaji(spgUserId, bulanJual)) ?? null);
      const pokok = !lain && g && g.ok ? g.rincian.gajiPokok : 0;
      const detail = detailGajiUntukDisimpan(g, lain);
      const salaryDetail = (detail ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
      const isi = { baseSalary: D(pokok), commission: D(komisi), total: D(pokok + komisi), deduction: D(0), salaryDetail };
      await tx.consignmentCommission.upsert({
        where: { cycleId_spgUserId: { cycleId: siklus.id, spgUserId } },
        create: { cycleId: siklus.id, spgUserId, ...isi },
        update: isi,
        select: { id: true },
      });
      const tahan = g && !g.ok ? g.alasan : null;
      if (g && !g.ok && g.alasan === "CATATAN_HADIR_BELUM_DIMASUKKAN") {
        pengingat.push(await ingatkanCatatanHadirPerlu(tx, { userId: spgUserId, storeId: siklus.storeId, bulan: bulanJual, hari: g.hari }));
      }
      perSpg.push({ spgUserId, potong: hitung?.pieces ?? 0, komisi, gajiPokok: pokok, potongTanpaTarif: hitung?.noRatePieces ?? 0, ditahan: tahan, gajiDiBarisLain: Boolean(lain) });
      kabar.push({
        userId: spgUserId,
        kabar: {
          jenis: JENIS_KABAR.KOMISI_SPG,
          judul: `Gaji & komisi penjualan ${salesMonthLabelId(bulanJual)} dikunci`,
          isi: tahan
            ? `${siklus.store.name}: pembayarannya menunggu kantor melengkapi dasar gaji bulan itu.`
            : rangkaiDalamBatas(
                [
                  `${siklus.store.name}: ` + (pokok > 0 ? `gaji pokok ${formatIDR(pokok)} + ` : "") + `komisi ${formatIDR(komisi)} (${hitung?.pieces ?? 0} potong).`,
                  `Dibayar ${salesMonthLabelId(payoutMonth(waktuKunci))} setelah kantor menandainya.`,
                ],
                191,
              ),
          data: { cycleId: siklus.id },
        },
      });
    }

    /*
     * Dua pengurang/penambah tagihan dibekukan DI transaksi yang sama dengan angka resmi: potongan
     * promo konter yang ditanggung Elorae dan beban barang hilang yang ditetapkan ke toko.
     */
    const promo = await promoEloraeSiklus(tx, { storeId: siklus.storeId, periodYear: siklus.periodYear, periodMonth: siklus.periodMonth });
    const bebanHilang = await bebanHilangUntukSiklus(tx, {
      cycleId: siklus.id,
      noKonsi: siklus.noKonsi,
      storeId: siklus.storeId,
      periodYear: siklus.periodYear,
      periodMonth: siklus.periodMonth,
      userId: input.olehUserId,
    });

    const pakaiPpn = siklus.store.consignmentVat;
    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: {
        lockedAt: waktuKunci,
        lockedById: input.olehUserId,
        promoBorneByElorae: D(promo.total),
        lossChargedToStore: D(bebanHilang),
        vatApplied: pakaiPpn,
      },
    });

    /*
     * Tagihan siklus di Piutang (keputusan pemilik 2026-10-29: "tagihan konsi masuk Piutang setelah
     * angka terjual dikunci"): satu tagihan bernomor konsi, atas nama salesman pemegang toko (P55),
     * bertanggal akhir bulan siklus — sama dengan tanggal jurnalnya (`tanggalPeriode`) — dan jatuh
     * tempo dari tanggal tagihan itu + tempo toko (P54, disetujui pemilik: siklus Oktober dikunci
     * 5 November, tempo 30 hari → jatuh tempo 30 November). Total nol tidak menagih.
     */
    const sold = await tx.consignmentSold.findMany({ where: { cycleId: siklus.id }, select: { amount: true } });
    const totalTagihan = totalTagihanBeku({ sold, promoBorneByElorae: promo.total, lossChargedToStore: bebanHilang });
    let receivableId: string | null = null;
    if (totalTagihan > 0) {
      const jumlah = D(totalTagihan);
      const tanggalTagihan = tanggalPeriode(siklus.periodYear, siklus.periodMonth, waktuKunci);
      const r = await tx.receivable.create({
        data: {
          storeId: siklus.storeId,
          invoiceNo: siklus.noKonsi,
          invoiceDate: tanggalTagihan,
          dueDate: jatuhTempoSiklus(tanggalTagihan, siklus.store.paymentTempo),
          originalAmount: jumlah,
          outstandingAmount: jumlah,
          amount: jumlah,
          outstanding: jumlah,
          salesmanId: siklus.store.salesmanId,
          isConsignment: true,
          consignmentCycleId: siklus.id,
          note: `Tagihan konsinyasi ${siklus.noKonsi}`,
        },
        select: { id: true, invoiceDate: true, dueDate: true },
      });
      receivableId = r.id;
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.TAGIHAN_KONSI_DIBUAT,
        entityType: "Receivable",
        entityId: r.id,
        changes: { after: { invoiceNo: siklus.noKonsi, amount: totalTagihan, invoiceDate: r.invoiceDate.toISOString(), dueDate: r.dueDate.toISOString(), salesmanId: siklus.store.salesmanId } },
        metadata: { cycleId: siklus.id, storeId: siklus.storeId },
      });
    }

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_DIKUNCI,
      entityType: 'ConsignmentCycle',
      entityId: siklus.id,
      changes: {
        before: {
          promoBorneByElorae: angka(siklus.promoBorneByElorae),
          lossChargedToStore: angka(siklus.lossChargedToStore),
          vatApplied: siklus.vatApplied,
          komisiDihapus,
        },
        after: {
          baris,
          totalKomisi,
          promoBorneByElorae: promo.total,
          lossChargedToStore: bebanHilang,
          vatApplied: pakaiPpn,
          // Gaji & komisi per peserta: gaji pokok dari dasar harinya (atau sebab tahannya), komisi dari penjualannya sendiri.
          gajiKomisiPerSpg: perSpg,
          tagihan: receivableId ? { id: receivableId, invoiceNo: siklus.noKonsi, amount: totalTagihan } : null,
        },
      },
      metadata: {
        jumlahSpg: perSpg.length,
        jumlahBaris: baris.length,
        komisiDihapus: komisiDihapus.length,
        aturanKomisi: "TARIF_KATEGORI",
        bulanJual,
        bulanBayar: payoutMonth(waktuKunci),
        catatanKomisi: salesMonthNoteId(bulanJual),
      },
    });

    return { ok: true as const, totalKomisi, jumlahSpg: perSpg.length, receivableId };
  });

  if (hasil.ok) {
    for (const k of kabar) await kabariPengguna(k.userId, k.kabar);
    await sebarPengingatCatatan(pengingat);
  }
  return hasil;
}

/**
 * Buka kunci untuk membetulkan angka.
 *
 * DITOLAK kalau ada gaji yang sudah dibayar (angka yang sudah masuk kantong orang tidak bisa
 * ditarik), sesudah nomor nota atau faktur pajak dicatat, dan selama tagihan siklusnya sudah
 * disentuh uang toko (`penghalangBatalPiutang`: BKM, kontrabon, pembayaran, tugas tagih). Tagihan
 * siklus yang masih bersih dibatalkan di transaksi yang sama (nomornya dilepas: "<no> (batal)"),
 * dan lahir lagi saat dikunci ulang.
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
        vatApplied: true,
        noNota: true,
        noFakturPajak: true,
        commissions: { select: { id: true, paidAt: true } },
        receivables: { where: { status: { not: "VOIDED" } }, select: { id: true, invoiceNo: true, amount: true, outstanding: true, status: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };
    if (siklus.commissions.some((k) => k.paidAt !== null)) {
      return { ok: false as const, alasan: 'ADA_GAJI_SUDAH_DIBAYAR' as const };
    }
    if (siklus.noNota) return { ok: false as const, alasan: "ADA_NOTA" as const };
    if (siklus.noFakturPajak) return { ok: false as const, alasan: "ADA_FAKTUR_PAJAK" as const };
    for (const r of siklus.receivables) {
      const halang = await penghalangBatalPiutang(tx, r.id);
      if (halang) return { ok: false as const, alasan: halang };
    }

    // Beban hilang yang sudah ditandai ditagihkan di siklus ini dilepas; dihitung ulang saat dikunci lagi.
    await lepasBebanHilangSiklus(tx, { cycleId: siklus.id, noKonsi: siklus.noKonsi, userId: input.olehUserId });
    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: { lockedAt: null, lockedById: null, promoBorneByElorae: D(0), lossChargedToStore: D(0), vatApplied: null },
    });

    const dibatalkan: { id: string; invoiceNo: string; menjadi: string; amount: number }[] = [];
    for (const r of siklus.receivables) {
      const menjadi = await nomorTagihanBatal(tx, r.invoiceNo);
      // Dibatalkan sepenuhnya (R3): sisa yang tersimpan nol, dan tidak pernah "lunas" — tagihan yang
      // batal tidak boleh terbaca masih punya sisa di penyaring mana pun yang memakai kolom cache.
      const u = await tx.receivable.updateMany({
        where: { id: r.id, status: r.status },
        data: { status: "VOIDED", invoiceNo: menjadi, outstanding: D(0), outstandingAmount: D(0), settledAt: null },
      });
      if (u.count !== 1) throw new Error("TAGIHAN_SIKLUS_BERUBAH");
      dibatalkan.push({ id: r.id, invoiceNo: r.invoiceNo, menjadi, amount: angka(r.amount) });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.TAGIHAN_KONSI_DIBATALKAN,
        entityType: "Receivable",
        entityId: r.id,
        changes: { before: { status: r.status, invoiceNo: r.invoiceNo, outstanding: angka(r.outstanding) }, after: { status: "VOIDED", invoiceNo: menjadi, outstanding: 0 } },
        metadata: { cycleId: siklus.id, sebab: "BUKA_KUNCI" },
      });
    }

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
          vatApplied: siklus.vatApplied,
          tagihan: siklus.receivables.map((r) => ({ id: r.id, invoiceNo: r.invoiceNo, status: r.status })),
        },
        after: { lockedAt: null, promoBorneByElorae: 0, lossChargedToStore: 0, vatApplied: null, tagihan: dibatalkan },
      },
      metadata: { noKonsi: siklus.noKonsi },
    });

    return { ok: true as const };
  });
}

/**
 * Tandai gaji + komisi satu SPG sudah dibayar — hanya untuk siklus yang TERKUNCI.
 *
 * Yang dibayar SELALU gaji pokok dan komisi yang dihitung ulang di transaksi ini
 * (`siapkanBayarKomisi`, `lib/spg/koreksi.ts`): angka tersimpan yang berbeda diganti di transaksi
 * yang sama dengan jejaknya; koreksi SPG itu yang menunggu ikut kalau baris ini sasarannya. Beban
 * barang hilang, beban retur pembeli, dan utang SPG dipotong PENUH di sini — dari komisi dulu, lalu
 * gaji pokok (P5, P11a, P13a); pada pembayaran terakhir SPG yang berhenti, yang tidak tertutup menjadi
 * utang (P6a). Dasar gaji yang belum pasti menahan seluruh pembayaran (P60). `jumlahDiharapkan` =
 * yang dilihat kantor; berbeda → `ANGKA_BERUBAH` tanpa menulis apa pun.
 */
export async function bayarKomisi(input: {
  commissionId: string;
  olehUserId: string;
  catatan?: string | null;
  /** Yang dilihat kantor di layar; tidak diisi = tanpa penjaga (hanya tes). */
  jumlahDiharapkan?: number;
}): Promise<{ ok: true; cycleId: string; diubah: boolean; dibayar: number; koreksi: number; utang: number } | Gagal> {
  const pemilik = await prisma.consignmentCommission.findUnique({ where: { id: input.commissionId }, select: { spgUserId: true } });
  if (!pemilik) return { ok: false, alasan: 'TIDAK_DITEMUKAN' };
  const praMuat = (await unitKomisiSpg(prisma, [pemilik.spgUserId])).get(pemilik.spgUserId) ?? [];

  let kabar: { userId: string; kabar: Kabar } | null = null;
  let notifikasi: AdminNotification[] = [];
  try {
    const hasil = await runSerializable(async (tx) => {
      kabar = null;
      notifikasi = [];
      const k = await tx.consignmentCommission.findUnique({
        where: { id: input.commissionId },
        select: {
          id: true,
          paidAt: true,
          cycleId: true,
          spgUserId: true,
          baseSalary: true,
          commission: true,
          total: true,
          deduction: true,
          cycle: { select: { lockedAt: true, noKonsi: true, periodYear: true, periodMonth: true, storeId: true, store: { select: { name: true } } } },
        },
      });
      if (!k) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (k.paidAt) return { ok: false as const, alasan: 'SUDAH_DIBAYAR' as const };
      if (!k.cycle.lockedAt) return { ok: false as const, alasan: "BELUM_DIKUNCI" as const };

      const [rates, laporan] = await Promise.all([commissionRates(tx), lockedKonsiReports(tx, { cycleIds: [k.cycleId] })]);
      const lap = laporan[0];
      if (!lap) return { ok: false as const, alasan: "BELUM_DIKUNCI" as const };
      const sendiri = commissionPerSpg(lap, rates).find((h) => h.salesmanId === k.spgUserId);
      const kunci = konsiReportKey(k.cycleId);
      const bulanJual = `${k.cycle.periodYear}-${String(k.cycle.periodMonth).padStart(2, "0")}`;
      const rencana = await siapkanBayarKomisi(tx, {
        userId: k.spgUserId,
        kunci,
        praMuat,
        angkaSendiri: { komisi: sendiri?.amount ?? 0, potong: sendiri?.pieces ?? 0, potongTanpaTarif: sendiri?.noRatePieces ?? 0 },
        storeId: k.cycle.storeId,
        bulanKerja: bulanJual,
        refType: REF_KOMISI_KONSI,
        refId: k.id,
      });
      if (rencana.ditahan) return { ok: false as const, alasan: rencana.ditahan };
      // Sebelum menulis apa pun: yang dibayarkan harus yang dilihat kantor.
      if (input.jumlahDiharapkan !== undefined && Math.round(rencana.dibayar * 100) !== Math.round(input.jumlahDiharapkan * 100)) {
        throw new KomisiBerubahError(rencana.dibayar);
      }

      const waktu = new Date();
      const r = await tx.consignmentCommission.updateMany({
        where: { id: k.id, paidAt: null },
        data: { paidAt: waktu, paidById: input.olehUserId, note: input.catatan?.trim() || null },
      });
      if (r.count !== 1) return { ok: false as const, alasan: 'SUDAH_DIBAYAR' as const };

      const bulanBayar = payoutMonth(k.cycle.lockedAt);
      const sesudahBayar = await terapkanPembayaran(tx, {
        userId: k.spgUserId,
        rencana,
        bulanBayar,
        olehUserId: input.olehUserId,
        waktu,
        catatan: `Gaji/komisi ${k.cycle.noKonsi} · dibayar`,
      });
      notifikasi = sesudahBayar.notifikasi;

      const total = rencana.gajiPokok + rencana.komisiBaru;
      const salaryDetail = (rencana.gaji ? { jenis: "RINCIAN", rincian: rencana.gaji } : Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
      await tx.consignmentCommission.update({
        where: { id: k.id },
        data: {
          commission: D(rencana.komisiBaru),
          baseSalary: D(rencana.gajiPokok),
          total: D(total),
          deduction: D(rencana.potonganHilang),
          ...(rencana.gaji ? { salaryDetail } : {}),
        },
      });
      if (rencana.berubah) {
        await catatHitungUlangSaatBayar(tx, {
          olehUserId: input.olehUserId,
          entityType: REF_KOMISI_KONSI,
          entityId: k.id,
          spgUserId: k.spgUserId,
          storeId: k.cycle.storeId,
          kunci,
          sebelum: { komisi: angka(k.commission), potong: null, dasar: null, potonganHilang: angka(k.deduction), gajiPokok: angka(k.baseSalary), total: angka(k.total) },
          sesudah: { komisi: rencana.komisiBaru, potong: null, dasar: null, potonganHilang: rencana.potonganHilang, gajiPokok: rencana.gajiPokok, total },
        });
      }

      // Membayar mengunci siklusnya untuk selamanya: sesudah ini kuncinya tidak bisa dibuka lagi.
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONSI_GAJI_DIBAYAR,
        entityType: 'ConsignmentCommission',
        entityId: k.id,
        changes: { before: { paidAt: null }, after: { paidAt: waktu.toISOString() } },
        metadata: {
          cycleId: k.cycleId,
          spgUserId: k.spgUserId,
          total,
          gajiPokok: rencana.gajiPokok,
          gaji: rencana.gaji,
          potong: rencana.potong,
          dariKomisi: rencana.dariKomisi,
          dariGaji: rencana.dariGaji,
          diubah: rencana.berubah,
          koreksi: sesudahBayar.koreksi.map((x) => ({ id: x.id, sumber: x.sumber, jumlah: x.jumlah, gaji: x.gaji })),
          utang: sesudahBayar.utangBaru,
          akhir: rencana.akhir,
          dibayar: rencana.dibayar,
          bulanBayar,
        },
        reason: input.catatan,
      });

      const tambahan = [kalimatKoreksiKabar(rencana.koreksi), kalimatPotongKabar(rencana)].filter(Boolean);
      kabar = {
        userId: k.spgUserId,
        kabar: {
          jenis: JENIS_KABAR.KOMISI_SPG,
          judul: `Gaji & komisi penjualan ${salesMonthLabelId(bulanJual)} dibayar`,
          isi: rangkaiDalamBatas(
            [
              `${k.cycle.store.name}: diterima ${formatIDR(rencana.dibayar)} (gaji pokok ${formatIDR(rencana.gajiPokok)} + komisi ${formatIDR(rencana.komisiBaru)}).`,
              ...tambahan,
            ],
            191,
          ),
          data: { cycleId: k.cycleId },
        },
      };

      return {
        ok: true as const,
        cycleId: k.cycleId,
        diubah: rencana.berubah,
        dibayar: rencana.dibayar,
        koreksi: rencana.jumlahKoreksi,
        utang: sesudahBayar.utangBaru.reduce((n, u) => n + u.jumlah, 0),
      };
    });

    const terkirim = kabar as { userId: string; kabar: Kabar } | null;
    if (hasil.ok) {
      if (terkirim) await kabariPengguna(terkirim.userId, terkirim.kabar);
      await sebarPengingatCatatan(notifikasi);
    }
    return hasil;
  } catch (e) {
    if (e instanceof KomisiBerubahError) return { ok: false, alasan: "ANGKA_BERUBAH" };
    throw e;
  }
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
      select: { id: true, lockedAt: true, noNota: true, noFakturPajak: true, vatApplied: true, store: { select: { consignmentVat: true } } },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    // Nomor nota dan faktur pajak menyatakan nilai yang ditagihkan; sebelum
    // angkanya dikunci, nilai itu belum ada.
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };
    // Tagihan tanpa PPN (dibekukan saat dikunci) tidak punya faktur pajak.
    if (input.jenis === 'PAJAK' && !(siklus.vatApplied ?? siklus.store.consignmentVat)) {
      return { ok: false as const, alasan: "TANPA_PPN" as const };
    }

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
