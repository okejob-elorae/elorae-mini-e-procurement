"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import type { StatusCampaignKol } from "@/lib/creative/campaign-aturan";
import { simpanCampaign, type AlasanGagalCampaign } from "@/lib/creative/campaign-writer";

/*
 * Aksi Campaign KOL. Izin diperiksa di setiap aksi; pengguna dari sesi.
 * Campaign tidak pernah dihapus — diarsipkan lewat centang di formulirnya.
 */

export type HasilAksiCampaign = { ok: true; id: string } | { ok: false; kode: AlasanGagalCampaign | "TANPA_AKSES" | "GAGAL"; detail?: string };

export type IsianCampaign = {
  name: string;
  brand?: string | null;
  product?: string | null;
  objective?: string | null;
  /** "YYYY-MM-DD" (hari WIB) atau kosong. */
  startDate?: string | null;
  endDate?: string | null;
  budget?: number | null;
  targetKol?: number | null;
  targetContent?: number | null;
  targetViews?: number | null;
  /** Draft / Berjalan / Selesai / Batal; tidak dikirim = tidak disentuh. */
  status?: StatusCampaignKol;
  brief?: string | null;
  note?: string | null;
  arsip?: boolean;
};

const teks = (v: unknown, maks = 5000): string | null => (typeof v === "string" ? v.slice(0, maks) : null);
const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v == null ? null : NaN);
const tanggal = (v: unknown): Date | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? (parseDateOnly(v) ?? null) : null;

export async function simpanCampaignAction(id: string | null, isi: IsianCampaign): Promise<HasilAksiCampaign> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  try {
    const r = await simpanCampaign({
      id: typeof id === "string" && id ? id : null,
      isi: {
        name: teks(isi?.name, 200) ?? "",
        brand: teks(isi.brand, 200),
        product: teks(isi.product, 200),
        objective: teks(isi.objective),
        startDate: tanggal(isi.startDate),
        endDate: tanggal(isi.endDate),
        budget: angka(isi.budget),
        targetKol: angka(isi.targetKol),
        targetContent: angka(isi.targetContent),
        targetViews: angka(isi.targetViews),
        // Nilainya diperiksa penulis (`STATUS_TIDAK_VALID`).
        status: typeof isi.status === "string" ? (isi.status as StatusCampaignKol) : undefined,
        brief: teks(isi.brief, 20_000),
        note: teks(isi.note),
        arsip: isi.arsip === true,
      },
      olehUserId: s.user.id,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    revalidatePath("/backoffice/kreatif", "layout");
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("simpanCampaign gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
