import Dexie, { Table } from "dexie";

export interface PendingOrder {
  localId: string;
  storeId: string;
  storeName: string;
  visitId: string | null;
  /**
   * Check-in yang juga dicatat TANPA sinyal (id buatan HP, `StoreVisit.clientId`).
   * Antrean mengirim check-in itu lebih dulu; pesanan menunggu selama check-in
   * masih di HP. Bukan indeks.
   */
  visitClientId?: string | null;
  note?: string;
  lines: Array<{
    itemId: string;
    variantSku: string;
    productName: string;
    qty: number;
    unitPrice: number;
    requestedUnitPrice?: number | null;
    appealReason?: string | null;
  }>;
  /** Pesanan jarak jauh (WA/telepon), dicatat tanpa kunjungan. Kosong = pesanan saat kunjungan. Bukan indeks — tanpa naik versi. */
  remoteChannel?: "WA" | "TELEPON" | "LAINNYA" | null;
  /** Jendela pre-order (inden). Kosong = pesanan stok siap. Bukan indeks — tanpa naik versi. */
  preorderWindowId?: string | null;
  /**
   * Mengubah pesanan sendiri: id pesanan lama yang diganti (server membatalkannya
   * di transaksi yang sama dengan pesanan baru). `gantiOrderNo` hanya untuk
   * ditampilkan di "Belum terkirim". Bukan indeks — tanpa naik versi.
   */
  gantiOrderId?: string | null;
  gantiOrderNo?: string | null;
  capturedAt: number;
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
}

export interface PendingPhoto {
  localId: string;
  visitId: string;
  storeId: string;
  blob: Blob;
  caption?: string;
  capturedAt: number;
  syncState: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
}

/**
 * Foto laporan yang belum tentu sudah naik. `blob` = berkas di HP (dipilih saat
 * tanpa sinyal); `url` diisi begitu terunggah — disimpan kembali ke baris
 * antrean supaya percobaan berikutnya tidak mengunggah foto yang sama dua kali.
 */
export interface FotoTertunda {
  nama: string;
  blob?: Blob;
  url?: string;
}

type KeadaanAntre = "pending" | "syncing" | "failed";

