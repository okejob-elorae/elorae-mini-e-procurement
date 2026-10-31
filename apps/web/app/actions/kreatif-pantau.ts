"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { GalatPantau, PengaturanPantau } from "@/lib/creative/pantau-aturan";
import { simpanPengaturanPantau } from "@/lib/creative/pantau-pengaturan";
import { buatKodeSambung, cabutPerangkat, jedaPerangkat, lanjutkanPerangkat, susunAntrean } from "@/lib/creative/pantau-writer";

/*
 * Aksi layar Kreatif → Pemantauan. Setiap aksi memeriksa `creative:manage`
 * sendiri (tidak ada kode izin baru); penulisnya di `lib/creative/pantau-*`
 * menulis jejak `AuditLog` di transaksinya. Galat tak terduga dijawab
 * `GAGAL`, tidak dilempar (pesan galat produksi disamarkan Next).
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

async function pengelola(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? s.user.id : null;
}

function segarkan() {
  // Pemantauan, lencana Hari ini (perangkat berhenti), dan profil KOL membaca data yang sama.
  revalidatePath("/backoffice/kreatif", "layout");
}

async function jalankan<T>(label: string, fn: (oleh: string) => Promise<T>): Promise<T | Gagal> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return await fn(oleh);
  } catch (err) {
    console.error(`${label} gagal:`, err);
    return { ok: false, kode: "GAGAL" };
  }
}

const idSah = (x: unknown): x is string => typeof x === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(x);

export async function buatKodeSambungAction(input: { nama?: string; perangkatId?: string }): Promise<
  | { ok: true; perangkatId: string; nama: string; kode: string; berlakuSampai: string }
  | { ok: false; kode: "NAMA_WAJIB" | "NAMA_TERLALU_PANJANG" | "PERANGKAT_TIDAK_ADA" | "SUDAH_DICABUT" }
  | Gagal
> {
  return jalankan("buatKodeSambung", async (oleh) => {
    const perangkatId = input?.perangkatId;
    if (perangkatId !== undefined && !idSah(perangkatId)) return { ok: false as const, kode: "PERANGKAT_TIDAK_ADA" as const };
    const r = await buatKodeSambung({ nama: typeof input?.nama === "string" ? input.nama : null, perangkatId: perangkatId ?? null, olehUserId: oleh });
    if (!r.ok) return r;
    segarkan();
    return { ok: true as const, perangkatId: r.perangkatId, nama: r.nama, kode: r.kode, berlakuSampai: r.berlakuSampai.toISOString() };
  });
}

type HasilUbah = { ok: true } | { ok: false; kode: "PERANGKAT_TIDAK_ADA" | "SUDAH_DICABUT" } | Gagal;

async function ubahPerangkat(
  label: string,
  perangkatId: unknown,
  fn: typeof jedaPerangkat,
): Promise<HasilUbah> {
  return jalankan(label, async (oleh) => {
    if (!idSah(perangkatId)) return { ok: false as const, kode: "PERANGKAT_TIDAK_ADA" as const };
    const r = await fn({ perangkatId, olehUserId: oleh });
    if (r.ok) segarkan();
    return r;
  });
}

export async function jedaPerangkatAction(perangkatId: string): Promise<HasilUbah> {
  return ubahPerangkat("jedaPerangkat", perangkatId, jedaPerangkat);
}

export async function lanjutkanPerangkatAction(perangkatId: string): Promise<HasilUbah> {
  return ubahPerangkat("lanjutkanPerangkat", perangkatId, lanjutkanPerangkat);
}

export async function cabutPerangkatAction(perangkatId: string): Promise<HasilUbah> {
  return ubahPerangkat("cabutPerangkat", perangkatId, cabutPerangkat);
}

export async function susunAntreanSekarangAction(): Promise<{ ok: true; dibuat: number; dilewati: number } | Gagal> {
  return jalankan("susunAntreanPantau", async (oleh) => {
    const r = await susunAntrean({ olehUserId: oleh });
    segarkan();
    return { ok: true as const, ...r };
  });
}

export async function simpanPengaturanPantauAction(
  input: Record<string, unknown>,
): Promise<{ ok: true; pengaturan: PengaturanPantau } | { ok: false; kode: "TIDAK_VALID"; galat: GalatPantau[] } | Gagal> {
  return jalankan("simpanPengaturanPantau", async (oleh) => {
    const r = await simpanPengaturanPantau(input, oleh);
    if (r.ok) segarkan();
    return r;
  });
}
