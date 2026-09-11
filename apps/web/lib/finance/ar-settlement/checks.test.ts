import { describe, expect, it } from "vitest";
import {
  buildCollectibilityCheck,
  buildHeadroomCheck,
  buildReturCreditCheck,
  buildReturnEligibilityCheck,
  deriveTotals,
  type SettlementComponentSpec,
  type SettlementDeductionDetail,
  type SettlementInvoiceDetail,
  type SettlementReturDetail,
} from "./checks";

function invoice(overrides: Partial<SettlementInvoiceDetail> = {}): SettlementInvoiceDetail {
  return {
    receivableId: "rcv-1",
    docNo: "DLV/0001",
    agreedAmount: 100000,
    liveOutstanding: 100000,
    receivableStatus: "OUTSTANDING",
    storeMatches: true,
    dueDate: null,
    ...overrides,
  };
}

function retur(overrides: Partial<SettlementReturDetail> = {}): SettlementReturDetail {
  return {
    id: "ret-1",
    docNo: "FIELDRET/0001",
    status: "APPROVED",
    valuationStatus: "VALUED",
    totalValue: 100000,
    alreadyDrawn: 0,
    remaining: 100000,
    storeMatches: true,
    ...overrides,
  };
}

function deduction(overrides: Partial<SettlementDeductionDetail> = {}): SettlementDeductionDetail {
  return {
    id: "ded-1",
    type: "RETUR_OFFSET",
    amount: 50000,
    percent: null,
    note: null,
    proofUrl: null,
    hasEvidence: false,
    fieldReturnId: "ret-1",
    fieldReturn: retur(),
    ...overrides,
  };
}

function spec(overrides: Partial<SettlementComponentSpec> = {}): SettlementComponentSpec {
  return { method: "CASH", amount: 100000, key: "settlement-s1-CASH", returnId: null, ...overrides };
}

describe("deriveTotals", () => {
  it("maps a null percent onto undefined so the admin fee is zero, never NaN", () => {
    const totals = deriveTotals([1000], [{ type: "ADMIN_FEE", amount: 0, percent: null }]);
    expect(totals.adminFee).toBe(0);
    expect(totals.expected).toBe(1000);
  });

  it("charges the admin fee on the netted base, matching the writer", () => {
    const totals = deriveTotals(
      [1000000],
      [
        { type: "RETUR_OFFSET", amount: 200000, percent: null },
        { type: "PROGRAM", amount: 100000, percent: null },
        { type: "ADMIN_FEE", amount: 0, percent: 10 },
      ],
    );
    expect(totals.adminFeeBase).toBe(700000);
    expect(totals.adminFee).toBe(70000);
    expect(totals.expected).toBe(630000);
  });
});

describe("buildReturnEligibilityCheck", () => {
  it("passes when every retur deduction is approved, valued and at this store", () => {
    expect(buildReturnEligibilityCheck([deduction()]).status).toBe("PASS");
  });

  it("ignores non-retur deductions entirely", () => {
    const check = buildReturnEligibilityCheck([
      deduction({ type: "PROGRAM", fieldReturnId: null, fieldReturn: null }),
      deduction({ type: "ADMIN_FEE", fieldReturnId: null, fieldReturn: null }),
    ]);
    expect(check.status).toBe("PASS");
  });

  it("reports MISSING_FIELD_RETURN_ID ahead of every other retur fault", () => {
    const check = buildReturnEligibilityCheck([
      deduction({ id: "ded-1", fieldReturnId: null, fieldReturn: null }),
      deduction({ id: "ded-2", fieldReturn: retur({ status: "PENDING_WAREHOUSE_RECEIVING" }) }),
    ]);
    expect(check.reason).toBe("MISSING_FIELD_RETURN_ID");
  });

  it("names the raw id when the retur row is gone, and marks it as an id", () => {
    const check = buildReturnEligibilityCheck([
      deduction({ fieldReturnId: "ret-missing", fieldReturn: null }),
    ]);
    expect(check.reason).toBe("FIELD_RETURN_NOT_FOUND");
    expect(check.subjectKind).toBe("RETUR_ID");
    expect(check.subjects).toEqual(["ret-missing"]);
  });

  it("orders wrong-store ahead of not-approved ahead of not-valued", () => {
    const wrongStore = buildReturnEligibilityCheck([
      deduction({
        fieldReturn: retur({ storeMatches: false, status: "PENDING_WAREHOUSE_RECEIVING", valuationStatus: "PENDING" }),
      }),
    ]);
    expect(wrongStore.reason).toBe("RETUR_WRONG_STORE");

    const notApproved = buildReturnEligibilityCheck([
      deduction({ fieldReturn: retur({ status: "PENDING_WAREHOUSE_RECEIVING", valuationStatus: "PENDING" }) }),
    ]);
    expect(notApproved.reason).toBe("RETURN_NOT_APPROVED");

    const notValued = buildReturnEligibilityCheck([
      deduction({ fieldReturn: retur({ valuationStatus: "PENDING", totalValue: null }) }),
    ]);
    expect(notValued.reason).toBe("NOT_VALUED");
  });

  it("treats a VALUED retur with a null totalValue as not valued", () => {
    const check = buildReturnEligibilityCheck([
      deduction({ fieldReturn: retur({ valuationStatus: "VALUED", totalValue: null }) }),
    ]);
    expect(check.reason).toBe("NOT_VALUED");
  });

  it("names every affected retur by docNo, not just the first", () => {
    const check = buildReturnEligibilityCheck([
      deduction({ id: "ded-1", fieldReturn: retur({ docNo: "FIELDRET/0001", status: "REJECTED" }) }),
      deduction({ id: "ded-2", fieldReturn: retur({ docNo: "FIELDRET/0002", status: "REJECTED" }) }),
    ]);
    expect(check.subjects).toEqual(["FIELDRET/0001", "FIELDRET/0002"]);
  });
});

