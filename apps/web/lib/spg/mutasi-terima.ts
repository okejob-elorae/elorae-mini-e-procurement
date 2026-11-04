import type { AdminNotification, Prisma } from "@elorae/db";
import {
  bacaAturanMutasi,
  bulanWib,
  ENTITAS_MUTASI,
  JEJAK_MUTASI,
  KATEGORI_NOTIF_MUTASI,
  KUNCI_ATURAN_MUTASI,
  selisihPenerimaan,
  sudahMacet,
  type AturanMutasi,
} from "./mutasi-aturan";

/**
 * Bagian penerimaan mutasi yang berjalan DI DALAM transaksi penerimaan kiriman
 * (`terimaKiriman` di `stok-writer.ts`) — juga dipakai penulis mutasi.
 *
 * Modul sendiri supaya `stok-writer` dan `mutasi-writer` tidak saling
 * mengimpor: keduanya bergantung ke sini, sini tidak bergantung ke keduanya.
 */

type Tx = Prisma.TransactionClient;

export async function bacaAturanMutasiTx(tx: Tx): Promise<AturanMutasi> {
  const s = await tx.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_MUTASI }, select: { value: true } });
  return bacaAturanMutasi(s?.value);
}

/** SPG toko = pengguna yang ditugaskan tetap di toko itu (`User.assignedStoreId`). */
export async function spgToko(tx: Tx, storeId: string): Promise<string[]> {
  const rows = await tx.user.findMany({ where: { assignedStoreId: storeId }, select: { id: true }, orderBy: { id: "asc" } });
  return rows.map((r) => r.id);
}

/** Buku stok toko sudah dimulai = sudah ada satu gerakan pun. */
export async function bukuDimulai(tx: Tx, storeId: string): Promise<boolean> {
  return (await tx.storeStockMovement.findFirst({ where: { storeId }, select: { id: true } })) !== null;
}

/**
 * Siklus konsinyasi yang sudah DIKUNCI di bulan `pada` (kalender WIB) untuk
 * toko-toko ini. Gerakan stok di bulan yang laporannya sudah dikunci mengubah
 * angka yang mungkin sudah dicetak — SPG ditolak, kantor harus menyatakan sadar.
 */
