import { createHash } from "node:crypto";

/**
 * Sidik isi foto: SHA-256 dari bytenya, heksadesimal huruf kecil.
 *
 * Dihitung saat unggah dan disimpan di `Foto.sha256`, supaya foto yang isinya
 * sama persis dengan foto lain bisa dikenali tanpa membaca byte siapa pun
 * (`lib/foto/kembar.ts`). Bentuknya sama dengan `encode(sha256(bytes), 'hex')`
 * di Postgres dan `SHA2(bytes, 256)` di MariaDB yang mengisi foto lama.
 */
export function sidikFoto(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
