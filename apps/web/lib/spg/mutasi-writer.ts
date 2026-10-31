import { prisma, type AdminNotification, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { parseItemVariants, variantDetailForSku, variantSelectOptions } from "@/lib/items/variants";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { denganNomorUnik } from "@/lib/receivables/nomor";
import {
  awalanNomorMutasi,
  ENTITAS_MUTASI,
  JEJAK_MUTASI,
  KATEGORI_NOTIF_MUTASI,
  kekuranganSaldo,
  keputusanArah,
  nomorMutasiBerikut,
  rapikanBarisMutasi,
  rapikanTeksMutasi,
  STATUS_BELUM_DIKIRIM,
  tahunWib,
  type BarisMutasi,
  type KurangSaldo,
  type StatusMutasi,
  type TolakBaris,
} from "./mutasi-aturan";
import { bacaAturanMutasiTx, bukuDimulai, siklusTerkunciDi, spgToko } from "./mutasi-terima";
import { terhitungSesudah, terimaKiriman, type HasilTerimaKiriman } from "./stok-writer";
import { catatHilangDariMutasi } from "./hilang-sumber";
import { kunciBaris } from "./stok";
import { BATAS_STOK_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";

/**
 * Penulis mutasi antar toko (`StoreTransfer`).
 *
 * SPG toko asal MENGAJUKAN (sedang check-in di tokonya), kantor MENYETUJUI atau
 * menolak (kecuali arah yang diatur `LANGSUNG`), SPG toko asal MENANDAI DIKIRIM
 * (stok buku toko asal keluar sebagai MUTASI_KELUAR), lalu toko tujuan
 * MENERIMA lewat layar terima kiriman yang sudah ada (sumber `MUTASI`, lihat
 * `terimaKiriman`). Kantor bisa menerima atas nama toko tujuan yang tanpa SPG
 * atau yang kirimannya macet, membatalkan (sesudah dikirim → DIKEMBALIKAN,
 * toko asal menerima kembali lewat sumber `MUTASI_KEMBALI`), mengalihkan
 * tujuan selama di jalan, dan memutuskan selisih kurang (HILANG / KEMBALI).
 *
 * Aturan yang tidak boleh dilonggarkan:
 * - Toko asal SELALU dari pemanggil (toko tetap SPG), tidak pernah dari layar.
 * - Stok gudang utama (`InventoryValue`) tidak tersentuh sama sekali.
 * - Setiap langkah di `runSerializable`; setiap penjaga keadaan berbentuk
 *   bandingkan-lalu-tukar di dalamnya, dan setiap keputusan menulis jejaknya
 *   di transaksi yang sama (`JEJAK_MUTASI`).
 * - Kabar ke HP dan sebaran catatan kantor SESUDAH transaksi.
 *
 * Mengajukan dan menandai dikirim juga bisa datang dari ANTREAN HP (dicatat
 * tanpa sinyal, `waktuTangkap`): kunci kiriman diperiksa paling dulu dan lagi
 * di dalam transaksi, dokumennya bertanggal saat dikerjakan di HP, dan
 * kunjungannya boleh sudah check-out (`kunjunganId`, diperiksa pemanggil lewat
 * `cariKunjunganAntrean`). Lihat `ajukanMutasi` dan `kirimMutasi`.
 */

type Tx = Prisma.TransactionClient;

const KUNCI_MAKS = 100;

export type BarisKurangSaldo = KurangSaldo & { productName: string };

export type KodeTolakAjuan =
  | "KUNCI_WAJIB"
  | "KUNCI_DIPAKAI"
  | "MUTASI_NONAKTIF"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "TOKO_TIDAK_DITEMUKAN"
  | "TUJUAN_TIDAK_DITEMUKAN"
  | "TUJUAN_SAMA"
  | "ARAH_DITOLAK"
  | "TUJUAN_TANPA_SPG"
  | "TANPA_KUNJUNGAN"
  | "BUKU_BELUM_DIMULAI"
  | TolakBaris
  | "BARANG_TIDAK_DIKENAL"
  | "VARIAN_TIDAK_DIKENAL"
  /** Dari antrean HP: waktu tangkapnya tidak terbaca atau lebih tua dari batas. */
  | "WAKTU_TIDAK_VALID";

export type HasilAjukanMutasi =
  | { ok: true; id: string; docNo: string; status: StatusMutasi; ulang: boolean; kurangSaldo: BarisKurangSaldo[] }
  | { ok: false; kode: KodeTolakAjuan }
  | { ok: false; kode: "SALDO_KURANG"; kurang: BarisKurangSaldo[] };

export type KodeTolakKeputusan =
  | "TIDAK_DITEMUKAN"
  | "MILIK_SENDIRI"
  | "SUDAH_DIPUTUSKAN"
  | "BELUM_DISETUJUI"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "ARAH_DITOLAK"
  | "TOKO_TIDAK_DITEMUKAN"
  | "TUJUAN_TIDAK_DITEMUKAN"
  | "TUJUAN_SAMA"
  | "TUJUAN_TANPA_SPG"
  | "TANPA_KUNJUNGAN"
  | "TIDAK_ADA_SELISIH"
  /** Dari antrean HP: waktu tangkapnya tidak terbaca atau lebih tua dari batas. */
  | "WAKTU_TIDAK_VALID"
  /*
   * Tanda dikirim dari antrean HP yang tiba sesudah mutasinya berubah — lebih
   * rinci dari `SUDAH_DIPUTUSKAN`, karena barangnya MUNGKIN sudah keluar dari
   * rak saat SPG menandainya, dan kalimatnya harus mengatakan apa yang terjadi.
   */
  | "MUTASI_DITOLAK"
  | "MUTASI_DIBATALKAN"
  | "SUDAH_DIKIRIM";

export type HasilKeputusanMutasi =
  | { ok: true; id: string; docNo: string; status: StatusMutasi; ulang: boolean }
  | { ok: false; kode: KodeTolakKeputusan }
  | { ok: false; kode: "SIKLUS_TERKUNCI"; noKonsi: string[] }
  | { ok: false; kode: "SALDO_KURANG"; kurang: BarisKurangSaldo[] };

/** Kabar yang menunggu dikirim sesudah transaksi. */
type KabarTertunda = { userIds: string[]; kabar: Kabar };

async function kirimKabar(daftar: KabarTertunda[]): Promise<void> {
  for (const k of daftar) {
    for (const userId of [...new Set(k.userIds.filter(Boolean))]) await kabariPengguna(userId, k.kabar);
  }
}

// ─── Bantuan di dalam transaksi ──────────────────────────────────────────────

const PILIH_MUTASI = {
  id: true,
  docNo: true,
  fromStoreId: true,
  toStoreId: true,
  status: true,
  createdById: true,
  shippedById: true,
  shippedAt: true,
  selisihStatus: true,
  reviewNote: true,
} as const;

type MutasiRingkas = {
  id: string;
  docNo: string;
  fromStoreId: string;
  toStoreId: string;
  status: StatusMutasi;
  createdById: string;
  shippedById: string | null;
  shippedAt: Date | null;
  selisihStatus: "TERBUKA" | "HILANG" | "KEMBALI" | null;
  reviewNote: string | null;
};

async function muatMutasi(tx: Tx, id: string): Promise<MutasiRingkas | null> {
  return tx.storeTransfer.findUnique({ where: { id }, select: PILIH_MUTASI });
}

const berhasil = (m: { id: string; docNo: string }, status: StatusMutasi, ulang = false) =>
  ({ ok: true, id: m.id, docNo: m.docNo, status, ulang }) as const;

/**
 * Saldo yang masih bisa dikirim per barang+varian: saldo buku toko dikurangi
 * jumlah di mutasi keluar lain yang belum dikirim (DIAJUKAN/DISETUJUI). Buku
 * tidak mengenal pesanan, jadi janji ke mutasi lain dihitung di sini.
 *
 * `sampai` (pekerjaan dari antrean HP): saldo buku PER WAKTU itu — gerakan yang
 * bertanggal sesudahnya (mis. nota tanpa sinyal yang terjual kemudian dan
 * terkirim lebih dulu) belum dialami rak saat SPG mengerjakannya.
 */
async function tersediaDiToko(tx: Tx, storeId: string, baris: BarisMutasi[], kecualiTransferId?: string, sampai?: Date | null) {
  const itemIds = [...new Set(baris.map((b) => b.itemId))];
  const [grup, janji] = await Promise.all([
    tx.storeStockMovement.groupBy({
      by: ["itemId", "variantSku"],
      where: { storeId, itemId: { in: itemIds }, ...(sampai ? { createdAt: { lte: sampai } } : {}) },
      _sum: { qty: true },
    }),
    tx.storeTransferLine.findMany({
      where: {
        itemId: { in: itemIds },
        transfer: {
          fromStoreId: storeId,
          status: { in: [...STATUS_BELUM_DIKIRIM] },
          ...(kecualiTransferId ? { id: { not: kecualiTransferId } } : {}),
        },
      },
      select: { itemId: true, variantSku: true, qty: true },
    }),
  ]);
  const saldo = new Map<string, number>();
  for (const g of grup) saldo.set(kunciBaris(g.itemId, g.variantSku), (saldo.get(kunciBaris(g.itemId, g.variantSku)) ?? 0) + (g._sum.qty ?? 0));
  const dilacak = new Set(saldo.keys());
  for (const j of janji) saldo.set(kunciBaris(j.itemId, j.variantSku), (saldo.get(kunciBaris(j.itemId, j.variantSku)) ?? 0) - j.qty);
  return { tersedia: (itemId: string, variantSku: string) => saldo.get(kunciBaris(itemId, variantSku)) ?? 0, dilacak };
}

/**
 * Yang mengerjakan ada di toko asal. Langsung dari HP: check-in yang masih
 * terbuka. Dari antrean HP (`kunjunganId`): kunjungan saat pekerjaannya
 * dilakukan — milik orang ini di toko ini, tapi boleh sudah check-out (sinyal
 * sering baru kembali sesudah pulang).
 */
async function adaKunjungan(tx: Tx, storeId: string, userId: string, kunjunganId?: string | null): Promise<boolean> {
  const v = await tx.storeVisit.findFirst({
    where: { storeId, userId, ...(kunjunganId ? { id: kunjunganId } : { checkoutAt: null }) },
    select: { id: true },
  });
  return v !== null;
}

/** Waktu tangkap dari antrean HP: `undefined` = bukan dari antrean, `null` = tidak sah (terlalu tua / tak terbaca). */
function waktuDariAntrean(waktuTangkap: Date | null | undefined, sekarang: Date): Date | null | undefined {
  if (waktuTangkap === undefined || waktuTangkap === null) return undefined;
  return jepitWaktuLuring(waktuTangkap, sekarang, BATAS_STOK_LURING_MS);
}

type BacaMutasi = Pick<Tx, "storeTransfer" | "auditLog">;

/**
 * Ajuan yang sudah dicatat dengan kunci ini: hasil yang sama untuk kiriman
 * ulang orang yang sama; `KUNCI_DIPAKAI` kalau kuncinya milik orang lain.
 */
async function ajuanDenganKunci(db: BacaMutasi, kunci: string, userId: string): Promise<HasilAjukanMutasi | null> {
  const ada = await db.storeTransfer.findUnique({
    where: { idempotencyKey: kunci },
    select: { id: true, docNo: true, status: true, createdById: true },
  });
  if (!ada) return null;
  return ada.createdById === userId
    ? { ok: true, id: ada.id, docNo: ada.docNo, status: ada.status, ulang: true, kurangSaldo: [] }
    : { ok: false, kode: "KUNCI_DIPAKAI" };
}

/**
 * Tanda dikirim yang sudah dicatat dengan kunci ini (kunci kiriman HP disimpan
 * di metadata jejak DIKIRIM — tanpa kolom baru). Kiriman ulang mendapat
 * berhasil apa pun status mutasinya sekarang: sesudah dikirim, mutasinya boleh
 * sudah diterima atau dikembalikan. Jejak dicocokkan di JS — penyaringan jalur
 * JSON tidak andal di semua adaptor.
 */
async function kirimanDenganKunci(db: BacaMutasi, transferId: string, kunci: string, storeId: string): Promise<HasilKeputusanMutasi | null> {
  const jejak = await db.auditLog.findMany({
    where: { entityType: ENTITAS_MUTASI, entityId: transferId, action: JEJAK_MUTASI.DIKIRIM },
    select: { metadata: true },
  });
  if (!jejak.some((j) => (j.metadata as { kunciKirim?: unknown } | null)?.kunciKirim === kunci)) return null;
  const m = await db.storeTransfer.findUnique({ where: { id: transferId }, select: { id: true, docNo: true, status: true, fromStoreId: true } });
  return m && m.fromStoreId === storeId ? berhasil(m, m.status, true) : null;
}

/** Mutasi yang tidak lagi bisa dikirim, untuk tanda dikirim dari antrean HP. */
function kodeTakBisaKirim(status: StatusMutasi): KodeTolakKeputusan {
  if (status === "DITOLAK") return "MUTASI_DITOLAK";
  if (status === "DIBATALKAN") return "MUTASI_DIBATALKAN";
  if (status === "DIKIRIM" || status === "DITERIMA" || status === "DIKEMBALIKAN") return "SUDAH_DIKIRIM";
  return "SUDAH_DIPUTUSKAN";
}

async function tokoAktif(tx: Tx, id: string) {
  const t = await tx.store.findUnique({ where: { id }, select: { id: true, name: true, isActive: true, termsType: true } });
  return t && t.isActive ? t : null;
}

async function catatJejak(
  tx: Tx,
  data: { userId: string; action: string; entityId: string; changes?: Prisma.InputJsonValue; metadata?: Prisma.InputJsonValue; reason?: string | null },
) {
  await tx.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: ENTITAS_MUTASI,
      entityId: data.entityId,
      ...(data.changes !== undefined ? { changes: data.changes } : {}),
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      reason: data.reason ?? null,
    },
  });
}