export async function siklusTerkunciDi(tx: Tx, storeIds: string[], pada: Date): Promise<string[]> {
  const ids = [...new Set(storeIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { tahun, bulan } = bulanWib(pada);
  const rows = await tx.consignmentCycle.findMany({
    where: { storeId: { in: ids }, periodYear: tahun, periodMonth: bulan, lockedAt: { not: null } },
    select: { noKonsi: true },
    orderBy: { noKonsi: "asc" },
  });
  return rows.map((r) => r.noKonsi);
}

export type PenolakanTerimaMutasi = "KIRIMAN_TIDAK_DITEMUKAN" | "MASIH_DITUNGGU_SPG" | "SIKLUS_TERKUNCI";

export type TransferRingkas = {
  id: string;
  docNo: string;
  fromStoreId: string;
  toStoreId: string;
  createdById: string;
  shippedAt: Date | null;
  cancelledAt: Date | null;
};

/**
 * Penjaga sebelum menulis apa pun. Kantor hanya boleh menerima atas nama toko
 * yang tidak punya SPG, atau kiriman yang sudah melewati `hariPengingat` —
 * selain itu, yang menghitung barang adalah SPG yang ada di toko itu.
 */
export async function periksaTerimaMutasi(
  tx: Tx,
  input: {
    sourceType: "MUTASI" | "MUTASI_KEMBALI";
    transferId: string;
    storeId: string;
    olehKantor: boolean;
    setujuSiklusTerkunci: boolean;
    sekarang: Date;
  },
): Promise<{ ok: true; transfer: TransferRingkas; siklusTerkunci: string[] } | { ok: false; alasan: PenolakanTerimaMutasi; noKonsi?: string[] }> {
  const transfer = await tx.storeTransfer.findUnique({
    where: { id: input.transferId },
    select: { id: true, docNo: true, fromStoreId: true, toStoreId: true, createdById: true, shippedAt: true, cancelledAt: true, status: true },
  });
  const tokoPenerima = input.sourceType === "MUTASI" ? transfer?.toStoreId : transfer?.fromStoreId;
  const statusSah = input.sourceType === "MUTASI" ? "DIKIRIM" : "DIKEMBALIKAN";
  if (!transfer || tokoPenerima !== input.storeId || transfer.status !== statusSah) {
    return { ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" };
  }

  if (input.olehKantor) {
    const aturan = await bacaAturanMutasiTx(tx);
    const tanpaSpg = (await spgToko(tx, input.storeId)).length === 0;
    const sejak = input.sourceType === "MUTASI" ? transfer.shippedAt : (transfer.cancelledAt ?? transfer.shippedAt);
    if (!tanpaSpg && !sudahMacet(sejak, aturan.hariPengingat, input.sekarang)) {
      return { ok: false, alasan: "MASIH_DITUNGGU_SPG" };
    }
  }

  const siklusTerkunci = await siklusTerkunciDi(tx, [input.storeId], input.sekarang);
  if (siklusTerkunci.length > 0 && (!input.olehKantor || !input.setujuSiklusTerkunci)) {
    return { ok: false, alasan: "SIKLUS_TERKUNCI", noKonsi: siklusTerkunci };
  }
  return {
    ok: true,
    transfer: {
      id: transfer.id,
      docNo: transfer.docNo,
      fromStoreId: transfer.fromStoreId,
      toStoreId: transfer.toStoreId,
      createdById: transfer.createdById,
      shippedAt: transfer.shippedAt,
      cancelledAt: transfer.cancelledAt,
    },
    siklusTerkunci,
  };
}

/**
 * Pindahkan status mutasi saat diterima — SEBELUM tanda terima ditulis, supaya
 * penolakan tidak meninggalkan baris apa pun. Bandingkan-lalu-tukar, di dalam
 * transaksi serializable pemanggil: dua SPG yang menerima bersamaan tidak bisa
 * sama-sama berhasil.
 *
 * MUTASI: DIKIRIM → DITERIMA. MUTASI_KEMBALI: status tetap DIKEMBALIKAN (sudah
 * akhir); penjaganya adalah kunci unik tanda terima (sumber, id).
 * Selisih kurang membuka `selisihStatus = TERBUKA` di keduanya.
 */
export async function tutupMutasiSaatTerima(
  tx: Tx,
  input: { sourceType: "MUTASI" | "MUTASI_KEMBALI"; transferId: string; storeId: string; baris: { qtySent: number; qtyReceived: number }[] },
): Promise<boolean> {
  const { kurang } = selisihPenerimaan(input.baris);
  if (input.sourceType === "MUTASI") {
    const r = await tx.storeTransfer.updateMany({
      where: { id: input.transferId, toStoreId: input.storeId, status: "DIKIRIM" },
      data: { status: "DITERIMA", ...(kurang > 0 ? { selisihStatus: "TERBUKA" as const } : {}) },
    });
    return r.count === 1;
  }
  if (kurang > 0) {
    const r = await tx.storeTransfer.updateMany({
      where: { id: input.transferId, fromStoreId: input.storeId, status: "DIKEMBALIKAN" },
      data: { selisihStatus: "TERBUKA" },
    });
    return r.count === 1;
  }
  return true;
}

/**
 * Jejak penerimaan + catatan kantor bila ada selisih. Ditulis di transaksi yang
 * sama dengan tanda terimanya. Mengembalikan catatan kantor (untuk disebar
 * SESUDAH transaksi) atau null.
 */
export async function catatTerimaMutasi(
  tx: Tx,
  input: {
    sourceType: "MUTASI" | "MUTASI_KEMBALI";
    transfer: TransferRingkas;
    userId: string;
    receiptId: string;
    baris: { qtySent: number; qtyReceived: number }[];
    olehKantor: boolean;
    tulisBuku: boolean;
    siklusTerkunci: string[];
  },
): Promise<AdminNotification | null> {
  const { kurang, barisKurang } = selisihPenerimaan(input.baris);
  const diterima = input.baris.reduce((n, b) => n + b.qtyReceived, 0);
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.sourceType === "MUTASI" ? JEJAK_MUTASI.DITERIMA : JEJAK_MUTASI.DITERIMA_KEMBALI,
      entityType: ENTITAS_MUTASI,
      entityId: input.transfer.id,
      changes:
        input.sourceType === "MUTASI"
          ? { before: { status: "DIKIRIM" }, after: { status: "DITERIMA", ...(kurang > 0 ? { selisihStatus: "TERBUKA" } : {}) } }
          : { before: { status: "DIKEMBALIKAN" }, after: { status: "DIKEMBALIKAN", ...(kurang > 0 ? { selisihStatus: "TERBUKA" } : {}) } },
      metadata: {
        receiptId: input.receiptId,
        diterima,
        kurang,
        olehKantor: input.olehKantor,
        // Toko tanpa buku stok: penerimaan kantor hanya tanda terima; stok
        // titipan konsinyasi membacanya dari sini.
        tulisBuku: input.tulisBuku,
        ...(input.siklusTerkunci.length > 0 ? { siklusTerkunci: input.siklusTerkunci } : {}),
      },
    },
  });
  if (kurang === 0) return null;
  return tx.adminNotification.create({
    data: {
      category: KATEGORI_NOTIF_MUTASI.SELISIH,
      severity: "WARNING",
      title: `Mutasi ${input.transfer.docNo} diterima kurang ${kurang} potong`,
      message:
        `${barisKurang} baris diterima lebih sedikit dari yang dikirim. ` +
        "Putuskan apakah barangnya hilang, atau kembali ke toko asal.",
      metadata: { transferId: input.transfer.id, kurang },
    },
  });
}
