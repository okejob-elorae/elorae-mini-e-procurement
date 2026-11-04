import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_GAJI_SPG, JEJAK_GAJI_SPG } from "./gaji-pokok";
import { aturGajiBulananSpg, bacaJumlahGaji, bulanDibayarYangBergeser } from "./gaji-pokok-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Gaji bulanan SPG di Pengaturan → Komisi SPG (P63): satu baris per SPG × bulan mulai berlaku, dan
 * gaji yang berlaku di bulan kerja yang sudah dibayar tidak pernah bergeser (tinjauan rancangan
 * akhir butir 2 — menambah bulan yang lebih tua tanpa menggeser bulan yang dibayar tetap boleh).
 */
describe("aturan gaji bulanan (murni)", () => {
  it("rupiah bulat 0 … batas atas; Rp 0 sah", () => {
    expect(bacaJumlahGaji(0)).toBe(0);
    expect(bacaJumlahGaji("3500000")).toBe(3_500_000);
    expect(bacaJumlahGaji(1.5)).toBeNull();
    expect(bacaJumlahGaji(-1)).toBeNull();
    expect(bacaJumlahGaji("")).toBeNull();
  });

  it("menambah Oktober sesudah November dibayar tidak menggeser November; mengubah November menggesernya", () => {
    const lama = [{ effectiveFrom: "2026-11", monthlyAmount: 3_500_000 }];
    expect(bulanDibayarYangBergeser(lama, { effectiveFrom: "2026-10", monthlyAmount: 3_000_000 }, new Set(["2026-11"]))).toBeNull();
    expect(bulanDibayarYangBergeser(lama, { effectiveFrom: "2026-11", monthlyAmount: 3_600_000 }, new Set(["2026-11"]))).toBe("2026-11");
    // Oktober sendiri sudah dibayar (tanpa gaji yang berlaku) — mengisinya menggeser Oktober.
    expect(bulanDibayarYangBergeser(lama, { effectiveFrom: "2026-10", monthlyAmount: 3_000_000 }, new Set(["2026-10"]))).toBe("2026-10");
    // Gaji baru mulai Desember tidak menyentuh November yang dibayar.
    expect(bulanDibayarYangBergeser(lama, { effectiveFrom: "2026-12", monthlyAmount: 4_000_000 }, new Set(["2026-11"]))).toBeNull();
  });
});

d("gaji bulanan SPG (test bed only)", () => {
  const tag = `GPW${Math.random().toString(36).slice(2, 8)}`;
  let toko = "";
  let spg = "";
  let kantor = "";

  beforeAll(async () => {
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`, name: `Spg ${tag}`, assignedStoreId: toko, spgStartedOn: "2026-10-10" } })).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
  });

  afterEach(async () => {
    const rows = await prisma.spgSalary.findMany({ where: { userId: seededId(spg) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_GAJI_SPG, entityId: { in: seededIds(rows.map((r) => r.id)) } } });
    await prisma.spgSalary.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spg, kantor].filter(Boolean)) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
  });

  const atur = (jumlah: unknown, berlakuMulai: string) => aturGajiBulananSpg({ userId: spg, jumlah, berlakuMulai, olehUserId: kantor });

  it("menyimpan dengan jejak sebelum/sesudah di transaksi yang sama; mengubah bulan yang sama menulis jejak kedua", async () => {
    expect(await atur(3_500_000, "2026-11")).toEqual({ ok: true });
    expect(await atur(3_600_000, "2026-11")).toEqual({ ok: true });
    const jejak = await prisma.auditLog.findMany({
      where: { action: JEJAK_GAJI_SPG.DIATUR, userId: seededId(kantor) },
      orderBy: { createdAt: "asc" },
      select: { changes: true },
    });
    expect(jejak.map((j) => j.changes)).toEqual([
      { before: null, after: { effectiveFrom: "2026-11", monthlyAmount: 3_500_000 } },
      { before: { effectiveFrom: "2026-11", monthlyAmount: 3_500_000 }, after: { effectiveFrom: "2026-11", monthlyAmount: 3_600_000 } },
    ]);
  });

  it("bulan yang sudah dibayar tidak bergeser; menambah bulan yang lebih tua tetap boleh", async () => {
    expect((await atur(3_500_000, "2026-11")).ok).toBe(true);
    await prisma.spgCommission.create({
      data: { userId: spg, storeId: toko, period: "2026-11", unitsSold: 0, commission: 0, basis: "TARIF_KATEGORI", lockedById: kantor, paidAt: new Date(), paidById: kantor },
    });
    expect(await atur(3_700_000, "2026-11")).toEqual({ ok: false, kode: "BULAN_SUDAH_DIBAYAR", bulan: "2026-11" });
    // Oktober (ia mulai 10 Oktober): belum dibayar dan tidak menggeser November.
    expect(await atur(3_000_000, "2026-10")).toEqual({ ok: true });
    expect(await atur("abc", "2026-12")).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH" });
    expect(await atur(1, "2026-13")).toEqual({ ok: false, kode: "BULAN_TIDAK_SAH" });
  });
});
