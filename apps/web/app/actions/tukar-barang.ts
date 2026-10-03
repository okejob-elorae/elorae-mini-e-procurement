"use server";

import { revalidatePath } from "next/cache";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { auth } from "@/lib/auth";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import {
  bolehMengajukanTukar,
  bolehMenyelesaikanTukar,
  bolehMenyetujuiTukar,
} from "@/lib/salesman/tukar-barang";
import { namaTokoTukar } from "@/lib/salesman/tukar-queries";
import {
  ajukanTukar,
  batalkanTukar,
  selesaikanTukar,
  setujuiTukar,
  tolakTukar,
  type HasilAjukanTukar,
  type HasilKeputusanTukar,
} from "@/lib/salesman/tukar-writer";

/**
 * Aksi tukar barang: mengajukan (HP), menyetujui/menolak (kantor penjualan),
 * menyelesaikan (gudang), membatalkan (salesman miliknya / kantor).
 *
 * Setiap aksi mengembalikan KODE, tidak melempar — di produksi Next
 * menyamarkan pesan galat jadi digest acak. Kabar ke salesman dikirim SESUDAH
 * transaksi dan tidak pernah membatalkannya.
 */

export type HasilAjukanTukarAksi = HasilAjukanTukar | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };
export type HasilKeputusanTukarAksi = HasilKeputusanTukar | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

function segarkan(exchangeId?: string, storeId?: string) {
  revalidatePath("/pwa/tukar");
  revalidatePath("/backoffice/tukar-barang");
  if (exchangeId) revalidatePath(`/backoffice/tukar-barang/${exchangeId}`);
  if (storeId) revalidatePath(`/pwa/stores/${storeId}`);
}