/** Catatan kantor "toko tujuan tanpa SPG — terima atas namanya". */
async function catatPerluDiterima(tx: Tx, m: { id: string; docNo: string }, namaTujuan: string) {
  return tx.adminNotification.create({
    data: {
      category: KATEGORI_NOTIF_MUTASI.PERLU_DITERIMA,
      severity: "INFO",
      title: `Mutasi ${m.docNo} perlu diterima kantor`,
      message: `${namaTujuan} tidak punya SPG. Hitung barangnya saat tiba, lalu terima atas nama toko di halaman mutasi.`,
      metadata: { transferId: m.id },
    },
  });
}

const kabarMasuk = (m: { id: string; docNo: string }, namaAsal: string): Kabar => ({
  jenis: JENIS_KABAR.MUTASI_MASUK,
  judul: `Barang dari ${namaAsal} sedang dikirim`,
  isi: `Mutasi ${m.docNo} menuju toko Anda. Hitung barangnya saat tiba, lalu terima di menu Terima kiriman.`,
  data: { transferId: m.id },
});

// ─── Mengajukan ──────────────────────────────────────────────────────────────

/**
 * SPG toko asal mengajukan mutasi dari tokonya sendiri, sambil check-in di sana.
 *
 * Kunci kiriman diperiksa PALING DULU: kiriman ulang dari HP (jawaban hilang di
 * jalan, dua ketukan) mengembalikan dokumen yang sudah ada apa adanya, tanpa
 * dinilai ulang — saldo yang berubah sesudahnya tidak membuat kiriman kedua gagal.
 *
 * Dari antrean HP (`waktuTangkap`): dokumen bertanggal saat SPG mengajukannya
 * di HP, saldo dinilai per waktu itu, dan kunjungannya (`kunjunganId`) boleh
 * sudah check-out. Aturan arah dan toko dinilai SAAT TERKIRIM — aturan yang
 * diubah pemilik selama HP tanpa sinyal tetap berlaku.
 */
