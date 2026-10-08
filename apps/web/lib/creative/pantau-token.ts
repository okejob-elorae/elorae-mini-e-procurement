import { createHash, randomBytes, randomInt } from "node:crypto";
import { ALFABET_KODE, PANJANG_KODE } from "./pantau-aturan";

/**
 * Token dan kode sambung perangkat pantau — KHUSUS SERVER (node:crypto).
 *
 * Seperti tautan portal toko (`lib/field-sales/portal-toko.ts`): yang DISIMPAN
 * hanya sha256 heks-nya (`KolPerangkat.tokenHash` / `kodeHash`). Token mentah
 * dikembalikan SEKALI ke ekstensi saat menyambung; kode mentah ditampilkan
 * SEKALI ke orang yang membuatnya. Basis data yang bocor tidak membocorkan
 * token yang bisa dipakai. Mencari lewat hash yang unik tidak butuh pembanding
 * waktu-konstan. Token dan kode TIDAK PERNAH ditulis ke log atau `AuditLog`.
 */

export function hashRahasia(nilai: string): string {
  return createHash("sha256").update(nilai, "utf8").digest("hex");
}

/** 32 byte acak, base64url tanpa padding = tepat 43 karakter. */
export function buatToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashRahasia(token) };
}

export const PANJANG_TOKEN = 43;

/** Bentuk token yang mungkin sah — diperiksa SEBELUM di-hash dan dicari. */
export function bentukTokenSah(token: unknown): token is string {
  return typeof token === "string" && token.length === PANJANG_TOKEN && /^[A-Za-z0-9_-]+$/.test(token);
}

/** Kode sambung 8 tanda dari alfabet tanpa huruf yang mudah tertukar. */
export function buatKode(): { kode: string; kodeHash: string } {
  let kode = "";
  for (let i = 0; i < PANJANG_KODE; i++) kode += ALFABET_KODE[randomInt(ALFABET_KODE.length)];
  return { kode, kodeHash: hashRahasia(kode) };
}

/** Token dari kepala `Authorization: Bearer <token>`; selain itu `null`. */
export function tokenDariKepala(kepala: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(kepala ?? "");
  return m && bentukTokenSah(m[1]) ? m[1] : null;
}
