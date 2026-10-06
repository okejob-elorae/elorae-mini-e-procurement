import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
import { applyMatchJubelio, runReconciliation, tersediaErpUntukPemetaan } from "./reconciliation-runner";

// Snapshot Jubelio datang dari apps/api; di tes diganti angka tetap.
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));

/*
 * Rekonsiliasi Jubelio membandingkan AVAILABLE, bukan qtyOnHand (BOUNDARY §3.1/D6):
 * ERP mendorong `available = onHand − reserved` (minimal 0) ke Jubelio, jadi qty Jubelio
 * dalam satuan available. Membandingkan onHand menandai setiap barang bercadangan selisih
 * sebesar `reservedQty`, dan MATCH_JUBELIO menulis onHand = qty Jubelio — menghapus
 * cadangan dari stok fisik (kerusakan yang sama dengan gema webhook stok).
 */

describe("tersediaErpUntukPemetaan — angka ERP yang dibandingkan dengan Jubelio", () => {
  const baris = (variantSku: string | null, qtyOnHand: number, reservedQty: number) => ({ variantSku, qtyOnHand, reservedQty });

  it("onHand 10, ditahan 3 → 7 (sama dengan yang didorong ke Jubelio), bukan 10", () => {
    expect(tersediaErpUntukPemetaan([baris("SKU-A", 10, 3)], "SKU-A")).toBe(7);
  });

  it("oversell (onHand 1, ditahan 3) → 0, seperti push yang meng-clamp di 0", () => {
    expect(tersediaErpUntukPemetaan([baris("SKU-A", 1, 3)], "SKU-A")).toBe(0);
  });

  it("barang sederhana dengan baris kembar null (3, ditahan 1) + \"\" (4) → 6, dijumlah lalu di-clamp", () => {
    expect(tersediaErpUntukPemetaan([baris(null, 3, 1), baris("", 4, 0)], "")).toBe(6);
    expect(tersediaErpUntukPemetaan([baris(null, 5, 0), baris("", 0, 7)], "")).toBe(0);
  });

  it("hanya baris varian pemetaan itu yang dihitung (kunci dipangkas, abai huruf)", () => {
    const stok = [baris("sku-a ", 5, 1), baris("SKU-B", 9, 0), baris(null, 30, 0)];
    expect(tersediaErpUntukPemetaan(stok, "SKU-A")).toBe(4);
    expect(tersediaErpUntukPemetaan(stok, "SKU-B")).toBe(9);
  });

  it("pemetaan barang sederhana tidak memungut baris varian (push juga tidak mengirimnya)", () => {
    expect(tersediaErpUntukPemetaan([baris("SKU-A", 5, 0)], "")).toBe(0);
  });

  it("tanpa baris stok → 0", () => {
    expect(tersediaErpUntukPemetaan([], "SKU-A")).toBe(0);
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("applyMatchJubelio — menyamakan AVAILABLE dengan Jubelio (test bed only)", () => {
  let tag = "";
  let uomId = "";
  let itemId = "";
  let runId = "";

  beforeEach(async () => {
    tag = Math.random().toString(36).slice(2, 9);
    uomId = "";
    itemId = "";
    runId = `recon-uji-${tag}`;
    uomId = (await prisma.uOM.create({ data: { code: `U-RC-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `RC-${tag}`, nameId: `Kaos Rekon ${tag}`, nameEn: "Recon tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { refType: "RECON", refId: seededId(runId) } });
    await prisma.stockAdjustment.deleteMany({ where: { externalRef: seededId(runId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const stokBaris = (variantSku: string | null, qtyOnHand: number, reservedQty: number, avgCost = 20_000) =>
    prisma.inventoryValue.create({
      data: { itemId, variantSku, qtyOnHand, reservedQty, avgCost, totalValue: qtyOnHand * avgCost },
    });
  const samakan = (variantSku: string, tersediaJubelio: number) =>
    prisma.$transaction((tx) =>
      applyMatchJubelio(tx, { runId, itemId, variantSku, itemName: `Kaos Rekon ${tag}`, tersediaJubelio }),
    );
  const stok = async () =>
    (
      await prisma.inventoryValue.findMany({
        where: { itemId: seededId(itemId) },
        select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true },
        orderBy: { variantSku: "asc" },
      })
    ).map((r) => ({ variantSku: r.variantSku, onHand: Number(r.qtyOnHand), ditahan: Number(r.reservedQty), nilai: Number(r.totalValue) }));
  const penyesuaian = () =>
    prisma.stockAdjustment.findMany({
      where: { externalRef: seededId(runId) },
      select: { type: true, qtyChange: true, prevQty: true, newQty: true, source: true },
    });

  it("onHand 10, ditahan 3, Jubelio 7 → sudah selaras: onHand tetap 10, tanpa penyesuaian", async () => {
    await stokBaris("SKU-A", 10, 3);

    await samakan("SKU-A", 7);

    expect(await stok()).toEqual([{ variantSku: "SKU-A", onHand: 10, ditahan: 3, nilai: 200_000 }]);
    expect(await penyesuaian()).toHaveLength(0);
  });

  it("onHand 10, ditahan 3, Jubelio 5 → onHand 8 (tersedia 5), ditahan tetap 3; penyesuaian −2 dan kartu stok", async () => {
    await stokBaris("SKU-A", 10, 3);

    await samakan("SKU-A", 5);

    expect(await stok()).toEqual([{ variantSku: "SKU-A", onHand: 8, ditahan: 3, nilai: 160_000 }]);
    const [adj, ...lain] = await penyesuaian();
    expect(lain).toHaveLength(0);
    expect({ ...adj, qtyChange: Number(adj.qtyChange), prevQty: Number(adj.prevQty), newQty: Number(adj.newQty) }).toEqual({
      type: "NEGATIVE",
      qtyChange: 2,
      prevQty: 10,
      newQty: 8,
      source: "JUBELIO_RECONCILE",
    });
    const gerak = await prisma.stockMovement.findMany({ where: { refType: "RECON", refId: seededId(runId) } });
    expect(gerak.map((g) => [Number(g.qty), Number(g.balanceQty), g.variantSku])).toEqual([[-2, 8, "SKU-A"]]);
  });

  it("oversell onHand 1, ditahan 4, Jubelio 0 → sudah selaras (push juga mengirim 0): tidak menambah 3 pcs fiktif", async () => {
    await stokBaris("SKU-A", 1, 4);

    await samakan("SKU-A", 0);

    expect(await stok()).toEqual([{ variantSku: "SKU-A", onHand: 1, ditahan: 4, nilai: 20_000 }]);
    expect(await penyesuaian()).toHaveLength(0);
  });

  it("onHand 10, ditahan 3, Jubelio 0 → onHand 3 (tersedia 0, cadangan tetap tertutup)", async () => {
    await stokBaris("SKU-A", 10, 3);

    await samakan("SKU-A", 0);

    expect((await stok())[0]).toMatchObject({ onHand: 3, ditahan: 3 });
    expect(await penyesuaian()).toHaveLength(1);
  });

  it("dijalankan dua kali dengan run yang sama → tidak menumpuk (onHand tetap 8)", async () => {
    await stokBaris("SKU-A", 10, 3);

    await samakan("SKU-A", 5);
    await samakan("SKU-A", 5);

    expect((await stok())[0].onHand).toBe(8);
    expect(await penyesuaian()).toHaveLength(1);
  });

  it("barang sederhana dengan baris variantSku null (dulu dilewati diam-diam): onHand 4, ditahan 1, Jubelio 6 → onHand 7", async () => {
    await stokBaris(null, 4, 1);

    await samakan("", 6);

    expect(await stok()).toEqual([{ variantSku: null, onHand: 7, ditahan: 1, nilai: 140_000 }]);
    expect(await penyesuaian()).toHaveLength(1);
  });

  it("baris kembar null 5 / \"\" 0 ditahan 2, Jubelio 1 → selisih −2 ditulis ke baris terbesar (null 5 → 3), tersedia total 1", async () => {
    await stokBaris(null, 5, 0);
    await stokBaris("", 0, 2);

    await samakan("", 1);

    const hasil = await stok();
    expect(hasil.map((r) => [r.variantSku, r.onHand, r.ditahan]).sort()).toEqual(
      [
        ["", 0, 2],
        [null, 3, 0],
      ].sort(),
    );
    const total = hasil.reduce((s, r) => s + r.onHand - r.ditahan, 0);
    expect(total).toBe(1);
  });
});

d("runReconciliation — membandingkan available, bukan onHand (test bed only)", () => {
  let tag = "";
  let uomId = "";
  let itemId = "";
  let runId = "";
  let jubelioItemId = 0;

  beforeEach(async () => {
    tag = Math.random().toString(36).slice(2, 9);
    uomId = "";
    itemId = "";
    runId = "";
    jubelioItemId = 900_000_000 + Math.floor(Math.random() * 99_000_000);
    uomId = (await prisma.uOM.create({ data: { code: `U-RR-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `RR-${tag}`, nameId: `Kaos Rekon Jalan ${tag}`, nameEn: "Recon run tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: jubelioItemId, jubelioItemId, jubelioItemCode: `RR-${tag}-BLK-M`, erpVariantSku: `RR-${tag}-M` },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `RR-${tag}-M`, qtyOnHand: 10, reservedQty: 3, avgCost: 20_000, totalValue: 200_000 },
    });
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { refType: "RECON", refId: seededId(runId) } });
    await prisma.stockAdjustment.deleteMany({ where: { externalRef: seededId(runId) } });
    await prisma.reconciliationResult.deleteMany({ where: { runId: seededId(runId) } });
    await prisma.reconciliationRun.deleteMany({ where: { id: seededId(runId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const jalankan = async (jubelioQty: number) => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { rows: [{ itemId, variantSku: `RR-${tag}-M`, jubelioItemId, jubelioQty }] },
    } as never);
    const hasil = await runReconciliation("MANUAL", undefined, { itemIds: [itemId] });
    runId = hasil.runId;
    expect(hasil.skipped).toBeUndefined();
    const baris = await prisma.reconciliationResult.findMany({ where: { runId: seededId(runId) } });
    return { hasil, baris };
  };

  it("onHand 10, ditahan 3, Jubelio 7 → IN_SYNC, Qty Elorae 7, selisih 0 (dulu FLAGGED selisih 3)", async () => {
    const { hasil, baris } = await jalankan(7);

    expect(hasil).toMatchObject({ inSync: 1, flagged: 0, autoCorrected: 0 });
    expect(baris.map((b) => [Number(b.eloraeQty), Number(b.jubelioQty), Number(b.variance), b.action])).toEqual([[7, 7, 0, "IN_SYNC"]]);
  });

  it("Jubelio 5 → selisih 2 (7 − 5), bukan 5 (10 − 5)", async () => {
    const { baris } = await jalankan(5);

    expect(baris.map((b) => [Number(b.eloraeQty), Number(b.variance)])).toEqual([[7, 2]]);
    expect(baris[0].action).not.toBe("IN_SYNC");
  });
});
