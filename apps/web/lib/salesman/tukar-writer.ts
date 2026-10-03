import { Prisma, type AdminNotification } from "@elorae/db";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { computeStorePrice } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { denganNomorUnik } from "@/lib/receivables/nomor";
import {
  awalanNomorTukar,
  ENTITAS_TUKAR,
  hitungNilaiTukar,
  JEJAK_TUKAR,
  KATEGORI_NOTIF_TUKAR,
  kekuranganStok,
  kunciBarisTukar,
  nomorTukarBerikut,
  periksaJenisToko,
  periksaNilaiTukar,
  periksaTukar,
  rapikanAlasanTukar,
  rapikanCatatanTukar,
  SUMBER_STOK_TUKAR,
  tahunWib,
  type ArahTukar,
  type BarisTukar,
  type KodeTolakBaris,
  type KurangStok,
  type NilaiTukar,
  type TolakSelisih,
} from "./tukar-barang";

/**
 * Penulis tukar barang (toko PUTUS).
 *
 * Empat langkah, empat tangan: salesman MENGAJUKAN di toko, kantor MENYETUJUI
 * (atau menolak), gudang MENYELESAIKAN saat barangnya benar-benar sudah
 * bertukar, dan siapa pun yang berhak boleh MEMBATALKAN selama stok belum
 * bergerak.
 *
 * Tidak satu baris pun di sini menyentuh piutang. Tukar barang netral nilai
 * (dijaga `periksaTukar`); yang tidak setara ditolak dan selisihnya harus lewat
 * pesanan atau retur, yang punya aturan uangnya sendiri.
 *
 * Stok hanya bergerak di `selesaikanTukar`, dalam SATU transaksi: KELUAR
 * mengurangi, MASUK menambah, keduanya dengan increment atomik (penulis lain —
 * webhook Jubelio, pengiriman lapangan — bisa menyentuh baris yang sama pada
 * saat yang sama). Harga rata-rata TIDAK digeser: tukar barang bukan pembelian,
 * sama dengan retur.
 */

type Klien = Prisma.TransactionClient;

const KUNCI_MAKS = 100;

export type BarangTolak = "BARANG_TIDAK_DIKENAL" | "VARIAN_TIDAK_DIKENAL" | "BARANG_TIDAK_AKTIF";

export type HasilAjukanTukar =
  | { ok: true; id: string; docNo: string; ulang: boolean }
  | {
      ok: false;
      kode:
        | "KUNCI_WAJIB"
        | "KUNCI_DIPAKAI"
        | "TOKO_TIDAK_DITEMUKAN"
        | "BUKAN_TOKO_PUTUS"
        | "TANPA_KUNJUNGAN"
        | "TEKS_TERLALU_PANJANG"
        | KodeTolakBaris
        | BarangTolak;
    }
  | { ok: false; kode: "HARGA_BELUM_DISET"; itemIds: string[] }
  | TolakSelisih;

export type BarisKurang = KurangStok & { productName: string };

export type KodeTolakKeputusan =
  | "TIDAK_DITEMUKAN"
  | "MILIK_SENDIRI"
  | "SUDAH_DIPUTUSKAN"
  | "BELUM_DISETUJUI"
  | "SUDAH_SELESAI"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "BUKAN_TOKO_PUTUS";

export type HasilKeputusanTukar =
  | { ok: true; salesmanId: string; storeId: string; docNo: string; ulang: boolean }
  | { ok: false; kode: KodeTolakKeputusan }
  | { ok: false; kode: "STOK_KURANG"; kurang: BarisKurang[] }
  | { ok: false; kode: "HARGA_BELUM_DISET"; itemIds: string[] }
  | TolakSelisih;

// ─── Bantuan ─────────────────────────────────────────────────────────────────

const PILIH_STOK = { id: true, qtyOnHand: true, reservedQty: true, avgCost: true } as const;
type BarisStok = { id: string; qtyOnHand: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal };

/**
 * Baris stok gudang untuk satu barang+varian. Barang tanpa varian memakai
 * `variantSku: null` di sebagian data dan `""` di sebagian lain — pencarian
 * toleran yang sama dengan retur toko dan rekonsiliasi van, supaya tidak ada
 * baris hantu kedua yang lahir dari penukaran.
 */
async function cariStok(tx: Klien, itemId: string, variantSku: string): Promise<BarisStok | null> {
  return variantSku === ""
    ? tx.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select: PILIH_STOK })
    : tx.inventoryValue.findFirst({ where: { itemId, variantSku }, select: PILIH_STOK });
}

