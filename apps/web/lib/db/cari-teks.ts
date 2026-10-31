/**
 * Saringan teks abai huruf besar-kecil untuk `where` Prisma, aman di DUA dialek.
 *
 * Opsi `mode: "insensitive"` hanya ada di klien Prisma PostgreSQL. Klien yang
 * dibangkitkan dari schema.prisma (MariaDB, produksi) tidak punya field itu:
 * menulisnya langsung di kueri membuat build gagal type-check, dan bila lolos,
 * setiap pencarian melempar "Unknown argument `mode`". MariaDB tidak butuh opsi
 * itu — collation utf8mb4 *_ci sudah abai huruf, jadi `contains` biasa cukup.
 * Di PostgreSQL justru wajib: tanpanya `contains` jadi LIKE yang peka huruf.
 *
 * Tipe kembalian sengaja TANPA `mode`, supaya bisa dipakai klien MySQL maupun
 * PostgreSQL; opsi itu hanya ditambahkan saat jalan bila dialeknya PostgreSQL.
 * Ini satu-satunya tempat opsi tersebut boleh ditulis — dijaga oleh
 * cari-teks.penjaga.test.ts.
 *
 * Sengaja tidak mengimpor `@elorae/db`: banyak tes memalsukan modul itu dengan
 * objek parsial, dan helper ini dipanggil dari kueri yang dites begitu.
 */

/** Sama persis dengan `isPostgresUrl` di packages/db/src/adapter.ts (dan prisma.config.ts). */
const POLA_POSTGRES = /^postgres(ql)?:\/\//i;

/**
 * True bila datasource aktif PostgreSQL. Dibaca per panggilan, bukan saat modul
 * dimuat — dotenv bisa mengisi DATABASE_URL belakangan (sama seperti
 * `usePostgres` di @elorae/db). URL kosong = MySQL, bawaan prisma.config.ts.
 */
export function dialekPostgres(url: string | undefined = process.env.DATABASE_URL): boolean {
  return POLA_POSTGRES.test((url ?? "").trim());
}

/** `contains` abai huruf: `{ name: cariTeks(q) }`. Pemanggil yang memangkas `q`. */
export function cariTeks(q: string): { contains: string } {
  return (dialekPostgres() ? { contains: q, mode: "insensitive" } : { contains: q }) as { contains: string };
}

/** `equals` abai huruf: `{ sku: samaTeks(kode) }`. */
export function samaTeks(q: string): { equals: string } {
  return (dialekPostgres() ? { equals: q, mode: "insensitive" } : { equals: q }) as { equals: string };
}
