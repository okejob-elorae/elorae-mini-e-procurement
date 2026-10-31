import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit: auth, rbac, penulis (fungsi tandai) dan pencarian nota dipalsukan; kelas galat
 * `NomorFakturError` tetap yang asli. Mengunci bahwa penolakan nomor faktur pajak dari
 * penulis sampai ke layar sebagai kode spesifik, bukan INVALID_REQUEST generik.
 */
const { mockAuth, mockHasPermission, mockMarkCreated, mockFindDelivery, mockFindSellThrough } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockMarkCreated: vi.fn(),
  mockFindDelivery: vi.fn(),
  mockFindSellThrough: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/tax-invoices/writer", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/tax-invoices/writer")>();
  return { ...actual, markTaxInvoiceCreated: mockMarkCreated };
});
vi.mock("@elorae/db", async (importActual) => {
  const actual = await importActual<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: { fieldSalesDelivery: { findUnique: mockFindDelivery }, konsiSellThrough: { findUnique: mockFindSellThrough } },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { NomorFakturError } from "@/lib/tax-invoices/writer";
import { TaxInvoiceError } from "@/lib/tax-invoices/errors";
import { markCreatedAction } from "./tax-invoices";

/** Masukan lengkap aksi; yang diuji di sini hanya nomornya. */
function tandai(invoiceNo: string) {
  return markCreatedAction({
    taxInvoiceId: "ti-1",
    invoiceNo,
    buyerNpwp: "01.234.567.8-901.000",
    taxableAmount: 100_000,
    ppnAmount: 11_000,
  });
}

describe("markCreatedAction — penolakan nomor faktur pajak", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockMarkCreated.mockReset();
    mockFindDelivery.mockReset();
    mockFindSellThrough.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["tax_invoices:manage"] } });
    mockHasPermission.mockReturnValue(true);
  });

  it("nomor yang sudah dipakai → NOMOR_FAKTUR_GANDA beserta nomor nota yang memegangnya", async () => {
    mockMarkCreated.mockRejectedValue(
      new NomorFakturError("GANDA", { taxInvoiceId: "ti-lain", deliveryId: "dlv-lain", sellThroughId: null, invoiceNo: "010.000-26.00000001" }),
    );
    mockFindDelivery.mockResolvedValue({ docNo: "DLV/2026/00012" });
    const res = await tandai("010.000-26.00000001");
    expect(res).toEqual({ ok: false, code: "NOMOR_FAKTUR_GANDA", dipakaiDi: "DLV/2026/00012" });
    expect(mockFindDelivery).toHaveBeenCalledWith({ where: { id: "dlv-lain" }, select: { docNo: true } });
  });

  it("nota pemegang tidak ditemukan → tetap NOMOR_FAKTUR_GANDA, tanpa nomor nota", async () => {
    mockMarkCreated.mockRejectedValue(
      new NomorFakturError("GANDA", { taxInvoiceId: "ti-lain", deliveryId: "dlv-hilang", sellThroughId: null, invoiceNo: "0100002600000001" }),
    );
    mockFindDelivery.mockResolvedValue(null);
    const res = await tandai("0100002600000001");
    expect(res).toEqual({ ok: false, code: "NOMOR_FAKTUR_GANDA" });
  });

  it("pencarian nota gagal → tetap NOMOR_FAKTUR_GANDA, tidak menjadi ERROR", async () => {
    mockMarkCreated.mockRejectedValue(
      new NomorFakturError("GANDA", { taxInvoiceId: "ti-lain", deliveryId: "dlv-lain", sellThroughId: null, invoiceNo: "0100002600000001" }),
    );
    mockFindDelivery.mockRejectedValue(new Error("koneksi putus"));
    const res = await tandai("0100002600000001");
    expect(res).toEqual({ ok: false, code: "NOMOR_FAKTUR_GANDA" });
  });

  it("nomor dipegang laporan sell-through konsi → nomor laporannya, tanpa mencari nota pengiriman", async () => {
    mockMarkCreated.mockRejectedValue(
      new NomorFakturError("GANDA", { taxInvoiceId: "ti-lain", deliveryId: null, sellThroughId: "st-lain", invoiceNo: "0100002600000001" }),
    );
    mockFindSellThrough.mockResolvedValue({ docNo: "KST/2026/00003" });
    const res = await tandai("0100002600000001");
    expect(res).toEqual({ ok: false, code: "NOMOR_FAKTUR_GANDA", dipakaiDi: "KST/2026/00003" });
    expect(mockFindSellThrough).toHaveBeenCalledWith({ where: { id: "st-lain" }, select: { docNo: true } });
    expect(mockFindDelivery).not.toHaveBeenCalled();
  });

  it("format salah → NOMOR_FAKTUR_FORMAT tanpa mencari nota", async () => {
    mockMarkCreated.mockRejectedValue(new NomorFakturError("FORMAT"));
    const res = await tandai("12-34");
    expect(res).toEqual({ ok: false, code: "NOMOR_FAKTUR_FORMAT" });
    expect(mockFindDelivery).not.toHaveBeenCalled();
    expect(mockFindSellThrough).not.toHaveBeenCalled();
  });

  it("INVALID_REQUEST biasa dari penulis tetap INVALID_REQUEST", async () => {
    mockMarkCreated.mockRejectedValue(new TaxInvoiceError("INVALID_REQUEST"));
    const res = await tandai(" ");
    expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});
