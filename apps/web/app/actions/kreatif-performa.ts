"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { JENIS_ORANG_VIDEO, type JenisOrangVideo } from "@/lib/creative/link-video";
import { tempelLinkVideo, type HasilTempelLink } from "@/lib/creative/tempel-link-writer";
import { keadaanPemantau, mintaCekSekarang, type HasilCekSekarang, type KeadaanPemantau } from "@/lib/creative/cek-sekarang-writer";

/*
 * Aksi Kreatif → Performa video. "Tempel link" butuh `creative:manage` (tidak
 * ada kode izin baru). Penulisnya (`tempel-link-writer.ts`) menulis jejak di
 * transaksinya sendiri. Galat tak terduga dijawab `GAGAL`, tidak dilempar
 * (pesan galat produksi disamarkan Next).
 */

export async function tempelLinkVideoAction(input: {
  teks: string;
  jenis: JenisOrangVideo;
}): Promise<HasilTempelLink | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE)) return { ok: false, kode: "TANPA_AKSES" };
  const jenis = (JENIS_ORANG_VIDEO as readonly string[]).includes(input?.jenis) ? input.jenis : null;
  if (!jenis) return { ok: false, kode: "JENIS_TIDAK_SAH" };
  try {
    const r = await tempelLinkVideo({ teks: typeof input?.teks === "string" ? input.teks : "", jenis, olehUserId: s.user.id });
    // Performa video, Konten KOL, Kolaborasi, KOL, dan lencana Hari ini membaca data yang sama.
    if (r.ok && (r.ditambahkan > 0 || r.kolBaru > 0)) revalidatePath("/backoffice/kreatif", "layout");
    return r;
  } catch (err) {
    console.error("tempelLinkVideo gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * "Cek sekarang": taruh video di depan antrean ekstensi (`cek-sekarang-writer.ts`), lalu kabarkan
 * kapan kira-kira dikerjakan (perangkat menyala? jam kerja?).
 */
export async function cekSekarangAction(
  kontenIds: string[],
): Promise<(HasilCekSekarang & { keadaan?: KeadaanPemantau }) | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await mintaCekSekarang({ kontenIds: Array.isArray(kontenIds) ? kontenIds.filter((x) => typeof x === "string") : [] });
    if (!r.ok) return r;
    if (r.diantrekan > 0 || r.sudahAntre > 0) revalidatePath("/backoffice/kreatif/performa");
    return { ...r, keadaan: await keadaanPemantau() };
  } catch (err) {
    console.error("cekSekarang gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
