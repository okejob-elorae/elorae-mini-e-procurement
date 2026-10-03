import type { Prisma } from '@elorae/db';

/**
 * Jejak keputusan untuk modul piutang, retur, konsinyasi, dan creative marketing.
 *
 * Modul ini penuh keputusan uang yang BISA DIBALIK: klaim ditolak lalu
 * diverifikasi, pasangan retur dilepas, kunci konsinyasi dibuka. Tanpa jejak,
 * seluruh penolakan yang dibangun di sini bisa dilangkahi tanpa bekas — dan
 * modul yang seluruh gunanya pertanggungjawaban kehilangan justru itu.
 *
 * Selalu ditulis DI DALAM transaksi yang sama dengan perubahannya. Jejak yang
 * ditulis setelah transaksi bisa gagal sendirian, dan yang tersisa adalah
 * perubahan tanpa catatan — persis keadaan yang mau dicegah.
 */

/**
 * Nama tindakan, terkumpul di satu tempat.
 *
 * Bukan string bebas: nama yang salah ketik tidak akan pernah muncul saat
 * dicari, dan jejak yang tidak bisa dicari sama saja dengan tidak ada.
 */
export const JEJAK = {
  KLAIM_DIBUAT: 'RECEIVABLE_CLAIM_CREATED',
  KLAIM_DIVERIFIKASI: 'RECEIVABLE_CLAIM_VERIFIED',
  KLAIM_DITOLAK: 'RECEIVABLE_CLAIM_REJECTED',
  KLAIM_DIBATALKAN: 'RECEIVABLE_CLAIM_VOIDED',
  POTONGAN_DITAUTKAN: 'RECEIVABLE_DEDUCTION_RELINKED',
  BEBAN_DIALIHKAN: 'RETURN_CHARGE_REASSIGNED',

  KONTRABON_DIBUAT: 'COLLECTION_NOTE_CREATED',
  KONTRABON_SELESAI: 'COLLECTION_NOTE_FINISHED',
  KONTRABON_DIBATALKAN: 'COLLECTION_NOTE_CANCELLED',
  KONTRABON_FOTO: 'COLLECTION_NOTE_PHOTO_ATTACHED',
  KONTRABON_DIKONFIRMASI: 'COLLECTION_NOTE_CONFIRMED',

  RETUR_DICATAT: 'STORE_RETURN_CREATED',
  RETUR_DIHITUNG: 'STORE_RETURN_COUNTED',
  RETUR_DIJODOHKAN: 'STORE_RETURN_MATCHED',
  RETUR_DILEPAS: 'STORE_RETURN_UNMATCHED',
  RETUR_DIBATALKAN: 'STORE_RETURN_CANCELLED',
  /** Nota retur (dan hitungan gudangnya) dipindah ke toko lain — sales salah memilih toko. */
  RETUR_DIPINDAH_TOKO: 'STORE_RETURN_MOVED_STORE',
  /** Nota batal diberi akhiran "(batal)" supaya nomor toko bisa dipakai nota penggantinya. */
  RETUR_NOMOR_DILEPAS: 'STORE_RETURN_NUMBER_RELEASED',
  /** BKM lama digantikan BKM baru (laporkan ulang / buat ulang). Ditulis di BKM LAMA. */
  KLAIM_DIGANTI: 'RECEIVABLE_CLAIM_REPLACED',
  /** Nota retur lama digantikan nota baru. Ditulis di nota LAMA. */
  RETUR_DIGANTI: 'STORE_RETURN_REPLACED',
  /** Sales meminta kantor membetulkan laporan yang sudah diproses (terverifikasi / dihitung gudang). */
  KOREKSI_DIMINTA: 'CORRECTION_REQUESTED',
  /**
   * Pembeli mengembalikan barang ke counter SPG (`SpgSaleReturn`). Uangnya
   * dikembalikan kasir toko — yang dicatat di sini hanya barang dan jumlahnya.
   */
  RETUR_PEMBELI_DICATAT: "SPG_SALE_RETURN_RECORDED",
  BEBAN_DIPUTUSKAN: 'RETURN_CHARGE_ASSIGNED',
  BEBAN_LUNAS: 'RETURN_CHARGE_SETTLED',

  FAKTUR_MANUAL: 'RECEIVABLE_CREATED_MANUAL',
  FAKTUR_IMPOR: 'RECEIVABLE_IMPORTED',
  IMPOR_DIBATALKAN: 'RECEIVABLE_IMPORT_REVERTED',

  KONSI_DIBUKA: 'CONSIGNMENT_CYCLE_OPENED',
  KONSI_DIKIRIM: 'CONSIGNMENT_SHIPPED',
  KONSI_LAPORAN: 'CONSIGNMENT_REPORT_RECORDED',
  KONSI_DIKUNCI: 'CONSIGNMENT_LOCKED',
  KONSI_DIBUKA_KUNCI: 'CONSIGNMENT_UNLOCKED',
  KONSI_GAJI_DIBAYAR: 'CONSIGNMENT_SALARY_PAID',
  KONSI_NOMOR: 'CONSIGNMENT_DOCUMENT_NUMBER',

  JENIS_POTONGAN_DIBUAT: 'DEDUCTION_TYPE_CREATED',
  JENIS_POTONGAN_DIUBAH: 'DEDUCTION_TYPE_UPDATED',

  TUGAS_TAGIH_DIBUAT: 'COLLECTION_TASK_CREATED',
  TUGAS_TAGIH_SELESAI: 'COLLECTION_TASK_DONE',
  TUGAS_TAGIH_SELESAI_OTOMATIS: 'COLLECTION_TASK_AUTO_DONE',
  TUGAS_TAGIH_DIBATALKAN: 'COLLECTION_TASK_CANCELLED',

  /*
   * Creative marketing. Ikut di sini, bukan di daftarnya sendiri, karena
   * `catatJejak` menuntut `action` bertipe `NamaJejak` — daftar kedua akan
   * memaksa sebuah cast di setiap pemanggilan, dan cast semacam itu sudah
   * pernah dibuang dari berkas ini sekali.
   */
  KOL_DIBUAT: 'KOL_CREATED',
  KOL_DIUBAH: 'KOL_UPDATED',
  BRIEF_DIBUAT: 'KOL_BRIEF_CREATED',
  BRIEF_DIKIRIM: 'KOL_BRIEF_SENT',
  BRIEF_PINDAH_STATUS: 'KOL_BRIEF_STATUS_CHANGED',
  BRIEF_DIBATALKAN: 'KOL_BRIEF_CANCELLED',
  KONTEN_DIBUAT: 'CONTENT_PLAN_CREATED',
  KONTEN_DIUBAH: 'CONTENT_PLAN_UPDATED',
  KONTEN_DIHAPUS: 'CONTENT_PLAN_DELETED',
  KONTEN_DITUKAR: 'CONTENT_PLAN_SWAPPED',
} as const;

export type NamaJejak = (typeof JEJAK)[keyof typeof JEJAK];

export type IsiJejak = {
  userId: string;
  action: NamaJejak;
  entityType: string;
  entityId: string;
  /**
   * Keadaan sebelum dan sesudah.
   *
   * Pasangan inilah yang membuat ini jejak, bukan daftar stempel waktu. Baris
   * dokumennya sendiri hanya menyimpan keadaan terakhir — yang tergantikan
   * hanya hidup di sini.
   */
  changes?: { before?: unknown; after?: unknown };
  metadata?: Record<string, unknown>;
  reason?: string | null;
};

export async function catatJejak(
  tx: Prisma.TransactionClient,
  isi: IsiJejak,
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
