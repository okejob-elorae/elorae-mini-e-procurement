import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import {
  bolehMengoreksiBuktiTerima,
  periksaMasukanBuktiTerima,
  periksaWaktuTerima,
  samaIsinya,
  sumberPencatat,
  type KodeBuktiTerima,
  type NilaiBuktiTerima,
} from "./bukti-terima";

/**
 * Penulis bukti terima digital untuk satu pengiriman putus.
 *
 * Dua jalur yang sengaja dipisah:
 *
 * - **Mencatat** (pertama kali): salesman pemilik pesanan dari HP, atau kantor.
 *   Compare-and-swap pada `receivedAt IS NULL`, jadi dua pencatat yang datang
 *   bersamaan tidak bisa dua-duanya menjadi "yang pertama" — yang kalah
 *   mendapat `SUDAH_DITERIMA` dan diarahkan ke koreksi.
 * - **Mengoreksi**: kantor saja, dengan alasan wajib. Compare-and-swap pada
 *   isi lama, sehingga koreksi yang dibuat atas layar basi ditolak (`KONFLIK`)
 *   alih-alih diam-diam menimpa koreksi orang lain.
 *
 * Keduanya menulis `AuditLog` (sebelum/sesudah) DI DALAM transaksinya: barisnya
 * hanya menyimpan keadaan terakhir, jadi bukti yang tergantikan hanya hidup di
 * jejak itu. Kunci kiriman (`idempotencyKey`) ikut disimpan di metadata jejak —
 * tidak ada kolomnya di pengiriman — dan diperiksa sebelum apa pun, supaya
 * antrean HP yang mengirim ulang mendapat jawaban yang sama, bukan penolakan.
 *
 * Tidak ada stok maupun uang yang bergerak di sini.
 */

export const AKSI_BUKTI_TERIMA = {
  CATAT: "DELIVERY_RECEIPT_RECORDED",
  KOREKSI: "DELIVERY_RECEIPT_CORRECTED",
} as const;

const ENTITAS = "FieldSalesDelivery";

export type PelakuBuktiTerima = { userId: string; izin: string[] | undefined };

export type MasukanCatatBuktiTerima = {
  deliveryId: unknown;
  receivedByName: unknown;
  /** Instan ISO. */
  receivedAt: unknown;
  podPhotoUrl: unknown;
  idempotencyKey: unknown;
  jenisBukti?: unknown;
};

export type MasukanKoreksiBuktiTerima = MasukanCatatBuktiTerima & {
  reason: unknown;
  /**
   * Isi bukti yang DILIHAT pengoreksi saat dialognya dibuka. Kalau tidak sama
   * dengan isi sekarang, koreksinya ditolak (`KONFLIK`) — tanpa ini, dua admin
   * yang mengoreksi bersamaan saling menimpa tanpa tahu.
   */
  sebelum?: unknown;
};

export type HasilBuktiTerima =
  | { ok: true; ulangan: boolean; orderId: string; deliveryId: string }
  | { ok: false; kode: KodeBuktiTerima };

type Tx = Prisma.TransactionClient;
type IsiBukti = { receivedByName: string | null; receivedAt: Date | null; podPhotoUrl: string | null };

const PILIH_KIRIMAN = {
  id: true,
  docNo: true,
  orderId: true,
  invoiceDate: true,
  deliveredAt: true,
  createdAt: true,
  receivedByName: true,
  receivedAt: true,
  podPhotoUrl: true,
  order: { select: { salesmanId: true } },
} as const;

const tolak = (kode: KodeBuktiTerima): HasilBuktiTerima => ({ ok: false, kode });

function isiDari(k: IsiBukti): IsiBukti {
  return { receivedByName: k.receivedByName, receivedAt: k.receivedAt, podPhotoUrl: k.podPhotoUrl };
}

function keJejak(k: IsiBukti) {
  return {
    receivedByName: k.receivedByName,
    receivedAt: k.receivedAt ? k.receivedAt.toISOString() : null,
    podPhotoUrl: k.podPhotoUrl,
  };
}