describe("buildCollectibilityCheck", () => {
  it("passes when every still-owed invoice is outstanding or partial", () => {
    const check = buildCollectibilityCheck(
      [
        { receivableId: "rcv-1", agreedRemaining: 100000, settlementAllocated: 0 },
        { receivableId: "rcv-2", agreedRemaining: 50000, settlementAllocated: 0 },
      ],
      [
        invoice({ receivableId: "rcv-1", receivableStatus: "OUTSTANDING" }),
        invoice({ receivableId: "rcv-2", receivableStatus: "PARTIAL" }),
      ],
    );
    expect(check.status).toBe("PASS");
  });

  /**
   * The resume scoping. A settlement whose earlier components already closed one of its own
   * invoices leaves that invoice PAID with nothing left agreed against it. Checking every selected
   * receivable unconditionally would refuse the resume over the receivable its own approval
   * settled — the exact state a crash leaves behind, with no path back to APPROVED.
   */
  it("ignores an invoice this settlement already settled in full", () => {
    const check = buildCollectibilityCheck(
      [{ receivableId: "rcv-1", agreedRemaining: 0, settlementAllocated: 100000 }],
      [invoice({ receivableId: "rcv-1", receivableStatus: "PAID" })],
    );
    expect(check.status).toBe("PASS");
  });

  /**
   * The case `agreedRemaining` alone cannot reach, and the reason `settlementAllocated` is carried
   * separately. When the agreed share exceeds the live balance — a verified `CollectionSubmission`
   * paying the invoice down between submit and approval is enough — one component closes the
   * RECEIVABLE while leaving part of the agreed share unspent. `agreedRemaining` stays positive
   * against a now-PAID row, so scoping on it alone refuses the resume permanently.
   */
  it("ignores an invoice this settlement closed while its agreed share is still partly unspent", () => {
    const check = buildCollectibilityCheck(
      [{ receivableId: "rcv-1", agreedRemaining: 60000, settlementAllocated: 40000 }],
      [invoice({ receivableId: "rcv-1", receivableStatus: "PAID" })],
    );
    expect(check.status).toBe("PASS");
  });

  it("refuses an invoice still owed that someone else closed", () => {
    const check = buildCollectibilityCheck(
      [{ receivableId: "rcv-1", agreedRemaining: 100000, settlementAllocated: 0 }],
      [invoice({ receivableId: "rcv-1", docNo: "DLV/0009", receivableStatus: "PAID" })],
    );
    expect(check.status).toBe("FAIL");
    expect(check.reason).toBe("NOT_OUTSTANDING");
    expect(check.subjectKind).toBe("INVOICE");
    expect(check.subjects).toEqual(["DLV/0009"]);
  });

  it("refuses a WRITTEN_OFF invoice that is still owed", () => {
    const check = buildCollectibilityCheck(
      [{ receivableId: "rcv-1", agreedRemaining: 1, settlementAllocated: 0 }],
      [invoice({ receivableId: "rcv-1", receivableStatus: "WRITTEN_OFF" })],
    );
    expect(check.reason).toBe("NOT_OUTSTANDING");
  });

  it("falls back to the receivable id when the invoice has no docNo, and marks it as an id", () => {
    const check = buildCollectibilityCheck(
      [{ receivableId: "rcv-1", agreedRemaining: 100000, settlementAllocated: 0 }],
      [invoice({ receivableId: "rcv-1", docNo: null, receivableStatus: "PAID" })],
    );
    expect(check.subjectKind).toBe("INVOICE_ID");
    expect(check.subjects).toEqual(["rcv-1"]);
  });

  /**
   * `subjectKind` is one value for the whole check, so a list mixing docNos with id fallbacks takes
   * the labelled kind — "invoice DLV/0009" still reads correctly, an unlabelled cuid does not.
   */
  it("uses the labelled kind as soon as any blocked invoice falls back to an id", () => {
    const check = buildCollectibilityCheck(
      [
        { receivableId: "rcv-1", agreedRemaining: 100000, settlementAllocated: 0 },
        { receivableId: "rcv-2", agreedRemaining: 100000, settlementAllocated: 0 },
      ],
      [
        invoice({ receivableId: "rcv-1", docNo: "DLV/0009", receivableStatus: "PAID" }),
        invoice({ receivableId: "rcv-2", docNo: null, receivableStatus: "PAID" }),
      ],
    );
    expect(check.subjectKind).toBe("INVOICE_ID");
    expect(check.subjects).toEqual(["DLV/0009", "rcv-2"]);
  });
});

