"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { bolehMemutuskanIzin, bolehMengajukanIzin, type KodeTolakIzin } from "@/lib/salesman/izin";
import {
  ajukanIzin,
  batalkanIzin,
  setujuiIzin,
  tarikIzin,
  tolakIzin,
  type HasilKeputusanIzin,
  type KodeTolakKeputusanIzin,
} from "@/lib/salesman/izin-writer";

/**
 * Izin, sakit, cuti: mengajukan dan menarik (HP — salesman dan SPG), lalu
 * keputusan kantor. Semua aturan ada di penulis (`lib/salesman/izin-writer.ts`);
 * di sini hanya sesi, izin, dan penyegaran layar.
 *
 * Mengembalikan KODE, tidak melempar — di produksi Next menyamarkan pesan
 * galat jadi digest acak.
 */

const segarkan = () => {
  revalidatePath("/pwa");
  revalidatePath("/pwa/absen");
  revalidatePath("/backoffice/izin");
  revalidatePath("/backoffice/absensi");
};

export type HasilAjukanIzinAction =
  | { ok: true; id: string }
  | { ok: false; kode: KodeTolakIzin | "KUNCI_WAJIB" | "KUNCI_DIPAKAI" | "TANPA_AKSES" | "GAGAL" }
  | { ok: false; kode: "KUOTA_CUTI_HABIS"; tahun: string; sisa: number };

export async function ajukanIzinAction(input: {
  jenis: string;
  mulai: string;
  selesai: string;
  alasan: string;
  fotoUrl?: string | null;
  /** Dibuat HP sekali per formulir — dua ketukan Kirim tetap satu ajuan. */
  idempotencyKey: string;
}): Promise<HasilAjukanIzinAction> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !bolehMengajukanIzin(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input !== "object") return { ok: false, kode: "GAGAL" };
  try {
    const r = await ajukanIzin({
      userId,
      jenis: input.jenis,
      mulai: input.mulai,
      selesai: input.selesai,
      alasan: input.alasan,
      fotoUrl: input.fotoUrl ?? null,
      idempotencyKey: input.idempotencyKey,
    });
    if (!r.ok) return r;
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("ajukanIzinAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilKeputusanIzinAction =
  | { ok: true }
  | { ok: false; kode: KodeTolakKeputusanIzin | "TANPA_AKSES" | "GAGAL" }
  | { ok: false; kode: "KUOTA_CUTI_HABIS"; tahun: string; sisa: number };

async function jalankan(
  boleh: (izin: string[] | undefined) => boolean,
  aksi: (userId: string) => Promise<HasilKeputusanIzin>,
  nama: string,
): Promise<HasilKeputusanIzinAction> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !boleh(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await aksi(userId);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error(`${nama} gagal`, err);
    return { ok: false, kode: "GAGAL" };
  }
}

const idSah = (id: unknown): string => (typeof id === "string" ? id : "");

/** Pemohon menarik ajuannya yang masih menunggu. */
export async function tarikIzinAction(id: string, alasan?: string | null): Promise<HasilKeputusanIzinAction> {
  return jalankan(bolehMengajukanIzin, (userId) => tarikIzin({ leaveRequestId: idSah(id), userId, alasan }), "tarikIzinAction");
}

export async function setujuiIzinAction(id: string, catatan?: string | null): Promise<HasilKeputusanIzinAction> {
  return jalankan(
    bolehMemutuskanIzin,
    (userId) => setujuiIzin({ leaveRequestId: idSah(id), olehUserId: userId, catatan }),
    "setujuiIzinAction",
  );
}

export async function tolakIzinAction(id: string, catatan: string): Promise<HasilKeputusanIzinAction> {
  return jalankan(
    bolehMemutuskanIzin,
    (userId) => tolakIzin({ leaveRequestId: idSah(id), olehUserId: userId, catatan }),
    "tolakIzinAction",
  );
}

/** Mencabut izin yang sudah disetujui. */
export async function batalkanIzinAction(id: string, catatan: string): Promise<HasilKeputusanIzinAction> {
  return jalankan(
    bolehMemutuskanIzin,
    (userId) => batalkanIzin({ leaveRequestId: idSah(id), olehUserId: userId, catatan }),
    "batalkanIzinAction",
  );
}
