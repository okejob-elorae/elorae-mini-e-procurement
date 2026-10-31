import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma, seededId, seededIds } from "@elorae/db";
import { PERMISSIONS } from "@/lib/rbac";
import { ENTITAS_BIAYA, KATEGORI_NOTIF_BIAYA } from "@/lib/salesman/biaya";
import { setujuiBiayaAction, tandaiDibayarBiayaAction, tolakBiayaAction } from "./expense-claims";

/**
 * Keputusan biaya perjalanan (setuju / tolak / dibayar) adalah penjaga keadaan:
 * dua klik bersamaan tidak boleh sama-sama "berhasil". `updateMany where status`
 * di Prisma 7 bukan compare-and-swap, jadi penjaganya harus serializable —
 * dibuktikan di sini dengan balapan sungguhan terhadap basis data.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("keputusan biaya perjalanan — balapan (test bed only)", () => {
  let token = "";
  let salesId = "";
  let atasanA = "";
  let atasanB = "";
  let keuangan = "";
  const klaimIds: string[] = [];
  let mulai = new Date();

  function sebagai(userId: string, izin: string[]) {
    return { user: { id: userId, permissions: izin } };
  }
  const IZIN_SETUJU = [PERMISSIONS.FIELD_SALES_ORDERS_APPROVE];
  const IZIN_BAYAR = [PERMISSIONS.JOURNALS_MANAGE];

  async function klaimBaru(status = "DIAJUKAN"): Promise<string> {
    const k = await prisma.expenseClaim.create({
      data: { userId: salesId, spentAt: new Date("2026-09-14T03:00:00.000Z"), category: "BENSIN", amount: 125_000, status },
      select: { id: true },
    });
    klaimIds.push(k.id);
    return k.id;
  }

  beforeEach(async () => {
    token = "";
    salesId = "";
    atasanA = "";
    atasanB = "";
    keuangan = "";
    klaimIds.length = 0;
    mulai = new Date(Date.now() - 1000);
    m.auth.mockReset();
    token = Math.random().toString(36).slice(2, 10);
    const buat = async (peran: string) =>
      (await prisma.user.create({ data: { email: `biaya-${peran}-${token}@uji.local`, name: `${peran} ${token}` } })).id;
    salesId = await buat("sales");
    atasanA = await buat("atasan-a");
    atasanB = await buat("atasan-b");
    keuangan = await buat("keuangan");
  });

  afterEach(async () => {
    const ids = [...klaimIds];
    // Catatan "perlu dibayar" dicocokkan lewat metadata.claimId di JS (filter JSON tidak andal lintas adaptor).
    const notif = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_BIAYA.PERLU_DIBAYAR, createdAt: { gte: mulai } },
      select: { id: true, metadata: true },
    });
    const notifIds = notif
      .filter((n) => ids.includes(String((n.metadata as { claimId?: unknown } | null)?.claimId ?? "")))
      .map((n) => n.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "ExpenseClaim", entityId: { in: seededIds(ids) } } });
    await prisma.expenseClaim.deleteMany({ where: { id: { in: seededIds(ids) } } });
    for (const u of [salesId, atasanA, atasanB, keuangan]) {
      if (u) await prisma.user.delete({ where: { id: seededId(u) } });
    }
  });

  async function notifPerluDibayar(claimId: string): Promise<number> {
    const rows = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_BIAYA.PERLU_DIBAYAR, createdAt: { gte: mulai } },
      select: { metadata: true },
    });
    return rows.filter((n) => (n.metadata as { claimId?: unknown } | null)?.claimId === claimId).length;
  }

  it("setuju dan tolak bersamaan oleh dua atasan: tepat satu keputusan, satu jejak", async () => {
    for (let putaran = 0; putaran < 4; putaran += 1) {
      const id = await klaimBaru();
      m.auth.mockResolvedValueOnce(sebagai(atasanA, IZIN_SETUJU)).mockResolvedValueOnce(sebagai(atasanB, IZIN_SETUJU));
      const [setuju, tolak] = await Promise.all([setujuiBiayaAction(id), tolakBiayaAction(id, "struk buram")]);

      const menang = [setuju, tolak].filter((h) => h.ok);
      const kalah = [setuju, tolak].filter((h) => !h.ok);
      expect(menang).toHaveLength(1);
      expect(kalah).toEqual([{ ok: false, kode: "SUDAH_DIPUTUSKAN" }]);

      const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(row.status).toBe(setuju.ok ? "DISETUJUI" : "DITOLAK");
      expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_BIAYA, entityId: seededId(id) } })).toBe(1);
      // Catatan "perlu dibayar" hanya ada bila persetujuan yang menang — dan hanya sekali.
      expect(await notifPerluDibayar(id)).toBe(setuju.ok ? 1 : 0);
    }
  });

  it("klik ganda 'setujui' oleh atasan yang sama: satu persetujuan, satu catatan perlu dibayar", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const id = await klaimBaru();
      m.auth.mockResolvedValue(sebagai(atasanA, IZIN_SETUJU));
      const hasil = await Promise.all([setujuiBiayaAction(id), setujuiBiayaAction(id)]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIPUTUSKAN" }]);
      expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_BIAYA, entityId: seededId(id) } })).toBe(1);
      expect(await notifPerluDibayar(id)).toBe(1);
    }
  });

  it("klik ganda 'dibayar' oleh keuangan: Rp125.000 dibayar sekali", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const id = await klaimBaru("DISETUJUI");
      m.auth.mockResolvedValue(sebagai(keuangan, IZIN_BAYAR));
      const hasil = await Promise.all([tandaiDibayarBiayaAction(id), tandaiDibayarBiayaAction(id)]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIPUTUSKAN" }]);
      const row = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(row.status).toBe("DIBAYAR");
      expect(row.amount.toString()).toBe("125000");
      expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_BIAYA, entityId: seededId(id), action: "EXPENSE_CLAIM_PAID" } })).toBe(1);
    }
  });

  it("aturan lama tetap: milik sendiri ditolak, bayar sebelum disetujui ditolak", async () => {
    const id = await klaimBaru();
    m.auth.mockResolvedValueOnce(sebagai(salesId, IZIN_SETUJU));
    expect(await setujuiBiayaAction(id)).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    m.auth.mockResolvedValueOnce(sebagai(keuangan, IZIN_BAYAR));
    expect(await tandaiDibayarBiayaAction(id)).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    m.auth.mockResolvedValueOnce(sebagai(atasanA, IZIN_SETUJU));
    expect(await tolakBiayaAction(`tidak-ada-${token}`, "x")).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect((await prisma.expenseClaim.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DIAJUKAN");
  });
});