export async function ajukanTukarAction(input: {
  storeId: string;
  baris: unknown;
  catatan?: string | null;
  /** Dibuat HP sekali per formulir — dua ketukan Kirim tetap satu dokumen. */
  idempotencyKey: string;
}): Promise<HasilAjukanTukarAksi> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !bolehMengajukanTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  // SPG (toko tetap) tidak mengajukan tukar barang — itu urusan salesman toko putus.
  if (await ambilTokoTetap(userId)) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input !== "object" || typeof input.storeId !== "string") return { ok: false, kode: "GAGAL" };

  try {
    const r = await ajukanTukar({
      salesmanId: userId,
      storeId: input.storeId,
      baris: input.baris,
      catatan: input.catatan,
      idempotencyKey: input.idempotencyKey,
    });
    if (r.ok) segarkan(r.id, input.storeId);
    return r;
  } catch (err) {
    console.error("ajukanTukarAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Kabar ke salesman pengaju. Dilewati kalau pelakunya salesman itu sendiri,
 * dan untuk penyelesaian yang diulang (`ulang`) — ia sudah dikabari sekali.
 */
async function kabari(
  hasil: Extract<HasilKeputusanTukar, { ok: true }>,
  pelakuId: string,
  jenis: "TUKAR_DISETUJUI" | "TUKAR_DITOLAK" | "TUKAR_SELESAI" | "TUKAR_DIBATALKAN",
  exchangeId: string,
  alasan?: string | null,
): Promise<void> {
  if (hasil.ulang || hasil.salesmanId === pelakuId) return;
  try {
    const toko = await namaTokoTukar(hasil.storeId);
    const kabar =
      jenis === "TUKAR_DISETUJUI"
        ? {
            jenis: JENIS_KABAR.TUKAR_DISETUJUI,
            judul: `Tukar barang ${hasil.docNo} disetujui`,
            isi: `Penukaran di ${toko} disetujui. Barang akan disiapkan gudang.${alasan ? ` Catatan: ${alasan}` : ""}`,
          }
        : jenis === "TUKAR_DITOLAK"
          ? {
              jenis: JENIS_KABAR.TUKAR_DITOLAK,
              judul: `Tukar barang ${hasil.docNo} ditolak`,
              isi: `Penukaran di ${toko} ditolak. Alasan: ${alasan ?? "-"}`,
            }
          : jenis === "TUKAR_DIBATALKAN"
            ? {
                jenis: JENIS_KABAR.TUKAR_DIBATALKAN,
                judul: `Tukar barang ${hasil.docNo} dibatalkan kantor`,
                isi: `Penukaran di ${toko} dibatalkan. Alasan: ${alasan ?? "-"}`,
              }
            : {
                jenis: JENIS_KABAR.TUKAR_SELESAI,
                judul: `Tukar barang ${hasil.docNo} selesai`,
                isi: `Barang di ${toko} sudah ditukar dan stok gudang sudah diperbarui.`,
              };
    await kabariPengguna(hasil.salesmanId, { ...kabar, data: { exchangeId } });
  } catch (err) {
    console.error("[kabar] tukar barang gagal", jenis, exchangeId, err);
  }
}

export async function setujuiTukarAction(exchangeId: string, catatan?: string | null): Promise<HasilKeputusanTukarAksi> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  if (!pelakuId || !bolehMenyetujuiTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof exchangeId !== "string" || !exchangeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await setujuiTukar({ exchangeId, olehUserId: pelakuId, catatan });
    if (r.ok) {
      segarkan(exchangeId, r.storeId);
      await kabari(r, pelakuId, "TUKAR_DISETUJUI", exchangeId, typeof catatan === "string" ? catatan.trim() || null : null);
    }
    return r;
  } catch (err) {
    console.error("setujuiTukarAction gagal", exchangeId, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function tolakTukarAction(exchangeId: string, alasan: string): Promise<HasilKeputusanTukarAksi> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  if (!pelakuId || !bolehMenyetujuiTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof exchangeId !== "string" || !exchangeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await tolakTukar({ exchangeId, olehUserId: pelakuId, alasan });
    if (r.ok) {
      segarkan(exchangeId, r.storeId);
      await kabari(r, pelakuId, "TUKAR_DITOLAK", exchangeId, typeof alasan === "string" ? alasan.trim() : null);
    }
    return r;
  } catch (err) {
    console.error("tolakTukarAction gagal", exchangeId, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Gudang: barang sudah benar-benar bertukar — stok bergerak di sini. */
export async function selesaikanTukarAction(exchangeId: string): Promise<HasilKeputusanTukarAksi> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  if (!pelakuId || !bolehMenyelesaikanTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof exchangeId !== "string" || !exchangeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await selesaikanTukar({ exchangeId, olehUserId: pelakuId });
    if (r.ok) {
      segarkan(exchangeId, r.storeId);
      revalidatePath("/backoffice/inventory");
      await kabari(r, pelakuId, "TUKAR_SELESAI", exchangeId);
    }
    return r;
  } catch (err) {
    console.error("selesaikanTukarAction gagal", exchangeId, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Salesman membatalkan pengajuannya sendiri (alasan boleh kosong). */
export async function batalkanTukarSayaAction(exchangeId: string, alasan?: string | null): Promise<HasilKeputusanTukarAksi> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  if (!pelakuId || !bolehMengajukanTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof exchangeId !== "string" || !exchangeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await batalkanTukar({ exchangeId, olehUserId: pelakuId, sebagai: "SALESMAN", alasan });
    if (r.ok) segarkan(exchangeId, r.storeId);
    return r;
  } catch (err) {
    console.error("batalkanTukarSayaAction gagal", exchangeId, err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Kantor membatalkan (alasan wajib) — keputusan dagang, izin yang sama dengan menyetujui. */
export async function batalkanTukarKantorAction(exchangeId: string, alasan: string): Promise<HasilKeputusanTukarAksi> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  if (!pelakuId || !bolehMenyetujuiTukar(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof exchangeId !== "string" || !exchangeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await batalkanTukar({ exchangeId, olehUserId: pelakuId, sebagai: "KANTOR", alasan });
    if (r.ok) {
      segarkan(exchangeId, r.storeId);
      await kabari(r, pelakuId, "TUKAR_DIBATALKAN", exchangeId, alasan);
    }
    return r;
  } catch (err) {
    console.error("batalkanTukarKantorAction gagal", exchangeId, err);
    return { ok: false, kode: "GAGAL" };
  }
}
