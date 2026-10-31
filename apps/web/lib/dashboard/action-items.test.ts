import { describe, expect, it } from "vitest";
import { buildActionItems, totalActionDocuments, type BuildActionItemsInput } from "./action-items";

const nol: BuildActionItemsInput = {
  fieldSalesPendingApproval: 0,
  storeChangesPending: 0,
  taxInvoicePending: 0,
  salesReturnPending: 0,
  journalPending: 0,
  overduePOs: 0,
  draftPOs: 0,
  oversoldSkus: 0,
  unshippedOrders: 0,
};

describe("totalActionDocuments", () => {
  it("overdue POs (sent) and POs awaiting approval (draft) are different documents", () => {
    // A DRAFT is never late (the supplier does not have it yet), so the two rows
    // never overlap and the total is their plain sum.
    const items = buildActionItems({ ...nol, overduePOs: 3, draftPOs: 2 });
    expect(items.map((i) => i.count)).toEqual([3, 2]);
    expect(totalActionDocuments(items)).toBe(5);
  });

  it("sums distinct document types plainly", () => {
    const items = buildActionItems({ ...nol, taxInvoicePending: 4, salesReturnPending: 1 });
    expect(totalActionDocuments(items)).toBe(5);
  });
});

describe("buildActionItems", () => {
  it("adds overdue payment promises and BKM awaiting verification, with amounts", () => {
    const items = buildActionItems({
      ...nol,
      overduePromises: { count: 2, amount: 5_000_000 },
      claimsAwaitingVerification: { count: 1, amount: 750_000 },
    });
    const janji = items.find((i) => i.key === "overduePromises");
    const bkm = items.find((i) => i.key === "claimsAwaitingVerification");
    expect(janji).toMatchObject({ count: 2, amount: 5_000_000, tone: "overdue", href: "/backoffice/piutang?keadaan=lewat" });
    expect(bkm).toMatchObject({ count: 1, amount: 750_000, tone: "waiting", permission: "journals:manage" });
  });

  it("every link carries the filter its count was taken with", () => {
    const items = buildActionItems({
      ...nol,
      overduePOs: 1,
      draftPOs: 1,
      taxInvoicePending: 1,
      salesReturnPending: 1,
      fieldSalesPendingApproval: 1,
      overduePromises: { count: 1, amount: 1 },
      journalPending: 1,
    });
    const href = (k: string) => items.find((i) => i.key === k)?.href;
    expect(href("overduePOs")).toBe("/backoffice/purchase-orders?status=overdue");
    expect(href("draftPOs")).toBe("/backoffice/purchase-orders?status=DRAFT");
    expect(href("taxInvoicePending")).toBe("/backoffice/finance/faktur-pajak?status=PENDING");
    expect(href("salesReturnPending")).toBe("/backoffice/returns?status=PENDING");
    expect(href("fieldSalesPendingApproval")).toBe("/backoffice/field-sales-orders?status=PENDING_APPROVAL");
    expect(href("overduePromises")).toBe("/backoffice/piutang?keadaan=lewat");
    // Daftar "Jurnal tertunda" di halaman Jurnal — bukan daftar jurnal yang terposting.
    expect(href("journalPending")).toBe("/backoffice/finance/journals?status=tertunda");
  });

  it("nilai PO terlambat diberi label nilai PO, supaya tidak dicocokkan dengan nilai yang belum diterima", () => {
    const po = buildActionItems({ ...nol, overduePOs: 3, overduePOsAmount: 11_450_000 }).find((i) => i.key === "overduePOs");
    expect(po).toMatchObject({ amount: 11_450_000, amountLabelKey: "amountPoValue" });
  });

  it("BKM milik penonton sendiri dipisah: yang bisa ia putuskan dan yang menunggu admin keuangan lain", () => {
    const items = buildActionItems(
      {
        ...nol,
        claimsAwaitingVerification: { count: 1, amount: 750_000 },
        claimsAwaitingOthers: { count: 2, amount: 400_000 },
      },
      ["journals:manage"],
    );
    const bisa = items.find((i) => i.key === "claimsAwaitingVerification");
    const lain = items.find((i) => i.key === "claimsAwaitingOthers");
    expect(bisa).toMatchObject({ count: 1, amount: 750_000, tone: "waiting" });
    expect(lain).toMatchObject({ count: 2, amount: 400_000, tone: "waiting", permission: "journals:manage" });
    // Dua baris, satu daftar: jumlah keduanya = isi daftar BKM berstatus DIKIRIM.
    expect(bisa?.href).toBe("/backoffice/pelunasan?status=DIKIRIM");
    expect(lain?.href).toBe("/backoffice/pelunasan?status=DIKIRIM");
    // Baris "menunggu orang lain" bukan pekerjaan penonton: tidak ikut "N hal perlu ditindaklanjuti".
    expect(lain?.menungguOrangLain).toBe(true);
    expect(totalActionDocuments(items)).toBe(1);
  });

  it("hanya BKM milik sendiri: baris 'bisa diputuskan' hilang, tidak menetap di beranda", () => {
    const items = buildActionItems(
      { ...nol, claimsAwaitingVerification: { count: 0, amount: 0 }, claimsAwaitingOthers: { count: 2, amount: 1 } },
      ["journals:manage"],
    );
    expect(items.map((i) => i.key)).toEqual(["claimsAwaitingOthers"]);
  });

  it("drops zero rows and puts overdue before waiting", () => {
    const items = buildActionItems({ ...nol, draftPOs: 9, overduePromises: { count: 1, amount: 10 } });
    expect(items.map((i) => i.key)).toEqual(["overduePromises", "draftPOs"]);
  });
});
