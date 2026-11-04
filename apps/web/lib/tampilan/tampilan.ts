/*
 * Pilihan tampilan daftar (Tabel / Galeri / Papan), seperti Notion dan
 * Airtable: satu daftar yang sama, beberapa cara melihatnya. Murni, aman untuk
 * komponen klien.
 *
 * Pilihan disimpan per orang per perangkat (localStorage, kunci memuat id
 * pengguna) dan ikut di alamat (`?tampilan=`) supaya tautan yang dibagikan
 * membuka tampilan yang sama. Alamat menang atas yang tersimpan.
 */

export const JENIS_TAMPILAN = ["tabel", "galeri", "papan"] as const;
export type JenisTampilan = (typeof JENIS_TAMPILAN)[number];

/** Nilai mentah (alamat/penyimpanan) → tampilan yang diizinkan halaman itu, atau `bawaan`. */
export function bacaTampilan(
  nilai: unknown,
  bolehkan: readonly JenisTampilan[],
  bawaan: JenisTampilan,
): JenisTampilan {
  return typeof nilai === "string" && (bolehkan as readonly string[]).includes(nilai) ? (nilai as JenisTampilan) : bawaan;
}

export function kunciSimpanTampilan(halaman: string, userId: string | null | undefined): string {
  return `elorae.tampilan.${halaman}.${userId || "tamu"}`;
}

type Penyimpanan = Pick<Storage, "getItem" | "setItem">;

/** Tampilan tersimpan, atau null bila tidak ada/tidak sah/penyimpanan tidak bisa dibaca. */
export function ambilTampilanTersimpan(
  penyimpanan: Penyimpanan | null | undefined,
  kunci: string,
  bolehkan: readonly JenisTampilan[],
): JenisTampilan | null {
  try {
    const v = penyimpanan?.getItem(kunci);
    return typeof v === "string" && (bolehkan as readonly string[]).includes(v) ? (v as JenisTampilan) : null;
  } catch {
    return null;
  }
}

/** Simpan pilihan; penyimpanan yang penuh/terblokir tidak menggagalkan apa pun. */
export function ingatTampilan(penyimpanan: Penyimpanan | null | undefined, kunci: string, nilai: JenisTampilan): void {
  try {
    penyimpanan?.setItem(kunci, nilai);
  } catch {
    // Hanya kenyamanan.
  }
}
