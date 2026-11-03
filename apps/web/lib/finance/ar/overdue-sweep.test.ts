import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import type { KeadaanPiutang } from "@/lib/receivables/rules";

/**
 * A pass-through spy on the real helper, so every case still runs it, `VITEST` guard included. The
 * failure case replaces it for one receivable. Stubbed at the module, never on a Prisma delegate.
 */
vi.mock("@/lib/notifications/recipients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/recipients")>();
  return { ...actual, sendNotificationToUsers: vi.fn(actual.sendNotificationToUsers) };
});
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { KALIMAT_TAHANAN_PENGINGAT, overduePhoneText, overdueRecipient, overdueSkipReason, runOverdueSweep } from "./overdue-sweep";
import { OVERDUE_THRESHOLD_SETTING_KEY } from "./overdue-thresholds";

const actualRecipients = await vi.importActual<typeof import("@/lib/notifications/recipients")>("@/lib/notifications/recipients");

describe("overdueSkipReason (pure)", () => {
  const row = (keadaan: KeadaanPiutang, outstanding = 1000, extra: { bolehDilunasi?: number; adaKontrabon?: boolean } = {}) => ({
    keadaan,
    outstanding,
    bolehDilunasi: outstanding,
    adaKontrabon: false,
    ...extra,
  });

  it("announces only an open invoice with nothing hanging on it", () => {
    expect(overdueSkipReason({ row: row("belum"), teamReportPending: false })).toBeNull();
  });

  it("skips a payment report (BKM) waiting for its check — the salesman already reported", () => {
    expect(overdueSkipReason({ row: row("klaim"), teamReportPending: false })).toBe("PAYMENT_REPORT_PENDING");
  });

  it("skips an invoice in a running kontrabon, before and after its promised date", () => {
    expect(overdueSkipReason({ row: row("tt"), teamReportPending: false })).toBe("KONTRABON");
    expect(overdueSkipReason({ row: row("lewat"), teamReportPending: false })).toBe("KONTRABON");
  });

  it("skips an invoice whose WHOLE balance waits for a return deduction", () => {
    expect(overdueSkipReason({ row: row("tertahan", 1000, { bolehDilunasi: 0 }), teamReportPending: false })).toBe("RETURN_HELD");
  });

  it("Q15: announces a partly held invoice for the part outside the hold", () => {
    expect(overdueSkipReason({ row: row("tertahan", 700, { bolehDilunasi: 400 }), teamReportPending: false })).toBeNull();
  });

  it("a partly held invoice in a running kontrabon is chased by the kontrabon, not by the due date", () => {
    expect(overdueSkipReason({ row: row("tertahan", 700, { bolehDilunasi: 400, adaKontrabon: true }), teamReportPending: false })).toBe("KONTRABON");
  });

  it("a held invoice with no collectable part known reads as wholly held", () => {
    expect(overdueSkipReason({ row: { keadaan: "tertahan", outstanding: 700 }, teamReportPending: false })).toBe("RETURN_HELD");
  });

  it("skips a settled invoice, by its money state or by a zero recomputed balance", () => {
    expect(overdueSkipReason({ row: row("lunas", 0), teamReportPending: false })).toBe("SETTLED");
    expect(overdueSkipReason({ row: row("belum", 0), teamReportPending: false })).toBe("SETTLED");
  });

  it("skips a pending report through the team's collection or settlement paths as well", () => {
    expect(overdueSkipReason({ row: row("belum"), teamReportPending: true })).toBe("PAYMENT_REPORT_PENDING");
  });

  it("settled wins over a pending team report, and a pending report wins over a held return, partly held included", () => {
    expect(overdueSkipReason({ row: row("lunas", 0), teamReportPending: true })).toBe("SETTLED");
    expect(overdueSkipReason({ row: row("tertahan", 1000, { bolehDilunasi: 0 }), teamReportPending: true })).toBe("PAYMENT_REPORT_PENDING");
    expect(overdueSkipReason({ row: row("tertahan", 700, { bolehDilunasi: 400 }), teamReportPending: true })).toBe("PAYMENT_REPORT_PENDING");
  });

  it("skips a receivable the receivables module does not list", () => {
    expect(overdueSkipReason({ row: undefined, teamReportPending: false })).toBe("NOT_LISTED");
  });
});

