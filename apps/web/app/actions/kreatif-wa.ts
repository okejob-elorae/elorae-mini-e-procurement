"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { catatKirimWa, siapkanPesanWa, type HasilSiapkanWa } from "@/lib/creative/wa-writer";

/*
 * Tombol WhatsApp Kreatif. Setiap ekspor berkas "use server" adalah endpoint
 * yang bisa dipanggil langsung, jadi izinnya diperiksa di setiap aksi.
 */

async function izin(): Promise<{ userId: string; bolehUbah: boolean } | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  if (!hasPermission(p, PERMISSIONS.CREATIVE_VIEW)) return null;
  return { userId: s.user.id, bolehUbah: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE) };
}

export async function siapkanPesanWaAction(input: {
  kolId: string;
  kolaborasiId?: string | null;
}): Promise<HasilSiapkanWa | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const i = await izin();
  if (!i) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return await siapkanPesanWa({ kolId: String(input.kolId ?? ""), kolaborasiId: input.kolaborasiId || null });
  } catch (err) {
    console.error("siapkanPesanWa gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function catatKirimWaAction(input: {
  kolId: string;
  kolaborasiId?: string | null;
  templateNama?: string | null;
}): Promise<{ ok: true; tahapBaru: string | null } | { ok: false; kode: "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "GAGAL" }> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await catatKirimWa({
      kolId: String(input.kolId ?? ""),
      kolaborasiId: input.kolaborasiId || null,
      templateNama: input.templateNama ?? null,
      olehUserId: i.userId,
    });
    if (r.ok) revalidatePath("/backoffice/kreatif", "layout");
    return r;
  } catch (err) {
    console.error("catatKirimWa gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
