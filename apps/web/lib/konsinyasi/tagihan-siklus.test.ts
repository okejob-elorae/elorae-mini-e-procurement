import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatKlaimPembayaran } from "@/lib/receivables/claim-writer";
import { JEJAK } from "@/lib/receivables/jejak";
import { bukaKunci } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Tagihan siklus konsinyasi yang dibatalkan saat kunci dibuka (tagihan-konsi-hp R3), terhadap basis
 * data sungguhan: statusnya VOIDED, sisa yang tersimpan nol, tidak pernah "lunas", nomornya dilepas
 * ("<no> (batal)"), dan jejaknya di transaksi yang sama. Membuka kunci berlomba dengan BKM yang
 * dilaporkan atas tagihan yang sama: tidak pernah berakhir dengan tagihan batal yang masih ditautkan
 * BKM yang hidup. Siklus terkunci dan tagihannya diseed langsung; semua baris dihapus lewat
 * `seededId(s)`.
 */
d("tagihan siklus konsinyasi saat kunci dibuka (test bed only)", () => {
  const tag = `TSK${Math.random().toString(36).slice(2, 8)}`;
  let toko = "";
  let pemegang = "";
  let kantor = "";
  let siklus = "";
  let piutang = "";
  const klaim: string[] = [];

  beforeAll(async () => {
    pemegang = (await prisma.user.create({ data: { email: `${tag}-pemegang@test.local`, name: `Pemegang ${tag}` } })).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    toko = (await prisma.store.create({ data: { code: `${tag}-K`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI", salesmanId: pemegang, paymentTempo: 30 } })).id;
  });

  beforeEach(async () => {
    const c = await prisma.consignmentCycle.create({
      data: { noKonsi: `${tag}/${Math.random().toString(36).slice(2, 6)}`, storeId: toko, periodYear: 2026, periodMonth: 9, lockedAt: new Date("2026-10-05T10:00:00+07:00"), lockedById: kantor },
      select: { id: true, noKonsi: true },
    });
    siklus = c.id;
    piutang = (
      await prisma.receivable.create({
        data: {
          storeId: toko,
          invoiceNo: c.noKonsi,
          // Seperti `kunciAngka`: bertanggal akhir bulan siklus; jatuh tempo = hari dikunci (5 Oktober) + tempo toko 30 hari (P54).
          invoiceDate: new Date("2026-09-30T00:00:00+07:00"),
          dueDate: new Date("2026-11-04T00:00:00+07:00"),
          originalAmount: 1_000_000,
          outstandingAmount: 1_000_000,
          amount: 1_000_000,
          outstanding: 1_000_000,
          salesmanId: pemegang,
          isConsignment: true,
          consignmentCycleId: siklus,
          note: "uji",
        },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "PaymentClaim", entityId: { in: seededIds(klaim) } } });
    await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: { in: seededIds(klaim) } } });
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaim) } } });
    klaim.length = 0;
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ["Receivable", "ConsignmentCycle"] }, entityId: { in: seededIds([piutang, siklus].filter(Boolean)) } } });
    await prisma.receivable.deleteMany({ where: { consignmentCycleId: seededId(siklus) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklus) } });
    siklus = "";
    piutang = "";
  });

  afterAll(async () => {
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([pemegang, kantor].filter(Boolean)) } } });
  });

  const lapor = () =>
    buatKlaimPembayaran({
      storeId: toko,
      salesmanId: pemegang,
      createdById: pemegang,
      claimedTransferAt: new Date("2026-11-03T00:00:00+07:00"),
      method: "transfer",
      pelunasan: [{ receivableId: piutang, nilai: 1_000_000 }],
      transferPhotoUrl: `/api/foto/${tag}`,
    });

  it("membuka kunci membatalkan tagihan siklus seluruhnya: VOIDED, sisa tersimpan nol, tidak lunas, nomor dilepas, jejak di transaksi yang sama", async () => {
    const c = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklus }, select: { noKonsi: true } });
    expect(await bukaKunci({ cycleId: siklus, olehUserId: kantor })).toEqual({ ok: true });
    const r = await prisma.receivable.findUniqueOrThrow({ where: { id: piutang }, select: { status: true, outstanding: true, outstandingAmount: true, settledAt: true, invoiceNo: true } });
    expect([r.status, Number(r.outstanding), Number(r.outstandingAmount), r.settledAt]).toEqual(["VOIDED", 0, 0, null]);
    expect(r.invoiceNo).toBe(`${c.noKonsi} (batal)`);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Receivable", entityId: piutang, action: JEJAK.TAGIHAN_KONSI_DIBATALKAN }, select: { changes: true } });
    expect(jejak).toHaveLength(1);
    expect((jejak[0].changes as { after: { status: string } }).after.status).toBe("VOIDED");
  });

  it("tagihan yang sudah ditautkan BKM tidak bisa dibatalkan dengan membuka kunci (ADA_BKM)", async () => {
    const k = await lapor();
    if (!k.ok) throw new Error(k.alasan);
    klaim.push(k.id);
    expect(await bukaKunci({ cycleId: siklus, olehUserId: kantor })).toEqual({ ok: false, alasan: "ADA_BKM" });
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: piutang }, select: { status: true } })).status).not.toBe("VOIDED");
  });

  it("balapan buka kunci vs BKM baru: tepat satu yang menang, dan tidak pernah tagihan batal dengan BKM hidup", async () => {
    const [buka, bkm] = await Promise.all([bukaKunci({ cycleId: siklus, olehUserId: kantor }), new Promise((r) => setTimeout(r, 10)).then(lapor)]);
    if (bkm.ok) klaim.push(bkm.id);
    const unlockMenang = buka.ok && !bkm.ok && bkm.alasan === "PIUTANG_DIBATALKAN";
    const bkmMenang = bkm.ok && !buka.ok && buka.alasan === "ADA_BKM";
    expect(unlockMenang !== bkmMenang).toBe(true);
    const r = await prisma.receivable.findUniqueOrThrow({
      where: { id: piutang },
      select: { status: true, claimLinks: { where: { paymentClaim: { status: { in: ["DIKIRIM", "TERVERIFIKASI"] } } }, select: { paymentClaimId: true } } },
    });
    expect(r.status === "VOIDED" && r.claimLinks.length > 0).toBe(false);
  });
});