describe("overdueRecipient (pure)", () => {
  it("is the store's current holder, even when another salesman sold the invoice", () => {
    expect(overdueRecipient({ storeHolderId: "baru", sellerId: "lama", konsi: false })).toEqual({ userId: "baru", basis: "STORE_HOLDER" });
  });

  it("is the holder when the holder also sold it", () => {
    expect(overdueRecipient({ storeHolderId: "sama", sellerId: "sama", konsi: false })).toEqual({ userId: "sama", basis: "STORE_HOLDER" });
  });

  it("falls back to the invoice's seller while the store has no holder", () => {
    expect(overdueRecipient({ storeHolderId: null, sellerId: "lama", konsi: false })).toEqual({ userId: "lama", basis: "SELLER" });
  });

  it("is the holder for an imported or manual invoice with no seller", () => {
    expect(overdueRecipient({ storeHolderId: "baru", sellerId: null, konsi: false })).toEqual({ userId: "baru", basis: "STORE_HOLDER" });
  });

  it("is nobody when there is neither a holder nor a seller", () => {
    expect(overdueRecipient({ storeHolderId: null, sellerId: null, konsi: false })).toBeNull();
  });

  it("treats an empty id as absent, never as a person", () => {
    expect(overdueRecipient({ storeHolderId: "", sellerId: "lama", konsi: false })).toEqual({ userId: "lama", basis: "SELLER" });
    expect(overdueRecipient({ storeHolderId: "", sellerId: "", konsi: false })).toBeNull();
  });

  it("P31: a konsi bill goes to the store's holder only — never to its seller", () => {
    expect(overdueRecipient({ storeHolderId: "pemegang", sellerId: "lama", konsi: true })).toEqual({ userId: "pemegang", basis: "STORE_HOLDER" });
    expect(overdueRecipient({ storeHolderId: null, sellerId: "lama", konsi: true })).toBeNull();
    expect(overdueRecipient({ storeHolderId: "", sellerId: "lama", konsi: true })).toBeNull();
  });
});

