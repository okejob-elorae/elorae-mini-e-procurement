"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { KodeBuktiTerima } from "@/lib/field-sales/delivery/bukti-terima";
import {
  catatBuktiTerima,
  koreksiBuktiTerima,
  type HasilBuktiTerima,
} from "@/lib/field-sales/delivery/bukti-terima-writer";

/**
 * Aksi bukti terima digital. Tipis: siapa yang boleh, apa yang sah, dan
 * kunci kiriman semuanya diputuskan penulis (`bukti-terima-writer.ts`) — di
 * sini hanya sesi, penangkapan galat, dan penyegaran halaman.
 *
 * Tidak pernah melempar: aksi yang melempar disamarkan Next di produksi, dan
 * antrean HP harus bisa membedakan "ditolak" (berhenti) dari "galat server"
 * (`GAGAL`, coba lagi).
 */

export type HasilAksiBuktiTerima = { ok: true; ulangan: boolean } | { ok: false; kode: KodeBuktiTerima };

/** Bentuk yang dikirim HP dan dialog kantor. `receivedAt` = instan ISO. */
export type MasukanAksiBuktiTerima = {
  deliveryId: string;
  receivedByName: string;
  receivedAt: string;
  podPhotoUrl: string | null;
  idempotencyKey: string;
  jenisBukti?: "FOTO" | "TANDA_TANGAN" | null;
};

export type MasukanAksiKoreksiBuktiTerima = MasukanAksiBuktiTerima & {
  reason: string;
  /** Isi yang dilihat pengoreksi saat dialognya dibuka (instan ISO). */
  sebelum?: { receivedByName: string | null; receivedAt: string | null; podPhotoUrl: string | null } | null;
};

function segarkan(orderId: string): void {
  revalidatePath(`/pwa/orders/${orderId}`);
  revalidatePath("/pwa/orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
}

async function jalankan(
  kerja: (pelaku: { userId: string; izin: string[] | undefined }) => Promise<HasilBuktiTerima>,
): Promise<HasilAksiBuktiTerima> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const hasil = await kerja({ userId: session.user.id, izin: session.user.permissions });
    if (!hasil.ok) return hasil;
    segarkan(hasil.orderId);
    return { ok: true, ulangan: hasil.ulangan };
  } catch (err) {
    console.error("[bukti-terima] gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Catat bukti terima pertama kali (salesman pemilik dari HP, atau kantor). */
export async function catatBuktiTerimaAction(input: MasukanAksiBuktiTerima): Promise<HasilAksiBuktiTerima> {
  const m = (input && typeof input === "object" ? input : {}) as Partial<MasukanAksiBuktiTerima>;
  return jalankan((pelaku) =>
    catatBuktiTerima(pelaku, {
      deliveryId: m.deliveryId,
      receivedByName: m.receivedByName,
      receivedAt: m.receivedAt,
      podPhotoUrl: m.podPhotoUrl,
      idempotencyKey: m.idempotencyKey,
      jenisBukti: m.jenisBukti,
    }),
  );
}

/** Koreksi bukti yang sudah tercatat — kantor saja, alasan wajib. */
export async function koreksiBuktiTerimaAction(input: MasukanAksiKoreksiBuktiTerima): Promise<HasilAksiBuktiTerima> {
  const m = (input && typeof input === "object" ? input : {}) as Partial<MasukanAksiKoreksiBuktiTerima>;
  return jalankan((pelaku) =>
    koreksiBuktiTerima(pelaku, {
      deliveryId: m.deliveryId,
      receivedByName: m.receivedByName,
      receivedAt: m.receivedAt,
      podPhotoUrl: m.podPhotoUrl,
      idempotencyKey: m.idempotencyKey,
      jenisBukti: m.jenisBukti,
      reason: m.reason,
      sebelum: m.sebelum,
    }),
  );
}