describe("buildHeadroomCheck", () => {
  it("passes when the invoices can absorb every unposted component", () => {
    const check = buildHeadroomCheck(
      [{ outstandingAmount: 100000 }],
      [spec({ amount: 60000, key: "k1" }), spec({ amount: 40000, key: "k2" })],
      new Set<string>(),
    );
    expect(check.status).toBe("PASS");
  });

  it("refuses when the unposted components exceed the headroom", () => {
    const check = buildHeadroomCheck(
      [{ outstandingAmount: 100000 }],
      [spec({ amount: 60000, key: "k1" }), spec({ amount: 60000, key: "k2" })],
      new Set<string>(),
    );
    expect(check.status).toBe("FAIL");
    expect(check.reason).toBe("COMPONENT_EXCEEDS_HEADROOM");
  });

  /**
   * The resume regression this spec exists for. Drop the `componentPaymentKeys` term and a
   * settlement whose cash component posted before a crash renders headroom FAIL with Approve
   * permanently disabled — a resumable document finance could then only reject, orphaning the
   * payments already behind it. The headroom passed in is already netted by
   * `computeComponentHeadroom`, so counting that component again double-counts it.
   */
  it("does not count a component that already has a payment", () => {
    const specs = [spec({ amount: 60000, key: "k1" }), spec({ amount: 60000, key: "k2" })];
    expect(buildHeadroomCheck([{ outstandingAmount: 60000 }], specs, new Set(["k1"])).status).toBe("PASS");
    expect(buildHeadroomCheck([{ outstandingAmount: 60000 }], specs, new Set<string>()).status).toBe("FAIL");
  });

  /**
   * The headroom here is deliberately smaller than the unkeyed component alone. Sizing it to match
   * would pass whether that component is counted or dropped, which is what the first version of
   * this spec did — a null-keyed retur deduction excluded alongside the posted `k1` would leave
   * `totalOwed` at zero and still read PASS.
   */
  it("always counts a component with no idempotency key, since it can never have posted", () => {
    const posted = spec({ amount: 60000, key: "k1" });
    const unkeyed = spec({ amount: 60000, key: null });
    expect(buildHeadroomCheck([{ outstandingAmount: 30000 }], [posted, unkeyed], new Set(["k1"])).status).toBe("FAIL");
    expect(buildHeadroomCheck([{ outstandingAmount: 30000 }], [posted], new Set(["k1"])).status).toBe("PASS");
  });

  it("ignores zero-amount components", () => {
    const check = buildHeadroomCheck(
      [{ outstandingAmount: 0 }],
      [spec({ amount: 0, key: "k1" }), spec({ amount: 0, key: "k2" })],
      new Set<string>(),
    );
    expect(check.status).toBe("PASS");
  });

  it("sums headroom across every invoice", () => {
    const check = buildHeadroomCheck(
      [{ outstandingAmount: 50000 }, { outstandingAmount: 50000 }],
      [spec({ amount: 100000, key: "k1" })],
      new Set<string>(),
    );
    expect(check.status).toBe("PASS");
  });
});

