import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatBebanDipotong, catatPengembalianBebanDibayar, loncengBebanLunasLewatUtangTx, ubahBesarBebanSpg, utangBebanSudahDiputuskan } from "./beban-spg-writer";
import { bebanSpgTerbukaPerOrang, bebanUntukRetur, kembaliBebanTerbukaPerOrang } from "./beban-spg-queries";
import { JEJAK } from "@/lib/receivables/jejak";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Penulis beban SPG terhadap basis data uji. Beban dibuat langsung (tanpa
 * laporan retur — `SpgCharge` tidak ber-FOREIGN KEY), rujukan bayaran palsu.
 * Penghapusan hanya lewat `seededId()`/`seededIds()`.
 */
d("beban SPG: potongan, pelunasan, pengembalian (test bed only)", () => {
  const tag = `BSP-${Math.random().toString(36).slice(2, 8)}`;
  let spgId = "";
  let kantorId = "";
  let chargeIds: string[] = [];
  let debtIds: string[] = [];

  beforeEach(async () => {
    spgId = "";
    kantorId = "";
    chargeIds = [];
    debtIds = [];
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg-${Date.now()}@test.local`.toLowerCase(), name: `SPG ${tag}` } })).id;
    kantorId = (await prisma.user.create({ data: { email: `${tag}-kantor-${Date.now()}@test.local`.toLowerCase(), name: `Kantor ${tag}` } })).id;
  });

  afterEach(async () => {
    const ids = () => chargeIds.filter(Boolean);
    if (ids().length) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(ids()) } } });
      const lonceng = await prisma.adminNotification.findMany({ where: { category: "RETUR_PEMBELI_MENUNGGU" }, select: { id: true, metadata: true } });
      const milik = lonceng.filter((n) => ids().includes(String((n.metadata as Record<string, unknown> | null)?.chargeId ?? ""))).map((n) => n.id);
      await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      await prisma.spgChargeDeduction.deleteMany({ where: { chargeId: { in: seededIds(ids()) } } });
      await prisma.spgCharge.deleteMany({ where: { id: { in: seededIds(ids()) } } });
    }
    if (debtIds.length) await prisma.spgDebt.deleteMany({ where: { id: { in: seededIds(debtIds.filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId, kantorId].filter(Boolean)) } } });
  });

  async function buatBeban(jumlah: number, o: { status?: string; goodsDecision?: string; paybackAmount?: number; settledAmount?: number } = {}) {
    const c = await prisma.spgCharge.create({
      data: {
        spgUserId: spgId,
        storeId: `${tag}-toko`,
        sourceKind: "KONSI",
        source: "RETUR_PEMBELI",
        sourceId: `${tag}-retur-${chargeIds.length}`,
        sourceDocNo: `${tag}/SPG/${chargeIds.length}`,
        spgSaleId: `${tag}-nota`,
        reportedAt: new Date(),
        computedAmount: jumlah,
        amount: jumlah,
        settledAmount: o.settledAmount ?? 0,
        status: o.status ?? "TERBUKA",
        goodsDecision: o.goodsDecision ?? null,
        paybackAmount: o.paybackAmount ?? 0,
        note: "uji",
        createdById: kantorId,
      },
    });
    chargeIds.push(c.id);
    return c;
  }

  const potong = (chargeId: string, jumlah: number, ref: string, paidRefType = "SpgCommission") =>
    runSerializable((tx) =>
      catatBebanDipotong(tx, {
        olehUserId: kantorId,
        waktu: new Date(),
        bulanBayar: "2026-11",
        potong: [
          {
            chargeId,
            jumlah,
            dariKomisi: paidRefType === "SpgDebt" ? 0 : jumlah,
            dariGaji: 0,
            paidRefType,
            paidRefId: ref,
          },
        ],
      }),
    );
  const baca = (id: string) => prisma.spgCharge.findUniqueOrThrow({ where: { id: seededId(id) } });

  it("a deduction raises settledAmount, audits, and a full one makes the charge LUNAS with ONE goods bell", async () => {
    const c = await buatBeban(50_000);
    expect((await potong(c.id, 20_000, `${tag}-bayar-1`)).lunas).toEqual([]);
    expect([Number((await baca(c.id)).settledAmount), (await baca(c.id)).status]).toEqual([20_000, "TERBUKA"]);
    const { lunas } = await potong(c.id, 30_000, `${tag}-bayar-2`);
    const sesudah = await baca(c.id);
    expect([Number(sesudah.settledAmount), sesudah.status, sesudah.settledAt !== null]).toEqual([50_000, "LUNAS", true]);
    expect(lunas).toHaveLength(1);
    expect(lunas[0].metadata).toMatchObject({ chargeId: c.id, returnId: c.sourceId });
    expect((await prisma.auditLog.findMany({ where: { entityId: seededId(c.id) } })).map((a) => a.action)).toEqual([JEJAK.BEBAN_SPG_DIPOTONG, JEJAK.BEBAN_SPG_DIPOTONG]);
    expect((await bebanSpgTerbukaPerOrang(prisma, [spgId])).get(spgId) ?? []).toEqual([]);
  });

  it("one payment cannot deduct the same charge twice (unique key), nor beyond what is left", async () => {
    const c = await buatBeban(50_000);
    await potong(c.id, 10_000, `${tag}-bayar-1`);
    await expect(potong(c.id, 10_000, `${tag}-bayar-1`)).rejects.toThrow();
    await expect(potong(c.id, 45_000, `${tag}-bayar-2`)).rejects.toThrow();
    expect(Number((await baca(c.id)).settledAmount)).toBe(10_000);
  });

  it("race: two payments applying the same charge never settle more than its amount", async () => {
    const c = await buatBeban(50_000);
    const hasil = await Promise.allSettled([potong(c.id, 40_000, `${tag}-bayar-a`), tunda(5).then(() => potong(c.id, 40_000, `${tag}-bayar-b`))]);
    expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    expect(Number((await baca(c.id)).settledAmount)).toBe(40_000);
    expect(await prisma.spgChargeDeduction.count({ where: { chargeId: seededId(c.id) } })).toBe(1);
  });

  it("moved to SPG debt at the final payment: DIUTANGKAN, no bell; compensated only once that debt is paid", async () => {
    const c = await buatBeban(50_000);
    const debt = await prisma.spgDebt.create({
      data: {
        spgUserId: spgId,
        kind: "RETUR_PEMBELI",
        sourceKey: c.id,
        sourceStoreId: c.storeId,
        amount: 50_000,
        createdRefType: "SpgDebtRecording",
        createdRefId: `${tag}-catat`,
        note: "uji",
        createdById: kantorId,
      },
    });
    debtIds.push(debt.id);
    const { lunas } = await potong(c.id, 50_000, debt.id, "SpgDebt");
    expect(lunas).toEqual([]);
    expect((await baca(c.id)).status).toBe("DIUTANGKAN");
    expect((await bebanUntukRetur(c.sourceId))?.bisaDiputuskan).toBe(false);
    // Utang SPG belum punya jalan pembatalan: beban yang sudah menjadi utang tidak dibatalkan dari P82.
    expect((await bebanUntukRetur(c.sourceId))?.bisaDibatalkan).toBe(false);

    await prisma.spgDebt.update({ where: { id: seededId(debt.id) }, data: { status: "LUNAS", settledAmount: 50_000, settledAt: new Date() } });
    const lonceng = await runSerializable((tx) => loncengBebanLunasLewatUtangTx(tx, [debt.id]));
    expect(lonceng.map((n) => (n.metadata as Record<string, unknown>).chargeId)).toEqual([c.id]);
    expect((await bebanUntukRetur(c.sourceId))?.bisaDiputuskan).toBe(true);
    expect(await runSerializable((tx) => utangBebanSudahDiputuskan(tx, [debt.id]))).toBe(false);
    await prisma.spgCharge.update({ where: { id: seededId(c.id) }, data: { goodsDecision: "DIBELI_SPG" } });
    expect(await runSerializable((tx) => utangBebanSudahDiputuskan(tx, [debt.id]))).toBe(true);
  });

  it("a payback is paid once: compare-and-swap on paybackPaidAt", async () => {
    const c = await buatBeban(50_000, { status: "LUNAS", settledAmount: 50_000, goodsDecision: "KEMBALI_STOK", paybackAmount: 50_000 });
    expect((await kembaliBebanTerbukaPerOrang(prisma, [spgId])).get(spgId)?.map((k) => k.jumlah)).toEqual([50_000]);
    const bayar = (ref: string) =>
      runSerializable((tx) =>
        catatPengembalianBebanDibayar(tx, { olehUserId: kantorId, waktu: new Date(), bulanBayar: "2026-12", paidRefType: "SpgCommission", paidRefId: ref, kembali: [{ chargeId: c.id, jumlah: 50_000 }] }),
      );
    await bayar(`${tag}-bayar-1`);
    await expect(bayar(`${tag}-bayar-2`)).rejects.toThrow();
    const sesudah = await baca(c.id);
    expect([sesudah.paybackPaidRefId, sesudah.paybackPayoutMonth]).toEqual([`${tag}-bayar-1`, "2026-12"]);
    expect((await kembaliBebanTerbukaPerOrang(prisma, [spgId])).get(spgId) ?? []).toEqual([]);
  });

  it("P81 amount change: reason required, refused for the charged SPG and after any deduction, audited", async () => {
    const c = await buatBeban(50_000);
    const ubah = (besar: unknown, alasan: unknown, oleh = kantorId) => ubahBesarBebanSpg({ returnId: c.sourceId, olehUserId: oleh, besar, alasan });
    expect(await ubah(40_000, " ")).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await ubah(0, "struk")).toEqual({ ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" });
    expect(await ubah(40_000, "struk", spgId)).toEqual({ ok: false, alasan: "PELAPOR_SAMA" });
    expect(await ubah(50_000, "struk")).toEqual({ ok: false, alasan: "SAMA" });
    expect(await ubah(40_000, "struk kasir")).toMatchObject({ ok: true, chargeId: c.id });
    expect([Number((await baca(c.id)).amount), (await baca(c.id)).amountReason]).toEqual([40_000, "struk kasir"]);
    expect((await prisma.auditLog.findMany({ where: { entityId: seededId(c.id) } })).map((a) => a.action)).toEqual([JEJAK.BEBAN_SPG_DIUBAH]);
    await potong(c.id, 1_000, `${tag}-bayar-1`);
    expect(await ubah(30_000, "lagi")).toEqual({ ok: false, alasan: "SUDAH_DIPOTONG" });
    expect(await ubahBesarBebanSpg({ returnId: `${tag}-tidak-ada`, olehUserId: kantorId, besar: 1, alasan: "x" })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
  });

  it("race: amount change vs a deduction — exactly one applies", async () => {
    const c = await buatBeban(50_000);
    const [u, p] = await Promise.allSettled([
      ubahBesarBebanSpg({ returnId: c.sourceId, olehUserId: kantorId, besar: 40_000, alasan: "struk" }),
      tunda(5).then(() => potong(c.id, 50_000, `${tag}-bayar-1`)),
    ]);
    const sesudah = await baca(c.id);
    const dipotong = await prisma.spgChargeDeduction.count({ where: { chargeId: seededId(c.id) } });
    if (Number(sesudah.amount) === 40_000) {
      expect(u.status === "fulfilled" && u.value.ok).toBe(true);
      expect(dipotong).toBe(0);
    } else {
      expect(p.status).toBe("fulfilled");
      expect(u.status === "fulfilled" ? u.value : null).toEqual({ ok: false, alasan: "SUDAH_DIPOTONG" });
      expect(dipotong).toBe(1);
    }
  });
});
