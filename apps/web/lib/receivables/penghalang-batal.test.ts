import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { penghalangBatalPiutang } from "./penghalang-batal";

/**
 * Yang menghalangi sebuah piutang dibatalkan, terhadap basis data sungguhan.
 *
 * Satu aturan untuk setiap jalur yang membatalkan piutang — membuka kunci siklus
 * konsinyasi, "tidak jadi dikirim", membatalkan laporan sell-through lama. BKM
 * yang sudah dilaporkan (diperiksa atau belum, P33a), kontrabon berjalan,
 * pembayaran kantor, dan tugas tagih terbuka masing-masing menahannya.
 *
 * Teardown hanya lewat `seededId()`: basis data dipakai bersama data dev.
 */

const tag = `PBL-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let piutangId = "";
let klaimIds: string[] = [];
let kontrabonIds: string[] = [];
let tugasIds: string[] = [];

beforeEach(async () => {
  tokoId = "";
  piutangId = "";
  klaimIds = [];
  kontrabonIds = [];
  tugasIds = [];
  tokoId = (await prisma.store.create({ data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "KONSI" } })).id;
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/1`,
        storeId: tokoId,
        invoiceDate: new Date("2026-10-31T17:00:00Z"),
        dueDate: new Date("2026-11-30T17:00:00Z"),
        amount: 1_000_000,
        outstanding: 1_000_000,
        originalAmount: 1_000_000,
        outstandingAmount: 1_000_000,
        source: "MANUAL",
        isConsignment: true,
      },
    })
  ).id;
});

afterEach(async () => {
  await prisma.collectionTask.deleteMany({ where: { id: { in: tugasIds.map(seededId) } } });
  await prisma.collectionNoteReceivable.deleteMany({ where: { collectionNoteId: { in: kontrabonIds.map(seededId) } } });
  await prisma.collectionNote.deleteMany({ where: { id: { in: kontrabonIds.map(seededId) } } });
  await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: { in: klaimIds.map(seededId) } } });
  await prisma.paymentClaim.deleteMany({ where: { id: { in: klaimIds.map(seededId) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: piutangId } });
  if (tokoId) await prisma.store.delete({ where: { id: tokoId } });
});

async function bkm(status: "DIKIRIM" | "TERVERIFIKASI" | "DITOLAK" | "DIBATALKAN", n: number) {
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM/${n}`,
      storeId: tokoId,
      salesmanId: `${tag}-sales`,
      createdById: `${tag}-sales`,
      claimedTransferAt: new Date("2026-11-10T00:00:00+07:00"),
      invoiceAmount: 100_000,
      receivedAmount: 100_000,
      status,
      receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 100_000 }] },
    },
  });
  klaimIds.push(k.id);
}

describe("penghalangBatalPiutang (basis data)", () => {
  it("tanpa apa pun yang menempel: boleh dibatalkan", async () => {
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBeNull();
  });

  it("BKM menunggu cek maupun yang sudah terverifikasi menahannya (P33a)", async () => {
    await bkm("DIKIRIM", 1);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_BKM");
  });

  it("BKM terverifikasi menahannya", async () => {
    await bkm("TERVERIFIKASI", 2);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_BKM");
  });

  it("BKM yang ditolak atau dibatalkan tidak menahan apa pun", async () => {
    await bkm("DITOLAK", 3);
    await bkm("DIBATALKAN", 4);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBeNull();
  });

  it("kontrabon berjalan menahannya; yang selesai tidak", async () => {
    const buat = async (status: "BERJALAN" | "SELESAI", n: number) => {
      const c = await prisma.collectionNote.create({
        data: {
          docNo: `${tag}/KB/${n}`,
          storeId: tokoId,
          salesmanId: `${tag}-sales`,
          handoverDate: new Date(),
          promisedDate: new Date(),
          status,
          receivableLinks: { create: [{ receivableId: piutangId, amount: 100_000 }] },
        },
      });
      kontrabonIds.push(c.id);
    };
    await buat("SELESAI", 1);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBeNull();
    await buat("BERJALAN", 2);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_KONTRABON");
  });

  it("pembayaran kantor yang sudah masuk menahannya", async () => {
    await prisma.receivable.update({ where: { id: seededId(piutangId) }, data: { paidAmount: 50_000 } });
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_PEMBAYARAN_TOKO");
  });

  it("tugas tagih terbuka yang mencantumkannya menahannya; yang selesai tidak", async () => {
    const buat = async (status: string) => {
      const t = await prisma.collectionTask.create({
        data: { assigneeId: `${tag}-sales`, storeId: tokoId, receivableIds: [piutangId], status, createdById: `${tag}-kantor` },
      });
      tugasIds.push(t.id);
    };
    await buat("SELESAI");
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBeNull();
    await buat("TERBUKA");
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_TUGAS_TAGIH");
  });

  it("urutannya: BKM disebut lebih dulu dari kontrabon dan tugas", async () => {
    const t = await prisma.collectionTask.create({
      data: { assigneeId: `${tag}-sales`, storeId: tokoId, receivableIds: [piutangId], status: "TERBUKA", createdById: `${tag}-kantor` },
    });
    tugasIds.push(t.id);
    await bkm("DIKIRIM", 5);
    expect(await penghalangBatalPiutang(prisma, piutangId)).toBe("ADA_BKM");
  });

  it("piutang yang tidak ada: tidak ada penghalang", async () => {
    expect(await penghalangBatalPiutang(prisma, `${tag}-tidak-ada`)).toBeNull();
  });
});
