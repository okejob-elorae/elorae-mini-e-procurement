"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { alamatLangganan, ASAL_SAH } from "@/lib/creative/kalender-langganan";
import { buatLanggananKalender, cabutLanggananKalender } from "@/lib/creative/kalender-langganan-writer";

/*
 * Tautan langganan Kalender Kreatif (Google Calendar / Apple Calendar).
 * Setiap orang mengelola tautannya sendiri — cukup `creative:view`, karena isinya
 * hanya yang sudah bisa ia lihat di halaman Kalender. Menjawab `{ ok:false, kode }`,
 * tidak pernah melempar (galat server disamarkan di produksi).
 */

const RUTE = "/backoffice/kreatif/kalender";

async function penggunaKreatif(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW) ? s.user.id : null;
}

export type HasilBuatLanggananAksi =
  | { ok: true; https: string; webcal: string; google: string; sejak: string }
  | { ok: false; kode: "TANPA_AKSES" | "ALAMAT_TIDAK_SAH" | "GAGAL" };

/**
 * Buat tautan baru (tautan lama berhenti bekerja). `asal` = origin halaman yang
 * memanggil (mis. https://elorae.cloud). Token mentah hanya ada di jawaban ini.
 */
export async function buatLanggananKalenderAction(input: { asal: string }): Promise<HasilBuatLanggananAksi> {
  const userId = await penggunaKreatif();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const asal = String(input?.asal ?? "");
  if (!ASAL_SAH.test(asal)) return { ok: false, kode: "ALAMAT_TIDAK_SAH" };
  try {
    const r = await buatLanggananKalender({ userId });
    revalidatePath(RUTE);
    return { ok: true, ...alamatLangganan(asal, r.token), sejak: r.sejak.toISOString() };
  } catch (e) {
    console.error("[kalender langganan] gagal membuat tautan:", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilCabutLanggananAksi = { ok: true } | { ok: false; kode: "TANPA_AKSES" | "TIDAK_ADA" | "GAGAL" };

export async function cabutLanggananKalenderAction(): Promise<HasilCabutLanggananAksi> {
  const userId = await penggunaKreatif();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await cabutLanggananKalender({ userId });
    if (!r.ok) return r;
    revalidatePath(RUTE);
    return { ok: true };
  } catch (e) {
    console.error("[kalender langganan] gagal mencabut tautan:", e);
    return { ok: false, kode: "GAGAL" };
  }
}
