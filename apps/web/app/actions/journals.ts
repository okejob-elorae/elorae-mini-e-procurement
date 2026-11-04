"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  ajukanJurnalManual,
  ajukanPembalik,
  setujuiJurnal,
  tolakJurnal,
  ubahDrafJurnal,
  type HasilJurnalManual,
} from "@/lib/finance/jurnal-manual/writer";

/*
 * Jurnal manual dengan persetujuan (maker-checker, rancangan akuntansi & pajak
 * lengkap D4; keputusan sementara pemilik no. 39). Semua aksi butuh
 * `journals:manage`; aktor selalu dari `auth()`. Penulisnya
 * (`lib/finance/jurnal-manual/writer.ts`) yang menolak penyetuju = pembuat.
 * Tidak pernah melempar ke layar: `{ ok: false, code }`.
 */

export type ManualJournalLineInput = {
  chartAccountId: string;
  debit: number;
  credit: number;
  memo?: string;
  /** Kanal (`KANAL_JURNAL`), opsional. */
  channel?: string | null;
};

export type CreateManualJournalInput = {
  date: string;
  description: string;
  lines: ManualJournalLineInput[];
  /** Sekali per isian formulir — kiriman ulang mengembalikan draf yang sama. */
  idempotencyKey?: string | null;
};

export type CreateManualJournalResult =
  | { ok: true; journalId: string; ulang?: boolean }
  | { ok: false; code: string; baris?: number };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE) ? session.user.id : null;
}

function keHasil(r: HasilJurnalManual): CreateManualJournalResult {
  return r.ok ? { ok: true, journalId: r.journalId, ...(r.ulang ? { ulang: true } : {}) } : { ok: false, code: r.kode, ...(r.baris ? { baris: r.baris } : {}) };
}

function segarkan(journalId?: string) {
  revalidatePath("/backoffice/finance/journals");
  if (journalId) revalidatePath(`/backoffice/finance/journals/${journalId}`);
}

async function aman(nama: string, fn: () => Promise<CreateManualJournalResult>): Promise<CreateManualJournalResult> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[journals] ${nama} gagal`, e);
    return { ok: false, code: "GAGAL" };
  }
}

const baris = (lines: ManualJournalLineInput[]) =>
  (Array.isArray(lines) ? lines : []).map((l) => ({
    akunId: l.chartAccountId,
    debit: Number(l.debit) || 0,
    kredit: Number(l.credit) || 0,
    memo: l.memo ?? null,
    kanal: l.channel ?? null,
  }));

/** Mengajukan jurnal manual: tersimpan sebagai DRAF sampai disetujui orang lain. */
export async function createManualJournalAction(input: CreateManualJournalInput): Promise<CreateManualJournalResult> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  return aman("ajukan", async () => {
    const r = keHasil(
      await ajukanJurnalManual({
        tanggal: String(input.date ?? ""),
        keterangan: String(input.description ?? ""),
        baris: baris(input.lines),
        olehUserId: userId,
        idempotencyKey: input.idempotencyKey ?? null,
      }),
    );
    if (r.ok) segarkan(r.journalId);
    return r;
  });
}

/** Pembuat mengubah drafnya sendiri. */
export async function updateManualJournalDraftAction(input: CreateManualJournalInput & { id: string }): Promise<CreateManualJournalResult> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  return aman("ubah draf", async () => {
    const r = keHasil(
      await ubahDrafJurnal({
        id: String(input.id ?? ""),
        tanggal: String(input.date ?? ""),
        keterangan: String(input.description ?? ""),
        baris: baris(input.lines),
        olehUserId: userId,
      }),
    );
    if (r.ok) segarkan(r.journalId);
    return r;
  });
}

export async function approveManualJournalAction(input: { id: string }): Promise<CreateManualJournalResult> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  return aman("setujui", async () => {
    const r = keHasil(await setujuiJurnal({ id: String(input.id ?? ""), olehUserId: userId }));
    if (r.ok) segarkan(r.journalId);
    return r;
  });
}

/** Menolak (orang lain) atau menarik (pembuatnya) draf; alasan wajib. */
export async function rejectManualJournalAction(input: { id: string; reason: string }): Promise<CreateManualJournalResult> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  return aman("tolak", async () => {
    const r = keHasil(await tolakJurnal({ id: String(input.id ?? ""), alasan: String(input.reason ?? ""), olehUserId: userId }));
    if (r.ok) segarkan(r.journalId);
    return r;
  });
}

/** Mengajukan pembalik jurnal manual / berulang yang sudah diposting (draf, butuh persetujuan). */
export async function reverseManualJournalAction(input: { id: string; date: string; reason: string }): Promise<CreateManualJournalResult> {
  const userId = await pengelola();
  if (!userId) return { ok: false, code: "FORBIDDEN" };
  return aman("balik", async () => {
    const r = keHasil(
      await ajukanPembalik({ id: String(input.id ?? ""), tanggal: String(input.date ?? ""), alasan: String(input.reason ?? ""), olehUserId: userId }),
    );
    if (r.ok) {
      segarkan(r.journalId);
      revalidatePath(`/backoffice/finance/journals/${input.id}`);
    }
    return r;
  });
}