const tersediaDari = (s: BarisStok | null): number => (s ? s.qtyOnHand.toNumber() - s.reservedQty.toNumber() : 0);

/** Harga toko PUTUS per barang — sama persis dengan harga pesanan lapangan. */
function petaHarga(items: { id: string; sellingPrice: Prisma.Decimal | null }[], marginPercent: Prisma.Decimal | null) {
  const margin = marginPercent === null ? null : Number(marginPercent);
  return new Map<string, number | null>(
    items.map((i) => [
      i.id,
      computeStorePrice({
        sellingPrice: i.sellingPrice === null ? null : Number(i.sellingPrice),
        termsType: "PUTUS",
        marginPercent: margin,
      }).price,
    ]),
  );
}

/** Stok KELUAR yang kurang, lengkap dengan nama barangnya untuk layar. */
async function periksaStokKeluar(
  tx: Klien,
  baris: { direction: string; itemId: string; variantSku: string; qty: number; productName: string }[],
): Promise<BarisKurang[]> {
  const stok = new Map<string, number>();
  for (const b of baris) {
    if (b.direction !== "KELUAR") continue;
    const k = kunciBarisTukar(b.itemId, b.variantSku);
    if (!stok.has(k)) stok.set(k, tersediaDari(await cariStok(tx, b.itemId, b.variantSku)));
  }
  const nama = new Map(baris.map((b) => [kunciBarisTukar(b.itemId, b.variantSku), b.productName]));
  return kekuranganStok(baris as BarisTukar[], (itemId, variantSku) => stok.get(kunciBarisTukar(itemId, variantSku)) ?? 0).map(
    (k) => ({ ...k, productName: nama.get(kunciBarisTukar(k.itemId, k.variantSku)) ?? k.itemId }),
  );
}

// ─── Mengajukan ──────────────────────────────────────────────────────────────

/**
 * Salesman mengajukan penukaran dari toko yang sedang ia kunjungi.
 *
 * Kunci kiriman diperiksa PALING DULU: kiriman ulang (jaringan putus setelah
 * tersimpan, dua ketukan Kirim) mengembalikan dokumen yang sudah ada apa
 * adanya — tidak dinilai ulang, jadi harga yang berubah sesudahnya tidak
 * membuat kiriman kedua "gagal" untuk dokumen yang sebenarnya sudah tercatat.
 *
 * Nama barang dan harga disusun SERVER. Yang dipercaya dari HP hanya barang,
 * varian, arah, dan jumlahnya.
 */
