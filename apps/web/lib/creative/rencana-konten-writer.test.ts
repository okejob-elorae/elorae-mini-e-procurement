import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { simpanKonten } from "./writer";
import { daftarKonten } from "./queries";

/** Bug F (status rencana konten) dan G (lewat jadwal menurut hari WIB), terhadap basis data sungguhan. */

const tag = `RKW-${Math.random().toString(36).slice(2, 7)}`;
let ids: string[] = [];
let userId = "";

async function buat(status: "IDE" | "REVIEW" | "TAYANG" | "DIJADWALKAN", scheduledAt: Date | null = null) {
  const r = await simpanKonten({
    isi: { title: `${tag} ${status}`, platform: "INSTAGRAM", format: "FEED", status, scheduledAt },
    olehUserId: userId,
  });
  if (!r.ok) throw new Error(r.alasan);
  ids.push(r.id);
  return r.id;
}

const ubahStatus = (id: string, status: "IDE" | "DRAFT" | "REVIEW" | "DIJADWALKAN" | "TAYANG" | "BATAL", alasan?: string) =>
  simpanKonten({ id, isi: { title: `${tag} ubah`, platform: "INSTAGRAM", format: "FEED", status }, alasan, olehUserId: userId });

const status = async (id: string) => (await prisma.contentPlan.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  ids = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(ids) } } });
  await prisma.contentPlan.deleteMany({ where: { id: { in: seededIds(ids) } } });
});

describe("status rencana konten (bug F)", () => {
  it("maju boleh melompat tanpa alasan", async () => {
    const id = await buat("IDE");
    expect(await ubahStatus(id, "DIJADWALKAN")).toMatchObject({ ok: true });
    expect(await status(id)).toBe("DIJADWALKAN");
  });

  it("mundur tanpa alasan ditolak dan statusnya tidak berubah", async () => {
    const id = await buat("REVIEW");
    expect(await ubahStatus(id, "IDE")).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await status(id)).toBe("REVIEW");
  });

  it("mundur dengan alasan diterima dan alasannya tercatat di jejak", async () => {
    const id = await buat("TAYANG");
    expect(await ubahStatus(id, "DIJADWALKAN", "salah tandai tayang")).toMatchObject({ ok: true });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "CONTENT_PLAN_UPDATED" } });
    expect(jejak.reason).toBe("salah tandai tayang");
    expect(jejak.changes).toMatchObject({ before: { status: "TAYANG" }, after: { status: "DIJADWALKAN" } });
  });

  it("yang sudah tayang tidak bisa dibatalkan", async () => {
    const id = await buat("TAYANG");
    expect(await ubahStatus(id, "BATAL", "tidak jadi")).toEqual({ ok: false, alasan: "STATUS_TIDAK_VALID" });
    expect(await status(id)).toBe("TAYANG");
  });
});

describe("lewat jadwal menurut hari WIB (bug G)", () => {
  it("jadwal hari ini belum terlambat; jadwal kemarin terlambat", async () => {
    const sekarang = new Date();
    const hariIni = await buat("DIJADWALKAN", sekarang);
    const kemarin = await buat("DIJADWALKAN", new Date(sekarang.getTime() - 26 * 3_600_000));
    const baris = (await daftarKonten()).filter((k) => ids.includes(k.id));
    expect(baris.find((k) => k.id === hariIni)?.terlambat).toBe(false);
    expect(baris.find((k) => k.id === kemarin)?.terlambat).toBe(true);
  });
});
