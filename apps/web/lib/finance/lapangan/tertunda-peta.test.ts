import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { hitungJurnalTertunda, sumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";
import { getNotificationHref } from "@/lib/notifications/navigation";
import { JENIS_TERTUNDA_LAPANGAN, SEMUA_SUMBER_LAPANGAN, SUMBER_LAPANGAN, sumberDariJenisTertunda } from "./aturan";

/*
 * Kontrak `kind` JOURNAL_PENDING jurnal lapangan dengan pembacanya: jurnal
 * tertunda (lib/finance/jurnal-tertunda.ts) dan tautan lonceng
 * (lib/notifications/navigation.ts). Dokumen bergenerasi (BKM, retur toko)
 * TIDAK dianggap selesai hanya karena jurnal generasi pertamanya berdiri.
 */

describe("kind JOURNAL_PENDING jurnal lapangan", () => {
  it("dikenali jurnal tertunda dan lonceng, bolak-balik", () => {
    for (const s of SEMUA_SUMBER_LAPANGAN) {
      const kind = JENIS_TERTUNDA_LAPANGAN[s];
      expect(sumberNotifikasiJurnal({ docId: "d1", kind })).toEqual({ tipe: "dokumen", sourceType: s, sourceId: "d1" });
      expect(sumberDariJenisTertunda(kind)).toBe(s);
      expect(getNotificationHref("JOURNAL_PENDING", { docId: "d1", kind })).toBe("/backoffice/finance/rekonsiliasi-piutang#tertunda");
    }
  });
});

describe("hitungan jurnal tertunda (basis data)", () => {
  const tag = `UJC1T-${Math.random().toString(36).slice(2, 8)}`;
  let notifIds: string[] = [];
  let jurnalIds: string[] = [];

  beforeEach(() => {
    notifIds = [];
    jurnalIds = [];
  });

  afterEach(async () => {
    if (jurnalIds.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
  });

  it("nota (sekali posting) selesai begitu jurnalnya ada; retur toko (bergenerasi) hanya lewat penandaan", async () => {
    const pengguna = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const buatTanda = async (kind: string, docId: string) =>
      (
        await prisma.adminNotification.create({
          data: { category: "JOURNAL_PENDING", severity: "WARNING", title: tag, message: tag, metadata: { docId, kind, reason: "UNMAPPED_ROLE", role: "AR_STORE" } },
        })
      ).id;
    const buatJurnal = async (sourceType: string, sourceId: string) =>
      (await prisma.journal.create({ data: { date: new Date(), description: tag, postedById: pengguna.id, sourceType, sourceId } })).id;

    notifIds.push(await buatTanda("nota_putus", `${tag}-nota`));
    notifIds.push(await buatTanda("retur_toko", `${tag}-nri`));
    expect(await hitungJurnalTertunda({ notifikasiIds: notifIds })).toBe(2);

    jurnalIds.push(await buatJurnal(SUMBER_LAPANGAN.NOTA, `${tag}-nota`));
    jurnalIds.push(await buatJurnal(SUMBER_LAPANGAN.RETUR, `${tag}-nri`));
    // Nota: jurnalnya berdiri = selesai. Retur: generasi pertama berdiri bukan bukti keadaan terakhirnya terjurnal.
    expect(await hitungJurnalTertunda({ notifikasiIds: notifIds })).toBe(1);
  });
});
