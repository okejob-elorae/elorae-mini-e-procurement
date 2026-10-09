import { NextResponse } from "next/server";
import type { KodeGalatPantau } from "./pantau-aturan";
import { pembatasTokenPantau } from "./pantau-batas";
import { hashRahasia, tokenDariKepala } from "./pantau-token";
import { perangkatDariToken, type PerangkatSah } from "./pantau-writer";

/*
 * Bagian bersama route handler API ekstensi pantau KOL
 * (`app/api/kreatif/ekstensi/*`) — KHUSUS SERVER.
 *
 * Rute ini di luar sesi NextAuth (allow-list `proxy.ts`): setiap handler
 * memeriksa token perangkatnya sendiri lewat `perangkatPermintaan`. Jawaban
 * selalu JSON `{ ok: false, kode }` dengan kode HTTP yang sesuai; galat tak
 * terduga dicatat di log server dan dijawab `GAGAL` tanpa jejak tumpukan.
 */

/** Badan permintaan terbesar — satu hasil profil (≤ 200 posting) jauh di bawah ini. */
export const MAKS_BADAN_BYTE = 256 * 1024;

const HTTP: Partial<Record<KodeGalatPantau, number>> = {
  TOKEN_TIDAK_SAH: 401,
  TERLALU_SERING: 429,
  MUATAN_TIDAK_SAH: 400,
  KODE_TIDAK_SAH: 400,
  KODE_KEDALUWARSA: 410,
  TUGAS_TIDAK_ADA: 404,
  TUGAS_TIDAK_AKTIF: 409,
  JENIS_BERBEDA: 400,
  AKUN_BERBEDA: 422,
  KONTEN_BERBEDA: 422,
  ANGKA_KOSONG: 422,
  ANGKA_TIDAK_SAH: 422,
  TANGGAL_TIDAK_SAH: 422,
  BELUM_TAYANG: 422,
  TIDAK_DITEMUKAN: 404,
  TIDAK_ADA_DI_ELORAE: 404,
  TANPA_IZIN: 403,
  KOL_DIBLOKIR: 409,
  GAGAL: 500,
};

export function statusHttp(kode: string): number {
  return HTTP[kode as KodeGalatPantau] ?? 400;
}

export function jawab(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function tolak(kode: string): NextResponse {
  return jawab({ ok: false, kode }, statusHttp(kode));
}

export function gagalTakTerduga(label: string, e: unknown): NextResponse {
  console.error(`[api ekstensi ${label}] gagal:`, e);
  return tolak("GAGAL");
}

/** Badan JSON, atau `undefined` bila bukan JSON / terlalu besar. Badan kosong = `{}`. */
export async function bacaBadan(req: Request): Promise<unknown | undefined> {
  const teks = await req.text();
  if (teks.length > MAKS_BADAN_BYTE) return undefined;
  if (!teks.trim()) return {};
  try {
    return JSON.parse(teks);
  } catch {
    return undefined;
  }
}

/**
 * Perangkat pemilik token di kepala `Authorization: Bearer`, atau jawaban
 * penolakannya (401 / 429). Batas laju dihitung pada hash token SEBELUM basis
 * data disentuh.
 */
export async function perangkatPermintaan(req: Request): Promise<{ ok: true; perangkat: PerangkatSah } | { ok: false; respons: NextResponse }> {
  const token = tokenDariKepala(req.headers.get("authorization"));
  if (!token) return { ok: false, respons: tolak("TOKEN_TIDAK_SAH") };
  if (!pembatasTokenPantau.coba(hashRahasia(token))) return { ok: false, respons: tolak("TERLALU_SERING") };
  const perangkat = await perangkatDariToken(token, new Date(), { versi: req.headers.get("x-elorae-versi") });
  if (!perangkat) return { ok: false, respons: tolak("TOKEN_TIDAK_SAH") };
  return { ok: true, perangkat };
}

/** Alamat peminta untuk batas laju `/sambung` (di belakang Caddy: kepala `x-forwarded-for`). */
export function alamatPeminta(req: Request): string {
  const maju = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return maju || req.headers.get("x-real-ip")?.trim() || "lokal";
}
