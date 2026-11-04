import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Rincian piutang kantor tidak menawarkan yang ditolak penulisnya. Tagihan konsi (`isKonsiBill`:
 * tagihan siklus/utang konsi tertulis `isConsignment`, atau tagihan sell-through) hanya dilunasi
 * lewat BKM — `recordPayment` menolaknya `KONSI_LEWAT_BKM` — jadi pemicu lembar pembayaran ditahan
 * di tagihan itu dan pemilih alokasinya tidak pernah memuat tagihan konsi (`excludeKonsiBills`).
 * Tanpa basis data.
 */

const h = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  piutang: null as Record<string, unknown> | null,
  tanda: null as { isConsignment: boolean; sellThroughId: string | null } | null,
  kandidat: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@elorae/db", () => ({
  prisma: { receivable: { findUnique: vi.fn(async () => h.tanda) } },
}));
vi.mock("@/lib/finance/ar/queries", () => ({
  getReceivable: vi.fn(async () => h.piutang),
  listAllocationCandidatesForStore: h.kandidat,
}));
vi.mock("@/lib/finance/ar/journal-pending", () => ({ isFieldDeliveryJournalStillPending: vi.fn(async () => false) }));
vi.mock("@/lib/finance/collections/queries", () => ({ listCollectorCandidates: vi.fn(async () => []) }));
vi.mock("./ReceivableDetailClient", () => ({ ReceivableDetailClient: () => null }));

import ReceivableDetailPage from "./page";

type Muatan = { konsiBill: boolean; canManagePayments: boolean; allocationCandidates: unknown[] };
const buka = async () => (await ReceivableDetailPage({ params: Promise.resolve({ id: "rcv-1" }) })) as ReactElement<Muatan>;

beforeEach(() => {
  vi.clearAllMocks();
  h.sesi = { user: { id: "keu-1", permissions: ["*"] } };
  h.piutang = { id: "rcv-1", storeId: "toko-1", source: { kind: "INVOICE", docNo: "INV-1" } };
  h.tanda = { isConsignment: false, sellThroughId: null };
  h.kandidat.mockResolvedValue([{ id: "rcv-2", docNo: "INV-2", dueDate: new Date("2026-11-01"), outstandingAmount: 100 }]);
});

describe("rincian piutang kantor dan tagihan konsi", () => {
  it("pemilih alokasi lembar pembayaran tidak pernah memuat tagihan konsi", async () => {
    const hasil = await buka();
    expect(isValidElement(hasil)).toBe(true);
    expect(h.kandidat).toHaveBeenCalledWith("toko-1", { excludeKonsiBills: true });
    expect(hasil.props.konsiBill).toBe(false);
  });

  it.each([
    ["tagihan siklus konsinyasi / utang konsi tertulis", { isConsignment: true, sellThroughId: null }],
    ["tagihan sell-through", { isConsignment: false, sellThroughId: "st-1" }],
  ])("%s ditandai tagihan konsi, jadi lembar pembayarannya tidak ditawarkan", async (_label, tanda) => {
    h.tanda = tanda;
    const hasil = await buka();
    expect(hasil.props.konsiBill).toBe(true);
  });

  it("tanpa izin mengelola pembayaran, kandidat tidak dibaca sama sekali", async () => {
    h.sesi = { user: { id: "lihat-1", permissions: ["receivables:view"] } };
    const hasil = await buka();
    expect(h.kandidat).not.toHaveBeenCalled();
    expect(hasil.props.allocationCandidates).toEqual([]);
  });
});