/**
 * Kiriman ini pernah diproses dengan kunci yang sama untuk aksi yang sama?
 *
 * Disaring di JS, bukan dengan saringan jalur-JSON Prisma: saringan itu tidak
 * andal di adaptor MariaDB, dan jejak satu pengiriman hanya segelintir baris
 * (indeks `entityType, entityId`).
 */
async function sudahDenganKunci(tx: Tx, deliveryId: string, aksi: string, kunci: string): Promise<boolean> {
  const jejak = await tx.auditLog.findMany({
    where: { entityType: ENTITAS, entityId: deliveryId, action: aksi },
    select: { metadata: true },
  });
  return jejak.some((j) => {
    const m = j.metadata;
    return m !== null && typeof m === "object" && !Array.isArray(m) && (m as Record<string, unknown>).idempotencyKey === kunci;
  });
}

/**
 * Foto bukti harus ada DAN diunggah oleh pencatatnya sendiri. Tanpa syarat
 * kedua, jalur `/api/foto/<id>` milik siapa pun — bukti transfer, nota retur
 * toko lain — bisa ditempelkan sebagai bukti terima.
 */
async function fotoMilik(tx: Tx, fotoId: string, userId: string): Promise<boolean> {
  const foto = await tx.foto.findUnique({ where: { id: fotoId }, select: { uploadedById: true } });
  return foto !== null && foto.uploadedById === userId;
}

function ok(k: { orderId: string; id: string }, ulangan: boolean): HasilBuktiTerima {
  return { ok: true, ulangan, orderId: k.orderId, deliveryId: k.id };
}

function metadata(v: NilaiBuktiTerima, sumber: "KANTOR" | "SALESMAN", k: { orderId: string; docNo: string }) {
  return { idempotencyKey: v.idempotencyKey, sumber, jenisBukti: v.jenisBukti, orderId: k.orderId, docNo: k.docNo };
}

export async function catatBuktiTerima(
  pelaku: PelakuBuktiTerima,
  masukan: MasukanCatatBuktiTerima,
  sekarang: Date = new Date(),
): Promise<HasilBuktiTerima> {
  if (typeof masukan.deliveryId !== "string" || masukan.deliveryId === "") return tolak("TIDAK_DITEMUKAN");
  const cek = periksaMasukanBuktiTerima(masukan, "CATAT");
  if (!cek.ok) return cek;
  const v = cek.nilai;
  const deliveryId = masukan.deliveryId;

  return runSerializable(async (tx): Promise<HasilBuktiTerima> => {
    const k = await tx.fieldSalesDelivery.findUnique({ where: { id: deliveryId }, select: PILIH_KIRIMAN });
    if (!k) return tolak("TIDAK_DITEMUKAN");
    const sumber = sumberPencatat({ izin: pelaku.izin, userId: pelaku.userId, salesmanId: k.order.salesmanId });
    if (!sumber) return tolak("TANPA_AKSES");

    if (await sudahDenganKunci(tx, k.id, AKSI_BUKTI_TERIMA.CATAT, v.idempotencyKey)) return ok(k, true);
    if (k.receivedAt) return samaIsinya(isiDari(k), v) ? ok(k, true) : tolak("SUDAH_DITERIMA");

    const waktu = periksaWaktuTerima(v.receivedAt, k, sekarang);
    if (waktu) return tolak(waktu);
    if (!(await fotoMilik(tx, v.fotoId, pelaku.userId))) return tolak("FOTO_TIDAK_DITEMUKAN");

    const swap = await tx.fieldSalesDelivery.updateMany({
      where: { id: k.id, receivedAt: null },
      data: { receivedByName: v.receivedByName, receivedAt: v.receivedAt, podPhotoUrl: v.podPhotoUrl },
    });
    if (swap.count === 0) {
      // Hanya bisa terjadi di bawah tingkat isolasi serializable: orang lain
      // mencatat di antara baca dan tulis kita. Nilai ulang terhadap isinya.
      const kini = await tx.fieldSalesDelivery.findUnique({ where: { id: k.id }, select: PILIH_KIRIMAN });
      return kini && samaIsinya(isiDari(kini), v) ? ok(k, true) : tolak("SUDAH_DITERIMA");
    }

    await tx.auditLog.create({
      data: {
        userId: pelaku.userId,
        action: AKSI_BUKTI_TERIMA.CATAT,
        entityType: ENTITAS,
        entityId: k.id,
        changes: { before: keJejak(isiDari(k)), after: keJejak(v) },
        metadata: metadata(v, sumber, k),
      },
    });
    return ok(k, false);
  });
}

