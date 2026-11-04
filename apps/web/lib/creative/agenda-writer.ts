import type { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import {
  bacaChecklist,
  centangButir,
  tulisChecklist,
  validasiAgenda,
  type ButirChecklist,
  type GalatAgenda,
} from "./agenda-aturan";

/*
 * Penulis agenda Ruang KOL — KHUSUS SERVER.
 *
 * Agenda itu PRIBADI: hanya pemiliknya yang mengubah, mencentang, menandai
 * selesai, atau menghapus. Pemeriksaan pemilik dan perubahannya terjadi di
 * satu `runSerializable`, dan setiap perubahan menulis jejak `KOL_AGENDA_*`
 * (sebelum/sesudah) di transaksi yang sama — barisnya hanya menyimpan
 * keadaan terakhir.
 *
 * Kaitan ke kolaborasi menentukan KOL-nya sendiri: kolaborasi selalu milik
 * satu KOL, jadi KOL yang dikirim terpisah tidak boleh membantahnya.
 */

export type KodeTolakAgenda = "TIDAK_DITEMUKAN" | "BUKAN_PEMILIK" | "KAITAN_TIDAK_ADA" | "INDEKS_TIDAK_VALID";

export type HasilSimpanAgenda =
  | { ok: true; id: string; tanggal: string; baru: boolean }
  | { ok: false; kode: "TIDAK_VALID"; galat: GalatAgenda[] }
  | { ok: false; kode: KodeTolakAgenda };

const PILIH = {
  id: true,
  title: true,
  date: true,
  time: true,
  kind: true,
  checklist: true,
  note: true,
  campaignId: true,
  kolId: true,
  collabId: true,
  remindDaysBefore: true,
  doneAt: true,
  ownerId: true,
} as const;

type BarisAgenda = Prisma.KolAgendaGetPayload<{ select: typeof PILIH }>;

/** Bentuk jejak: tanggal sebagai hari WIB, daftar persiapan sebagai butir. */
function potret(a: BarisAgenda) {
  return {
    judul: a.title,
    tanggal: formatDateOnlyJakarta(a.date),
    jam: a.time,
    jenis: a.kind,
    checklist: bacaChecklist(a.checklist),
    catatan: a.note,
    campaignId: a.campaignId,
    kolId: a.kolId,
    kolaborasiId: a.collabId,
    ingatHari: a.remindDaysBefore,
    selesai: a.doneAt !== null,
  };
}

async function milikSendiri(
  tx: Prisma.TransactionClient,
  id: string,
  olehUserId: string,
): Promise<{ ok: true; a: BarisAgenda } | { ok: false; kode: "TIDAK_DITEMUKAN" | "BUKAN_PEMILIK" }> {
  const a = await tx.kolAgenda.findUnique({ where: { id }, select: PILIH });
  if (!a) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (a.ownerId !== olehUserId) return { ok: false, kode: "BUKAN_PEMILIK" };
  return { ok: true, a };
}

/** Buat (tanpa `id`) atau ubah agenda milik sendiri. */
export async function simpanAgenda(input: unknown, olehUserId: string): Promise<HasilSimpanAgenda> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : null;
  const v = validasiAgenda(input);
  if (!v.ok) return { ok: false, kode: "TIDAK_VALID", galat: v.galat };
  const g = v.agenda;
  const tanggal = parseDateOnly(g.tanggal);
  if (!tanggal) return { ok: false, kode: "TIDAK_VALID", galat: [{ kolom: "tanggal", kode: "TANGGAL_TIDAK_VALID" }] };

  return runSerializable(async (tx): Promise<HasilSimpanAgenda> => {
    let kolId = g.kolId;
    if (g.kolaborasiId) {
      const c = await tx.kolBrief.findUnique({ where: { id: g.kolaborasiId }, select: { kolId: true } });
      if (!c) return { ok: false, kode: "KAITAN_TIDAK_ADA" };
      kolId = c.kolId;
    } else if (kolId) {
      const k = await tx.kol.findUnique({ where: { id: kolId }, select: { id: true } });
      if (!k) return { ok: false, kode: "KAITAN_TIDAK_ADA" };
    }
    if (g.campaignId) {
      const cp = await tx.kolCampaign.findUnique({ where: { id: g.campaignId }, select: { id: true } });
      if (!cp) return { ok: false, kode: "KAITAN_TIDAK_ADA" };
    }

    const data = {
      title: g.judul,
      date: tanggal,
      time: g.jam,
      kind: g.jenis,
      checklist: tulisChecklist(g.checklist),
      note: g.catatan,
      campaignId: g.campaignId,
      kolId,
      collabId: g.kolaborasiId,
      remindDaysBefore: g.ingatHari,
    };

    if (!id) {
      const baru = await tx.kolAgenda.create({ data: { ...data, ownerId: olehUserId }, select: PILIH });
      await catatJejak(tx, {
        userId: olehUserId,
        action: JEJAK.AGENDA_DIBUAT,
        entityType: "KolAgenda",
        entityId: baru.id,
        changes: { after: potret(baru) },
      });
      return { ok: true, id: baru.id, tanggal: g.tanggal, baru: true };
    }

    const lama = await milikSendiri(tx, id, olehUserId);
    if (!lama.ok) return lama;
    const sesudah = await tx.kolAgenda.update({ where: { id }, data, select: PILIH });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.AGENDA_DIUBAH,
      entityType: "KolAgenda",
      entityId: id,
      changes: { before: potret(lama.a), after: potret(sesudah) },
    });
    return { ok: true, id, tanggal: g.tanggal, baru: false };
  });
}