export async function ajukanMutasi(input: {
  userId: string;
  fromStoreId: string;
  toStoreId: unknown;
  baris: unknown;
  alasan: unknown;
  idempotencyKey: unknown;
  sekarang?: Date;
  /** Antrean HP: kunjungan saat diajukan (milik pengguna ini di toko asal; boleh sudah check-out). */
  kunjunganId?: string | null;
  /** Antrean HP: saat tombol Ajukan ditekan di HP. */
  waktuTangkap?: Date | null;
}): Promise<HasilAjukanMutasi> {
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > KUNCI_MAKS) return { ok: false, kode: "KUNCI_WAJIB" };
  // Kunci PALING DULU — sebelum waktu tangkap dinilai: ajuan yang sudah sampai
  // (jawabannya hilang di jalan) tetap terbaca berhasil walau antreannya tua.
  const lama = await ajuanDenganKunci(prisma, kunci, input.userId);
  if (lama) return lama;
  const waktu = waktuDariAntrean(input.waktuTangkap, input.sekarang ?? new Date());
  if (waktu === null) return { ok: false, kode: "WAKTU_TIDAK_VALID" };
  const sekarang = waktu ?? input.sekarang ?? new Date();

  let notifikasi: AdminNotification | null = null;
  const simpan = () =>
    denganNomorUnik(() =>
      runSerializable(async (tx): Promise<HasilAjukanMutasi> => {
        notifikasi = null;
        // Lagi di dalam transaksi: percobaan ulang sesudah balapan dua kiriman
        // berkunci sama (yang kalah diulang) mendapat dokumen pemenangnya.
        const ada = await ajuanDenganKunci(tx, kunci, input.userId);
        if (ada) return ada;

        const aturan = await bacaAturanMutasiTx(tx);
        if (!aturan.aktif) return { ok: false, kode: "MUTASI_NONAKTIF" };
        const alasan = rapikanTeksMutasi(input.alasan, true);
        if (!alasan.ok) return { ok: false, kode: alasan.kode };
        const baris = rapikanBarisMutasi(input.baris);
        if (!baris.ok) return { ok: false, kode: baris.kode };

        const toStoreId = typeof input.toStoreId === "string" ? input.toStoreId.trim() : "";
        if (!toStoreId) return { ok: false, kode: "TUJUAN_TIDAK_DITEMUKAN" };
        if (toStoreId === input.fromStoreId) return { ok: false, kode: "TUJUAN_SAMA" };
        const asal = await tokoAktif(tx, input.fromStoreId);
        if (!asal) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
        const tujuan = await tokoAktif(tx, toStoreId);
        if (!tujuan) return { ok: false, kode: "TUJUAN_TIDAK_DITEMUKAN" };

        const keputusan = keputusanArah(aturan, asal.termsType, tujuan.termsType);
        if (keputusan === "TOLAK") return { ok: false, kode: "ARAH_DITOLAK" };
        if (!aturan.tujuanTanpaSpg && (await spgToko(tx, tujuan.id)).length === 0) return { ok: false, kode: "TUJUAN_TANPA_SPG" };

        // Barang berpindah dari rak toko ini: yang mengajukan harus ada di sana.
        if (!(await adaKunjungan(tx, asal.id, input.userId, input.kunjunganId))) return { ok: false, kode: "TANPA_KUNJUNGAN" };
        // Toko yang belum punya buku tidak punya saldo untuk dikurangi — mulai
        // dengan opname dulu, supaya MUTASI_KELUAR tidak menjadi angka pertamanya.
        if (!(await bukuDimulai(tx, asal.id))) return { ok: false, kode: "BUKU_BELUM_DIMULAI" };

        const items = await tx.item.findMany({
          where: { id: { in: [...new Set(baris.baris.map((b) => b.itemId))] } },
          select: { id: true, nameId: true, variants: true },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));
        const { tersedia, dilacak } = await tersediaDiToko(tx, asal.id, baris.baris, undefined, waktu);

        const barisData: (BarisMutasi & { productName: string })[] = [];
        for (const b of baris.baris) {
          const item = itemById.get(b.itemId);
          if (!item) return { ok: false, kode: "BARANG_TIDAK_DIKENAL" };
          // Barang yang ada di buku toko selalu boleh — termasuk baris tanpa
          // ukuran dari kiriman konsinyasi lama. Selebihnya harus varian yang dikenal.
          if (!dilacak.has(kunciBaris(b.itemId, b.variantSku))) {
            const pilihan = variantSelectOptions(parseItemVariants(item.variants));
            const sah = b.variantSku === "" ? pilihan.length === 0 : pilihan.some((p) => p.sku === b.variantSku);
            if (!sah) return { ok: false, kode: "VARIAN_TIDAK_DIKENAL" };
          }
          const label = variantDetailForSku(item.variants, b.variantSku || null);
          barisData.push({ ...b, productName: label ? `${item.nameId} — ${label}` : item.nameId });
        }

        const nama = new Map(barisData.map((b) => [kunciBaris(b.itemId, b.variantSku), b.productName]));
        const kurang = kekuranganSaldo(baris.baris, tersedia).map((k) => ({
          ...k,
          productName: nama.get(kunciBaris(k.itemId, k.variantSku)) ?? k.itemId,
        }));
        if (kurang.length > 0 && aturan.saldo === "TOLAK") return { ok: false, kode: "SALDO_KURANG", kurang };

        const tahun = tahunWib(sekarang);
        const terakhir = await tx.storeTransfer.findFirst({
          where: { docNo: { startsWith: awalanNomorMutasi(tahun) } },
          orderBy: { docNo: "desc" },
          select: { docNo: true },
        });
        const docNo = nomorMutasiBerikut(terakhir?.docNo ?? null, tahun);
        const langsung = keputusan === "LANGSUNG";
        const status = langsung ? ("DISETUJUI" as const) : ("DIAJUKAN" as const);

        const dokumen = await tx.storeTransfer.create({
          data: {
            docNo,
            fromStoreId: asal.id,
            toStoreId: tujuan.id,
            status,
            reason: alasan.teks ?? "",
            createdById: input.userId,
            ...(langsung ? { approvedAt: sekarang } : {}),
            // Dari antrean HP: tanggal ajuannya = saat diajukan di HP.
            ...(waktu ? { createdAt: waktu } : {}),
            idempotencyKey: kunci,
            lines: { create: barisData.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, productName: b.productName, qty: b.qty })) },
          },
          select: { id: true, docNo: true },
        });

        await catatJejak(tx, {
          userId: input.userId,
          action: JEJAK_MUTASI.DIAJUKAN,
          entityId: dokumen.id,
          changes: { after: { status, docNo, fromStoreId: asal.id, toStoreId: tujuan.id } },
          metadata: {
            jumlahBaris: barisData.length,
            pcs: barisData.reduce((n, b) => n + b.qty, 0),
            // Disetujui otomatis oleh aturan arah, bukan oleh orang.
            langsung,
            ...(kurang.length > 0 ? { melebihiSaldo: kurang.length } : {}),
            // Dicatat tanpa sinyal di HP dan terkirim belakangan.
            ...(waktu ? { luring: true, waktuTangkap: waktu.toISOString() } : {}),
          },
          reason: alasan.teks,
        });
        if (!langsung) {
          notifikasi = await tx.adminNotification.create({
            data: {
              category: KATEGORI_NOTIF_MUTASI.DIAJUKAN,
              severity: kurang.length > 0 ? "WARNING" : "INFO",
              title: `Mutasi ${docNo} diajukan`,
              message:
                `${asal.name} → ${tujuan.name}, ${barisData.length} baris. ` +
                (kurang.length > 0 ? `${kurang.length} baris melebihi saldo buku toko asal. ` : "") +
                "Tinjau dan setujui sebelum SPG mengirim barangnya.",
              metadata: { transferId: dokumen.id },
            },
          });
        }
        return { ok: true, id: dokumen.id, docNo: dokumen.docNo, status, ulang: false, kurangSaldo: kurang };
      }),
    );

  let hasil: HasilAjukanMutasi;
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