export async function ajukanTukar(input: {
  salesmanId: string;
  storeId: string;
  baris: unknown;
  catatan?: unknown;
  idempotencyKey: unknown;
  sekarang?: Date;
}): Promise<HasilAjukanTukar> {
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > KUNCI_MAKS) return { ok: false, kode: "KUNCI_WAJIB" };
  const catatan = rapikanCatatanTukar(input.catatan);
  if (!catatan.ok) return catatan;
  const sekarang = input.sekarang ?? new Date();

  // Diisi di dalam transaksi; percobaan ulang (deadlock, nomor bentrok) menyetelnya ulang
  // supaya baris dari percobaan yang dibatalkan tidak pernah ikut dikirim.
  let notifikasi: AdminNotification | null = null;
  const simpan = () =>
    denganNomorUnik(() =>
      runSerializable(async (tx): Promise<HasilAjukanTukar> => {
        notifikasi = null;
        const ada = await tx.storeExchange.findUnique({
          where: { idempotencyKey: kunci },
          select: { id: true, docNo: true, salesmanId: true },
        });
        if (ada) {
          return ada.salesmanId === input.salesmanId
            ? { ok: true, id: ada.id, docNo: ada.docNo, ulang: true }
            : { ok: false, kode: "KUNCI_DIPAKAI" };
        }

        const toko = await tx.store.findUnique({
          where: { id: input.storeId },
          select: { id: true, isActive: true, termsType: true, marginPercent: true },
        });
        if (!toko || !toko.isActive) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
        const jenis = periksaJenisToko(toko.termsType);
        if (jenis) return { ok: false, kode: jenis };

        // Penukaran lahir di toko: barang cacat/salah ukuran dilihat langsung
        // oleh salesman. Tanpa kunjungan yang sedang berjalan, tidak ada yang
        // menyaksikan barangnya.
        const kunjungan = await tx.storeVisit.findFirst({
          where: { storeId: toko.id, userId: input.salesmanId, checkoutAt: null },
          orderBy: { checkinAt: "desc" },
          select: { id: true },
        });
        if (!kunjungan) return { ok: false, kode: "TANPA_KUNJUNGAN" };

        const itemIds = Array.isArray(input.baris)
          ? [...new Set(input.baris.map((b) => (b && typeof b === "object" ? (b as { itemId?: unknown }).itemId : null)))]
              .filter((x): x is string => typeof x === "string" && x.trim() !== "")
              .map((x) => x.trim())
          : [];
        const items = await tx.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, nameId: true, sellingPrice: true, variants: true, isActive: true },
        });

        const cek = periksaTukar({ termsType: toko.termsType, baris: input.baris, harga: petaHarga(items, toko.marginPercent) });
        if (!cek.ok) {
          // Barang yang tidak ada di basis data lebih jelas dilaporkan sebagai
          // "tidak dikenal" daripada "harganya belum diatur".
          if (cek.kode === "HARGA_BELUM_DISET" && cek.itemIds.some((id) => !items.some((i) => i.id === id))) {
            return { ok: false, kode: "BARANG_TIDAK_DIKENAL" };
          }
          return cek;
        }

        const itemById = new Map(items.map((i) => [i.id, i]));
        const barisData: { direction: ArahTukar; itemId: string; variantSku: string; qty: number; productName: string }[] = [];
        for (const b of cek.baris) {
          const item = itemById.get(b.itemId);
          if (!item) return { ok: false, kode: "BARANG_TIDAK_DIKENAL" };
          // Barang yang sudah tidak dijual boleh DIKEMBALIKAN toko, tapi tidak
          // boleh diberikan lagi sebagai pengganti.
          if (b.direction === "KELUAR" && !item.isActive) return { ok: false, kode: "BARANG_TIDAK_AKTIF" };
          const pilihan = variantSelectOptions(parseItemVariants(item.variants));
          // Barang bervarian dipegang per varian di stok: baris tanpa varian akan
          // masuk ke baris stok gabungan yang tidak dijual siapa pun.
          if (pilihan.length > 0 && !pilihan.some((p) => p.sku === b.variantSku)) return { ok: false, kode: "VARIAN_TIDAK_DIKENAL" };
          if (pilihan.length === 0 && b.variantSku !== "") return { ok: false, kode: "VARIAN_TIDAK_DIKENAL" };
          const label = pilihan.find((p) => p.sku === b.variantSku)?.label;
          barisData.push({ ...b, productName: label ? `${item.nameId} — ${label}` : item.nameId });
        }

        const awalan = awalanNomorTukar(tahunWib(sekarang));
        const terakhir = await tx.storeExchange.findFirst({
          where: { docNo: { startsWith: awalan } },
          orderBy: { docNo: "desc" },
          select: { docNo: true },
        });
        const docNo = nomorTukarBerikut(terakhir?.docNo ?? null, tahunWib(sekarang));

        const dokumen = await tx.storeExchange.create({
          data: {
            docNo,
            storeId: toko.id,
            salesmanId: input.salesmanId,
            visitId: kunjungan.id,
            note: catatan.catatan,
            idempotencyKey: kunci,
          },
          select: { id: true, docNo: true },
        });
        await tx.storeExchangeLine.createMany({ data: barisData.map((b) => ({ exchangeId: dokumen.id, ...b })) });

        await tx.auditLog.create({
          data: {
            userId: input.salesmanId,
            action: JEJAK_TUKAR.DIAJUKAN,
            entityType: ENTITAS_TUKAR,
            entityId: dokumen.id,
            changes: { after: { status: "DIAJUKAN", docNo, storeId: toko.id, nilai: cek.nilai } },
            metadata: { visitId: kunjungan.id, jumlahBaris: barisData.length },
          },
        });
        // Penyetuju diberi tahu, di transaksi yang sama: tercatat bersama ajuannya atau tidak sama sekali.
        notifikasi = await tx.adminNotification.create({
          data: {
            category: KATEGORI_NOTIF_TUKAR.DIAJUKAN,
            severity: "INFO",
            title: `Tukar barang ${docNo} diajukan`,
            message: `Salesman mengajukan tukar barang (${barisData.length} baris). Tinjau dan setujui sebelum gudang menyiapkan barangnya.`,
            metadata: { exchangeId: dokumen.id },
          },
        });

        return { ok: true, id: dokumen.id, docNo: dokumen.docNo, ulang: false };
      }),
    );

  let hasil: HasilAjukanTukar;
  try {
    hasil = await simpan();
  } catch (err) {
    // Kiriman kembarnya menang lebih dulu; percobaan ini menemukan dokumennya.
    if (!bentrokKunciKiriman(err)) throw err;
    hasil = await simpan();
  }
  const terkirim: AdminNotification | null = notifikasi;
  if (hasil.ok && !hasil.ulang && terkirim) void fanOutAdminNotification(terkirim);
  return hasil;
}