describe("overduePhoneText (pure)", () => {
  const base = { docNo: "DLV/2026/10/0001", storeName: "Toko Maju", outstanding: 3_000_000 };

  it("names the invoice, the store and the amount", () => {
    const text = overduePhoneText({ ...base, days: 7 });
    expect(text.title).toBe("Tagihan lewat jatuh tempo 7 hari");
    expect(text.body).toMatch(/^Nota DLV\/2026\/10\/0001 di Toko Maju sebesar Rp\s?3\.000\.000(,00)? sudah lewat 7 hari dari jatuh tempo\. Mohon ditagih\.$/);
  });

  it("says due today on the due date itself (threshold 0)", () => {
    const text = overduePhoneText({ ...base, days: 0 });
    expect(text.title).toBe("Tagihan jatuh tempo hari ini");
    expect(text.body).toContain("jatuh tempo hari ini");
  });

  it("Q15: names the reminded part and the held part, by why the held part waits", () => {
    const bagian = { ...base, outstanding: 400_000, days: 30 };
    expect(overduePhoneText({ ...bagian, held: { nilai: 300_000, sebab: "BELUM_DIHITUNG" } }).body).toMatch(
      /sebesar Rp\s?400\.000(,00)? sudah lewat 30 hari dari jatuh tempo; Rp\s?300\.000(,00)? lagi menunggu hitungan retur\. Mohon ditagih\.$/,
    );
    expect(overduePhoneText({ ...bagian, held: { nilai: 300_000, sebab: "MENUNGGU_BEBAN" } }).body).toContain("lagi menunggu keputusan selisih retur.");
    expect(overduePhoneText({ ...bagian, held: { nilai: 300_000, sebab: "CAMPURAN" } }).body).toContain("lagi ditahan potongan retur.");
    expect(overduePhoneText({ ...bagian, held: { nilai: 300_000, sebab: null } }).body).toContain("lagi ditahan potongan retur.");
    // A held part of zero is no held part.
    expect(overduePhoneText({ ...bagian, held: { nilai: 0, sebab: "BELUM_DIHITUNG" } }).body).not.toContain("retur");
  });

  it("every cause has its wording", () => {
    expect(Object.keys(KALIMAT_TAHANAN_PENGINGAT).sort()).toEqual(["BELUM_DIHITUNG", "CAMPURAN", "MENUNGGU_BEBAN"]);
  });

  it("fits a long store name into 191 code points without losing an amount or the held clause", () => {
    const text = overduePhoneText({
      docNo: "DLV/2026/10/0001",
      storeName: "Toko ".padEnd(120, "x"),
      outstanding: 400_000,
      days: 30,
      held: { nilai: 300_000, sebab: "BELUM_DIHITUNG" },
    });
    expect(Array.from(text.body).length).toBeLessThanOrEqual(191);
    expect(text.body).toMatch(/Rp\s?400\.000/);
    expect(text.body).toMatch(/Rp\s?300\.000/);
    expect(text.body).toContain("lagi menunggu hitungan retur");
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const DAY_MS = 24 * 60 * 60 * 1000;
/** WIB midnight anchor so a fixed offset in days lands on the day this test expects, regardless of host TZ. */
function daysAgoWib(days: number): Date {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const wibMidnight = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
  return new Date(wibMidnight.getTime() - 7 * 60 * 60 * 1000 - days * DAY_MS);
}

async function notificationsFor(receivableId: string) {
  if (!receivableId) return [];
  const rows = await prisma.adminNotification.findMany({
    where: { category: "AR_OVERDUE" },
    select: { id: true, metadata: true, message: true },
  });
  return rows.filter((r) => (r.metadata as { receivableId?: string } | null)?.receivableId === receivableId);
}

type Meta = {
  thresholdDays: number;
  collectorId: string;
  collectorBasis: string;
  outstandingAmount: number;
  overdueAmount: number;
  heldAmount: number;
};

d("runOverdueSweep (test bed only)", () => {
  let token = "";
  let storeId = "";
  let holderId = "";
  let sellerId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";
  let extraDeliveryId = "";
  let extraReceivableIds: string[] = [];
  let claimIds: string[] = [];
  let noteIds: string[] = [];
  let submissionIds: string[] = [];
  let settlementIds: string[] = [];
  let returnIds: string[] = [];
  let countIds: string[] = [];
  let chargeIds: string[] = [];
  let konsiStoreIds: string[] = [];
  let seq = 0;
  /**
   * `ar.overdueThresholdDays` is a SHARED singleton row on the `:3308` bed, and the settings page
   * writes it in real dev use. Snapshot before any test touches it, restore after — an
   * unconditional delete in teardown would silently revert an operator's configured schedule
   * (`parseOverdueThresholds` fails OPEN, so nothing would ever surface the loss).
   */
  let settingSnapshot: string | null = null;

  /** Both column sets the merged `Receivable` carries: the team's and the receivables module's. */
  const money = (amount: number) => ({ amount, outstanding: amount, originalAmount: amount, outstandingAmount: amount });

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; holderId = ""; sellerId = ""; orderId = ""; deliveryId = ""; receivableId = "";
    extraDeliveryId = ""; extraReceivableIds = []; claimIds = []; noteIds = []; submissionIds = []; settlementIds = []; returnIds = [];
    countIds = []; chargeIds = [];
    konsiStoreIds = [];
    seq = 0;
    vi.mocked(sendNotificationToUsers).mockReset();
    vi.mocked(sendNotificationToUsers).mockImplementation(actualRecipients.sendNotificationToUsers);

    const existingSetting = await prisma.systemSetting.findUnique({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      select: { value: true },
    });
    settingSnapshot = existingSetting?.value ?? null;

    const holder = await prisma.user.create({ data: { email: `osw-holder-${token}@test.local`, name: "pemegang" } });
    holderId = holder.id;
    const seller = await prisma.user.create({ data: { email: `osw-seller-${token}@test.local`, name: "penjual" } });
    sellerId = seller.id;
    const store = await prisma.store.create({
      data: { code: `TEST-OSW-${token}`, name: "test", address: "test", termsType: "PUTUS", salesmanId: holderId },
    });
    storeId = store.id;
    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-OSW-ORD-${token}`, storeId, salesmanId: sellerId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-OSW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: sellerId, invoiceDate: new Date(), dueDate: daysAgoWib(45), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId,
        invoiceNo: `TEST-OSW-DLV-${token}`,
        source: "DELIVERY",
        storeId,
        salesmanId: sellerId,
        invoiceDate: new Date(),
        dueDate: daysAgoWib(45),
        ...money(1000),
      },
    });
    receivableId = receivable.id;
  });

  afterEach(async () => {
    const allReceivables = [receivableId, ...extraReceivableIds].filter(Boolean);
    const notifs = (await Promise.all(allReceivables.map((id) => notificationsFor(id)))).flat();
    if (notifs.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    /* Claim links, claim deductions and kontrabon links go with their parent (onDelete Cascade). */
    if (claimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(claimIds) } } });
    if (noteIds.length) await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(noteIds) } } });
    if (submissionIds.length) await prisma.collectionSubmission.deleteMany({ where: { id: { in: seededIds(submissionIds) } } });
    if (settlementIds.length) {
      await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: { in: seededIds(settlementIds) } } });
      await prisma.storeSettlement.deleteMany({ where: { id: { in: seededIds(settlementIds) } } });
    }
    if (chargeIds.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(chargeIds) } } });
    if (countIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(countIds) } } });
    if (returnIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(returnIds) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: [seededId(receivableId), ...seededIds(extraReceivableIds)] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: [seededId(deliveryId), seededId(extraDeliveryId)] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    /* The store before its holder: `Store.salesman` is `onDelete: Restrict`. */
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), ...seededIds(konsiStoreIds)] } } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(holderId), seededId(sellerId)] } } });
    if (settingSnapshot === null) {
      await prisma.systemSetting.deleteMany({ where: { key: OVERDUE_THRESHOLD_SETTING_KEY } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
        create: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: settingSnapshot },
        update: { value: settingSnapshot },
      });
    }
  });

  /**
   * A BKM over the fixture's invoice (or `on`'s), written directly so its status is exactly the one
   * under test. `invoiceAmount` (default 1000) is both the BKM's invoice amount and what it settles
   * on this invoice.
   */
  async function bkm(
    status: "DIKIRIM" | "TERVERIFIKASI" | "DITOLAK",
    opts?: {
      returnDeduction?: { storeReturnId: string; amount: number };
      on?: { storeId: string; receivableId: string };
      invoiceAmount?: number;
    },
  ) {
    seq += 1;
    const deduction = opts?.returnDeduction?.amount ?? 0;
    const invoiceAmount = opts?.invoiceAmount ?? 1000;
    const claim = await prisma.paymentClaim.create({
      data: {
        docNo: `TEST-OSW-BKM-${token}-${seq}`,
        storeId: opts?.on?.storeId ?? storeId,
        salesmanId: holderId,
        createdById: holderId,
        claimedTransferAt: new Date(),
        invoiceAmount,
        deductionTotal: deduction,
        receivedAmount: invoiceAmount - deduction,
        status,
        receivableLinks: { create: [{ receivableId: opts?.on?.receivableId ?? receivableId, settledAmount: invoiceAmount }] },
        ...(opts?.returnDeduction
          ? { deductions: { create: [{ name: "Retur", amount: deduction, storeReturnId: opts.returnDeduction.storeReturnId }] } }
          : {}),
      },
    });
    claimIds.push(claim.id);
    return claim.id;
  }

  async function extraReceivable(source: "MANUAL" | "IMPORT", salesmanId: string | null) {
    seq += 1;
    const r = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-OSW-${source}-${token}-${seq}`,
        source,
        storeId,
        salesmanId,
        invoiceDate: new Date(),
        dueDate: daysAgoWib(45),
        ...money(1000),
      },
    });
    extraReceivableIds.push(r.id);
    return r.id;
  }

  /**
   * A konsi bill (`isConsignment`) at a konsi store, sold by the fixture's seller and — unless
   * `holderless` — held by the fixture's holder. Seeded as a MANUAL konsi invoice only because a
   * cycle or sell-through bill is heavy to seed: `daftarPiutang` and the recipient rule key on
   * `isConsignment`, never on the source. `paidAmount` is set with the team balance to match.
   */
  async function konsiBill(paid = 0, holderless = false) {
    seq += 1;
    const store = await prisma.store.create({
      data: {
        code: `TEST-OSW-K-${token}-${seq}`,
        name: "test konsi",
        address: "test",
        termsType: "KONSI",
        markupPercent: 25,
        salesmanId: holderless ? null : holderId,
      },
    });
    konsiStoreIds.push(store.id);
    const r = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-OSW-KST-${token}-${seq}`,
        source: "MANUAL",
        isConsignment: true,
        storeId: store.id,
        salesmanId: sellerId,
        invoiceDate: new Date(),
        dueDate: daysAgoWib(45),
        ...money(1000),
        ...(paid > 0
          ? { status: "PARTIAL" as const, paidAmount: paid, outstandingAmount: 1000 - paid, outstanding: 1000 - paid }
          : {}),
      },
    });
    extraReceivableIds.push(r.id);
    return { storeId: store.id, receivableId: r.id };
  }

  it("a receivable 45 days overdue fires ONCE at threshold 30, not at 0/7/30", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.announced).toBe(1);
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(1);
    expect((notifs[0].metadata as Meta).thresholdDays).toBe(30);
  });

  it("keeps the outstanding amount a number in metadata and formats only the message", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    const [notif] = await notificationsFor(receivableId);
    expect((notif.metadata as Meta).outstandingAmount).toBe(1000);
    expect(notif.metadata as Meta).toMatchObject({ overdueAmount: 1000, heldAmount: 0 });
    expect(notif.message).toMatch(/Rp\s?1\.000/);
  });

  it("a second sweep the same day announces nothing more", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
    expect(await notificationsFor(receivableId)).toHaveLength(1);
  });

  it("ageing from 45 to 65 days fires again at the higher threshold", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { dueDate: daysAgoWib(65) } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(1);
    const thresholds = (await notificationsFor(receivableId)).map((n) => (n.metadata as Meta).thresholdDays).sort((a, b) => a - b);
    expect(thresholds).toEqual([30, 60]);
  });

  it("excludes a PAID receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.scanned).toBe(0);
    expect(result.announced).toBe(0);
  });

  it("excludes a WRITTEN_OFF receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "WRITTEN_OFF" } });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.scanned).toBe(0);
  });

  it("a partial payment does not change dueDate and does not re-fire the same threshold", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PARTIAL", outstandingAmount: 400, paidAmount: 600 } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
  });

  it("announces the recomputed balance, not a stored column", async () => {
    /* An office payment of 600 the receivables module counts; both stored balance columns are deliberately wrong. */
    await prisma.receivable.update({
      where: { id: receivableId },
      data: { status: "PARTIAL", paidAmount: 600, outstandingAmount: 999, outstanding: 999 },
    });
    await runOverdueSweep({ receivableIds: [receivableId] });
    const [notif] = await notificationsFor(receivableId);
    expect((notif.metadata as Meta).outstandingAmount).toBe(400);
  });

  it("a due-date correction pushing the invoice back to not-yet-due fires nothing", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { dueDate: daysAgoWib(-5) } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
    expect(second.scanned).toBe(1);
  });

  it("respects a custom threshold list from SystemSetting", async () => {
    /* upsert, not create: the bed may already hold an operator-configured row, which afterEach restores instead of deleting. */
    await prisma.systemSetting.upsert({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      create: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: "0,10" },
      update: { value: "0,10" },
    });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    const notifs = await notificationsFor(receivableId);
    expect(result.announced).toBe(1);
    expect((notifs[0].metadata as Meta).thresholdDays).toBe(10);
  });

  it("caps announcements per run and reports the remainder as deferred", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId], maxAnnouncementsPerRun: 0 });
    expect(result.announced).toBe(0);
    expect(result.deferred).toBe(1);
    expect(await notificationsFor(receivableId)).toHaveLength(0);
  });

  describe("skip rules (the receivables module's money state)", () => {
    it("skips an invoice whose BKM waits for its check, and fires once the report is rejected", async () => {
      const claimId = await bkm("DIKIRIM");
      const first = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(first).toMatchObject({ announced: 0, skipped: { PAYMENT_REPORT_PENDING: 1 } });
      expect(await notificationsFor(receivableId)).toHaveLength(0);
      expect(vi.mocked(sendNotificationToUsers)).not.toHaveBeenCalled();

      /* No marker was written, so the crossing is judged again: a rejected report counts for nothing. */
      await prisma.paymentClaim.update({ where: { id: claimId }, data: { status: "DITOLAK" } });
      const second = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(second.announced).toBe(1);
      expect(await notificationsFor(receivableId)).toHaveLength(1);
    });

    it("skips an invoice a verified BKM settled, even while the team status still reads OUTSTANDING", async () => {
      await bkm("TERVERIFIKASI");
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ scanned: 1, announced: 0, skipped: { SETTLED: 1 } });
    });

    it("skips an invoice in a running kontrabon, even one past its promised date, until it is cancelled", async () => {
      seq += 1;
      const note = await prisma.collectionNote.create({
        data: {
          docNo: `TEST-OSW-TT-${token}-${seq}`,
          storeId,
          salesmanId: holderId,
          handoverDate: daysAgoWib(20),
          promisedDate: daysAgoWib(3),
          receivableLinks: { create: [{ receivableId, amount: 1000 }] },
        },
      });
      noteIds.push(note.id);
      const first = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(first).toMatchObject({ announced: 0, skipped: { KONTRABON: 1 } });

      await prisma.collectionNote.update({ where: { id: note.id }, data: { status: "BATAL" } });
      const second = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(second.announced).toBe(1);
    });

    it("skips an invoice whose return deduction is still held (the warehouse has not counted it)", async () => {
      seq += 1;
      const nrt = await prisma.storeReturn.create({
        data: { noNrt: `TEST-OSW-NRT-${token}-${seq}`, storeId, salesmanId: holderId, claimDate: daysAgoWib(10), claimedAmount: 300 },
      });
      returnIds.push(nrt.id);
      await bkm("TERVERIFIKASI", { returnDeduction: { storeReturnId: nrt.id, amount: 300 } });
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 0, skipped: { RETURN_HELD: 1 } });
    });

    it("skips an invoice with a pending team collection submission", async () => {
      const submission = await prisma.collectionSubmission.create({
        data: { receivableId, collectorId: holderId, amount: 1000, method: "CASH", paidAt: new Date() },
      });
      submissionIds.push(submission.id);
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 0, skipped: { PAYMENT_REPORT_PENDING: 1 } });
    });

    it("skips an invoice in a pending team settlement", async () => {
      seq += 1;
      const settlement = await prisma.storeSettlement.create({
        data: {
          docNo: `TEST-OSW-STL-${token}-${seq}`,
          storeId,
          salesmanId: holderId,
          expectedAmount: 1000,
          actualAmount: 1000,
          varianceAmount: 0,
          invoices: { create: [{ receivableId, amount: 1000 }] },
        },
      });
      settlementIds.push(settlement.id);
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 0, skipped: { PAYMENT_REPORT_PENDING: 1 } });
    });

    it("a skipped crossing takes no slot under the cap", async () => {
      await bkm("DIKIRIM");
      const result = await runOverdueSweep({ receivableIds: [receivableId], maxAnnouncementsPerRun: 0 });
      expect(result).toMatchObject({ announced: 0, deferred: 0, skipped: { PAYMENT_REPORT_PENDING: 1 } });
    });
  });

  describe("konsi bills (listed by daftarPiutang like every other bill)", () => {
    it("reminds the office and the store's holder, with the amount and the store's Tagihan link on the phone", async () => {
      const k = await konsiBill(300);
      const result = await runOverdueSweep({ receivableIds: [k.receivableId] });
      expect(result).toMatchObject({ scanned: 1, announced: 1, collectorNotified: 1, skipped: { NOT_LISTED: 0 } });

      const [notif] = await notificationsFor(k.receivableId);
      expect(notif.metadata as Meta).toMatchObject({ outstandingAmount: 700, collectorId: holderId, collectorBasis: "STORE_HOLDER" });
      expect(notif.message).toMatch(/Rp\s?700/);

      const [users, payload] = vi.mocked(sendNotificationToUsers).mock.calls[0];
      expect(users).toEqual([{ id: holderId, fcmToken: null }]);
      expect(payload.body).toMatch(/sebesar Rp\s?700/);
      expect(payload.data).toEqual({ receivableId: k.receivableId, storeId: k.storeId, thresholdDays: "30", daysOverdue: "45" });
    });

    it("P31: a konsi store without a holder tells nobody's phone — never the seller — and the office keeps the amount", async () => {
      const k = await konsiBill(0, true);
      const result = await runOverdueSweep({ receivableIds: [k.receivableId] });
      expect(result).toMatchObject({ announced: 1, collectorNotified: 0, unassigned: 1 });
      expect(vi.mocked(sendNotificationToUsers)).not.toHaveBeenCalled();
      const [notif] = await notificationsFor(k.receivableId);
      expect(notif.metadata as Meta).toMatchObject({ outstandingAmount: 1000, collectorId: "" });
      expect(notif.message).toMatch(/Rp\s?1\.000/);
    });

    it("skips a konsi bill whose BKM waits for its check", async () => {
      const k = await konsiBill();
      await bkm("DIKIRIM", { on: k });
      const result = await runOverdueSweep({ receivableIds: [k.receivableId] });
      expect(result).toMatchObject({ announced: 0, skipped: { PAYMENT_REPORT_PENDING: 1, NOT_LISTED: 0 } });
      expect(vi.mocked(sendNotificationToUsers)).not.toHaveBeenCalled();
    });
  });

  /*
   * Q15 (2026-11-02, "Ya, diingatkan"): the part of a nota outside a return hold is reminded, and
   * the reminder names the waiting part and why it waits.
   */
  describe("partly held notas", () => {
    /** An uncounted NRT for `nilai` on the fixture's store. */
    async function nrt(nilai: number) {
      seq += 1;
      const r = await prisma.storeReturn.create({
        data: { noNrt: `TEST-OSW-NRT-${token}-${seq}`, storeId, salesmanId: holderId, claimDate: daysAgoWib(10), claimedAmount: nilai },
      });
      returnIds.push(r.id);
      return r.id;
    }

    it("BKM 600 with an uncounted 300 deduction: 400 is reminded, 300 is named as waiting for the count", async () => {
      const storeReturnId = await nrt(300);
      await bkm("TERVERIFIKASI", { invoiceAmount: 600, returnDeduction: { storeReturnId, amount: 300 } });
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, partlyHeld: 1, skipped: { RETURN_HELD: 0 } });

      const [notif] = await notificationsFor(receivableId);
      expect(notif.metadata as Meta).toMatchObject({ outstandingAmount: 700, overdueAmount: 400, heldAmount: 300 });
      expect(notif.message).toMatch(/sebesar Rp\s?400(,00)? sudah lewat 45 hari dari jatuh tempo; Rp\s?300(,00)? lagi menunggu hitungan retur\./);

      const [, payload] = vi.mocked(sendNotificationToUsers).mock.calls[0];
      expect(payload.body).toMatch(/sebesar Rp\s?400(,00)?.*; Rp\s?300(,00)? lagi menunggu hitungan retur\./);

      const again = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(again.announced).toBe(0);
      expect(await notificationsFor(receivableId)).toHaveLength(1);
    });

    it("a counted shortfall nobody has borne yet is named as waiting for the shortfall decision", async () => {
      const storeReturnId = await nrt(300);
      seq += 1;
      const nri = await prisma.warehouseReturn.create({
        data: {
          noNri: `TEST-OSW-NRI-${token}-${seq}`,
          storeId,
          storeReturnId,
          warehouseUserId: holderId,
          receivedAt: daysAgoWib(5),
          physicalAmount: 0,
          claimedAmount: 300,
          status: "FINAL",
          finalisedAt: daysAgoWib(5),
        },
      });
      countIds.push(nri.id);
      const charge = await prisma.returnCharge.create({ data: { storeReturnId, warehouseReturnId: nri.id, storeId, amount: 300 } });
      chargeIds.push(charge.id);
      await bkm("TERVERIFIKASI", { invoiceAmount: 600, returnDeduction: { storeReturnId, amount: 300 } });

      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, partlyHeld: 1 });
      const [notif] = await notificationsFor(receivableId);
      expect(notif.message).toContain("lagi menunggu keputusan selisih retur.");
      expect(notif.message).not.toContain("menunggu hitungan retur");
    });

    it("a partly held nota in a running kontrabon is still chased by the kontrabon", async () => {
      const storeReturnId = await nrt(300);
      await bkm("TERVERIFIKASI", { invoiceAmount: 600, returnDeduction: { storeReturnId, amount: 300 } });
      seq += 1;
      const note = await prisma.collectionNote.create({
        data: {
          docNo: `TEST-OSW-TT-${token}-${seq}`,
          storeId,
          salesmanId: holderId,
          handoverDate: daysAgoWib(20),
          promisedDate: daysAgoWib(3),
          receivableLinks: { create: [{ receivableId, amount: 700 }] },
        },
      });
      noteIds.push(note.id);
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 0, skipped: { KONTRABON: 1 } });
    });

    it("a deduction whose return note is missing is owed: reminded in full, nothing named as waiting", async () => {
      await bkm("TERVERIFIKASI", { invoiceAmount: 600, returnDeduction: { storeReturnId: `TEST-OSW-MISSING-${token}`, amount: 300 } });
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, partlyHeld: 0 });
      const [notif] = await notificationsFor(receivableId);
      expect(notif.metadata as Meta).toMatchObject({ outstandingAmount: 700, overdueAmount: 700, heldAmount: 0 });
      expect(notif.message).not.toContain("menunggu");
    });
  });

  describe("recipient rule (store holder, else the seller)", () => {
    it("tells the store's current holder on the phone, not the salesman who sold it", async () => {
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, collectorNotified: 1, unassigned: 0 });
      const calls = vi.mocked(sendNotificationToUsers).mock.calls;
      expect(calls).toHaveLength(1);
      const [users, payload] = calls[0];
      expect(users).toEqual([{ id: holderId, fcmToken: null }]);
      expect(payload.type).toBe("AR_OVERDUE");
      /* `storeId` is what opens the store's Tagihan screen on the phone. */
      expect(payload.data).toMatchObject({ receivableId, storeId, thresholdDays: "30" });
      const [notif] = await notificationsFor(receivableId);
      expect(notif.metadata as Meta).toMatchObject({ collectorId: holderId, collectorBasis: "STORE_HOLDER" });
    });

    it("tells the seller while the store has no holder", async () => {
      await prisma.store.update({ where: { id: storeId }, data: { salesmanId: null } });
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, collectorNotified: 1 });
      expect(vi.mocked(sendNotificationToUsers).mock.calls[0][0]).toEqual([{ id: sellerId, fcmToken: null }]);
      const [notif] = await notificationsFor(receivableId);
      expect(notif.metadata as Meta).toMatchObject({ collectorId: sellerId, collectorBasis: "SELLER" });
    });

    it("with neither a holder nor a seller, still tells the office and nobody's phone", async () => {
      await prisma.store.update({ where: { id: storeId }, data: { salesmanId: null } });
      await prisma.receivable.update({ where: { id: receivableId }, data: { salesmanId: null } });
      const result = await runOverdueSweep({ receivableIds: [receivableId] });
      expect(result).toMatchObject({ announced: 1, collectorNotified: 0, unassigned: 1 });
      expect(vi.mocked(sendNotificationToUsers)).not.toHaveBeenCalled();
      const [notif] = await notificationsFor(receivableId);
      expect(notif.metadata as Meta).toMatchObject({ collectorId: "", collectorBasis: "" });
    });

    it("ignores the team's assigned collector", async () => {
      await prisma.receivable.update({ where: { id: receivableId }, data: { collectorId: sellerId } });
      await runOverdueSweep({ receivableIds: [receivableId] });
      expect(vi.mocked(sendNotificationToUsers).mock.calls[0][0]).toEqual([{ id: holderId, fcmToken: null }]);
    });

    it("covers manual and imported invoices alike, with or without a seller", async () => {
      const manualId = await extraReceivable("MANUAL", null);
      const importId = await extraReceivable("IMPORT", sellerId);
      const result = await runOverdueSweep({ receivableIds: [manualId, importId] });
      expect(result).toMatchObject({ announced: 2, collectorNotified: 2, unassigned: 0 });
      const told = vi.mocked(sendNotificationToUsers).mock.calls.map(([users, payload]) => [users[0].id, payload.data.receivableId]);
      expect(told).toEqual(expect.arrayContaining([[holderId, manualId], [holderId, importId]]));
    });
  });

  /**
   * Regression guard for `sendNotificationToUsers`' own `if (process.env.VITEST) return;`, reached
   * end to end: the sweep's collector push calls the real helper (the spy passes through), so the
   * zero below is the helper's guard at work, not a skipped call. Every other assertion in this
   * file passes identically with or without that line — `collectorNotified` counts intent, not
   * delivery — so removing it would write permanent orphaned `NotificationQueue` rows on the shared
   * bed with no test turning red. This one turns red.
   */
  it("does not write a real NotificationQueue row for the holder under VITEST", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.collectorNotified).toBe(1);
    expect(vi.mocked(sendNotificationToUsers)).toHaveBeenCalledTimes(1);
    const queueRows = await prisma.notificationQueue.count({ where: { userId: holderId } });
    expect(queueRows).toBe(0);
  });

  it("a receivable whose collector notify throws is logged and left unannounced, and the run carries on", async () => {
    /* Due earlier than the fixture's receivable, so oldest-due-first processes it FIRST: a loop that halted on it would never reach the other one. */
    const extraDelivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-OSW-DLV2-${token}`, orderId, deliveredAt: new Date(), deliveredById: sellerId, invoiceDate: new Date(), dueDate: daysAgoWib(50), subtotal: 1000, total: 1000 } });
    extraDeliveryId = extraDelivery.id;
    const failing = await prisma.receivable.create({
      data: {
        deliveryId: extraDeliveryId,
        invoiceNo: `TEST-OSW-DLV2-${token}`,
        source: "DELIVERY",
        storeId,
        salesmanId: sellerId,
        invoiceDate: new Date(),
        dueDate: daysAgoWib(50),
        ...money(1000),
      },
    });
    extraReceivableIds.push(failing.id);
    const failingId = failing.id;
    const scope = [failingId, receivableId];

    vi.mocked(sendNotificationToUsers).mockImplementation(async (users, payload) => {
      if (payload.data.receivableId === failingId) throw new Error("NotificationQueue insert failed");
      return actualRecipients.sendNotificationToUsers(users, payload);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await runOverdueSweep({ receivableIds: scope });
      expect(vi.mocked(sendNotificationToUsers).mock.calls.map(([, payload]) => payload.data.receivableId)).toEqual(scope);
      expect(first).toMatchObject({ scanned: 2, announced: 1, collectorNotified: 1, failed: 1 });
      expect(await notificationsFor(failingId)).toHaveLength(0);
      expect(await notificationsFor(receivableId)).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      vi.mocked(sendNotificationToUsers).mockImplementation(actualRecipients.sendNotificationToUsers);
      errorSpy.mockRestore();
    }

    /* No marker was written for the failed crossing, so the next run retries it — and only it. */
    const second = await runOverdueSweep({ receivableIds: scope });
    expect(second).toMatchObject({ scanned: 2, announced: 1, collectorNotified: 1, failed: 0 });
    expect(await notificationsFor(failingId)).toHaveLength(1);
    expect(await notificationsFor(receivableId)).toHaveLength(1);
  });
});