// ─── Keputusan kantor: setujui / tolak ───────────────────────────────────────

export async function setujuiMutasi(input: { transferId: string; olehUserId: string; catatan?: unknown }): Promise<HasilKeputusanMutasi> {
  const catatan = rapikanTeksMutasi(input.catatan, false);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };

  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    const m = await muatMutasi(tx, input.transferId);
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.createdById === input.olehUserId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (m.status !== "DIAJUKAN") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    // Aturan dibaca ulang saat keputusan: arah yang sudah ditutup pemilik
    // sesudah ajuan dibuat tidak bisa disetujui lagi — tolak ajuannya.
    const [asal, tujuan, aturan] = await Promise.all([tokoAktif(tx, m.fromStoreId), tokoAktif(tx, m.toStoreId), bacaAturanMutasiTx(tx)]);
    if (!asal) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
    if (!tujuan) return { ok: false, kode: "TUJUAN_TIDAK_DITEMUKAN" };
    if (keputusanArah(aturan, asal.termsType, tujuan.termsType) === "TOLAK") return { ok: false, kode: "ARAH_DITOLAK" };

    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, status: "DIAJUKAN" },
      data: { status: "DISETUJUI", approvedById: input.olehUserId, approvedAt: new Date(), reviewNote: catatan.teks },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_MUTASI.DISETUJUI,
      entityId: m.id,
      changes: { before: { status: m.status }, after: { status: "DISETUJUI" } },
      reason: catatan.teks,
    });
    return berhasil(m, "DISETUJUI");
  });
  if (hasil.ok) {
    const m = await baca(input.transferId);
    if (m) {
      await kirimKabar([
        {
          userIds: [m.createdById],
          kabar: {
            jenis: JENIS_KABAR.MUTASI_DISETUJUI,
            judul: `Mutasi ${m.docNo} disetujui`,
            isi: `Siapkan barangnya, lalu tandai dikirim saat barang berangkat ke ${m.toStore.name}.`,
            data: { transferId: m.id },
          },
        },
      ]);
    }
  }
  return hasil;
}

