import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { catatKirimWa, siapkanPesanWa } from "./wa-writer";

const tag = `WAUJI-${Math.random().toString(36).slice(2, 7)}`;
let kolId = "";
let kolabIds: string[] = [];
let userId = "";

beforeEach(async () => {
  kolId = "";
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (
    await prisma.kol.create({
      data: {
        name: `${tag} Nadia`,
        phone: "0812-3456-7890",
        accounts: { create: [{ platform: "TIKTOK", handle: "nadia.daily", followers: 85_000 }] },
      },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  const entitas = [...seededIds(kolabIds), seededId(kolId)];
  await prisma.auditLog.deleteMany({ where: { entityId: { in: entitas } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

describe("siapkanPesanWa", () => {
  it("mengisi template dengan nama KOL dan menormalkan nomornya", async () => {
    const r = await siapkanPesanWa({ kolId });
    if (!r.ok) throw new Error(r.kode);
    expect(r.nomor).toBe("6281234567890");
    expect(r.pesan.length).toBeGreaterThan(0);
    expect(r.pesan[0].isi).toContain(`${tag} Nadia`);
    expect(r.pesan.every((p) => !p.isi.includes("{nama}"))).toBe(true);
  });

  it("menolak kolaborasi milik KOL lain", async () => {
    expect(await siapkanPesanWa({ kolId, kolaborasiId: "bukan-milik" })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });
});

describe("catatKirimWa", () => {
  it("mencatat kontak terakhir dan memajukan kolaborasi PROSPEK ke DIHUBUNGI", async () => {
    const c = await prisma.kolBrief.create({ data: { docNo: `${tag}-1`, kolId, tahap: "PROSPEK" }, select: { id: true } });
    kolabIds.push(c.id);

    const r = await catatKirimWa({ kolId, kolaborasiId: c.id, templateNama: "Perkenalan pertama", olehUserId: userId });
    expect(r).toEqual({ ok: true, tahapBaru: "DIHUBUNGI" });

    const baris = await prisma.kolBrief.findUniqueOrThrow({ where: { id: c.id } });
    expect(baris.tahap).toBe("DIHUBUNGI");
    expect(baris.lastContactAt).not.toBeNull();
    expect(baris.outreachAt).not.toBeNull();
    const jejak = await prisma.auditLog.findMany({ where: { entityId: c.id }, select: { action: true, metadata: true } });
    expect(jejak.map((j) => j.action).sort()).toEqual(["KOL_COLLAB_CONTACTED", "KOL_COLLAB_STAGE_AUTO_ADVANCED"]);
  });

  it("kolaborasi yang sudah lewat PROSPEK tidak berpindah tahap", async () => {
    const c = await prisma.kolBrief.create({ data: { docNo: `${tag}-2`, kolId, tahap: "NEGO" }, select: { id: true } });
    kolabIds.push(c.id);
    expect(await catatKirimWa({ kolId, kolaborasiId: c.id, templateNama: "Follow-up", olehUserId: userId })).toEqual({
      ok: true,
      tahapBaru: null,
    });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: c.id } })).tahap).toBe("NEGO");
  });
});