// ─── Keputusan kantor ────────────────────────────────────────────────────────

type DokumenTukar = {
  id: string;
  docNo: string;
  storeId: string;
  salesmanId: string;
  status: string;
  reviewNote: string | null;
};

const PILIH_DOKUMEN = { id: true, docNo: true, storeId: true, salesmanId: true, status: true, reviewNote: true } as const;

async function barisDokumen(tx: Klien, exchangeId: string) {
  return tx.storeExchangeLine.findMany({
    where: { exchangeId },
    orderBy: [{ direction: "asc" }, { productName: "asc" }],
    select: { id: true, direction: true, itemId: true, variantSku: true, productName: true, qty: true },
  });
}

const berhasil = (d: DokumenTukar, ulang = false) =>
  ({ ok: true, salesmanId: d.salesmanId, storeId: d.storeId, docNo: d.docNo, ulang }) as const;

/**
 * Setujui. Diperiksa ulang pada saat keputusan: toko masih PUTUS, nilai kedua
 * sisi masih setara pada harga HARI INI, dan stok KELUAR cukup untuk SEMUA
 * baris (semua atau tidak sama sekali — penukaran setengah jadi tidak ada).
 *
 * Stok tidak dipesan (tidak ada reservasi): ia bisa terpakai pesanan lain di
 * antara persetujuan dan penyelesaian, jadi `selesaikanTukar` memeriksanya lagi.
 */
export async function setujuiTukar(input: { exchangeId: string; olehUserId: string; catatan?: unknown }): Promise<HasilKeputusanTukar> {
  const catatan = rapikanCatatanTukar(input.catatan);
  if (!catatan.ok) return catatan;

  let notifikasi: AdminNotification | null = null;
  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanTukar> => {
    notifikasi = null;
    const d = await tx.storeExchange.findUnique({ where: { id: input.exchangeId }, select: PILIH_DOKUMEN });
    if (!d) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    // Tidak ada yang menyetujui pengajuannya sendiri.
    if (d.salesmanId === input.olehUserId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (d.status !== "DIAJUKAN") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const toko = await tx.store.findUnique({ where: { id: d.storeId }, select: { termsType: true, marginPercent: true } });
    if (!toko || periksaJenisToko(toko.termsType)) return { ok: false, kode: "BUKAN_TOKO_PUTUS" };

    const baris = await barisDokumen(tx, d.id);
    const items = await tx.item.findMany({
      where: { id: { in: [...new Set(baris.map((b) => b.itemId))] } },
      select: { id: true, sellingPrice: true },
    });
    const nilai = hitungNilaiTukar(baris as BarisTukar[], petaHarga(items, toko.marginPercent));
    if (!nilai.ok) return nilai;
    const setara = periksaNilaiTukar(nilai.nilai);
    if (!setara.ok) return setara;

    const kurang = await periksaStokKeluar(tx, baris);
    if (kurang.length > 0) return { ok: false, kode: "STOK_KURANG", kurang };

    // Bandingkan-lalu-tukar: dua orang yang menekan bersamaan tidak bisa
    // sama-sama "berhasil".
    const r = await tx.storeExchange.updateMany({
      where: { id: d.id, status: "DIAJUKAN" },
      data: { status: "DISETUJUI", reviewedById: input.olehUserId, reviewedAt: new Date(), reviewNote: catatan.catatan },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_TUKAR.DISETUJUI,
        entityType: ENTITAS_TUKAR,
        entityId: d.id,
        changes: { before: { status: d.status }, after: { status: "DISETUJUI" } },
        metadata: { nilai: nilai.nilai },
        reason: catatan.catatan,
      },
    });
    // Gudang yang menyelesaikan perlu tahu ada barang yang harus disiapkan.
    notifikasi = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_TUKAR.PERLU_DISELESAIKAN,
        severity: "INFO",
        title: `Tukar barang ${d.docNo} siap diselesaikan`,
        message: "Penukaran sudah disetujui. Siapkan barang pengganti, lalu tandai selesai saat barang tukar sudah diterima gudang.",
        metadata: { exchangeId: d.id },
      },
    });
    return berhasil(d);
  });
  const terkirim: AdminNotification | null = notifikasi;
  if (hasil.ok && terkirim) void fanOutAdminNotification(terkirim);
  return hasil;
}

