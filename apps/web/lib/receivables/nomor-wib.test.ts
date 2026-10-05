import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatKlaimPembayaran } from "./claim-writer";
import { buatKontrabon } from "./collection-writer";

/**
 * Nomor BKM dan TT memakai tahun WIB, bukan tahun jam server.
 *
 * Tanggal transfer dan tanggal serah terima disimpan tengah malam WIB — 1 Januari
 * 2027 WIB adalah 31 Desember 2026 17.00 UTC. Server produksi berjalan di UTC,
 * jadi `getFullYear()` memberi 2026 dan dokumen 1 Januari ikut bernomor tahun
 * lalu. Tes ini memaksa zona proses ke UTC supaya kesalahannya terlihat juga di
 * laptop yang berzona WIB. Basis data dipakai bersama data dev: setiap
 * penghapusan lewat `seededId()`.
 */

const zonaAsli = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (zonaAsli === undefined) delete process.env.TZ;
  else process.env.TZ = zonaAsli;
});

const tag = `NWIB-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let salesId = "";
let tokoId = "";
let piutangId = "";
let klaimIds: string[] = [];
let ttIds: string[] = [];

beforeEach(async () => {
  salesId = "";
  tokoId = "";
  piutangId = "";
  klaimIds = [];
  ttIds = [];

  const orang = await prisma.user.findFirstOrThrow({ select: { id: true }, orderBy: { createdAt: "asc" } });
  salesId = orang.id;
  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoId,
        invoiceDate: wib("2026-12-01"),
        dueDate: wib("2026-12-31"),
        amount: 2_000_000,
        outstanding: 2_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  if (klaimIds.length || ttIds.length) {
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...klaimIds, ...ttIds].filter(Boolean).map(seededId) } },
    });
  }
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds).filter(Boolean) } } });
  if (ttIds.length) await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(ttIds).filter(Boolean) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

describe("nomor dokumen piutang memakai tahun WIB", () => {
  it("prasyarat: proses tes benar-benar berjalan di UTC", () => {
    expect(wib("2027-01-01").getFullYear()).toBe(2026);
  });

  it("BKM bertanggal transfer 1 Januari 2027 WIB bernomor BKM/2027/…", async () => {
    const h = await buatKlaimPembayaran({
      storeId: tokoId,
      salesmanId: salesId,
      createdById: salesId,
      claimedTransferAt: wib("2027-01-01"),
      method: "transfer",
      pelunasan: [{ receivableId: piutangId, nilai: 500_000 }],
      transferPhotoUrl: "/api/foto/uji",
    });
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    klaimIds.push(h.id);
    expect(h.docNo).toMatch(/^BKM\/2027\//);
  });

  it("TT yang diserahkan 1 Januari 2027 WIB bernomor TT/2027/…", async () => {
    const h = await buatKontrabon({
      receivableIds: [piutangId],
      salesmanId: salesId,
      handoverDate: wib("2027-01-01"),
      promisedDate: wib("2027-01-15"),
    });
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    ttIds.push(h.id);
    expect(h.docNo).toMatch(/^TT\/2027\//);
  });
});