describe("buildReturCreditCheck", () => {
  const returns = new Map<string, SettlementReturDetail>([
    ["ret-1", retur({ id: "ret-1", docNo: "FIELDRET/0001", totalValue: 100000, alreadyDrawn: 0 })],
  ]);

  it("passes when the draw fits inside the retur's remaining credit", () => {
    const check = buildReturCreditCheck(
      [spec({ method: "RETUR_OFFSET", amount: 100000, key: "k1", returnId: "ret-1" })],
      new Set<string>(),
      returns,
    );
    expect(check.status).toBe("PASS");
  });

  it("refuses when the draw plus what is already drawn exceeds the frozen totalValue", () => {
    const drawn = new Map<string, SettlementReturDetail>([
      ["ret-1", retur({ id: "ret-1", docNo: "FIELDRET/0001", totalValue: 100000, alreadyDrawn: 60000 })],
    ]);
    const check = buildReturCreditCheck(
      [spec({ method: "RETUR_OFFSET", amount: 50000, key: "k1", returnId: "ret-1" })],
      new Set<string>(),
      drawn,
    );
    expect(check.status).toBe("FAIL");
    expect(check.reason).toBe("RETUR_OVERCLAIMED");
    expect(check.subjectKind).toBe("RETUR");
    expect(check.subjects).toEqual(["FIELDRET/0001"]);
  });

  /**
   * The resume scoping again, on the retur side. A draw that already posted is inside
   * `alreadyDrawn`; counting it as still owed as well would refuse every resumed approval that got
   * as far as posting one of its retur components.
   */
  it("does not count a draw whose component already has a payment", () => {
    const drawn = new Map<string, SettlementReturDetail>([
      ["ret-1", retur({ id: "ret-1", totalValue: 100000, alreadyDrawn: 100000 })],
    ]);
    const check = buildReturCreditCheck(
      [spec({ method: "RETUR_OFFSET", amount: 100000, key: "k1", returnId: "ret-1" })],
      new Set(["k1"]),
      drawn,
    );
    expect(check.status).toBe("PASS");
  });

  it("aggregates two draws against the same retur", () => {
    const check = buildReturCreditCheck(
      [
        spec({ method: "RETUR_OFFSET", amount: 60000, key: "k1", returnId: "ret-1" }),
        spec({ method: "RETUR_OFFSET", amount: 60000, key: "k2", returnId: "ret-1" }),
      ],
      new Set<string>(),
      returns,
    );
    expect(check.status).toBe("FAIL");
    expect(check.subjects).toEqual(["FIELDRET/0001"]);
  });

  it("ignores components that carry no returnId", () => {
    const check = buildReturCreditCheck(
      [spec({ method: "CASH", amount: 999999999, key: "k1", returnId: null })],
      new Set<string>(),
      returns,
    );
    expect(check.status).toBe("PASS");
  });

  /**
   * A retur deduction with no `fieldReturnId` reaches here with `returnId: null` and is skipped,
   * because there is nothing to attribute the draw to. `RETURNS_ELIGIBLE` is the check that
   * refuses it, and `buildHeadroomCheck` is what still counts its amount.
   */
  it("treats an unattributable draw as this check's problem to skip, not to guess at", () => {
    const check = buildReturCreditCheck(
      [spec({ method: "RETUR_OFFSET", amount: 500000, key: null, returnId: null })],
      new Set<string>(),
      returns,
    );
    expect(check.status).toBe("PASS");
  });

  /**
   * A retur whose row has gone fails `RETURNS_ELIGIBLE` at the same time, and that check already
   * labels the cuid. Leaving this one bare put the same id on two adjacent checklist rows in two
   * different spellings.
   */
  it("refuses a draw against a retur whose row is missing, and marks the id as an id", () => {
    const check = buildReturCreditCheck(
      [spec({ method: "RETUR_OFFSET", amount: 1, key: "k1", returnId: "ret-gone" })],
      new Set<string>(),
      returns,
    );
    expect(check.status).toBe("FAIL");
    expect(check.subjectKind).toBe("RETUR_ID");
    expect(check.subjects).toEqual(["ret-gone"]);
  });
});
