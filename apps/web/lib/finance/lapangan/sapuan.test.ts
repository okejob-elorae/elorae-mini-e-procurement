import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Pencari sapuan tukar barang di basis data sungguhan (uji akuntansi gelombang
 * 2, bug 3): tukar yang biayanya SEIMBANG tidak pernah berjurnal
 * (`NOTHING_TO_POST`), jadi tidak boleh dihitung "dokumen tanpa jurnal" —
 * kalau dihitung, bulannya tidak pernah bisa ditutup. Data tes sendiri,
 * tahun 2002; tanggal mulai buku besar ditiru.
 */

const h = vi.hoisted(() => ({ mulai: new Date("2002-01-01T00:00:00+07:00") as Date | null }));
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));

import { cariTukarTanpaJurnal } from "./sapuan";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `UJTK-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T10:00:00+07:00`);

d("pencari sapuan tukar barang (test bed only)", () => {
  let userId = "";
  let uomId = "";
  let tokoId = "";
  let barangIds: string[] = [];
  let tukarIds: string[] = [];
  let adjIds: string[] = [];
  let urut = 0;
  let seimbang = "";
  let berselisih = "";
  let tanpaBiaya = "";
  let berselisihKedua = "";

  /** Tukar SELESAI dengan baris masuk/keluar; `biaya` = [biaya masuk, biaya keluar] per pcs, null = tanpa penyesuaian stok. */
  async function tukar(tanggal: string, biaya: [number, number] | null): Promise<string> {
    const x = await prisma.storeExchange.create({
      data: { docNo: `${tag}-TKR-${++urut}`, storeId: tokoId, salesmanId: userId, status: "SELESAI", completedAt: wib(tanggal) },
    });
    tukarIds.push(x.id);
    const masuk = await prisma.storeExchangeLine.create({ data: { exchangeId: x.id, direction: "MASUK", itemId: barangIds[0], productName: "L", qty: 1 } });
    const keluar = await prisma.storeExchangeLine.create({ data: { exchangeId: x.id, direction: "KELUAR", itemId: barangIds[1], productName: "S", qty: 1 } });
    if (biaya) {
      for (const [l, qty, b, barang] of [
        [masuk, 1, biaya[0], barangIds[0]],
        [keluar, -1, biaya[1], barangIds[1]],
      ] as const) {
        const a = await prisma.stockAdjustment.create({
          data: {
            docNumber: `${tag}-ADJ-${++urut}`,
            itemId: barang,
            type: qty > 0 ? "POSITIVE" : "NEGATIVE",
            qtyChange: qty,
            reason: "uji tukar",
            prevQty: 10,
            newQty: 10 + qty,
            prevAvgCost: b,
            newAvgCost: b,
            source: qty > 0 ? "STORE_EXCHANGE_IN" : "STORE_EXCHANGE_OUT",
            idempotencyKey: `tukar:${l.id}`,
          },
        });
        adjIds.push(a.id);
      }
    }
    return x.id;
  }

  beforeAll(async () => {
    userId = "";
    uomId = "";
    tokoId = "";
    barangIds = [];
    tukarIds = [];
    adjIds = [];
    const u = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    const uom = await prisma.uOM.findFirst({ select: { id: true } });
    if (!u || !uom) throw new Error("Basis data uji butuh satu pengguna dan satu satuan");
    userId = u.id;
    uomId = uom.id;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    for (const sku of ["L", "S"]) {
      barangIds.push(
        (await prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: `${tag} Gamis ${sku}`, nameEn: `${tag} Gamis ${sku}`, type: "FINISHED_GOOD", uomId } })).id,
      );
    }
    seimbang = await tukar("2002-04-02", [91_528.53, 91_528.53]);
    berselisih = await tukar("2002-04-03", [40_000, 55_000]);
    tanpaBiaya = await tukar("2002-04-04", null);
    berselisihKedua = await tukar("2002-04-05", [30_000, 31_000]);
  });

  afterAll(async () => {
    if (adjIds.length) await prisma.stockAdjustment.deleteMany({ where: { id: { in: seededIds(adjIds) } } });
    if (tukarIds.length) {
      await prisma.storeExchangeLine.deleteMany({ where: { exchangeId: { in: seededIds(tukarIds) } } });
      await prisma.storeExchange.deleteMany({ where: { id: { in: seededIds(tukarIds) } } });
    }
    if (barangIds.length) await prisma.item.deleteMany({ where: { id: { in: seededIds(barangIds) } } });
    if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  });

  const opsi = (batas = 50, ids?: string[]) => ({ sejak: wib("2002-04-01"), sampai: wib("2002-04-30"), batas, ...(ids ? { ids } : {}) });

  it("tukar bernilai seimbang tidak dihitung tanpa jurnal; yang berselisih dan yang biayanya belum diketahui tetap dihitung", async () => {
    const ids = (await cariTukarTanpaJurnal(opsi())).map((x) => x.id).filter((id) => tukarIds.includes(id));
    expect(ids).not.toContain(seimbang);
    expect(ids).toEqual([berselisih, tanpaBiaya, berselisihKedua]);
  });

  it("cakupan `ids` diterapkan sebelum batas", async () => {
    expect((await cariTukarTanpaJurnal(opsi(1, [berselisihKedua]))).map((x) => x.id)).toEqual([berselisihKedua]);
    expect(await cariTukarTanpaJurnal(opsi(5, [seimbang]))).toEqual([]);
    expect(await cariTukarTanpaJurnal(opsi(5, []))).toEqual([]);
  });
});