export async function tolakMutasi(input: { transferId: string; olehUserId: string; alasan: unknown }): Promise<HasilKeputusanMutasi> {
  const alasan = rapikanTeksMutasi(input.alasan, true);
  if (!alasan.ok) return { ok: false, kode: alasan.kode };

  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    const m = await muatMutasi(tx, input.transferId);
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.createdById === input.olehUserId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (m.status !== "DIAJUKAN") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, status: "DIAJUKAN" },
      data: { status: "DITOLAK", approvedById: input.olehUserId, approvedAt: new Date(), reviewNote: alasan.teks },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_MUTASI.DITOLAK,
      entityId: m.id,
      changes: { before: { status: m.status }, after: { status: "DITOLAK" } },
      reason: alasan.teks,
    });
    return berhasil(m, "DITOLAK");
  });
  if (hasil.ok) {
    const m = await baca(input.transferId);
    if (m) {
      await kirimKabar([
        {
          userIds: [m.createdById],
          kabar: {
            jenis: JENIS_KABAR.MUTASI_DITOLAK,
            judul: `Mutasi ${m.docNo} ditolak`,
            isi: `Alasan: ${alasan.teks}`,
            data: { transferId: m.id },
          },
        },
      ]);
    }
  }
  return hasil;
}

/** Bacaan ringkas di luar transaksi, untuk menyusun kabar sesudahnya. */
async function baca(id: string) {
  return prisma.storeTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      createdById: true,
      fromStoreId: true,
      toStoreId: true,
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
    },
  });
}

// ─── Dikirim oleh SPG toko asal ──────────────────────────────────────────────

/**
 * Barang berangkat: stok buku toko asal berkurang (MUTASI_KELUAR, satu baris
 * per baris mutasi). Hanya SPG toko asal, sambil check-in di sana.
 *
 * Mengulang pada mutasi yang sudah ia tandai dikirim mengembalikan berhasil
 * tanpa menulis apa pun (`ulang: true`) — HP yang tidak menerima jawaban boleh
 * mengetuk lagi. Siklus konsinyasi toko asal yang sudah dikunci untuk bulan
 * ini menolak SPG (`SIKLUS_TERKUNCI`); laporan bulan itu mungkin sudah dicetak.
 *
 * `idempotencyKey` (kunci kiriman HP, sekali per ketukan) disimpan di jejak
 * DIKIRIM dan diperiksa PALING DULU, lalu lagi di dalam transaksi: kiriman
 * ulang dengan kunci yang sama selalu berhasil tanpa menulis apa pun, juga
 * sesudah mutasinya diterima toko tujuan.
 *
 * Dari antrean HP (`waktuTangkap`, ditandai tanpa sinyal):
 * - mutasi berstatus DIKIRIM dan buku MUTASI_KELUAR bertanggal saat ditandai
 *   di HP; siklus konsinyasi dan saldo dinilai per waktu itu;
 * - barang yang sudah dihitung opname toko asal SESUDAH waktu itu tidak
 *   mendapat baris buku — opname itu sudah melihat raknya tanpa barang ini
 *   (aturan yang sama dengan nota, penerimaan, dan opname tanpa sinyal);
 * - kunjungannya (`kunjunganId`) boleh sudah check-out;
 * - mutasi yang sementara itu berubah ditolak dengan kode yang menyebut
 *   sebabnya (`MUTASI_DITOLAK`, `MUTASI_DIBATALKAN`, `SUDAH_DIKIRIM`), dan yang
 *   sudah ia sendiri tandai dikirim (dengan kunci lain) dianggap berhasil.
 */
