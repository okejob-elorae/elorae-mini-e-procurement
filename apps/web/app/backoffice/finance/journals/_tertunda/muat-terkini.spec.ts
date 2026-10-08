import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { muatJurnalTertunda } from "./muat";

/*
 * Sebab "peran belum dipetakan" dibaca ulang terhadap pemetaan SEKARANG (audit
 * G8). Peran AP terpetakan di basis data lokal (data uji UJIAKUN — tes ini
 * hanya membaca); nama peran rekaan tidak pernah terpetakan.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("muatJurnalTertunda — peran kini terpetakan (basis data uji)", () => {
  let notifIds: string[] = [];

  beforeEach(() => {
    notifIds = [];
  });

  afterEach(async () => {
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[muat-terkini.spec.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
  });

  async function gagal(metadata: Record<string, unknown>): Promise<string> {
    const n = await prisma.adminNotification.create({
      data: { category: "JOURNAL_PENDING", severity: "WARNING", title: "uji", message: "uji", metadata: metadata as never },
      select: { id: true },
    });
    notifIds.push(n.id);
    return n.id;
  }

  it("menandai peran yang sudah dipetakan, yang belum, dan sebab lain", async () => {
    const pemetaanAp = await prisma.journalAccountMapping.findUnique({ where: { role: "AP" }, select: { id: true } });
    const token = `d6t-${Date.now().toString(36)}`;
    const nAp = await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: "UNMAPPED_ROLE", role: "AP" });
    const nRekaan = await gagal({ grnId: `grn2-${token}`, kind: "receipt", reason: "UNMAPPED_ROLE", role: "PERAN_REKAAN_UJI" });
    const nLain = await gagal({ grnId: `grn3-${token}`, kind: "receipt", reason: "ERROR", role: null });

    const per = new Map((await muatJurnalTertunda({ notifikasiIds: notifIds })).map((b) => [b.id, b]));

    expect(per.get(nAp)?.peranKiniTerpetakan).toBe(pemetaanAp ? true : false);
    expect(per.get(nRekaan)?.peranKiniTerpetakan).toBe(false);
    expect(per.get(nLain)?.peranKiniTerpetakan).toBeNull();
  });
});
