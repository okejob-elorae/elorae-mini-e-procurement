/**
 * Penjaga tes untuk pengaturan pajak (`pajak.ppn`, `pajak.profil`).
 *
 * Basis data lokal dipakai bersama oleh server dev dan tes. Begitu pemilik
 * menyalakan PKP di server lokal, setiap tes jurnal yang mengandalkan "tanpa
 * PPN" akan mendapat baris PPN dan gagal. Maka di bawah vitest pengaturan
 * sungguhan TIDAK dibaca — pembacanya mengembalikan bawaan di kode — kecuali
 * tes meminta dengan `UJI_PENGATURAN_PAJAK=setelan` (mis. tes yang meneruskan
 * klien tiruan berisi pengaturan PKP). Aturan yang sama dengan
 * `UJI_TANGGAL_MULAI_BUKU` untuk tanggal mulai buku besar.
 */
export function bacaSetelanPajakSungguhan(): boolean {
  if (!process.env.VITEST) return true;
  return process.env.UJI_PENGATURAN_PAJAK === "setelan";
}