export async function kirimMutasi(input: {
  transferId: string;
  userId: string;
  storeId: string;
  sekarang?: Date;
  idempotencyKey?: string | null;
  /** Antrean HP: kunjungan saat ditandai dikirim (milik SPG ini di toko asal; boleh sudah check-out). */
  kunjunganId?: string | null;
  /** Antrean HP: saat "Ya, sudah dikirim" ditekan di HP. */
  waktuTangkap?: Date | null;
}): Promise<HasilKeputusanMutasi> {
  const kunciKirim = input.idempotencyKey?.trim() || null;
  // Kunci PALING DULU — sebelum waktu tangkap dinilai dan sebelum status dibaca.
  if (kunciKirim) {
    const lama = await kirimanDenganKunci(prisma, input.transferId, kunciKirim, input.storeId);
    if (lama) return lama;
  }
  const waktu = waktuDariAntrean(input.waktuTangkap, input.sekarang ?? new Date());
  if (waktu === null) return { ok: false, kode: "WAKTU_TIDAK_VALID" };
  const dariAntrean = waktu !== undefined;
  const sekarang = waktu ?? input.sekarang ?? new Date();

  const sesudah: { notifikasi: AdminNotification | null; kabar: KabarTertunda[] } = { notifikasi: null, kabar: [] };
  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    sesudah.notifikasi = null;
    sesudah.kabar = [];
    // Lagi di dalam transaksi: yang kalah balapan dua kiriman berkunci sama
    // diulang `runSerializable`, dan percobaan ulangnya menemukan jejak pemenang.
    if (kunciKirim) {
      const lama = await kirimanDenganKunci(tx, input.transferId, kunciKirim, input.storeId);
      if (lama) return lama;
    }
    const m = await muatMutasi(tx, input.transferId);
    // Mutasi toko lain tidak diakui ada — bukan urusan SPG ini.
    if (!m || m.fromStoreId !== input.storeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.status === "DIKIRIM" && m.shippedById === input.userId) return berhasil(m, "DIKIRIM", true);
    // Antrean HP: SPG ini sudah menandainya dikirim lewat jalan lain, dan
    // mutasinya sudah berjalan lebih jauh — tanda yang tertahan ini tidak menambah apa pun.
    if (dariAntrean && m.shippedById === input.userId && (m.status === "DITERIMA" || m.status === "DIKEMBALIKAN")) {
      return berhasil(m, m.status, true);
    }
    if (m.status === "DIAJUKAN") return { ok: false, kode: "BELUM_DISETUJUI" };
    if (m.status !== "DISETUJUI") return { ok: false, kode: dariAntrean ? kodeTakBisaKirim(m.status) : "SUDAH_DIPUTUSKAN" };
    if (!(await adaKunjungan(tx, m.fromStoreId, input.userId, input.kunjunganId))) return { ok: false, kode: "TANPA_KUNJUNGAN" };

    const terkunci = await siklusTerkunciDi(tx, [m.fromStoreId], sekarang);
    if (terkunci.length > 0) return { ok: false, kode: "SIKLUS_TERKUNCI", noKonsi: terkunci };

    const baris = await tx.storeTransferLine.findMany({
      where: { transferId: m.id },
      select: { itemId: true, variantSku: true, productName: true, qty: true },
    });
    const aturan = await bacaAturanMutasiTx(tx);
    if (aturan.saldo === "TOLAK") {
      const { tersedia } = await tersediaDiToko(tx, m.fromStoreId, baris, m.id, waktu);
      const nama = new Map(baris.map((b) => [kunciBaris(b.itemId, b.variantSku), b.productName]));
      const kurang = kekuranganSaldo(baris, tersedia).map((k) => ({ ...k, productName: nama.get(kunciBaris(k.itemId, k.variantSku)) ?? k.itemId }));
      if (kurang.length > 0) return { ok: false, kode: "SALDO_KURANG", kurang };
    }

    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, status: "DISETUJUI" },
      data: { status: "DIKIRIM", shippedById: input.userId, shippedAt: sekarang },
    });
    if (r.count !== 1) return { ok: false, kode: dariAntrean ? "SUDAH_DIKIRIM" : "SUDAH_DIPUTUSKAN" };

    // Antrean HP: barang yang sudah dihitung opname SESUDAH ditandai dikirim
    // tidak dikurangi lagi — hitungan itu sudah tanpa barang ini.
    const terhitung = waktu ? await terhitungSesudah(tx, m.fromStoreId, [...new Set(baris.map((b) => b.itemId))], waktu) : new Set<string>();
    const gerak = baris.filter((b) => !terhitung.has(kunciBaris(b.itemId, b.variantSku)));
    if (gerak.length > 0) {
      await tx.storeStockMovement.createMany({
        data: gerak.map((b) => ({
          storeId: m.fromStoreId,
          itemId: b.itemId,
          variantSku: b.variantSku,
          qty: -b.qty,
          kind: "MUTASI_KELUAR" as const,
          refType: ENTITAS_MUTASI,
          refId: m.id,
          createdById: input.userId,
          createdAt: sekarang,
        })),
      });
    }
    await catatJejak(tx, {
      userId: input.userId,
      action: JEJAK_MUTASI.DIKIRIM,
      entityId: m.id,
      changes: { before: { status: m.status }, after: { status: "DIKIRIM" } },
      metadata: {
        pcs: baris.reduce((n, b) => n + b.qty, 0),
        ...(kunciKirim ? { kunciKirim } : {}),
        ...(waktu ? { luring: true, waktuTangkap: waktu.toISOString(), dilewatiOpname: baris.length - gerak.length } : {}),
      },
    });

    const [tujuanSpg, tokoTujuan, tokoAsal] = await Promise.all([
      spgToko(tx, m.toStoreId),
      tx.store.findUnique({ where: { id: m.toStoreId }, select: { name: true } }),
      tx.store.findUnique({ where: { id: m.fromStoreId }, select: { name: true } }),
    ]);
    if (tujuanSpg.length === 0) sesudah.notifikasi = await catatPerluDiterima(tx, m, tokoTujuan?.name ?? "Toko tujuan");
    else sesudah.kabar.push({ userIds: tujuanSpg, kabar: kabarMasuk(m, tokoAsal?.name ?? "toko lain") });
    return berhasil(m, "DIKIRIM");
  });
  if (hasil.ok && !hasil.ulang) {
    if (sesudah.notifikasi) void fanOutAdminNotification(sesudah.notifikasi);
    await kirimKabar(sesudah.kabar);
  }
  return hasil;
}

// ─── Batal ───────────────────────────────────────────────────────────────────

/**
 * Batalkan. SPG toko asal boleh membatalkan selama barang belum dikirim
 * (alasan boleh kosong — ia yang tahu toko tujuan sudah tidak butuh). Kantor
 * boleh membatalkan sampai sebelum diterima, dengan alasan; yang sudah DIKIRIM
 * menjadi DIKEMBALIKAN — barangnya kembali, dan toko asal menerimanya lewat
 * layar terima kiriman (sumber `MUTASI_KEMBALI`), yang mengembalikan stoknya.
 */