/** Tolak — alasan wajib, karena salesman yang di toko harus bisa menjelaskannya. */
export async function tolakTukar(input: { exchangeId: string; olehUserId: string; alasan: unknown }): Promise<HasilKeputusanTukar> {
  const alasan = rapikanAlasanTukar(input.alasan, true);
  if (!alasan.ok) return alasan;

  return runSerializable(async (tx): Promise<HasilKeputusanTukar> => {
    const d = await tx.storeExchange.findUnique({ where: { id: input.exchangeId }, select: PILIH_DOKUMEN });
    if (!d) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (d.salesmanId === input.olehUserId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (d.status !== "DIAJUKAN") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const r = await tx.storeExchange.updateMany({
      where: { id: d.id, status: "DIAJUKAN" },
      data: { status: "DITOLAK", reviewedById: input.olehUserId, reviewedAt: new Date(), reviewNote: alasan.alasan },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_TUKAR.DITOLAK,
        entityType: ENTITAS_TUKAR,
        entityId: d.id,
        changes: { before: { status: d.status }, after: { status: "DITOLAK" } },
        reason: alasan.alasan,
      },
    });
    return berhasil(d);
  });
}

/**
 * Barang sudah benar-benar bertukar di toko — gerakkan stok.
 *
 * SATU transaksi: status berpindah lebih dulu lewat bandingkan-lalu-tukar,
 * lalu setiap baris KELUAR mengurangi dan setiap baris MASUK menambah stok
 * gudang, masing-masing dengan `StockAdjustment` bersumber
 * `STORE_EXCHANGE_OUT`/`STORE_EXCHANGE_IN`. Gagal di tengah → semuanya batal.
 *
 * Mengulang pada dokumen yang sudah SELESAI mengembalikan berhasil tanpa
 * menggerakkan apa pun (`ulang: true`). Penjaga kedua ada di basis data:
 * kunci idempoten tiap penyesuaian stok adalah id barisnya, jadi satu baris
 * tidak mungkin diposting dua kali.
 */
