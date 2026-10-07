import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { centangAgenda, hapusAgenda, simpanAgenda, tandaiSelesaiAgenda } from "./agenda-writer";

/*
 * Terhadap basis data sungguhan: pemilik, kaitan kolaborasi → KOL, dan jejak
 * yang ditulis di transaksi yang sama. Aturan isiannya diuji di agenda-aturan.
 */

const tag = `AGENDAUJI-${Math.random().toString(36).slice(2, 7)}`;
let pemilik = "";
let orangLain = "";
let kolId = "";
let kolLainId = "";
let kolabId = "";
let campaignId = "";
let agendaIds: string[] = [];

beforeEach(async () => {
  pemilik = "";
  orangLain = "";
  kolId = "";
  kolLainId = "";
  kolabId = "";
  campaignId = "";
  agendaIds = [];
  const users = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  pemilik = users[0].id;
  orangLain = users[1]?.id ?? "";
  kolId = (await prisma.kol.create({ data: { name: `${tag} Nadia` }, select: { id: true } })).id;
  kolLainId = (await prisma.kol.create({ data: { name: `${tag} Lain` }, select: { id: true } })).id;
  kolabId = (await prisma.kolBrief.create({ data: { docNo: `${tag}-1`, kolId, tahap: "DEAL" }, select: { id: true } })).id;
  campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} campaign` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: "KolAgenda", entityId: { in: seededIds(agendaIds) } } });
  await prisma.kolAgenda.deleteMany({ where: { id: { in: seededIds(agendaIds) } } });
  if (kolabId) await prisma.kolBrief.delete({ where: { id: seededId(kolabId) } });
  if (campaignId) await prisma.kolCampaign.delete({ where: { id: seededId(campaignId) } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds([kolId, kolLainId].filter(Boolean)) } } });
});

async function buat(isi: Record<string, unknown> = {}) {
  const r = await simpanAgenda({ judul: `${tag} meeting`, tanggal: "2026-10-20", jam: "9:30", jenis: "MEETING", checklist: "Deck\n[x] Undangan", ingatHari: 2, ...isi }, pemilik);
  if (!r.ok) throw new Error(r.kode);
  agendaIds.push(r.id);
  return r;
}

describe("simpanAgenda", () => {
  it("membuat agenda: tanggal hari WIB, jam dirapikan, persiapan JSON, jejak dibuat", async () => {
    const r = await buat({ campaignId });
    expect(r).toMatchObject({ ok: true, tanggal: "2026-10-20", baru: true });
    const a = await prisma.kolAgenda.findUniqueOrThrow({ where: { id: r.id } });
    expect(formatDateOnlyJakarta(a.date)).toBe("2026-10-20");
    expect(a).toMatchObject({ time: "09:30", kind: "MEETING", remindDaysBefore: 2, ownerId: pemilik, campaignId, doneAt: null });
    expect(JSON.parse(a.checklist!)).toEqual([
      { teks: "Deck", selesai: false },
      { teks: "Undangan", selesai: true },
    ]);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "KolAgenda", entityId: r.id }, select: { action: true } });
    expect(jejak.map((j) => j.action)).toEqual(["KOL_AGENDA_CREATED"]);
  });

  it("kaitan kolaborasi menentukan KOL-nya, walau KOL lain dikirim", async () => {
    const r = await buat({ kolaborasiId: kolabId, kolId: kolLainId });
    const a = await prisma.kolAgenda.findUniqueOrThrow({ where: { id: r.id } });
    expect(a.collabId).toBe(kolabId);
    expect(a.kolId).toBe(kolId);
  });

  it("kaitan yang tidak ada ditolak; isian salah dikembalikan per isian", async () => {
    expect(await simpanAgenda({ judul: "x", tanggal: "2026-10-20", kolaborasiId: "tidak-ada" }, pemilik)).toEqual({ ok: false, kode: "KAITAN_TIDAK_ADA" });
    expect(await simpanAgenda({ judul: "x", tanggal: "2026-10-20", campaignId: "tidak-ada" }, pemilik)).toEqual({ ok: false, kode: "KAITAN_TIDAK_ADA" });
    const r = await simpanAgenda({ judul: "x", tanggal: "2026-10-20", ingatHari: 45 }, pemilik);
    expect(r).toEqual({ ok: false, kode: "TIDAK_VALID", galat: [{ kolom: "ingatHari", kode: "INGAT_TIDAK_VALID" }] });
  });

  it("mengubah: jejak membawa sebelum/sesudah; orang lain ditolak", async () => {
    const r = await buat();
    const u = await simpanAgenda({ id: r.id, judul: `${tag} meeting dipindah`, tanggal: "2026-10-22", jenis: "DEADLINE" }, pemilik);
    expect(u).toEqual({ ok: true, id: r.id, tanggal: "2026-10-22", baru: false });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "KOL_AGENDA_UPDATED" }, select: { changes: true } });
    const ch = j.changes as { before: { tanggal: string; jenis: string }; after: { tanggal: string; jenis: string } };
    expect([ch.before.tanggal, ch.after.tanggal, ch.before.jenis, ch.after.jenis]).toEqual(["2026-10-20", "2026-10-22", "MEETING", "DEADLINE"]);

    if (orangLain) {
      expect(await simpanAgenda({ id: r.id, judul: "rebut", tanggal: "2026-10-22" }, orangLain)).toEqual({ ok: false, kode: "BUKAN_PEMILIK" });
      expect(await hapusAgenda({ id: r.id }, orangLain)).toEqual({ ok: false, kode: "BUKAN_PEMILIK" });
    }
    expect(await simpanAgenda({ id: "tidak-ada", judul: "x", tanggal: "2026-10-22" }, pemilik)).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });
});

describe("centang, selesai, hapus", () => {
  it("centang menetapkan butir; mengirim ulang tidak menulis jejak kedua", async () => {
    const r = await buat();
    const c1 = await centangAgenda({ id: r.id, indeks: 0, selesai: true }, pemilik);
    expect(c1).toEqual({
      ok: true,
      checklist: [
        { teks: "Deck", selesai: true },
        { teks: "Undangan", selesai: true },
      ],
    });
    await centangAgenda({ id: r.id, indeks: 0, selesai: true }, pemilik);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "KOL_AGENDA_UPDATED" } })).toBe(1);
    expect(await centangAgenda({ id: r.id, indeks: 9, selesai: true }, pemilik)).toEqual({ ok: false, kode: "INDEKS_TIDAK_VALID" });
  });

  it("selesai lalu dibuka lagi; masing-masing satu jejak", async () => {
    const r = await buat();
    const s = await tandaiSelesaiAgenda({ id: r.id, selesai: true }, pemilik);
    expect(s.ok && s.doneAt).toBeTruthy();
    await tandaiSelesaiAgenda({ id: r.id, selesai: true }, pemilik);
    const b = await tandaiSelesaiAgenda({ id: r.id, selesai: false }, pemilik);
    expect(b).toEqual({ ok: true, doneAt: null });
    const aksi = (await prisma.auditLog.findMany({ where: { entityId: r.id }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((x) => x.action);
    expect(aksi).toEqual(["KOL_AGENDA_CREATED", "KOL_AGENDA_DONE", "KOL_AGENDA_UPDATED"]);
  });

  it("hapus menyisakan jejak berisi keadaan sebelumnya", async () => {
    const r = await buat();
    expect(await hapusAgenda({ id: r.id }, pemilik)).toEqual({ ok: true });
    expect(await prisma.kolAgenda.findUnique({ where: { id: r.id } })).toBeNull();
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "KOL_AGENDA_DELETED" }, select: { changes: true } });
    expect((j.changes as { before: { judul: string } }).before.judul).toBe(`${tag} meeting`);
    expect(await hapusAgenda({ id: r.id }, pemilik)).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });
});
