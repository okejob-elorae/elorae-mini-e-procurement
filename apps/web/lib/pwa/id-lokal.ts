/**
 * Id acak untuk kunci idempoten dan antrean luring.
 *
 * `crypto.randomUUID` hanya ada di konteks aman (https atau localhost) — HP
 * yang membuka server lewat IP LAN http tidak punya, dan formulirnya mati
 * begitu dibuka. Cadangannya cukup unik untuk satu perangkat.
 *
 * Modul sendiri, tanpa Dexie, supaya layar yang hanya butuh id tidak ikut
 * memuat basis data luring.
 */
export function newLocalId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
