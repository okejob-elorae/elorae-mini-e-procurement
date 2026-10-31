"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { assignCollector } from "@/lib/finance/collections/assign-writer";
import { submitCollection } from "@/lib/finance/collections/submit-writer";
import { verifyCollection } from "@/lib/finance/collections/verify-writer";
import { rejectCollection } from "@/lib/finance/collections/reject-writer";
import { CollectionError, type CollectionErrorCode } from "@/lib/finance/collections/errors";
import { PaymentError, type PaymentErrorCode } from "@/lib/finance/ar/errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postPaymentReceiptJournal } from "@/lib/finance/ar/payment-journal";
import { formatDateOnlyJakarta, formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { bolehMelapor, bolehMengelola } from "@/lib/receivables/izin";
import { hariWib } from "@/lib/receivables/giro";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import {
  buatKontrabon,
  konfirmasiKontrabon,
  pasangFotoKontrabon,
  tutupKontrabon,
  type AlasanGagalKontrabon,
} from "@/lib/receivables/collection-writer";

export type CollectionActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | CollectionErrorCode
  | PaymentErrorCode;

export type CollectionActionResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; reason: CollectionActionReason };

async function guardManage(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

async function guardCollect(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

async function guardVerify(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.PAYMENTS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

function toCollectionResult(e: unknown): { ok: false; reason: CollectionActionReason } {
  if (e instanceof CollectionError) return { ok: false, reason: e.code };
  if (e instanceof PaymentError) return { ok: false, reason: e.code };
  return { ok: false, reason: "INVALID_REQUEST" };
}

/**
 * Anchors a "YYYY-MM-DD" calendar day to WIB midnight and rejects anything that doesn't
 * round-trip exactly — same guard `recordPaymentAction` uses for the same `Payment.paidAt`
 * field, so a collector's submitted date can't produce a different GL date than the backoffice
 * payment-recording path would for the same string.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

export async function assignCollectorAction(input: {
  receivableIds: string[];
  collectorId: string | null;
}): Promise<CollectionActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  try {
    const result = await assignCollector({
      receivableIds: input.receivableIds,
      collectorId: input.collectorId,
      assignedById: g.userId,
    });
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/collections");
    return { ok: true, assignedCount: result.assignedCount };
  } catch (e) {
    return toCollectionResult(e);
  }
}

/**
 * Bulk-assigns (or unassigns) a collector across a store's currently outstanding receivables.
 * Reads the id list here and calls `assignCollector` directly rather than going through
 * `assignCollectorAction`, to avoid double-guarding on `guardManage()`. `assignCollector` throws
 * `EMPTY_TARGETS` itself when the store has no outstanding receivable — same handling as every
 * other reason via `toCollectionResult`.
 */
export async function bulkAssignStoreAction(
  storeId: string,
  collectorId: string | null,
): Promise<CollectionActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  try {
    const receivables = await prisma.receivable.findMany({
      where: { storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
      select: { id: true },
    });
    const result = await assignCollector({
      receivableIds: receivables.map((r) => r.id),
      collectorId,
      assignedById: g.userId,
    });
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/collections");
    return { ok: true, assignedCount: result.assignedCount };
  } catch (e) {
    return toCollectionResult(e);
  }
}

export async function submitCollectionAction(input: {
  receivableId: string;
  amount: number;
  method: "CASH" | "TRANSFER";
  paidAt: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
}): Promise<CollectionActionResult> {
  const g = await guardCollect();
  if ("ok" in g) return g;

  /* Same reasoning as submitCollection's own guard — this boundary is reachable by a raw
     request that never went through the TS parameter type at all. */
  const method: unknown = input.method;
  if (method !== "CASH" && method !== "TRANSFER") return { ok: false, reason: "INVALID_METHOD" };

  const paidAt = parseCalendarDay(input.paidAt);
  if (!paidAt) return { ok: false, reason: "INVALID_REQUEST" };
  try {
    const result = await submitCollection({
      receivableId: input.receivableId,
      collectorId: g.userId,
      amount: input.amount,
      method: input.method,
      paidAt,
      note: input.note,
      proofUrl: input.proofUrl,
      proofR2Key: input.proofR2Key,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/pwa/collections");
    return { ok: true, submissionId: result.submissionId };
  } catch (e) {
    return toCollectionResult(e);
  }
}

export async function verifyCollectionAction(submissionId: string): Promise<CollectionActionResult> {
  const g = await guardVerify();
  if ("ok" in g) return g;
  let paymentId: string;
  let alreadyVerified = false;
  try {
    const result = await verifyCollection({ submissionId, verifiedById: g.userId });
    paymentId = result.paymentId;
    alreadyVerified = result.alreadyVerified ?? false;
  } catch (e) {
    return toCollectionResult(e);
  }
  /*
   * Posted unconditionally, including on the `alreadyVerified` short-circuit: `postJournal`
   * underneath `postPaymentReceiptJournal` is idempotent on `Journal @@unique([sourceType, sourceId])`
   * and simply returns `created: false` for an entry that already exists, so a repost is a safe
   * no-op. That is what makes a crashed verify-then-retry converge — before this, the retry hit
   * the short-circuit, carried no payment id, and left the payment forever un-journaled.
   */
  await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId, g.userId));
  revalidatePath("/backoffice/finance/collections");
  revalidatePath("/backoffice/finance/piutang");
  return { ok: true, alreadyVerified };
}

export async function rejectCollectionAction(submissionId: string, reason: string): Promise<CollectionActionResult> {
  const g = await guardVerify();
  if ("ok" in g) return g;
  if (typeof reason !== "string" || reason.trim() === "") return { ok: false, reason: "INVALID_REQUEST" };
  try {
    await rejectCollection({ submissionId, reason, rejectedById: g.userId });
  } catch (e) {
    return toCollectionResult(e);
  }
  revalidatePath("/backoffice/finance/collections");
  return { ok: true };
}

export type KodeAksiKontrabon =
  | "TANPA_AKSES"
  | "TANGGAL_TIDAK_VALID"
  | AlasanGagalKontrabon
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DITUTUP"
  | "MASIH_ADA_SISA"
  | "ALASAN_WAJIB"
  | "BUKAN_DARI_LAPANGAN"
  | "SUDAH_DIKONFIRMASI"
  | "GAGAL";

export type HasilAksiKontrabon = { ok: true } | { ok: false; kode: KodeAksiKontrabon };

function segarkan() {
  revalidatePath("/backoffice/kontrabon");
  revalidatePath("/backoffice/piutang");
  revalidatePath("/pwa/piutang");
}

/**
 * Kabar ke salesman atas janji bayar yang ia catat di lapangan: dikonfirmasi
 * kantor, atau dibatalkan beserta alasannya.
 *
 * Hanya untuk kontrabon LAPANGAN — kontrabon kantor tidak punya pelapor yang
 * menunggu kabar. Dipanggil SESUDAH transaksinya selesai dan tidak pernah
 * melempar: keputusannya sudah tersimpan, kabar yang gagal tidak boleh
 * membuatnya tampak gagal.
 */
async function kabarKontrabonLapangan(
  collectionNoteId: string,
  keputusan: "DIKONFIRMASI" | "DIBATALKAN",
  catatan: string | null | undefined,
  pelakuId: string,
): Promise<void> {
  try {
    const nota = await prisma.collectionNote.findUnique({
      where: { id: collectionNoteId },
      select: {
        docNo: true,
        source: true,
        salesmanId: true,
        storeId: true,
        amount: true,
        promisedDate: true,
        store: { select: { name: true } },
      },
    });
    if (!nota || nota.source !== "FIELD" || nota.salesmanId === pelakuId) return;
    const data = { storeId: nota.storeId, collectionNoteId };
    const nilai = formatIDR(nota.amount.toString());
    if (keputusan === "DIKONFIRMASI") {
      await kabariPengguna(nota.salesmanId, {
        jenis: JENIS_KABAR.KONTRABON_DIKONFIRMASI,
        judul: `Janji bayar ${nota.docNo} dikonfirmasi`,
        isi: `${nota.store.name} · ${nilai}, janji bayar ${formatDisplayDate(nota.promisedDate)}.`,
        data,
      });
    } else {
      const alasan = catatan?.trim() ? ` Alasan: ${catatan.trim()}` : "";
      await kabariPengguna(nota.salesmanId, {
        jenis: JENIS_KABAR.KONTRABON_DIBATALKAN,
        judul: `Janji bayar ${nota.docNo} dibatalkan`,
        isi: `${nota.store.name} · ${nilai}.${alasan}`,
        data,
      });
    }
  } catch (err) {
    console.error("[kabar] kontrabon lapangan gagal", collectionNoteId, err);
  }
}

/**
 * Tanggal dari `<input type="date">` datang sebagai "YYYY-MM-DD" tanpa zona.
 * Ditafsirkan sebagai tengah malam WIB, bukan UTC — kalau tidak, sebuah tanda
 * terima yang diserahkan hari ini tercatat kemarin bagi siapa pun di Jakarta.
 */
function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Buat kontrabon baru.
 *
 * Dibatasi ke pemegang `receivables:manage`: menyerahkan faktur fisik adalah
 * keputusan penagihan, dan kontrabon yang salah mengunci piutangnya dari
 * kontrabon lain sampai dibatalkan.
 */
export async function buatKontrabonAction(input: {
  receivableIds: string[];
  handoverDate: string;
  promisedDate: string;
  receivedBy?: string;
  photoUrl?: string | null;
  note?: string;
}): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }

  const serah = tanggalWib(input.handoverDate);
  const janji = tanggalWib(input.promisedDate);
  if (!serah || !janji) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };

  try {
    const hasil = await buatKontrabon({
      receivableIds: input.receivableIds,
      salesmanId: session.user.id,
      handoverDate: serah,
      promisedDate: janji,
      receivedBy: input.receivedBy,
      photoUrl: input.photoUrl,
      note: input.note,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("buatKontrabon gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Tandai kontrabon selesai (semua fakturnya lunas) atau batal (faktur ditarik). */
export async function tutupKontrabonAction(
  collectionNoteId: string,
  keputusan: "SELESAI" | "BATAL",
  catatan?: string,
): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }

  try {
    const hasil = await tutupKontrabon({
      collectionNoteId,
      keputusan,
      catatan,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    if (keputusan === "BATAL") {
      void kabarKontrabonLapangan(collectionNoteId, "DIBATALKAN", catatan, session.user.id);
    }
    return { ok: true };
  } catch (err) {
    console.error("tutupKontrabon gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Pasang foto lembar kontrabon yang sudah ditandatangani toko. */
export async function pasangFotoKontrabonAction(
  collectionNoteId: string,
  photoUrl: string,
): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }

  try {
    const hasil = await pasangFotoKontrabon({
      collectionNoteId,
      photoUrl,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    return { ok: true };
  } catch (err) {
    console.error("pasangFotoKontrabon gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Konfirmasi kantor atas janji bayar yang dicatat salesman di lapangan.
 *
 * Pemegang `receivables:manage` — pengelola penagihan, bukan pelapornya.
 * Salesman yang bisa mengonfirmasi janjinya sendiri membuat konfirmasi itu
 * tidak menyatakan apa-apa.
 */
export async function konfirmasiKontrabonAction(collectionNoteId: string): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!bolehMengelola(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  try {
    const hasil = await konfirmasiKontrabon({ collectionNoteId, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    revalidatePath(`/pwa/piutang/${hasil.storeId}`);
    void kabarKontrabonLapangan(collectionNoteId, "DIKONFIRMASI", null, session.user.id);
    return { ok: true };
  } catch (err) {
    console.error("konfirmasiKontrabon gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilJanjiBayar = { ok: true; docNo: string } | { ok: false; kode: KodeAksiKontrabon };

/**
 * Catat janji bayar / tukar faktur dari lapangan.
 *
 * Izinnya sama dengan melapor BKM (`bolehMelapor`): sales yang menyaksikan
 * toko menandatangani lembarnya. Servernya memeriksa ulang bahwa SETIAP faktur
 * memang ia tagih — layar HP sudah menyaring, tapi kiriman dari antrean bisa
 * tiba setelah tokonya dirotasi ke sales lain.
 *
 * Tanggal serah adalah hari laporannya dibuat di HP, bukan hari kirimannya
 * sampai: janji yang dicatat tanpa sinyal kemarin tetap diserahkan kemarin.
 * Tanggal serah di masa depan ditolak.
 */
export async function catatJanjiBayarAction(input: {
  receivableIds: string[];
  tanggalSerah: string;
  janjiBayar: string;
  receivedBy: string;
  photoUrl: string | null;
  note?: string;
  /** Kunci kiriman dari HP: kiriman ulang dengan kunci sama tidak mencatat dua kali. */
  idempotencyKey?: string | null;
}): Promise<HasilJanjiBayar> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  const serah = tanggalWib(input.tanggalSerah);
  const janji = tanggalWib(input.janjiBayar);
  if (!serah || !janji) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
  if (input.tanggalSerah > hariWib(new Date())) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };

  try {
    const hasil = await buatKontrabon({
      receivableIds: input.receivableIds,
      salesmanId: session.user.id,
      handoverDate: serah,
      promisedDate: janji,
      receivedBy: input.receivedBy,
      photoUrl: input.photoUrl,
      note: input.note,
      source: "FIELD",
      penagihId: session.user.id,
      idempotencyKey: input.idempotencyKey,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    const nota = await prisma.collectionNote.findUnique({ where: { id: hasil.id }, select: { storeId: true } });
    if (nota) revalidatePath(`/pwa/piutang/${nota.storeId}`);
    return { ok: true, docNo: hasil.docNo };
  } catch (err) {
    console.error("catatJanjiBayar gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
