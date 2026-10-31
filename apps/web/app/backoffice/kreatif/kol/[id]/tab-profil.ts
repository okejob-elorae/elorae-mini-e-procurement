/**
 * Tab profil KOL yang bisa dibuka lewat alamat (`?tab=`) — murni, aman untuk
 * klien. Tautan "Lengkapi data" (Hari ini, rincian kolaborasi) membuka
 * `?tab=ukuran` langsung, tempat alamat, nomor HP, dan ukuran diisi.
 */
export const TAB_PROFIL_KOL = ["kolaborasi", "konten", "brand", "ukuran", "pengikut", "catatan"] as const;
export type TabProfilKol = (typeof TAB_PROFIL_KOL)[number];

export function bacaTabProfilKol(v: string | string[] | null | undefined): TabProfilKol {
  const x = Array.isArray(v) ? v[0] : v;
  return (TAB_PROFIL_KOL as readonly string[]).includes(x ?? "") ? (x as TabProfilKol) : "kolaborasi";
}