export async function batalkanMutasi(input: {
  transferId: string;
  olehUserId: string;
  sebagai: "SPG" | "KANTOR";
  /** SPG: toko tetapnya (dari server). */
  storeId?: string;
  alasan?: unknown;
}): Promise<HasilKeputusanMutasi> {
  const alasan = rapikanTeksMutasi(input.alasan, input.sebagai === "KANTOR");
  if (!alasan.ok) return { ok: false, kode: alasan.kode };

  const kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    kabar.length = 0;
    const m = await muatMutasi(tx, input.transferId);
    if (!m || (input.sebagai === "SPG" && m.fromStoreId !== input.storeId)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const bolehDari: StatusMutasi[] = input.sebagai === "SPG" ? ["DIAJUKAN", "DISETUJUI"] : ["DIAJUKAN", "DISETUJUI", "DIKIRIM"];
    if (!bolehDari.includes(m.status)) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const ke: StatusMutasi = m.status === "DIKIRIM" ? "DIKEMBALIKAN" : "DIBATALKAN";
    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, status: m.status },
      data: { status: ke, cancelledById: input.olehUserId, cancelledAt: new Date(), ...(alasan.teks ? { reviewNote: alasan.teks } : {}) },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: ke === "DIKEMBALIKAN" ? JEJAK_MUTASI.DIKEMBALIKAN : JEJAK_MUTASI.DIBATALKAN,
      entityId: m.id,
      changes: { before: { status: m.status, reviewNote: m.reviewNote }, after: { status: ke } },
      metadata: { sebagai: input.sebagai },
      reason: alasan.teks,
    });

    const judul = ke === "DIKEMBALIKAN" ? `Mutasi ${m.docNo} dibatalkan — barang kembali` : `Mutasi ${m.docNo} dibatalkan`;
    const isiAlasan = alasan.teks ? ` Alasan: ${alasan.teks}` : "";
    if (ke === "DIKEMBALIKAN") {
      // Toko asal menerima barangnya kembali; toko tujuan tidak lagi menunggunya.
      kabar.push({
        userIds: [m.createdById, ...(await spgToko(tx, m.fromStoreId))],
        kabar: {
          jenis: JENIS_KABAR.MUTASI_DIBATALKAN,
          judul,
          isi: `Kantor membatalkan mutasi yang sudah dikirim. Hitung barangnya saat kembali, lalu terima di menu Terima kiriman.${isiAlasan}`,
          data: { transferId: m.id },
        },
      });
      kabar.push({
        userIds: await spgToko(tx, m.toStoreId),
        kabar: { jenis: JENIS_KABAR.MUTASI_DIBATALKAN, judul, isi: `Kiriman ini tidak jadi menuju toko Anda.${isiAlasan}`, data: { transferId: m.id } },
      });
    } else if (input.olehUserId !== m.createdById) {
      kabar.push({
        userIds: [m.createdById],
        kabar: { jenis: JENIS_KABAR.MUTASI_DIBATALKAN, judul, isi: `Mutasi ini tidak jadi dikirim.${isiAlasan}`, data: { transferId: m.id } },
      });
    }
    return berhasil(m, ke);
  });
  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}

// ─── Alihkan tujuan ──────────────────────────────────────────────────────────

/**
 * Kantor mengalihkan tujuan selama barang di jalan (DIKIRIM, belum diterima).
 * Aturan arah dan toko tanpa SPG dinilai untuk tujuan BARU. Stok tidak
 * bergerak — yang berubah hanya siapa yang akan menerimanya.
 */
export async function alihkanTujuanMutasi(input: {
  transferId: string;
  olehUserId: string;
  toStoreId: unknown;
  alasan: unknown;
}): Promise<HasilKeputusanMutasi> {
  const alasan = rapikanTeksMutasi(input.alasan, true);
  if (!alasan.ok) return { ok: false, kode: alasan.kode };
  const tujuanBaru = typeof input.toStoreId === "string" ? input.toStoreId.trim() : "";
  if (!tujuanBaru) return { ok: false, kode: "TUJUAN_TIDAK_DITEMUKAN" };

  const sesudah: { notifikasi: AdminNotification | null; kabar: KabarTertunda[] } = { notifikasi: null, kabar: [] };
  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    sesudah.notifikasi = null;
    sesudah.kabar = [];
    const m = await muatMutasi(tx, input.transferId);
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.status !== "DIKIRIM") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    if (tujuanBaru === m.fromStoreId || tujuanBaru === m.toStoreId) return { ok: false, kode: "TUJUAN_SAMA" };

    const [asal, tujuan, aturan] = await Promise.all([tokoAktif(tx, m.fromStoreId), tokoAktif(tx, tujuanBaru), bacaAturanMutasiTx(tx)]);
    if (!tujuan) return { ok: false, kode: "TUJUAN_TIDAK_DITEMUKAN" };
    // Toko asal yang sudah nonaktif tidak menghalangi: barangnya sudah keluar.
    const jenisAsal = asal?.termsType ?? (await tx.store.findUnique({ where: { id: m.fromStoreId }, select: { termsType: true } }))?.termsType;
    if (!jenisAsal || keputusanArah(aturan, jenisAsal, tujuan.termsType) === "TOLAK") return { ok: false, kode: "ARAH_DITOLAK" };
    const spgBaru = await spgToko(tx, tujuan.id);
    if (!aturan.tujuanTanpaSpg && spgBaru.length === 0) return { ok: false, kode: "TUJUAN_TANPA_SPG" };

    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, status: "DIKIRIM", toStoreId: m.toStoreId },
      data: { toStoreId: tujuan.id },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_MUTASI.DIALIHKAN,
      entityId: m.id,
      changes: { before: { toStoreId: m.toStoreId }, after: { toStoreId: tujuan.id } },
      reason: alasan.teks,
    });
    if (spgBaru.length === 0) sesudah.notifikasi = await catatPerluDiterima(tx, m, tujuan.name);
    else {
      const namaAsal = asal?.name ?? (await tx.store.findUnique({ where: { id: m.fromStoreId }, select: { name: true } }))?.name ?? "toko lain";
      sesudah.kabar.push({ userIds: spgBaru, kabar: kabarMasuk(m, namaAsal) });
    }
    return berhasil(m, "DIKIRIM");
  });
  if (hasil.ok) {
    if (sesudah.notifikasi) void fanOutAdminNotification(sesudah.notifikasi);
    await kirimKabar(sesudah.kabar);
  }
  return hasil;
}

