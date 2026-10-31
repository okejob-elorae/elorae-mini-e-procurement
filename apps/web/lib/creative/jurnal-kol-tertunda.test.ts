import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";

/*
 * Jalur gagal jurnal KOL: peran belum dipetakan → `JOURNAL_PENDING` (sekali
 * per sebab), terbaca tab Tertunda (dokumen + tautan + posting ulang), lalu
 * posting ulang dari panel kolaborasi menandainya selesai.
 *
 * `generateAutoJournal` dipalsukan supaya kegagalan bisa dibuat tanpa
 * mencabut pemetaan akun orang lain di basis data bersama.
 */

const hasilJurnal = vi.hoisted(() => ({ nilai: { ok: false, code: "UNMAPPED_ROLE", role: "KOL_EXPENSE" } as Record<string, unknown> }));
vi.mock("@/lib/finance/journal", () => ({ generateAutoJournal: vi.fn(async () => hasilJurnal.nilai) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => undefined) }));

import { muatJurnalTertunda } from "@/app/backoffice/finance/journals/_tertunda/muat";
import { daftarJurnalTertunda, hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { jurnalKolTertunda, postingUlangJurnalKol, sinkronJurnalKolAman } from "./jurnal-kol";
import { selaraskanTermin } from "./termin-writer";

const tag = `JKTUNDA-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolId = "";
let kolabId = "";
let mulai = new Date();

async function notifikasiKu(): Promise<{ id: string; readAt: Date | null; metadata: unknown }[]> {
  const semua = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", createdAt: { gte: mulai } },
    select: { id: true, readAt: true, metadata: true },
  });
  return semua.filter((n) => (n.metadata as { docId?: string } | null)?.docId === kolabId);
}

beforeEach(async () => {
  userId = "";
  kolId = "";
  kolabId = "";
  mulai = new Date(Date.now() - 1000);
  hasilJurnal.nilai = { ok: false, code: "UNMAPPED_ROLE", role: "KOL_EXPENSE" };
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
  kolabId = (
    await prisma.kolBrief.create({
      data: { docNo: `${tag}/1`, kolId, fee: 1_000_000, tahap: "TAYANG", liveAt: new Date(), payStatus: "BELUM" },
      select: { id: true },
    })
  ).id;
  await runSerializable((tx) => selaraskanTermin(tx, { kolaborasiId: kolabId, olehUserId: userId, sebab: "uji" }));
});

afterEach(async () => {
  const ids = (await notifikasiKu()).map((n) => n.id);
  await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(ids) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([kolabId].filter(Boolean)) } } });
  await prisma.kolPaymentTerm.deleteMany({ where: { collabId: seededId(kolabId) } });
  if (kolabId) await prisma.kolBrief.delete({ where: { id: seededId(kolabId) } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

describe("JOURNAL_PENDING untuk jurnal KOL", () => {
  it("kegagalan dicatat sekali per sebab, terbaca di tab Tertunda, lalu selesai lewat posting ulang", async () => {
    const [r] = await sinkronJurnalKolAman([kolabId], userId, { paksa: true });
    expect(r).toMatchObject({ ok: false, gagal: [{ kode: "UNMAPPED_ROLE", peran: "KOL_EXPENSE" }] });
    await sinkronJurnalKolAman([kolabId], userId, { paksa: true });
    const n = await notifikasiKu();
    expect(n).toHaveLength(1);
    expect(n[0].metadata).toMatchObject({ docId: kolabId, kind: "kol_kolaborasi", reason: "UNMAPPED_ROLE", role: "KOL_EXPENSE", docNo: `${tag}/1` });

    expect(await jurnalKolTertunda(kolabId)).toEqual({ kolaborasi: true, sampelIds: [], sebab: ["UNMAPPED_ROLE"] });
    expect(await hitungJurnalTertunda({ notifikasiIds: [n[0].id] })).toBe(1);
    const [daftar] = await daftarJurnalTertunda({ notifikasiIds: [n[0].id] });
    expect(daftar.sumber).toEqual({ tipe: "kolaborasiKol", kolaborasiId: kolabId });
    const [baris] = await muatJurnalTertunda({ notifikasiIds: [n[0].id] });
    expect(baris).toMatchObject({
      jenis: "KOL_KOLABORASI",
      nomor: `${tag}/1`,
      hrefDokumen: `/backoffice/kreatif/kolaborasi/${kolabId}?tab=pembayaran`,
      hrefPostingUlang: `/backoffice/kreatif/kolaborasi/${kolabId}?tab=pembayaran`,
      otomatis: false,
      sebab: "UNMAPPED_ROLE",
      peran: "KOL_EXPENSE",
    });

    hasilJurnal.nilai = { ok: true, journalId: "palsu", created: true };
    const ulang = await postingUlangJurnalKol(kolabId, userId);
    expect(ulang).toMatchObject({ ok: true, diposting: 1 });
    const sesudah = await notifikasiKu();
    expect(sesudah[0].readAt).not.toBeNull();
    expect(await hitungJurnalTertunda({ notifikasiIds: [n[0].id] })).toBe(0);
    expect((await jurnalKolTertunda(kolabId)).kolaborasi).toBe(false);
  });

  it("di dalam vitest tanpa paksa: tidak memposting dan tidak menulis notifikasi", async () => {
    expect(await sinkronJurnalKolAman([kolabId], userId)).toEqual([]);
    expect(await notifikasiKu()).toHaveLength(0);
  });
});
