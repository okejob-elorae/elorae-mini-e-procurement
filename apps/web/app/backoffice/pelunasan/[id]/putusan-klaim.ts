import type { HasilAksiKlaim } from "@/app/actions/receivables";
import type { RincianKlaim } from "@/lib/receivables/claim-queries";

type KodeGagal = Extract<HasilAksiKlaim, { ok: false }>["kode"];

/**
 * Pemisahan tugas: yang melaporkan (sales) atau mencatatkan BKM tidak boleh
 * memutuskannya. Aturan yang sama dengan `putuskanKlaim` — di sini hanya
 * supaya layar bisa mematikan tombolnya lebih dulu; penulisnya tetap penjaga.
 */
export function pemeriksaSamaKlaim(
  penontonId: string,
  klaim: { salesmanId: string | null; createdById: string | null },
): boolean {
  if (!penontonId) return false;
  return penontonId === klaim.salesmanId || penontonId === klaim.createdById;
}

/** Tombol "Cocok di rekening" + "Tolak": tampil atau tidak, dan kenapa mati. */
export function tombolPutusan(i: {
  status: RincianKlaim["status"];
  bolehMemutuskan: boolean;
  giroMenunggu: boolean;
  pemeriksaSama: boolean;
}): { tampil: boolean; alasanNonaktif: "PEMERIKSA_SAMA" | null } {
  const tampil = i.status === "DIKIRIM" && i.bolehMemutuskan && !i.giroMenunggu;
  return { tampil, alasanNonaktif: tampil && i.pemeriksaSama ? "PEMERIKSA_SAMA" : null };
}

/**
 * Kunci pesan (namespace `payments`) untuk putusan yang ditolak penulis.
 * MELEBIHI_SISA saat verifikasi berarti faktur sudah dilunasi BKM lain sejak
 * laporan ini dibuat — bukan salah ketik di formulir pembuatan.
 */
export function kunciGalatPutusan(kode: KodeGagal, keputusan: "TERVERIFIKASI" | "DITOLAK"): string {
  if (kode === "MELEBIHI_SISA" && keputusan === "TERVERIFIKASI") return "errVerifikasiMELEBIHI_SISA";
  return `err${kode}`;
}
