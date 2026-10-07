"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { AmbangKreatif } from "@/lib/creative/ambang";
import {
  simpanAmbangKreatif,
  simpanIdentitasKreatif,
  simpanTemplateWaKreatif,
  type KodeTolakTemplate,
} from "@/lib/creative/pengaturan";
import { variabelTakDikenal, type IdentitasKreatif, type TemplateWa } from "@/lib/creative/wa";

/*
 * Pengaturan Ruang KOL (ambang, identitas pesan, template WhatsApp).
 * Pembacanya memakai bawaan bila kosong; penulisnya di `lib/creative/
 * pengaturan.ts` sudah menulis jejak sebelum/sesudah di transaksinya.
 * Setiap aksi memeriksa `creative:manage` sendiri.
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

async function penulis(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? s.user.id : null;
}

function segarkan() {
  // Ambang mengubah isi Hari ini, kalender, dan lencana; template dipakai tombol WhatsApp di semua tab.
  revalidatePath("/backoffice/kreatif", "layout");
}

export async function simpanAmbangKreatifAction(
  input: Record<string, unknown>,
): Promise<{ ok: true; ambang: AmbangKreatif } | { ok: false; kode: "TIDAK_VALID"; galat: { kunci: keyof AmbangKreatif; sebab: string }[] } | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await simpanAmbangKreatif(input, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("simpanAmbangKreatif gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function simpanIdentitasKreatifAction(
  input: Record<string, unknown>,
): Promise<{ ok: true; identitas: IdentitasKreatif } | { ok: false; kode: "TIDAK_VALID" | "TERLALU_PANJANG" } | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await simpanIdentitasKreatif(input, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("simpanIdentitasKreatif gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Simpan SELURUH daftar template (tambah, ubah, hapus = daftar baru).
 * Variabel yang tidak dikenal ditolak di sini — pembaca template membiarkannya
 * apa adanya, jadi "{nma}" yang salah ketik akan terkirim mentah ke KOL.
 */
export async function simpanTemplateWaKreatifAction(
  input: TemplateWa[],
): Promise<
  | { ok: true; templates: TemplateWa[] }
  | { ok: false; kode: KodeTolakTemplate; indeks?: number }
  | { ok: false; kode: "VARIABEL_TAK_DIKENAL"; indeks: number; variabel: string[] }
  | Gagal
> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (Array.isArray(input)) {
    for (const [indeks, x] of input.entries()) {
      const variabel = typeof x?.isi === "string" ? variabelTakDikenal(x.isi) : [];
      if (variabel.length) return { ok: false, kode: "VARIABEL_TAK_DIKENAL", indeks, variabel };
    }
  }
  try {
    const r = await simpanTemplateWaKreatif(input, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("simpanTemplateWaKreatif gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
