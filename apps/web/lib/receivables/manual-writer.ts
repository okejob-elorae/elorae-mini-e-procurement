import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatJejak, JEJAK } from './jejak';
import { bacaTanggalMulaiTagihan, tagihanSesudahMulaiBuku } from './gerbang-tanggal-mulai';
import { muatBulanSiklusPertama } from "@/lib/konsinyasi/siklus-pertama";
import { fakturKonsiLewatSiklusPertama } from "@/lib/konsinyasi/siklus-pertama-aturan";

/**
 * Penulis faktur yang diketik manual.
 *
 * Terpisah dari impor karena tuntutannya berbeda: impor menerima berkas apa
 * adanya dan melaporkan yang tidak bisa dipakai, sedangkan yang diketik orang
 * harus ditolak di depan supaya ia bisa langsung membetulkannya.
 */

const D = (n: number) => new Prisma.Decimal(n);

export type BarisFaktur = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type AlasanGagalFaktur =
  | 'NOMOR_WAJIB'
  | 'NOMOR_SUDAH_ADA'
  | 'TOKO_TIDAK_DITEMUKAN'
  /**
   * Utang toko konsinyasi bertanggal pada atau sesudah bulan siklus konsinyasi
   * pertama di sistem (P59): bulan itu dan sesudahnya ditagih lewat siklus,
   * bukan lewat faktur manual atau impor — supaya tidak tertagih dua kali.
   */
  | "KONSI_SESUDAH_SIKLUS_PERTAMA"
  | 'NILAI_TIDAK_VALID'
  | 'TEMPO_SEBELUM_FAKTUR'
  /** Sejak tanggal mulai buku besar, tagihan barang hanya lewat nota tagihan pengiriman. */
  | 'SESUDAH_TANGGAL_MULAI';

