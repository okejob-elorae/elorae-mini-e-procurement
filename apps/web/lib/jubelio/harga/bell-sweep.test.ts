import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { JUBELIO_PRICE_DIFFERS } from "./aturan";
import { runJubelioPriceDiffBellSweep } from "./bell-sweep";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Lonceng "Harga di Jubelio berbeda dengan ERP" (jawaban pemilik P2, 2026-11-02): satu pemberitahuan
 * per barang per perubahan bacaan Jubelio. Sapuannya SELALU dibatasi barang milik tes ini.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("runJubelioPriceDiffBellSweep (test bed only)", () => {
  const fx = buatFixtureHarga();
  const tadi = new Date("2026-11-03T01:00:00.000Z");
  const beda = { terpetakan: true, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 125_000, jubelioTerendah: 120_000 };

  beforeEach(async () => {
    await fx.siapkan();
  });

  /** Pemberitahuan milik barang tes ini — dicocokkan di JS (penyaring jalur JSON tidak andal di antara adaptor). */
  async function pemberitahuan(): Promise<Array<{ id: string; itemId: string; berubahPada: string }>> {
    const milik = new Set(fx.keadaan.itemIds);
    const rows = await prisma.adminNotification.findMany({ where: { category: JUBELIO_PRICE_DIFFERS }, select: { id: true, metadata: true } });
    return rows
      .map((r) => ({ id: r.id, m: r.metadata as { itemId?: unknown; berubahPada?: unknown } | null }))
      .filter((r) => typeof r.m?.itemId === "string" && milik.has(r.m.itemId))
      .map((r) => ({ id: r.id, itemId: r.m!.itemId as string, berubahPada: String(r.m!.berubahPada ?? "") }));
  }

  afterEach(async () => {
    const milik = await pemberitahuan();
    await prisma.adminNotification.deleteMany({ where: { id: { in: milik.map((r) => seededId(r.id)) } } });
    await fx.bersihkan();
  });

  it("mengumumkan sekali, tidak dua kali untuk bacaan yang sama", async () => {
    const id = await fx.barang(beda);
    expect(await runJubelioPriceDiffBellSweep({ itemIds: [id] })).toMatchObject({ scanned: 1, announced: 1 });
    expect(await runJubelioPriceDiffBellSweep({ itemIds: [id] })).toMatchObject({ scanned: 1, announced: 0 });
    const rows = await pemberitahuan();
    expect(rows).toEqual([{ id: expect.any(String), itemId: id, berubahPada: tadi.toISOString() }]);
  });

  it("perubahan baru di Jubelio diumumkan lagi", async () => {
    const id = await fx.barang(beda);
    await runJubelioPriceDiffBellSweep({ itemIds: [id] });
    const lagi = new Date("2026-11-03T02:00:00.000Z");
    await prisma.item.update({ where: { id: seededId(id) }, data: { jubelioObservedPriceMax: 130_000, jubelioObservedAt: lagi, jubelioObservedChangedAt: lagi } });
    expect(await runJubelioPriceDiffBellSweep({ itemIds: [id] })).toMatchObject({ announced: 1 });
    expect((await pemberitahuan()).map((r) => r.berubahPada).sort()).toEqual([tadi.toISOString(), lagi.toISOString()]);
  });

  it("batas per putaran menunda sisanya; barang yang tidak beda tidak pernah diumumkan", async () => {
    const a = await fx.barang(beda);
    const b = await fx.barang(beda);
    const sama = await fx.barang({ ...beda, jubelioTertinggi: 100_000, jubelioTerendah: 100_000 });
    expect(await runJubelioPriceDiffBellSweep({ itemIds: [a, b, sama], maxAnnouncementsPerRun: 1 })).toMatchObject({
      scanned: 2,
      announced: 1,
      deferred: 1,
    });
    expect(await runJubelioPriceDiffBellSweep({ itemIds: [a, b, sama], maxAnnouncementsPerRun: 1 })).toMatchObject({ announced: 1, deferred: 0 });
    expect((await pemberitahuan()).map((r) => r.itemId).sort()).toEqual([a, b].sort());
  });
});