/** Laporan pelunasan (BKM) yang menunggu sinyal. `localId` = kunci kiriman ke server. */
export interface PendingClaim {
  localId: string;
  storeId: string;
  storeName: string;
  receivedAmount: number;
  payload: {
    claimedTransferAt: string;
    method: string;
    pelunasan: { receivableId: string; nilai: number }[];
    potongan: {
      nama: string;
      nilai: number;
      deductionTypeId: string | null;
      storeReturnId: string | null;
      catatan: string;
    }[];
    /** Rincian bilyet kalau cara bayarnya giro. Tanggal "YYYY-MM-DD" (WIB). */
    giro?: { nomor: string; bank: string; tanggalTerbit: string; tanggalEfektif: string } | null;
    /** BKM yang digantikan ("Laporkan ulang"). */
    menggantikanId?: string | null;
  };
  fotoTransfer: FotoTertunda | null;
  fotoRincian: FotoTertunda | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/** Nota retur toko (NRT) yang menunggu sinyal. `localId` = kunci kiriman ke server. */
export interface PendingReturn {
  localId: string;
  storeId: string;
  storeName: string;
  payload: {
    noNrt: string;
    claimDate: string;
    deliveryMethod: "SALES" | "TOKO" | "EKSPEDISI";
    claimedAmount: number;
    note: string;
    /** Nota batal yang digantikan ("Laporkan ulang"). */
    menggantikanId?: string | null;
    /**
     * Baris barang dari HP SPG (barang, varian, qty, kondisi) — tanpa harga.
     * Kolom tak berindeks, jadi tidak butuh versi Dexie baru; antrean lama
     * tanpa kolom ini tetap terkirim sebagai nota salesman.
     */
    barisSpg?: { itemId: string; variantSku?: string | null; qty: number; condition?: "LAYAK" | "RUSAK" | "EXPIRED" }[];
  };
  foto: FotoTertunda | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/**
 * Janji bayar / tukar faktur yang dicatat di depan toko dan menunggu sinyal.
 * `localId` = kunci kiriman ke server. Selama masih di sini, janjinya belum
 * tercatat sama sekali — faktur-fakturnya belum berpindah ke "sudah dikontrabon".
 */
export interface PendingPromise {
  localId: string;
  storeId: string;
  storeName: string;
  /** Sisa faktur saat dicatat — hanya untuk ditampilkan di "Belum terkirim". */
  nilai: number;
  payload: {
    receivableIds: string[];
    /** Hari laporannya dibuat di HP ("YYYY-MM-DD", WIB) — tanggal serahnya. */
    tanggalSerah: string;
    janjiBayar: string;
    receivedBy: string;
    note: string;
  };
  foto: FotoTertunda | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/**
 * Bukti terima satu pengiriman yang dicatat di depan toko tanpa sinyal.
 * `localId` = kunci kiriman ke server. Gambarnya (foto nota bertanda tangan
 * atau tanda tangan di layar) disimpan sebagai berkas dan diunggah saat sinkron.
 * Selama masih di sini, pengirimannya BELUM tercatat diterima di kantor.
 */
export interface PendingBuktiTerima {
  localId: string;
  deliveryId: string;
  orderId: string;
  /** Nomor nota pengiriman dan nama toko — hanya untuk ditampilkan di "Belum terkirim". */
  docNo: string;
  storeName: string;
  payload: {
    receivedByName: string;
    /** Instan ISO. */
    receivedAt: string;
    jenisBukti: "FOTO" | "TANDA_TANGAN";
  };
  foto: FotoTertunda | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/**
 * Pembeli pada nota SPG yang tertahan: pelanggan toko yang sudah ada (`id`,
 * `nama` hanya untuk ditampilkan), atau pembeli baru yang dicatat di konter —
 * nomornya hanya dikirim kalau pembeli setuju dihubungi lewat WhatsApp.
 */
export type PembeliTertahan = { id: string; nama: string } | { nama: string; hp: string; setuju: boolean };

/**
 * Nota penjualan SPG yang dicatat tanpa sinyal. `localId` = kunci idempotensi
 * keranjangnya, jadi kiriman ulang (jawaban hilang di jalan) tidak pernah
 * mencatat nota kedua. Selama masih di sini, penjualannya BELUM tercatat sama
 * sekali — tidak ada nomor nota, tidak masuk laporan, target, atau komisi.
 *
 * Harga dan promo di sini hanya PRATINJAU di HP. Server menilai ulang saat
 * terkirim; yang tercatat adalah hitungan server.
 */
export interface PendingSpgSale {
  localId: string;
  storeId: string;
  storeName: string;
  /** Kunjungan (check-in) saat barang dijual — server menerimanya walau sudah check-out. */
  visitId: string | null;
  /**
   * Check-in yang juga dicatat TANPA sinyal (id buatan HP). Pengganti `visitId`
   * saat check-in itu belum sampai ke server; nota menunggu sampai ia terkirim.
   */
  visitClientId?: string | null;
  /** Saat tombol simpan ditekan (ISO). Nota tercatat pada waktu ini, bukan saat terkirim. */
  waktuJual: string;
  lines: Array<{
    itemId: string;
    variantSku: string | null;
    qty: number;
    productName: string;
    /** Harga per potong di layar saat dijual (pratinjau). */
    unitPrice: number;
  }>;
  pembeli: PembeliTertahan | null;
  diskonManual: { jenis: "PERSEN" | "RUPIAH"; nilai: number; alasan: string | null } | null;
  /** Total bersih di layar saat dijual (pratinjau). */
  totalPratinjau: number;
  /** Seluruh potongan di layar saat dijual (pratinjau). */
  potonganPratinjau: number;
  saleLat?: number | null;
  saleLng?: number | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/**
 * Check-in yang dicatat TANPA sinyal. `localId` = id buatan HP yang juga
 * menjadi `StoreVisit.clientId` di server — kunci kiriman, dan cara pekerjaan
 * lain di kunjungan ini (nota, pesanan, stok, check-out) menunjuknya sebelum
 * server memberinya id. Selama baris ini masih di sini, kunjungannya BELUM
 * tercatat di kantor (absensi SPG pun belum).
 */
export interface PendingCheckin {
  localId: string;
  storeId: string;
  storeName: string | null;
  /** Saat check-in ditekan di HP (ms). Server mencatat kunjungan pada waktu ini. */
  waktu: number;
  lat: number;
  lng: number;
  akurasi: number | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  /** Angka penolakan radius (DI_LUAR_RADIUS), untuk alasan di layar. */
  galatRinci?: { jarakMeter?: number; radiusMeter?: number } | null;
  attempts: number;
}

/**
 * Check-out yang dicatat tanpa sinyal — dikirim PALING AKHIR, sesudah
 * pekerjaan kunjungannya. Menunjuk kunjungan server (`visitId`) atau check-in
 * yang juga masih/pernah di antrean (`visitClientId`).
 */
export interface PendingCheckout {
  localId: string;
  storeId: string;
  storeName: string | null;
  visitId: string | null;
  visitClientId: string | null;
  /** Saat check-out ditekan di HP (ms). */
  waktu: number;
  lat: number;
  lng: number;
  /** Alasan tanpa transaksi (salesman), bila ditanyakan HP. */
  outcome: string | null;
  outcomeNote: string | null;
  /** HP melihat transaksi kunjungan ini masih di antrean saat check-out. */
  transaksiTertunda: boolean;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/** Ikatan kunjungan pekerjaan stok dari antrean: kunjungan server ATAU check-in tanpa sinyal. */
type IkatanKunjungan = { visitId: string | null; visitClientId: string | null };

/**
 * Tanda terima kiriman yang dihitung tanpa sinyal. `localId` = kunci kiriman
 * (sekali per formulir). Foto barang rusak disimpan sebagai berkas di HP dan
 * diunggah saat sinkron. Selama di sini, stok tokonya BELUM bertambah.
 */
export interface PendingStoreReceipt extends IkatanKunjungan {
  localId: string;
  storeId: string;
  sourceType: string;
  sourceId: string;
  /** Nomor dokumen kiriman — hanya untuk ditampilkan. */
  docNo: string;
  /** Saat dihitung di HP (ms). */
  waktu: number;
  diterima: Array<{
    lineId: string;
    /** Nama barang — hanya untuk ditampilkan. */
    productName: string;
    qtySent: number;
    qtyReceived: number;
    qtyDamaged?: number;
    damageNote?: string;
    foto?: FotoTertunda | null;
  }>;
  note: string | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  /** Nomor siklus konsinyasi yang terkunci (SIKLUS_TERKUNCI), untuk alasan di layar. */
  noKonsi?: string[];
  attempts: number;
}

/**
 * Opname toko yang dihitung tanpa sinyal. Saldo sistem dan selisihnya dinilai
 * SERVER saat terkirim (per waktu hitung), bukan dari angka di HP.
 */
export interface PendingStoreOpname extends IkatanKunjungan {
  localId: string;
  storeId: string;
  /** Saat rak dihitung di HP (ms). */
  waktu: number;
  baris: Array<{ itemId: string; variantSku: string | null; qtyCounted: number; productName: string }>;
  note: string | null;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/**
 * Barang kembali dari pembeli yang dicatat tanpa sinyal. `localId` = kunci
 * kiriman. Tidak terikat kunjungan (retur pembeli tidak butuh check-in).
 */
export interface PendingSpgReturn {
  localId: string;
  storeId: string;
  spgSaleId: string;
  /** Nomor nota — hanya untuk ditampilkan. */
  docNo: string;
  /** Saat dicatat di HP (ms). */
  waktu: number;
  alasan: string;
  baris: Array<{ saleLineId: string; qty: number; condition: "LAYAK" | "RUSAK" | "EXPIRED"; productName: string }>;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  attempts: number;
}

/** Baris yang melebihi saldo toko (penolakan `SALDO_KURANG`), untuk alasan di layar. */
export type KurangSaldoTertahan = { itemId: string; variantSku: string; qty: number; tersedia: number; productName: string };

/**
 * Mutasi antar toko yang DIAJUKAN tanpa sinyal. `localId` = kunci kiriman
 * (`StoreTransfer.idempotencyKey`), dibuat sekali per formulir. Selama di sini,
 * mutasinya BELUM ada di kantor — belum bernomor, belum bisa disetujui. Aturan
 * arah, toko tujuan, dan saldo dinilai server saat terkirim.
 */
export interface PendingMutasiAjuan extends IkatanKunjungan {
  localId: string;
  storeId: string;
  toStoreId: string;
  /** Nama toko tujuan — hanya untuk ditampilkan. */
  tujuanNama: string;
  /**
   * Menurut aturan yang dimuat layar saat diajukan: arah ini tanpa persetujuan
   * kantor, jadi barangnya boleh ditandai dikirim dari HP sebelum ajuannya
   * sampai. Server menilai aturannya ulang saat terkirim.
   */
  langsung: boolean;
  alasan: string;
  baris: Array<{ itemId: string; variantSku: string | null; qty: number; productName: string }>;
  /** Saat Ajukan ditekan di HP (ms). Mutasi tercatat pada waktu ini. */
  waktu: number;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  kurang?: KurangSaldoTertahan[];
  attempts: number;
}

/**
 * Tanda "barang sudah dikirim" untuk mutasi keluar, dicatat tanpa sinyal.
 * `localId` = kunci kiriman (sekali per ketukan). Selama di sini, stok toko
 * asal BELUM berkurang di kantor dan toko tujuan belum diberi tahu.
 *
 * Menunjuk mutasi server (`transferId`), atau ajuan yang juga masih di HP
 * (`ajuanLocalId`, arah tanpa persetujuan): dikirim sesudah ajuannya sampai,
 * dan `transferId`-nya diisi begitu server memberi id.
 */
export interface PendingMutasiKirim extends IkatanKunjungan {
  localId: string;
  storeId: string;
  transferId: string | null;
  ajuanLocalId: string | null;
  /** Nomor mutasi (kosong selama ajuannya masih di HP) — hanya untuk ditampilkan. */
  docNo: string | null;
  tujuanNama: string;
  pcs: number;
  /** Saat "Ya, sudah dikirim" ditekan di HP (ms). Stok keluar pada waktu ini. */
  waktu: number;
  capturedAt: number;
  syncState: KeadaanAntre;
  error?: string;
  noKonsi?: string[];
  kurang?: KurangSaldoTertahan[];
  attempts: number;
}

// Separate DB from the backoffice EloraeOfflineDB (different scope: PWA field work).
export class PwaOfflineDB extends Dexie {
  pendingOrders!: Table<PendingOrder, string>;
  pendingPhotos!: Table<PendingPhoto, string>;
  pendingClaims!: Table<PendingClaim, string>;
  pendingReturns!: Table<PendingReturn, string>;
  pendingPromises!: Table<PendingPromise, string>;
  pendingBuktiTerima!: Table<PendingBuktiTerima, string>;
  pendingSpgSales!: Table<PendingSpgSale, string>;
  pendingCheckins!: Table<PendingCheckin, string>;
  pendingCheckouts!: Table<PendingCheckout, string>;
  pendingStoreReceipts!: Table<PendingStoreReceipt, string>;
  pendingStoreOpnames!: Table<PendingStoreOpname, string>;
  pendingSpgReturns!: Table<PendingSpgReturn, string>;
  pendingMutasiAjuan!: Table<PendingMutasiAjuan, string>;
  pendingMutasiKirim!: Table<PendingMutasiKirim, string>;
  constructor() {
    super("elorae-pwa-offline");
    this.version(1).stores({ pendingOrders: "localId, syncState, storeId, capturedAt" });
    this.version(2).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
    });
    this.version(3).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
    });
    // Versi 4: janji bayar dari lapangan. Tabel lama disebut ulang apa adanya —
    // Dexie hanya menambah tabel baru, isi antrean yang ada tidak disentuh.
    this.version(4).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
      pendingPromises: "localId, syncState, capturedAt",
    });
    // Versi 5: bukti terima pengiriman (nama penerima + foto nota/tanda tangan).
    this.version(5).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
      pendingPromises: "localId, syncState, capturedAt",
      pendingBuktiTerima: "localId, syncState, orderId, deliveryId, capturedAt",
    });
    // Versi 6: nota penjualan SPG yang dicatat tanpa sinyal.
    this.version(6).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
      pendingPromises: "localId, syncState, capturedAt",
      pendingBuktiTerima: "localId, syncState, orderId, deliveryId, capturedAt",
      pendingSpgSales: "localId, syncState, storeId, capturedAt",
    });
    // Versi 7: check-in/check-out tanpa sinyal dan pekerjaan stok SPG tanpa
    // sinyal (terima kiriman, opname, barang kembali dari pembeli). Ketujuh
    // tabel lama disebut ulang apa adanya.
    this.version(7).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
      pendingPromises: "localId, syncState, capturedAt",
      pendingBuktiTerima: "localId, syncState, orderId, deliveryId, capturedAt",
      pendingSpgSales: "localId, syncState, storeId, capturedAt",
      pendingCheckins: "localId, syncState, storeId, capturedAt",
      pendingCheckouts: "localId, syncState, capturedAt",
      pendingStoreReceipts: "localId, syncState, sourceId, capturedAt",
      pendingStoreOpnames: "localId, syncState, capturedAt",
      pendingSpgReturns: "localId, syncState, spgSaleId, capturedAt",
    });
    // Versi 8: mutasi antar toko tanpa sinyal (ajuan dan tanda dikirim). Kedua
    // belas tabel lama disebut ulang apa adanya.
    this.version(8).stores({
      pendingOrders: "localId, syncState, storeId, capturedAt",
      pendingPhotos: "localId, syncState, visitId, capturedAt",
      pendingClaims: "localId, syncState, capturedAt",
      pendingReturns: "localId, syncState, capturedAt",
      pendingPromises: "localId, syncState, capturedAt",
      pendingBuktiTerima: "localId, syncState, orderId, deliveryId, capturedAt",
      pendingSpgSales: "localId, syncState, storeId, capturedAt",
      pendingCheckins: "localId, syncState, storeId, capturedAt",
      pendingCheckouts: "localId, syncState, capturedAt",
      pendingStoreReceipts: "localId, syncState, sourceId, capturedAt",
      pendingStoreOpnames: "localId, syncState, capturedAt",
      pendingSpgReturns: "localId, syncState, spgSaleId, capturedAt",
      pendingMutasiAjuan: "localId, syncState, storeId, capturedAt",
      pendingMutasiKirim: "localId, syncState, transferId, ajuanLocalId, capturedAt",
    });
  }
}

export const pwaDb = new PwaOfflineDB();
