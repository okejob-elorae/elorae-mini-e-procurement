/*
 * Pilihan tampilan di menu pengguna kantor: tema dan bahasa. Murni.
 */

export type PilihanTema = "light" | "dark" | "system";

/**
 * Tema yang TERSIMPAN (satu-satunya yang diberi centang) dan tema PERANGKAT
 * (`systemTheme` next-themes) — yang akan tampak bila "Ikuti perangkat"
 * dipilih. Dulu "Ikuti perangkat" yang tampak terang mencentang "Terang" dan
 * "Ikuti perangkat" sekaligus. Keterangan "(sekarang …)" memakai tema
 * perangkat, bukan tema yang sedang tampak: dengan "Gelap" tersimpan di
 * perangkat terang, "Ikuti perangkat" akan tampak terang. Tanpa pilihan
 * tersimpan = ikuti perangkat.
 */
export function keadaanTema(
  theme: string | undefined,
  temaPerangkat: string | undefined,
): { terpilih: PilihanTema; perangkat: "light" | "dark" | null } {
  const terpilih: PilihanTema = theme === "light" || theme === "dark" ? theme : "system";
  const perangkat = temaPerangkat === "light" || temaPerangkat === "dark" ? temaPerangkat : null;
  return { terpilih, perangkat };
}

/** Nama bahasa ditulis dalam bahasanya sendiri — tidak ikut diterjemahkan. */
export const BAHASA = [
  { kode: "id", nama: "Bahasa Indonesia" },
  { kode: "en", nama: "English" },
] as const;