// ─── Terima oleh kantor ──────────────────────────────────────────────────────

/**
 * Kantor menerima atas nama toko (`stores:manage`): toko tujuan tanpa SPG, atau
 * kiriman yang sudah lewat `hariPengingat`. Satu jalur dengan penerimaan SPG
 * (`terimaKiriman`), jadi semua penjaganya sama — tanda terima unik, status
 * dibandingkan-lalu-ditukar, lebih-dari-dikirim ditolak. Bedanya: toko yang
 * belum punya buku stok tidak mendapat baris buku, dan siklus konsinyasi yang
 * terkunci boleh dilewati sesudah dikonfirmasi (dicatat di jejaknya).
 */
export async function terimaMutasiKantor(input: {
  transferId: string;
  olehUserId: string;
  sumber: "MUTASI" | "MUTASI_KEMBALI";
  diterima: { lineId: string; qtyReceived: number }[];
  catatan?: string | null;
  setujuSiklusTerkunci?: boolean;
  sekarang?: Date;
}): Promise<HasilTerimaKiriman> {
  const m = await prisma.storeTransfer.findUnique({ where: { id: input.transferId }, select: { fromStoreId: true, toStoreId: true } });
  if (!m) return { ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" };
  return terimaKiriman({
    storeId: input.sumber === "MUTASI" ? m.toStoreId : m.fromStoreId,
    userId: input.olehUserId,
    sourceType: input.sumber,
    sourceId: input.transferId,
    diterima: input.diterima,
    note: input.catatan,
    kantor: { setujuSiklusTerkunci: Boolean(input.setujuSiklusTerkunci) },
    sekarang: input.sekarang,
  });
}

// ─── Selisih ─────────────────────────────────────────────────────────────────

/**
 * Putuskan selisih kurang yang TERBUKA. `HILANG` hanya jejak — barangnya sudah
 * keluar dari buku toko asal dan tidak pernah masuk buku tujuan. `KEMBALI`
 * berarti barang yang kurang ada di toko asal: buku toko asal ditambah
 * (MUTASI_MASUK) sebesar kekurangannya.
 */
export async function putuskanSelisihMutasi(input: {
  transferId: string;
  olehUserId: string;
  keputusan: "HILANG" | "KEMBALI";
  catatan: unknown;
  setujuSiklusTerkunci?: boolean;
  sekarang?: Date;
}): Promise<HasilKeputusanMutasi> {
  const catatan = rapikanTeksMutasi(input.catatan, true);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };
  if (input.keputusan !== "HILANG" && input.keputusan !== "KEMBALI") return { ok: false, kode: "TIDAK_ADA_SELISIH" };
  const sekarang = input.sekarang ?? new Date();

  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanMutasi> => {
    const m = await muatMutasi(tx, input.transferId);
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.selisihStatus !== "TERBUKA") return { ok: false, kode: "TIDAK_ADA_SELISIH" };
    const sumber = m.status === "DITERIMA" ? "MUTASI" : m.status === "DIKEMBALIKAN" ? "MUTASI_KEMBALI" : null;
    if (!sumber) return { ok: false, kode: "TIDAK_ADA_SELISIH" };

    const terima = await tx.storeReceipt.findUnique({
      where: { sourceType_sourceId: { sourceType: sumber, sourceId: m.id } },
      select: { id: true, lines: { select: { itemId: true, variantSku: true, qtySent: true, qtyReceived: true } } },
    });
    const kurang = (terima?.lines ?? [])
      .filter((l) => l.itemId && l.qtySent > l.qtyReceived)
      .map((l) => ({ itemId: l.itemId as string, variantSku: l.variantSku, qty: l.qtySent - l.qtyReceived }));
    if (kurang.length === 0) return { ok: false, kode: "TIDAK_ADA_SELISIH" };

    let siklusTerkunci: string[] = [];
    if (input.keputusan === "KEMBALI") {
      siklusTerkunci = await siklusTerkunciDi(tx, [m.fromStoreId], sekarang);
      if (siklusTerkunci.length > 0 && !input.setujuSiklusTerkunci) return { ok: false, kode: "SIKLUS_TERKUNCI", noKonsi: siklusTerkunci };
    }

    const r = await tx.storeTransfer.updateMany({
      where: { id: m.id, selisihStatus: "TERBUKA" },
      data: { selisihStatus: input.keputusan, selisihNote: catatan.teks },
    });
    if (r.count !== 1) return { ok: false, kode: "TIDAK_ADA_SELISIH" };

    if (input.keputusan === "KEMBALI") {
      await tx.storeStockMovement.createMany({
        data: kurang.map((k) => ({
          storeId: m.fromStoreId,
          itemId: k.itemId,
          variantSku: k.variantSku,
          qty: k.qty,
          kind: "MUTASI_MASUK" as const,
          refType: ENTITAS_MUTASI,
          refId: m.id,
          createdById: input.olehUserId,
          createdAt: sekarang,
        })),
      });
    }
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_MUTASI.SELISIH_DIPUTUSKAN,
      entityId: m.id,
      changes: { before: { selisihStatus: "TERBUKA" }, after: { selisihStatus: input.keputusan } },
      metadata: {
        pcs: kurang.reduce((n, k) => n + k.qty, 0),
        ...(siklusTerkunci.length > 0 ? { siklusTerkunci } : {}),
      },
      reason: catatan.teks,
    });
    return berhasil(m, m.status);
  });
  // Barang yang diputuskan hilang membuka catatan barang hilang untuk diputuskan
  // penanggungnya (sesudah transaksi; kaitnya idempoten dan tidak pernah melempar).
  if (hasil.ok && input.keputusan === "HILANG") void catatHilangDariMutasi(input.transferId, input.olehUserId);
  return hasil;
}
