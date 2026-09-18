/**
 * Aksen untuk kain netral (hitam, putih, abu) — kain tanpa rona tidak bisa
 * memberi rona aksen, jadi dipilihkan dari warna sablon yang lazim dan kuat.
 * Urutan ini juga urutan kartu di galeri komposisi, dan aksen pertama menjadi
 * rona dasar saran berbasis aturan harmoni di kain netral.
 */
export const AKSEN_POPULER = ['375 C', 'Orange 021 C', '2728 C', '485 C', '116 C', '3262 C', '213 C'] as const;

/** Di bawah kepekatan (kroma Lab) ini sebuah warna dianggap tidak berona. */
export const KROMA_NETRAL = 6;
