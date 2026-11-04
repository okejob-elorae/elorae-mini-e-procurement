import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit-only: auth, the writers, the journal hook and the notifications are mocked, so nothing here
 * touches the shared dev database. The writers have their own DB-backed spec
 * (`lib/field-sales/konsi-transfer/pesanan-lama-writer.test.ts`) — this file pins the gates the
 * actions add on top: the office can never confirm an arrival, and only `field_sales_orders:deliver`
 * may mark the remainder "tidak jadi dikirim".
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  konfirmasi: vi.fn(),
  batal: vi.fn(),
  kait: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/konsi-transfer/pesanan-lama-writer", () => ({
  konfirmasiSampaiPesananLama: h.konfirmasi,
  batalKirimPesananLama: h.batal,
}));
vi.mock("@/lib/finance/operasional/kait", () => ({ kaitPindahKonsiTransfer: h.kait }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: { PESANAN_DITUTUP: "PESANAN_DITUTUP" }, kabariPengguna: vi.fn() }));
vi.mock("@/lib/spg/titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => undefined) }));
vi.mock("@elorae/db", () => ({ prisma: { fieldSalesOrder: { findUnique: vi.fn(async () => null) } } }));

import { batalKirimPesananLamaAction, konfirmasiSampaiPesananLamaAction } from "./field-sales-orders-konsi-lama";

const isian = { orderId: "o1", baris: [{ lineId: "l1", qty: 3 }], idempotencyKey: "k1" };
const berhasil = {
  ok: true,
  storeId: "s1",
  transferId: "t1",
  docNo: "KTRF/1",
  receiptId: "r1",
  pcs: 3,
  pcsSesudahOpname: 0,
  peran: "SPG",
};

describe("konfirmasiSampaiPesananLamaAction", () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.konfirmasi.mockReset();
    h.kait.mockClear();
  });

  it("admin (izin wildcard) adalah kantor: ditolak tanpa memanggil penulis", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin", permissions: ["*"] } });
    expect(await konfirmasiSampaiPesananLamaAction(isian)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.konfirmasi).not.toHaveBeenCalled();
  });

  it("pengguna kantor tanpa akses HP ditolak", async () => {
    h.auth.mockResolvedValue({ user: { id: "keuangan", permissions: ["field_sales_orders:deliver", "field_sales_orders:approve"] } });
    expect(await konfirmasiSampaiPesananLamaAction(isian)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.konfirmasi).not.toHaveBeenCalled();
  });

  it("isian rusak ditolak sebelum sesi dibaca", async () => {
    expect(await konfirmasiSampaiPesananLamaAction({ orderId: "o1", baris: [{ lineId: "l1", qty: -1 }] })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await konfirmasiSampaiPesananLamaAction({ orderId: "o1", baris: [] })).toEqual({ ok: false, code: "VALIDATION" });
    expect(h.konfirmasi).not.toHaveBeenCalled();
  });

  it("pengguna HP: penulis menilai tokonya dengan id SESI (bukan dari layar), lalu jurnal pindahnya diposting", async () => {
    h.auth.mockResolvedValue({ user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } });
    h.konfirmasi.mockResolvedValue(berhasil);
    expect(await konfirmasiSampaiPesananLamaAction({ ...isian, userId: "orang-lain" })).toEqual({ ok: true, docNo: "KTRF/1", pcs: 3, pcsSesudahOpname: 0 });
    expect(h.konfirmasi).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o1", userId: "spg-1", idempotencyKey: "k1" }));
    expect(h.kait).toHaveBeenCalledWith("t1", "spg-1");
  });

  it("penolakan penulis diteruskan sebagai kode", async () => {
    h.auth.mockResolvedValue({ user: { id: "sales-1", permissions: ["pwa:access"] } });
    h.konfirmasi.mockResolvedValue({ ok: false, alasan: "BUKAN_PENERIMA" });
    expect(await konfirmasiSampaiPesananLamaAction(isian)).toEqual({ ok: false, code: "BUKAN_PENERIMA" });
    expect(h.kait).not.toHaveBeenCalled();
  });
});

describe("batalKirimPesananLamaAction", () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.batal.mockReset();
  });

  it("butuh field_sales_orders:deliver — izin yang sama dengan tombolnya", async () => {
    h.auth.mockResolvedValue({ user: { id: "sales-1", permissions: ["pwa:access", "field_sales_orders:view"] } });
    expect(await batalKirimPesananLamaAction("o1", "alasan")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.batal).not.toHaveBeenCalled();
  });

  it("alasan wajib", async () => {
    h.auth.mockResolvedValue({ user: { id: "kantor-1", permissions: ["field_sales_orders:deliver"] } });
    expect(await batalKirimPesananLamaAction("o1", "   ")).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    expect(await batalKirimPesananLamaAction("", "alasan")).toEqual({ ok: false, code: "VALIDATION" });
    expect(h.batal).not.toHaveBeenCalled();
  });

  it("meneruskan alasan yang dirapikan dan id pelaku dari sesi", async () => {
    h.auth.mockResolvedValue({ user: { id: "kantor-1", permissions: ["field_sales_orders:deliver"] } });
    h.batal.mockResolvedValue({ ok: true, orderNo: "KONSI/1", pcs: 6 });
    expect(await batalKirimPesananLamaAction("o1", "  tidak jadi  ")).toEqual({ ok: true });
    expect(h.batal).toHaveBeenCalledWith({ orderId: "o1", userId: "kantor-1", alasan: "tidak jadi" });
  });
});
