import { describe, expect, it } from "vitest";
import { serializePODetail } from "./serialize";

type DetailInput = Parameters<typeof serializePODetail>[0];

function detailRow(overrides: Partial<DetailInput> = {}): DetailInput {
  const createdAt = new Date("2026-10-01T03:00:00.000Z");
  return {
    id: "po-1",
    docNumber: "PO/2026/10/0001",
    supplierId: "sup-1",
    status: "SUBMITTED",
    etaDate: null,
    paymentDueDate: null,
    paidAt: null,
    paymentTermsDays: null,
    currency: "IDR",
    totalAmount: 0,
    taxAmount: 0,
    grandTotal: 0,
    notes: null,
    terms: null,
    createdById: "user-1",
    syncStatus: "SYNCED",
    createdAt,
    updatedAt: createdAt,
    chainSnapshot: null,
    chainTotalDays: null,
    chainConfirmedStepIndex: null,
    chainConfirmedAt: null,
    actualLeadDays: null,
    supplier: {},
    items: [],
    grns: [],
    statusHistory: [],
    ...overrides,
  };
}

function grn(ownerDeclinedAt: Date | null) {
  return {
    id: "grn-1",
    docNumber: "GRN/2026/10/0001",
    totalAmount: 1000,
    grnDate: new Date("2026-10-02T03:00:00.000Z"),
    ownerDeclinedAt,
  };
}

describe("serializePODetail payment terms", () => {
  it("passes a number of payment terms days through", () => {
    expect(serializePODetail(detailRow({ paymentTermsDays: 30 })).paymentTermsDays).toBe(30);
  });

  it("passes null payment terms days through as null", () => {
    expect(serializePODetail(detailRow({ paymentTermsDays: null })).paymentTermsDays).toBeNull();
  });
});

describe("serializePODetail goods receipts", () => {
  it("serializes a declined receipt's ownerDeclinedAt as an ISO string", () => {
    const declinedAt = new Date("2026-10-03T04:05:06.000Z");
    const [row] = serializePODetail(detailRow({ grns: [grn(declinedAt)] })).grns;
    expect(row.ownerDeclinedAt).toBe("2026-10-03T04:05:06.000Z");
  });

  it("keeps an undeclined receipt's ownerDeclinedAt as null", () => {
    const [row] = serializePODetail(detailRow({ grns: [grn(null)] })).grns;
    expect(row.ownerDeclinedAt).toBeNull();
  });
});
