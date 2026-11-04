import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRevalidate, tx, mockTransaction, mockFind } = vi.hoisted(() => {
  const tx = {
    systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    mockAuth: vi.fn(),
    mockRevalidate: vi.fn(),
    tx,
    mockTransaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    mockFind: vi.fn(),
  };
});
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@elorae/db", () => ({ prisma: { $transaction: mockTransaction, systemSetting: { findUnique: mockFind } } }));

import { ambilSuratPo, simpanSuratPo } from "./surat-po";
import { SURAT_PO_BAWAAN } from "@/lib/purchase-orders/surat-po";

const surat = { pembuka: "Dengan hormat,\nKami memesan:", penutup: "Terima kasih." };

describe("simpanSuratPo", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockRevalidate, mockFind, tx.systemSetting.findUnique, tx.systemSetting.upsert, tx.auditLog.create]) m.mockReset();
    mockTransaction.mockClear();
  });

  it("butuh sesi dan settings_tax:manage — sama dengan tarif PPN", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await simpanSuratPo(surat)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settings_tax:view", "purchase_orders:create"] } });
    expect(await simpanSuratPo(surat)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("menolak isian yang bukan dua teks", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settings_tax:manage"] } });
    expect(await simpanSuratPo({ pembuka: "a" } as never)).toEqual({ ok: false, code: "INVALID" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("menyimpan surat dan jejak sebelum/sesudah di transaksi yang sama; id pengguna dari sesi", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settings_tax:manage"] } });
    tx.systemSetting.findUnique.mockResolvedValue(null);
    expect(await simpanSuratPo({ ...surat, lain: 1 } as never)).toEqual({ ok: true });
    expect(tx.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "purchasing.suratPo" }, update: { value: JSON.stringify(surat) } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "PURCHASE_ORDER_LETTER_UPDATED",
        entityType: "SystemSetting",
        entityId: "purchasing.suratPo",
        changes: { before: SURAT_PO_BAWAAN, after: surat },
      }),
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/tax");
  });
});

describe("ambilSuratPo", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFind.mockReset();
  });

  it("boleh dibaca pemegang izin lihat PO atau pengaturan pajak", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:view"] } });
    mockFind.mockResolvedValue({ value: JSON.stringify(surat) });
    expect(await ambilSuratPo()).toEqual({ ok: true, surat });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settings_tax:view"] } });
    mockFind.mockResolvedValue(null);
    expect(await ambilSuratPo()).toEqual({ ok: true, surat: SURAT_PO_BAWAAN });
  });

  it("selain itu ditolak", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
    expect(await ambilSuratPo()).toEqual({ ok: false, code: "FORBIDDEN" });
    mockAuth.mockResolvedValue(null);
    expect(await ambilSuratPo()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(mockFind).not.toHaveBeenCalled();
  });
});