/** Tetapkan satu butir persiapan selesai/belum (bukan membalik — mengirim ulang aman). */
export async function centangAgenda(
  input: { id: string; indeks: number; selesai: boolean },
  olehUserId: string,
): Promise<{ ok: true; checklist: ButirChecklist[] } | { ok: false; kode: KodeTolakAgenda }> {
  return runSerializable(async (tx) => {
    const lama = await milikSendiri(tx, input.id, olehUserId);
    if (!lama.ok) return lama;
    const sebelum = bacaChecklist(lama.a.checklist);
    const sesudah = centangButir(sebelum, input.indeks, input.selesai === true);
    if (!sesudah) return { ok: false as const, kode: "INDEKS_TIDAK_VALID" as const };
    if (sebelum[input.indeks].selesai === sesudah[input.indeks].selesai) return { ok: true as const, checklist: sebelum };
    await tx.kolAgenda.update({ where: { id: input.id }, data: { checklist: tulisChecklist(sesudah) } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.AGENDA_DIUBAH,
      entityType: "KolAgenda",
      entityId: input.id,
      changes: { before: { checklist: sebelum }, after: { checklist: sesudah } },
      metadata: { butir: input.indeks, selesai: sesudah[input.indeks].selesai },
    });
    return { ok: true as const, checklist: sesudah };
  });
}

/** Tandai agenda selesai atau buka lagi. Mengirim keadaan yang sama tidak menulis apa-apa. */
export async function tandaiSelesaiAgenda(
  input: { id: string; selesai: boolean },
  olehUserId: string,
): Promise<{ ok: true; doneAt: string | null } | { ok: false; kode: KodeTolakAgenda }> {
  return runSerializable(async (tx) => {
    const lama = await milikSendiri(tx, input.id, olehUserId);
    if (!lama.ok) return lama;
    const selesai = input.selesai === true;
    if ((lama.a.doneAt !== null) === selesai) return { ok: true as const, doneAt: lama.a.doneAt?.toISOString() ?? null };
    const doneAt = selesai ? new Date() : null;
    await tx.kolAgenda.update({ where: { id: input.id }, data: { doneAt } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: selesai ? JEJAK.AGENDA_SELESAI : JEJAK.AGENDA_DIUBAH,
      entityType: "KolAgenda",
      entityId: input.id,
      changes: { before: { selesai: !selesai }, after: { selesai } },
    });
    return { ok: true as const, doneAt: doneAt?.toISOString() ?? null };
  });
}

export async function hapusAgenda(input: { id: string }, olehUserId: string): Promise<{ ok: true } | { ok: false; kode: KodeTolakAgenda }> {
  return runSerializable(async (tx) => {
    const lama = await milikSendiri(tx, input.id, olehUserId);
    if (!lama.ok) return lama;
    await tx.kolAgenda.delete({ where: { id: input.id } });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK.AGENDA_DIHAPUS,
      entityType: "KolAgenda",
      entityId: input.id,
      changes: { before: potret(lama.a) },
    });
    return { ok: true as const };
  });
}

