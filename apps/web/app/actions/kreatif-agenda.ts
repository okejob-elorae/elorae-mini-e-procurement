"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { ButirChecklist } from "@/lib/creative/agenda-aturan";
import {
  centangAgenda,
  hapusAgenda,
  simpanAgenda,
  tandaiSelesaiAgenda,
  type HasilSimpanAgenda,
  type KodeTolakAgenda,
} from "@/lib/creative/agenda-writer";

/*
 * Agenda Ruang KOL. Setiap ekspor berkas "use server" adalah endpoint yang
 * bisa dipanggil langsung, jadi izin diperiksa di setiap aksi dan pemiliknya
 * selalu pengguna sesi — id pengguna dari klien tidak pernah dipercaya.
 * Galat dikembalikan sebagai `{ ok: false, kode }`, tidak dilempar.
 */

type Gagal = { ok: false; kode: KodeTolakAgenda | "TANPA_AKSES" | "GAGAL" };

async function penulis(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? s.user.id : null;
}

function segarkan() {
  // Agenda muncul di Hari ini (dan lencananya) serta di kalender.
  revalidatePath("/backoffice/kreatif", "layout");
}

export async function simpanAgendaAction(input: Record<string, unknown>): Promise<HasilSimpanAgenda | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await simpanAgenda(input, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("simpanAgenda gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function centangAgendaAction(input: { id: string; indeks: number; selesai: boolean }): Promise<{ ok: true; checklist: ButirChecklist[] } | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await centangAgenda({ id: String(input?.id ?? ""), indeks: Number(input?.indeks), selesai: input?.selesai === true }, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("centangAgenda gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function selesaiAgendaAction(input: { id: string; selesai: boolean }): Promise<{ ok: true; doneAt: string | null } | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await tandaiSelesaiAgenda({ id: String(input?.id ?? ""), selesai: input?.selesai === true }, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("tandaiSelesaiAgenda gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function hapusAgendaAction(input: { id: string }): Promise<{ ok: true } | Gagal> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await hapusAgenda({ id: String(input?.id ?? "") }, oleh);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("hapusAgenda gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
