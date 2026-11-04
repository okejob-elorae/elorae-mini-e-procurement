import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { terapkanMajuOtomatis } from "./maju-otomatis";

/**
 * Pintu maju-otomatis, terhadap basis data sungguhan: faktanya dibaca ulang
 * dari baris pengiriman/konten/angka, bukan dikirim pemanggil.
 */

const tag = `KMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let userId = "";
let kolId = "";
let briefId = "";
let kontenId = "";

beforeEach(async () => {
  userId = "";
  kolId = "";
  briefId = "";
  kontenId = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
  briefId = (
    await prisma.kolBrief.create({
      data: { docNo: `${tag}/1`, kolId, tahap: "DEAL", fee: 0, payStatus: "TIDAK_PERLU" },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(briefId) } });
  await prisma.kolContentMetric.deleteMany({ where: { contentId: seededId(kontenId) } });
  await prisma.kolContent.deleteMany({ where: { collabId: seededId(briefId) } });
  await prisma.kolShipment.deleteMany({ where: { collabId: seededId(briefId) } });
  await prisma.kolBrief.deleteMany({ where: { id: seededId(briefId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

const jalankan = (sebab = "uji") =>
  prisma.$transaction((tx) => terapkanMajuOtomatis(tx, { kolaborasiId: briefId, olehUserId: userId, sebab }));

const tahap = async () => (await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } })).tahap;

describe("terapkanMajuOtomatis", () => {
  it("resi tercatat memajukan DEAL ke SAMPEL_DIKIRIM dan meninggalkan jejak otomatis", async () => {
    await prisma.kolShipment.create({ data: { collabId: briefId, trackingNo: "JNE123", sentAt: new Date() } });
    expect(await jalankan("resi diisi")).toEqual({ dari: "DEAL", ke: "SAMPEL_DIKIRIM" });
    expect(await tahap()).toBe("SAMPEL_DIKIRIM");
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: briefId, action: "KOL_COLLAB_STAGE_AUTO_ADVANCED" } });
    expect(jejak.metadata).toMatchObject({ sebab: "resi diisi", otomatis: true });
  });

  it("tanpa fakta baru tidak bergerak dan tidak menulis jejak", async () => {
    expect(await jalankan()).toBeNull();
    expect(await tahap()).toBe("DEAL");
    expect(await prisma.auditLog.count({ where: { entityId: briefId } })).toBe(0);
  });

  it("link konten memajukan ke TAYANG dan mengisi tanggal tayang kolaborasi dari kontennya", async () => {
    const tayang = new Date("2026-10-01T03:00:00.000Z");
    kontenId = (
      await prisma.kolContent.create({
        data: { collabId: briefId, platform: "TIKTOK", format: "VIDEO", link: "https://tiktok.com/@x/video/1", liveAt: tayang },
        select: { id: true },
      })
    ).id;
    expect(await jalankan()).toEqual({ dari: "DEAL", ke: "TAYANG" });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } })).liveAt?.toISOString()).toBe(tayang.toISOString());
  });

  it("angka pada H+7 kolaborasi tanpa fee langsung menutupnya SELESAI", async () => {
    await prisma.kolBrief.update({ where: { id: briefId }, data: { tahap: "TAYANG" } });
    kontenId = (
      await prisma.kolContent.create({
        data: {
          collabId: briefId,
          platform: "INSTAGRAM",
          format: "REELS",
          link: "https://instagram.com/reel/1",
          liveAt: new Date("2026-10-01T03:00:00.000Z"),
        },
        select: { id: true },
      })
    ).id;
    await prisma.kolContentMetric.create({ data: { contentId: kontenId, views: 1000, recordedAt: new Date("2026-10-03T03:00:00.000Z") } });
    expect(await jalankan()).toBeNull();
    await prisma.kolContentMetric.create({ data: { contentId: kontenId, views: 5000, recordedAt: new Date("2026-10-08T03:00:00.000Z") } });
    expect(await jalankan()).toEqual({ dari: "TAYANG", ke: "SELESAI" });
  });

  it("TIDAK menyentuh kolaborasi yang sudah keluar jalur", async () => {
    await prisma.kolBrief.update({ where: { id: briefId }, data: { tahap: "BATAL" } });
    await prisma.kolShipment.create({ data: { collabId: briefId, trackingNo: "JNE123", receivedAt: new Date() } });
    expect(await jalankan()).toBeNull();
    expect(await tahap()).toBe("BATAL");
  });
});