export async function selesaikanTukar(input: { exchangeId: string; olehUserId: string }): Promise<HasilKeputusanTukar> {
  return runSerializable(async (tx): Promise<HasilKeputusanTukar> => {
    const d = await tx.storeExchange.findUnique({ where: { id: input.exchangeId }, select: PILIH_DOKUMEN });
    if (!d) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (d.status === "SELESAI") return berhasil(d, true);
    // Yang mengajukan tidak mengesahkan bahwa barangnya sudah bertukar.
    if (d.salesmanId === input.olehUserId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (d.status === "DIAJUKAN") return { ok: false, kode: "BELUM_DISETUJUI" };
    if (d.status !== "DISETUJUI") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const baris = await barisDokumen(tx, d.id);
    const kurang = await periksaStokKeluar(tx, baris);
    if (kurang.length > 0) return { ok: false, kode: "STOK_KURANG", kurang };

    const r = await tx.storeExchange.updateMany({
      where: { id: d.id, status: "DISETUJUI" },
      data: { status: "SELESAI", completedAt: new Date() },
    });
    if (r.count !== 1) {
      const kini = await tx.storeExchange.findUnique({ where: { id: d.id }, select: { status: true } });
      return kini?.status === "SELESAI" ? berhasil(d, true) : { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    }

    // KELUAR dulu: urutan tetap membuat dua penukaran yang berpacu mengunci
    // baris stok dengan urutan yang sama.
    const urut = [...baris].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "KELUAR" ? -1 : 1));
    for (const b of urut) {
      const keluar = b.direction === "KELUAR";
      const stok = await cariStok(tx, b.itemId, b.variantSku);
      let barisStokId: string;
      let hargaRata: number;
      if (stok) {
        barisStokId = stok.id;
        hargaRata = stok.avgCost.toNumber();
      } else {
        // Hanya MASUK yang bisa sampai di sini (KELUAR sudah lolos cek stok).
        // Baris baru mengambil harga rata-rata saudaranya (varian lain barang
        // yang sama) — bukan harga baru, sekadar titik awal yang wajar.
        const saudara = await tx.inventoryValue.findFirst({ where: { itemId: b.itemId }, select: { avgCost: true } });
        hargaRata = saudara ? saudara.avgCost.toNumber() : 0;
        const baru = await tx.inventoryValue.create({
          data: { itemId: b.itemId, variantSku: b.variantSku, qtyOnHand: 0, reservedQty: 0, avgCost: hargaRata, totalValue: 0 },
          select: { id: true },
        });
        barisStokId = baru.id;
      }

      const nilai = b.qty * hargaRata;
      const sesudah = await tx.inventoryValue.update({
        where: { id: barisStokId },
        data: keluar
          ? { qtyOnHand: { decrement: b.qty }, totalValue: { decrement: nilai }, lastUpdated: new Date() }
          : { qtyOnHand: { increment: b.qty }, totalValue: { increment: nilai }, lastUpdated: new Date() },
        select: { qtyOnHand: true },
      });
      const qtyBaru = sesudah.qtyOnHand.toNumber();

      await tx.stockAdjustment.create({
        data: {
          docNumber: await generateDocNumber("ADJ", tx),
          itemId: b.itemId,
          type: keluar ? "NEGATIVE" : "POSITIVE",
          qtyChange: keluar ? -b.qty : b.qty,
          reason: `Tukar barang ${d.docNo} — ${b.productName}`,
          prevQty: keluar ? qtyBaru + b.qty : qtyBaru - b.qty,
          newQty: qtyBaru,
          prevAvgCost: hargaRata,
          newAvgCost: hargaRata,
          createdById: input.olehUserId,
          source: keluar ? SUMBER_STOK_TUKAR.KELUAR : SUMBER_STOK_TUKAR.MASUK,
          idempotencyKey: `tukar:${b.id}`,
          externalRef: d.docNo,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_TUKAR.SELESAI,
        entityType: ENTITAS_TUKAR,
        entityId: d.id,
        changes: { before: { status: d.status }, after: { status: "SELESAI" } },
        metadata: {
          barisKeluar: baris.filter((b) => b.direction === "KELUAR").length,
          barisMasuk: baris.filter((b) => b.direction === "MASUK").length,
        },
      },
    });
    return berhasil(d);
  });
}

/**
 * Batalkan sebelum stok bergerak. Salesman boleh membatalkan miliknya sendiri
 * (tanpa alasan pun — ia yang tahu toko berubah pikiran); kantor boleh
 * membatalkan milik siapa saja, dengan alasan.
 *
 * Yang sudah SELESAI tidak bisa dibatalkan: stoknya sudah bergerak. Koreksinya
 * adalah penukaran baru ke arah sebaliknya.
 */
export async function batalkanTukar(input: {
  exchangeId: string;
  olehUserId: string;
  sebagai: "SALESMAN" | "KANTOR";
  alasan?: unknown;
}): Promise<HasilKeputusanTukar> {
  const alasan = rapikanAlasanTukar(input.alasan, input.sebagai === "KANTOR");
  if (!alasan.ok) return alasan;

  return runSerializable(async (tx): Promise<HasilKeputusanTukar> => {
    const d = await tx.storeExchange.findUnique({ where: { id: input.exchangeId }, select: PILIH_DOKUMEN });
    // Dokumen salesman lain tidak diakui ada — bukan urusannya.
    if (!d || (input.sebagai === "SALESMAN" && d.salesmanId !== input.olehUserId)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (d.status === "SELESAI") return { ok: false, kode: "SUDAH_SELESAI" };
    if (d.status !== "DIAJUKAN" && d.status !== "DISETUJUI") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    // Catatan keputusan terakhir yang dibawa baris ini. Catatan persetujuan
    // sebelumnya tidak hilang: ia hidup di jejaknya.
    const r = await tx.storeExchange.updateMany({
      where: { id: d.id, status: d.status },
      data: {
        status: "DIBATALKAN",
        reviewNote: alasan.alasan,
        ...(input.sebagai === "KANTOR" ? { reviewedById: input.olehUserId, reviewedAt: new Date() } : {}),
      },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_TUKAR.DIBATALKAN,
        entityType: ENTITAS_TUKAR,
        entityId: d.id,
        changes: { before: { status: d.status, reviewNote: d.reviewNote }, after: { status: "DIBATALKAN" } },
        metadata: { sebagai: input.sebagai },
        reason: alasan.alasan,
      },
    });
    return berhasil(d);
  });
}

export type { NilaiTukar };