export async function buatPiutangManual(input: {
  invoiceNo: string;
  storeId: string;
  salesmanId?: string | null;
  invoiceDate: Date;
  dueDate: Date;
  olehUserId: string;
  amount?: number;
  items?: BarisFaktur[];
}): Promise<{ ok: true; id: string } | { ok: false; alasan: AlasanGagalFaktur }> {
  const nomor = input.invoiceNo?.trim();
  if (!nomor) return { ok: false, alasan: 'NOMOR_WAJIB' };

  const items = (input.items ?? []).filter((b) => b.itemName.trim() && b.qty > 0);
  // Kalau rinciannya ada, totalnya DIHITUNG dari rincian — total yang diketik
  // di samping rincian yang tidak menjumlah ke sana adalah dua kebenaran.
  const total = items.length > 0
    ? items.reduce((s, b) => s + b.qty * b.price, 0)
    : (input.amount ?? 0);
  if (!(total > 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  // Jatuh tempo sebelum tanggal faktur akan langsung tampil lewat tempo pada
  // hari fakturnya dibuat — angka yang tidak berarti apa pun bagi siapa pun.
  if (input.dueDate < input.invoiceDate) return { ok: false, alasan: 'TEMPO_SEBELUM_FAKTUR' };

  // Faktur yang diketik tidak membawa barang: stok tidak berkurang dan HPP-nya
  // tidak ada. Sejak tanggal mulai buku besar penagihan barang hanya lewat nota
  // tagihan pengiriman (pemilik, 2026-10-08); sebelumnya pintu ini tetap untuk
  // memindahkan tagihan lama. `tulisPiutangManual` (beban retur yang dilahirkan
  // sistem) sengaja tidak lewat gerbang ini.
  if (tagihanSesudahMulaiBuku(input.invoiceDate, await bacaTanggalMulaiTagihan(prisma))) {
    return { ok: false, alasan: 'SESUDAH_TANGGAL_MULAI' };
  }

  return runSerializable((tx) =>
    tulisPiutangManual(tx, {
      invoiceNo: nomor,
      storeId: input.storeId,
      salesmanId: input.salesmanId ?? null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      olehUserId: input.olehUserId,
      total,
      items,
    }),
  );
}

/**
 * Tulis satu faktur manual DI DALAM transaksi pemanggil.
 *
 * Dipisah supaya penulis lain bisa melahirkan faktur di transaksi yang sama
 * dengan keputusannya. Penjagaan toko, nomor kembar, dan gerbang siklus
 * konsinyasi pertama tetap di sini.
 *
 * Toko konsinyasi DITERIMA (P32, jawaban pemilik 2026-11-02: utang toko konsi
 * di kertas boleh masuk lewat impor atau ketik manual) dan fakturnya ditandai
 * `isConsignment` menurut jenis toko SAAT dibuat — tanda itu tidak pernah
 * diubah sesudahnya. Faktur konsi bertanggal pada/sesudah bulan siklus pertama
 * di sistem ditolak (P59). Faktur konsi tidak dijurnal STORE_INVOICE; lawannya
 * diketik di Saldo awal → Akun pada akun Piutang Toko Konsinyasi.
 */
export async function tulisPiutangManual(
  tx: Prisma.TransactionClient,
  input: {
    invoiceNo: string;
    storeId: string;
    salesmanId?: string | null;
    invoiceDate: Date;
    dueDate: Date;
    olehUserId: string;
    total: number;
    items?: BarisFaktur[];
    /** Catatan pada faktur; untuk beban retur, penunjuk bebannya. */
    note?: string | null;
    /** Tambahan metadata jejak FAKTUR_MANUAL (mis. sumber beban retur). */
    metadataJejak?: Record<string, unknown>;
  },
): Promise<{ ok: true; id: string } | { ok: false; alasan: AlasanGagalFaktur }> {
  const nomor = input.invoiceNo;
  const items = input.items ?? [];
  const total = input.total;

  const toko = await tx.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, termsType: true },
  });
  if (!toko) return { ok: false as const, alasan: 'TOKO_TIDAK_DITEMUKAN' as const };
  const konsi = toko.termsType === "KONSI";
  if (konsi) {
    // Dibaca di transaksi ini juga: pengaturan yang disimpan bersamaan tidak lolos.
    const pertama = await muatBulanSiklusPertama(tx);
    if (pertama.diatur && fakturKonsiLewatSiklusPertama(input.invoiceDate, pertama.bulan)) {
      return { ok: false as const, alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA" as const };
    }
  }

  const kembar = await tx.receivable.findFirst({
    where: { invoiceNo: nomor },
    select: { id: true },
  });
  if (kembar) return { ok: false as const, alasan: 'NOMOR_SUDAH_ADA' as const };

  const piutang = await tx.receivable.create({
    data: {
      invoiceNo: nomor,
      storeId: input.storeId,
      salesmanId: input.salesmanId ?? null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      amount: D(total),
      // Faktur baru belum dibayar apa pun. Sisanya tetap dihitung ulang oleh
      // pembacanya dari klaim yang menyentuhnya, jadi kolom ini cache.
      outstanding: D(total),
      // Kolom yang dibaca layar pembayaran kantor (Keuangan → Piutang), sama
      // dengan piutang nota (`buatPiutangNota`).
      originalAmount: D(total),
      outstandingAmount: D(total),
      source: 'MANUAL',
      isConsignment: konsi,
      ...(input.note ? { note: input.note } : {}),
      items: {
        create: items.map((b) => ({
          itemId: b.itemId ?? null,
          itemName: b.itemName.trim(),
          qty: b.qty,
          price: D(b.price),
          amount: D(b.qty * b.price),
        })),
      },
    },
    select: { id: true },
  });

  await catatJejak(tx, {
    userId: input.olehUserId,
    action: JEJAK.FAKTUR_MANUAL,
    entityType: 'Receivable',
    entityId: piutang.id,
    changes: { after: { invoiceNo: nomor, storeId: input.storeId, amount: total, isConsignment: konsi } },
    metadata: { jumlahBaris: items.length, ...(input.metadataJejak ?? {}) },
  });

  return { ok: true as const, id: piutang.id };
}
