/*
 * Surat PO (2026-10-07, meniru "Surat (pembuka & penutup)" PLAN PRODUKSI SSG):
 * paragraf pembuka dan penutup yang tercetak di PO. Bawaannya disimpan di
 * `SystemSetting["purchasing.suratPo"]` (Pengaturan → Pajak, kartu Surat PO), dan
 * bisa diubah per cetak tanpa mengubah bawaannya. Murni, aman di klien.
 */

export const KUNCI_SURAT_PO = "purchasing.suratPo";
export const MAKS_PANJANG_SURAT_PO = 2000;
/** Nama tindakan `AuditLog` saat bawaan surat PO diubah. */
export const JEJAK_SURAT_PO = "PURCHASE_ORDER_LETTER_UPDATED";

export type SuratPo = { pembuka: string; penutup: string };

export const SURAT_PO_BAWAAN: SuratPo = {
  pembuka: "Dengan hormat,\nBersama surat ini kami memesan barang dengan rincian sebagai berikut:",
  penutup:
    "Mohon barang dikirim sesuai jumlah, warna, dan tanggal yang tercantum. Atas perhatian dan kerja samanya kami ucapkan terima kasih.",
};

function rapikan(teks: unknown): string | null {
  if (typeof teks !== "string") return null;
  return teks.replace(/\r\n/g, "\n").trim();
}

/**
 * Nilai tersimpan → surat. Tidak ada, rusak, atau bukan objek → bawaan; satu
 * bagian yang hilang diisi bawaannya. Teks kosong yang tersimpan berarti
 * "tidak dicetak" dan dipertahankan.
 */
export function bacaSuratPo(nilai: string | null | undefined): SuratPo {
  if (!nilai) return { ...SURAT_PO_BAWAAN };
  try {
    const o = JSON.parse(nilai) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || Array.isArray(o)) return { ...SURAT_PO_BAWAAN };
    return {
      pembuka: (rapikan(o.pembuka) ?? SURAT_PO_BAWAAN.pembuka).slice(0, MAKS_PANJANG_SURAT_PO),
      penutup: (rapikan(o.penutup) ?? SURAT_PO_BAWAAN.penutup).slice(0, MAKS_PANJANG_SURAT_PO),
    };
  } catch {
    return { ...SURAT_PO_BAWAAN };
  }
}

/** Isian formulir → surat yang boleh disimpan, atau null bila tidak sah. */
export function periksaSuratPo(isi: unknown): SuratPo | null {
  if (!isi || typeof isi !== "object") return null;
  const o = isi as Record<string, unknown>;
  const pembuka = rapikan(o.pembuka);
  const penutup = rapikan(o.penutup);
  if (pembuka == null || penutup == null) return null;
  if (pembuka.length > MAKS_PANJANG_SURAT_PO || penutup.length > MAKS_PANJANG_SURAT_PO) return null;
  return { pembuka, penutup };
}
