"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaSumberLapangan } from "@/lib/finance/lapangan/aturan";
import { postingJurnalLapanganAman, type KodeGagalPosting } from "@/lib/finance/lapangan/tertunda";
import { postingSemuaTanpaJurnal, selaraskanJurnalToko, type HasilMassal } from "@/lib/finance/lapangan/selaraskan-toko";

/*
 * Aksi jurnal penjualan lapangan & piutang toko (Keuangan → Rekonsiliasi
 * piutang). Memposting jurnal = pekerjaan keuangan: `journals:manage`. Tidak
 * pernah melempar — hasil berkode.
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "PERMINTAAN_RUSAK" | "GAGAL" };

async function pelaku(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE) ? session.user.id : null;
}

function segarkan() {
  revalidatePath("/backoffice/finance/rekonsiliasi-piutang");
  revalidatePath("/backoffice/finance/journals");
}

export type HasilPostingUlang =
  | { ok: true; created: boolean }
  | { ok: false; kode: KodeGagalPosting; peran?: string; detail?: string }
  | Gagal;

/** Posting (atau selaraskan) jurnal satu dokumen lapangan. */
export async function postingUlangJurnalLapanganAction(sumber: string, id: string): Promise<HasilPostingUlang> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const s = bacaSumberLapangan(sumber);
  if (!s || typeof id !== "string" || id === "") return { ok: false, kode: "PERMINTAAN_RUSAK" };
  try {
    const r = await postingJurnalLapanganAman(s, id, userId);
    segarkan();
    if (r.ok) return { ok: true, created: r.created };
    return { ok: false, kode: r.code, ...(r.role ? { peran: r.role } : {}), ...(r.detail ? { detail: r.detail } : {}) };
  } catch (e) {
    console.error("[finance-lapangan] posting ulang gagal", sumber, id, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilMassalAksi = ({ ok: true } & HasilMassal) | Gagal;

/** Selaraskan semua jurnal lapangan satu toko. */
export async function selaraskanJurnalTokoAction(storeId: string): Promise<HasilMassalAksi> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof storeId !== "string" || storeId === "") return { ok: false, kode: "PERMINTAAN_RUSAK" };
  try {
    const r = await selaraskanJurnalToko(storeId, userId);
    segarkan();
    return { ok: true, ...r };
  } catch (e) {
    console.error("[finance-lapangan] selaraskan toko gagal", storeId, e);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Posting setiap dokumen lapangan yang belum berjurnal sejak tanggal mulai (100 per jenis per klik). */
export async function postingSemuaJurnalLapanganAction(): Promise<HasilMassalAksi> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await postingSemuaTanpaJurnal(userId);
    segarkan();
    return { ok: true, ...r };
  } catch (e) {
    console.error("[finance-lapangan] posting semua gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}
