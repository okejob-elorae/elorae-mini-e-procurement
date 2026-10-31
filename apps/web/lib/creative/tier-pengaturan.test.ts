import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AMBANG_TIER_BAWAAN, KUNCI_TIER } from "./tier";
import { bacaAmbangTierKreatif, simpanAmbangTierKreatif } from "./tier-pengaturan";

/**
 * Ambang tier terhadap basis data sungguhan. Barisnya konfigurasi bersama di
 * basis data dev, jadi nilai aslinya dipotret dulu dan DIPULIHKAN sesudah
 * setiap tes — termasuk menghapus baris yang sebelumnya tidak ada.
 */

let asli: string | null = null;
let jejakIds: string[] = [];
let userId = "";

beforeEach(async () => {
  jejakIds = [];
  asli = null;
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  asli = (await prisma.systemSetting.findUnique({ where: { key: KUNCI_TIER }, select: { value: true } }))?.value ?? null;
  await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_TIER) } });
});

afterEach(async () => {
  // Konfigurasi bersama dipulihkan lebih dulu, apa pun yang terjadi sesudahnya.
  if (asli === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_TIER) } });
  else await prisma.systemSetting.upsert({ where: { key: KUNCI_TIER }, create: { key: KUNCI_TIER, value: asli }, update: { value: asli } });
  await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(jejakIds) } } });
});

describe("ambang tier di SystemSetting", () => {
  it("tanpa baris = bawaan; baris rusak juga bawaan", async () => {
    expect(await bacaAmbangTierKreatif()).toEqual(AMBANG_TIER_BAWAAN);
    await prisma.systemSetting.create({ data: { key: KUNCI_TIER, value: "{rusak" } });
    expect(await bacaAmbangTierKreatif()).toEqual(AMBANG_TIER_BAWAAN);
  });

  it("menyimpan ambang yang naik berurutan dan menulis jejak sebelum/sesudah", async () => {
    const baru = { mikro: 5_000, mid: 50_000, makro: 300_000, mega: 2_000_000 };
    expect(await simpanAmbangTierKreatif(baru, userId)).toEqual({ ok: true, ambang: baru });
    expect(await bacaAmbangTierKreatif()).toEqual(baru);
    const j = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CREATIVE_SETTINGS_UPDATED", entityId: KUNCI_TIER, userId },
      orderBy: { createdAt: "desc" },
    });
    jejakIds.push(j.id);
    expect(j.changes).toEqual({ before: null, after: JSON.stringify(baru) });
  });

  it("menolak urutan yang tidak naik tanpa menulis apa pun", async () => {
    const r = await simpanAmbangTierKreatif({ mikro: 10_000, mid: 5_000, makro: 500_000, mega: 1_000_000 }, userId);
    expect(r).toEqual({ ok: false, kode: "TIDAK_VALID", galat: [{ kunci: "mid", sebab: "TIDAK_NAIK" }] });
    expect(await prisma.systemSetting.findUnique({ where: { key: KUNCI_TIER } })).toBeNull();
  });
});
