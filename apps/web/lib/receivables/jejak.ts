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
   * Retur pembeli sejak 2026-11-02 (keputusan pemilik): SPG MELAPORKAN, dan
   * laporannya baru berpengaruh (buku stok toko, penjualan bersih, komisi)
   * setelah kantor menyetujui. Ditolak kantor atau ditarik SPG = tidak pernah
   * berpengaruh. Setiap keputusan membawa pasangan status sebelum/sesudah.
   */
  RETUR_PEMBELI_DILAPORKAN: "SPG_SALE_RETURN_REPORTED",
  RETUR_PEMBELI_DISETUJUI: "SPG_SALE_RETURN_APPROVED",
  RETUR_PEMBELI_DITOLAK: "SPG_SALE_RETURN_REJECTED",
  RETUR_PEMBELI_DITARIK: "SPG_SALE_RETURN_WITHDRAWN",
  /** SPG mencatat uang retur sudah dikembalikan ke pembeli (foto struk; P77). */
  RETUR_PEMBELI_UANG_DIKEMBALIKAN: "SPG_SALE_RETURN_REFUNDED",
  /** Penarikan laporan retur pembeli dibatalkan: uangnya dicatat di HP sebelum SPG menariknya (P78) — sebelum/sesudah. */
  RETUR_PEMBELI_PENARIKAN_DIBATALKAN: "SPG_SALE_RETURN_WITHDRAWAL_UNDONE",
  /** Penolakan retur pembeli yang keliru dibatalkan kantor (P82) — sebelum/sesudah. */
  RETUR_PEMBELI_PENOLAKAN_DIBATALKAN: "SPG_SALE_RETURN_REJECTION_REVERSED",
  /** Retur yang sudah dibebankan ke SPG akhirnya diterima (uang SPG dikembalikan, P79). */
  RETUR_PEMBELI_DITERIMA_SESUDAH_BEBAN: "SPG_SALE_RETURN_ACCEPTED_AFTER_CHARGE",
  /** Beban SPG (`SpgCharge`) lahir dari retur pembeli yang ditolak sesudah uangnya dikembalikan. */
  BEBAN_SPG_DIBUAT: "SPG_CHARGE_CREATED",
  /** Besar beban SPG diubah kantor (P81) — sebelum/sesudah dan alasannya. */
  BEBAN_SPG_DIUBAH: "SPG_CHARGE_AMOUNT_CHANGED",
  /** Beban SPG dipotong dari komisi/gaji pada pembayaran bulan itu. */
  BEBAN_SPG_DIPOTONG: "SPG_CHARGE_DEDUCTED",
  BEBAN_SPG_DIBATALKAN: "SPG_CHARGE_CANCELLED",
  /** Barang retur yang dibebankan: kembali ke stok atau dibeli SPG (P79). */
  BEBAN_SPG_BARANG_DIPUTUSKAN: "SPG_CHARGE_GOODS_DECIDED",
  /** Potongan beban SPG dikembalikan pada pembayaran berikutnya. */
  BEBAN_SPG_DIKEMBALIKAN: "SPG_CHARGE_PAID_BACK",
  BEBAN_DIPUTUSKAN: 'RETURN_CHARGE_ASSIGNED',
  BEBAN_LUNAS: 'RETURN_CHARGE_SETTLED',
  /** Sales pemegang toko melaporkan hasil mencari barang selisih retur (ketemu / tidak ketemu, P88). */
  BEBAN_HASIL_CEK: "RETURN_CHARGE_CHECK_REPORTED",
  /** Gudang menghitung barang susulan sebuah nota retur toko. */
  RETUR_SUSULAN_DIHITUNG: "STORE_RETURN_FOLLOW_UP_COUNTED",
  /** Hitungan gudang tanpa nota dijadikan susulan sebuah nota retur toko. */
  RETUR_SUSULAN_DIJODOHKAN: "STORE_RETURN_FOLLOW_UP_MATCHED",
  RETUR_SUSULAN_DILEPAS: "STORE_RETURN_FOLLOW_UP_UNMATCHED",
  /** Besar beban selisih retur berubah karena barang susulan — sebelum/sesudah. */
  BEBAN_DISESUAIKAN: "RETURN_CHARGE_ADJUSTED",
  /** Beban selisih retur dipotong dari komisi sales (bulan dan jumlahnya). */
  BEBAN_DIPOTONG: "RETURN_CHARGE_DEDUCTED",
  /**
   * Kelebihan potongan beban selisih retur dikembalikan ke sales. Jalurnya MENUNGGU jawaban P87:
   * yang disetujui pemilik ("setuju") adalah bawaannya — barang yang ketemu sesudah komisi dipotong
   * tidak dicatat sebagai susulan nota itu — jadi kelebihan potongan tidak terjadi hari ini.
   */
  BEBAN_DIKEMBALIKAN: "RETURN_CHARGE_REFUNDED",
  /** Nota putus dibatalkan lewat "tidak jadi dikirim" — piutangnya ikut dibatalkan. */
  PIUTANG_NOTA_DIBATALKAN: "RECEIVABLE_DELIVERY_VOIDED",
  /** Nota putus dikoreksi karena barang ditolak/hilang di pintu toko — sebelum/sesudah. */
  PIUTANG_NOTA_DIKOREKSI: "RECEIVABLE_DELIVERY_CORRECTED",
  /**
   * Tagihan siklus konsinyasi lahir saat angka terjual dikunci (keputusan 2026-10-29):
   * bernomor konsi, atas nama pemegang toko saat dikunci (P55), bertanggal akhir bulan
   * siklus (`tanggalPeriode`, sama dengan tanggal jurnalnya), jatuh tempo = pukul 00:00 WIB
   * hari DIKUNCI + tempo toko (P54, disetujui pemilik 2026-11-02 — "setuju" atas usulan
   * "jatuh tempo dihitung dari tanggal dikunci": siklus Oktober dikunci 5 November, tempo
   * 30 hari → jatuh tempo 5 Desember). Jejak ini mencatat tanggal yang benar-benar dipakai.
   */
  TAGIHAN_KONSI_DIBUAT: "CONSIGNMENT_RECEIVABLE_CREATED",
  /** Tagihan siklus konsinyasi dibatalkan karena kunci siklusnya dibuka — sebelum/sesudah. */
  TAGIHAN_KONSI_DIBATALKAN: "CONSIGNMENT_RECEIVABLE_VOIDED",

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
  /** Bulan siklus konsinyasi pertama di sistem diatur (P59) — sebelum/sesudah. */
  KONSI_SIKLUS_PERTAMA: "CONSIGNMENT_FIRST_CYCLE_MONTH_SET",

  JENIS_POTONGAN_DIBUAT: 'DEDUCTION_TYPE_CREATED',
  JENIS_POTONGAN_DIUBAH: 'DEDUCTION_TYPE_UPDATED',

  TUGAS_TAGIH_DIBUAT: 'COLLECTION_TASK_CREATED',
  TUGAS_TAGIH_SELESAI: 'COLLECTION_TASK_DONE',
  TUGAS_TAGIH_SELESAI_OTOMATIS: 'COLLECTION_TASK_AUTO_DONE',
  TUGAS_TAGIH_DIBATALKAN: 'COLLECTION_TASK_CANCELLED',

  /*
   * Utang pemasok: koreksi selisih harga invoice, permintaan invoice, invoice
   * tidak perlu, dan penerimaan barang tanpa PO yang menunggu konfirmasi admin.
   */
  KOREKSI_UTANG_DIBUAT: "SUPPLIER_PAYABLE_CORRECTION_CREATED",
  KOREKSI_UTANG_DITERIMA: "SUPPLIER_PAYABLE_CORRECTION_ACCEPTED",
  KOREKSI_UTANG_INVOICE_DIKOREKSI: "SUPPLIER_PAYABLE_CORRECTION_INVOICE_CORRECTED",
  KOREKSI_UTANG_DIBATALKAN: "SUPPLIER_PAYABLE_CORRECTION_CANCELLED",
  PERMINTAAN_INVOICE_DIBUAT: "SUPPLIER_INVOICE_REQUEST_CREATED",
  PERMINTAAN_INVOICE_DIULANG: "SUPPLIER_INVOICE_REQUEST_FOLLOWED_UP",
  PERMINTAAN_INVOICE_DIBATALKAN: "SUPPLIER_INVOICE_REQUEST_CANCELLED",
  INVOICE_TIDAK_PERLU: "SUPPLIER_INVOICE_WAIVED",
  INVOICE_TIDAK_PERLU_DIBATALKAN: "SUPPLIER_INVOICE_WAIVER_CANCELLED",
  GRN_TANPA_PO_DIKONFIRMASI: "GRN_NO_PO_CONFIRMED",
  GRN_TANPA_PO_DITOLAK: "GRN_NO_PO_DECLINED",

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

  /*
   * Ruang KOL (2026-10-07). Kolaborasi = baris `KolBrief`; riwayat otomatis
   * di linimasa kolaborasi/KOL dibaca dari nama-nama di bawah ini, jadi
   * penulis baru memakai nama yang ada, bukan menulis string sendiri.
   */
  KOLABORASI_PINDAH_TAHAP: 'KOL_COLLAB_STAGE_CHANGED',
  KOLABORASI_MAJU_OTOMATIS: 'KOL_COLLAB_STAGE_AUTO_ADVANCED',
  KOLABORASI_DIUBAH: 'KOL_COLLAB_UPDATED',
  /** "Kirim WA: <template>" — ikut memperbarui kontak terakhir. */
  KOLABORASI_KONTAK: 'KOL_COLLAB_CONTACTED',
  KOL_DIBLOKIR: 'KOL_BLOCKED',
  KOL_DIBUKA_BLOKIR: 'KOL_UNBLOCKED',
  CAMPAIGN_DIBUAT: 'KOL_CAMPAIGN_CREATED',
  CAMPAIGN_DIUBAH: 'KOL_CAMPAIGN_UPDATED',
  CAMPAIGN_DIARSIPKAN: 'KOL_CAMPAIGN_ARCHIVED',
  /** Status campaign (Draft/Berjalan/Selesai/Batal) berubah — sebelum/sesudah. */
  CAMPAIGN_STATUS_DIUBAH: 'KOL_CAMPAIGN_STATUS_CHANGED',
  SAMPEL_DIBUAT: 'KOL_SHIPMENT_CREATED',
  SAMPEL_DIKIRIM: 'KOL_SHIPMENT_SENT',
  SAMPEL_DITERIMA: 'KOL_SHIPMENT_RECEIVED',
  SAMPEL_DIUBAH: 'KOL_SHIPMENT_UPDATED',
  KONTEN_KOL_DICATAT: 'KOL_CONTENT_RECORDED',
  KONTEN_KOL_DIUBAH: 'KOL_CONTENT_UPDATED',
  DRAF_DISETUJUI: 'KOL_DRAFT_APPROVED',
  DRAF_REVISI: 'KOL_DRAFT_REVISION_REQUESTED',
  ANGKA_KONTEN_DICATAT: 'KOL_CONTENT_METRICS_RECORDED',
  PENJUALAN_KOL_DICATAT: 'KOL_SALE_RECORDED',
  PENJUALAN_KOL_DIUBAH: 'KOL_SALE_UPDATED',
  PENJUALAN_KOL_DIHAPUS: 'KOL_SALE_DELETED',
  PEMBAYARAN_KOL_DICATAT: 'KOL_PAYMENT_RECORDED',
  /*
   * Pembayaran KOL per termin + PPh + data pajak (2026-10-07). Data sensitif
   * (rekening/NIK/NPWP) tidak pernah masuk `changes` — hanya tanda "diubah".
   */
  TERMIN_KOL_DIATUR: 'KOL_PAYMENT_TERMS_SET',
  TERMIN_KOL_DIBAYAR: 'KOL_PAYMENT_TERM_PAID',
  TERMIN_KOL_BAYAR_DIBATALKAN: 'KOL_PAYMENT_TERM_PAYMENT_CANCELLED',
  BUKTI_POTONG_KOL_DICATAT: 'KOL_WITHHOLDING_SLIP_RECORDED',
  SETOR_PPH_KOL_DICATAT: 'KOL_WITHHOLDING_DEPOSIT_RECORDED',
  MODE_PAJAK_KOL_DIUBAH: 'KOL_COLLAB_TAX_MODE_CHANGED',
  PAJAK_KOL_DIUBAH: 'KOL_TAX_PROFILE_UPDATED',
  DATA_SENSITIF_KOL_DIUBAH: 'KOL_SENSITIVE_UPDATED',
  DATA_SENSITIF_KOL_DIBUKA: 'KOL_SENSITIVE_VIEWED',
  CATATAN_KOL_DIBUAT: 'KOL_NOTE_CREATED',
  FORMULIR_KOL_LINK_DIBUAT: 'KOL_FORM_LINK_CREATED',
  FORMULIR_KOL_LINK_DICABUT: 'KOL_FORM_LINK_REVOKED',
  FORMULIR_KOL_DICEK: 'KOL_FORM_SUBMISSION_REVIEWED',
  AGENDA_DIBUAT: 'KOL_AGENDA_CREATED',
  AGENDA_DIUBAH: 'KOL_AGENDA_UPDATED',
  AGENDA_SELESAI: 'KOL_AGENDA_DONE',
  AGENDA_DIHAPUS: 'KOL_AGENDA_DELETED',
  /** Tautan langganan Kalender Kreatif (iCal) — tanpa token maupun hash-nya. */
  KALENDER_LANGGANAN_DIBUAT: 'KOL_CALENDAR_FEED_CREATED',
  KALENDER_LANGGANAN_DICABUT: 'KOL_CALENDAR_FEED_REVOKED',
  PENGATURAN_KREATIF_DIUBAH: 'CREATIVE_SETTINGS_UPDATED',
  BRAND_KOL_DITAMBAH: 'KOL_BRAND_COLLAB_ADDED',
  BRAND_KOL_DIHAPUS: 'KOL_BRAND_COLLAB_DELETED',
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