/** Isi yang dilihat pengoreksi, dari jaringan: bentuk yang salah = anggap basi. */
function bacaSebelum(x: unknown): IsiBukti | "RUSAK" | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== "object" || Array.isArray(x)) return "RUSAK";
  const o = x as Record<string, unknown>;
  const teksAtauNull = (v: unknown) => v === null || typeof v === "string";
  if (!teksAtauNull(o.receivedByName) || !teksAtauNull(o.receivedAt) || !teksAtauNull(o.podPhotoUrl)) return "RUSAK";
  const receivedAt = o.receivedAt === null ? null : new Date(o.receivedAt as string);
  if (receivedAt && Number.isNaN(receivedAt.getTime())) return "RUSAK";
  return { receivedByName: o.receivedByName as string | null, receivedAt, podPhotoUrl: o.podPhotoUrl as string | null };
}

export async function koreksiBuktiTerima(
  pelaku: PelakuBuktiTerima,
  masukan: MasukanKoreksiBuktiTerima,
  sekarang: Date = new Date(),
): Promise<HasilBuktiTerima> {
  if (typeof masukan.deliveryId !== "string" || masukan.deliveryId === "") return tolak("TIDAK_DITEMUKAN");
  const cek = periksaMasukanBuktiTerima(masukan, "KOREKSI");
  if (!cek.ok) return cek;
  const v = cek.nilai;
  const dilihat = bacaSebelum(masukan.sebelum);
  const deliveryId = masukan.deliveryId;

  return runSerializable(async (tx): Promise<HasilBuktiTerima> => {
    const k = await tx.fieldSalesDelivery.findUnique({ where: { id: deliveryId }, select: PILIH_KIRIMAN });
    if (!k) return tolak("TIDAK_DITEMUKAN");
    if (!bolehMengoreksiBuktiTerima(pelaku.izin)) return tolak("TANPA_AKSES");

    if (await sudahDenganKunci(tx, k.id, AKSI_BUKTI_TERIMA.KOREKSI, v.idempotencyKey)) return ok(k, true);
    if (!k.receivedAt) return tolak("BELUM_DITERIMA");

    const lama = isiDari(k);
    if (dilihat === "RUSAK" || (dilihat !== null && !samaIsinya(dilihat, lama))) return tolak("KONFLIK");
    if (samaIsinya(lama, v)) return tolak("TIDAK_BERUBAH");

    const waktu = periksaWaktuTerima(v.receivedAt, k, sekarang);
    if (waktu) return tolak(waktu);
    // Foto yang dipertahankan sudah diperiksa saat dicatat; foto BARU harus milik pengoreksi.
    if (v.podPhotoUrl !== lama.podPhotoUrl && !(await fotoMilik(tx, v.fotoId, pelaku.userId))) {
      return tolak("FOTO_TIDAK_DITEMUKAN");
    }

    const swap = await tx.fieldSalesDelivery.updateMany({
      where: {
        id: k.id,
        receivedByName: lama.receivedByName,
        receivedAt: lama.receivedAt,
        podPhotoUrl: lama.podPhotoUrl,
      },
      data: { receivedByName: v.receivedByName, receivedAt: v.receivedAt, podPhotoUrl: v.podPhotoUrl },
    });
    if (swap.count === 0) return tolak("KONFLIK");

    await tx.auditLog.create({
      data: {
        userId: pelaku.userId,
        action: AKSI_BUKTI_TERIMA.KOREKSI,
        entityType: ENTITAS,
        entityId: k.id,
        changes: { before: keJejak(lama), after: keJejak(v) },
        metadata: metadata(v, "KANTOR", k),
        reason: v.reason,
      },
    });
    return ok(k, false);
  });
}
