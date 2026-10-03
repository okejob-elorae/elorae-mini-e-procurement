import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Pemicu "barang titipan sudah datang" terhadap basis data uji. Modul kabar
 * dipalsukan: yang diuji SIAPA yang dikabari dan BERAPA kali, bukan pengiriman
 * push-nya.
 */

const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; data: Record<string, string>; isi: string }[], gagal: false }));

vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { TITIP_PESAN_TERSEDIA: "TITIP_PESAN_TERSEDIA" },
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; data: Record<string, string>; isi: string }) => {
    if (kabar.gagal) throw new Error("push mati");
    kabar.kirim.push({ userId, jenis: k.jenis, data: k.data, isi: k.isi });
  }),
}));

import { kabariTitipanTersedia, susunKabarTersedia, tandaiTitipanTersedia } from "./titip-tersedia";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `TTS-${Math.random().toString(36).slice(2, 9)}`;

describe("susunKabarTersedia", () => {
  const baru = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, barang: `Barang ${i}`, pembeli: "Rina" }));

  it("sends one notice per request up to the cap", () => {
    const k = susunKabarTersedia(baru(10));
    expect(k).toHaveLength(10);
    expect(k.map((x) => x.data.requestId)).toEqual(baru(10).map((b) => b.id));
  });

  it("folds the rest into one summary without a request id beyond the cap", () => {
    const k = susunKabarTersedia(baru(14));
    expect(k).toHaveLength(10);
    expect(k.slice(0, 9).every((x) => x.data.requestId)).toBe(true);
    expect(k[9].data).toEqual({});
    expect(k[9].isi).toContain("5 titip pesan lain");
  });

  it("never names a price", () => {
    for (const x of susunKabarTersedia(baru(3))) expect(x.isi).not.toMatch(/Rp|harga/i);
  });
});

d("kabariTitipanTersedia (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let toko = "";
  let tokoLain = "";
  let spg1 = "";
  let spg2 = "";
  let spgLain = "";
  let pembeli = "";
  let pembeliLain = "";
  let kunciKe = 0;

  const tokoIds = () => seededIds([toko, tokoLain].filter(Boolean));
  const userIds = () => seededIds([spg1, spg2, spgLain].filter(Boolean));

  beforeAll(async () => {
    uomId = "";
    kaos = "";
    toko = "";
    tokoLain = "";
    spg1 = "";
    spg2 = "";
    spgLain = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          variants: [
            { sku: `${tag}-KAOS-M`, size: "M" },
            { sku: `${tag}-KAOS-L`, size: "L" },
          ],
        },
      })
    ).id;
    toko = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    const pengguna = async (n: string, storeId: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    spg1 = await pengguna("spg1", toko);
    spg2 = await pengguna("spg2", toko);
    spgLain = await pengguna("spg3", tokoLain);
  });

  beforeEach(async () => {
    pembeli = "";
    pembeliLain = "";
    kabar.kirim = [];
    kabar.gagal = false;
    pembeli = (await prisma.storeCustomer.create({ data: { storeId: toko, name: "Rina", phone: "6281200000001", consentAt: new Date(), createdById: spg1 } })).id;
    pembeliLain = (await prisma.storeCustomer.create({ data: { storeId: tokoLain, name: "Sari", phone: "6281200000002", consentAt: new Date(), createdById: spgLain } })).id;
  });

  afterEach(async () => {
    await prisma.customerRequest.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeCustomer.deleteMany({ where: { id: { in: seededIds([pembeli, pembeliLain].filter(Boolean)) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const minta = async (data: { storeId?: string; customerId?: string; itemId?: string | null; variantSku?: string; description?: string; status?: string }) =>
    (
      await prisma.customerRequest.create({
        data: {
          storeId: data.storeId ?? toko,
          customerId: data.customerId ?? pembeli,
          itemId: data.itemId === undefined ? kaos : data.itemId,
          variantSku: data.variantSku ?? `${tag}-KAOS-L`,
          description: data.description ?? "Kaos Uji L",
          status: data.status ?? "MENUNGGU",
          createdById: spg1,
          idempotencyKey: `${tag}-k${kunciKe++}`,
        },
      })
    ).id;

  const stok = (storeId: string, variantSku: string, qty: number) =>
    prisma.storeStockMovement.create({ data: { storeId, itemId: kaos, variantSku, qty, kind: "TERIMA", createdById: spg1 } });

  const status = async (id: string) => (await prisma.customerRequest.findUniqueOrThrow({ where: { id } })).status;

  it("marks only requests whose goods are now in THIS store, and tells every SPG of that store", async () => {
    const ada = await minta({});
    const variLain = await minta({ variantSku: `${tag}-KAOS-M` });
    const bebas = await minta({ itemId: null, variantSku: "", description: "Jaket parasut" });
    const tokoB = await minta({ storeId: tokoLain, customerId: pembeliLain });
    await stok(toko, `${tag}-KAOS-L`, 2);
    await stok(tokoLain, `${tag}-KAOS-M`, 0);

    await kabariTitipanTersedia(toko);

    expect(await status(ada)).toBe("TERSEDIA");
    expect((await prisma.customerRequest.findUniqueOrThrow({ where: { id: ada } })).availableAt).not.toBeNull();
    expect(await status(variLain)).toBe("MENUNGGU");
    expect(await status(bebas)).toBe("MENUNGGU");
    expect(await status(tokoB)).toBe("MENUNGGU");
    expect(kabar.kirim.map((k) => k.userId).sort()).toEqual([spg1, spg2].sort());
    expect(kabar.kirim.every((k) => k.jenis === "TITIP_PESAN_TERSEDIA" && k.data.requestId === ada)).toBe(true);
    expect(kabar.kirim[0].isi).toContain("Rina");

    // Pemicu berikutnya tidak mengabarkan ulang yang sudah TERSEDIA.
    kabar.kirim = [];
    await kabariTitipanTersedia(toko);
    expect(kabar.kirim).toHaveLength(0);
  });

  it("matches an empty variant to any variant on the shelf", async () => {
    const id = await minta({ variantSku: "" });
    await stok(toko, `${tag}-KAOS-M`, 1);
    await kabariTitipanTersedia(toko);
    expect(await status(id)).toBe("TERSEDIA");
  });

  it("does nothing while the balance is zero or negative", async () => {
    const id = await minta({});
    await stok(toko, `${tag}-KAOS-L`, 1);
    await stok(toko, `${tag}-KAOS-L`, -1);
    await kabariTitipanTersedia(toko);
    expect(await status(id)).toBe("MENUNGGU");
    expect(kabar.kirim).toHaveLength(0);
  });

  it("caps the notices per SPG at ten", async () => {
    for (let i = 0; i < 12; i++) await minta({});
    await stok(toko, `${tag}-KAOS-L`, 5);
    await kabariTitipanTersedia(toko);
    expect(await prisma.customerRequest.count({ where: { storeId: toko, status: "TERSEDIA" } })).toBe(12);
    const keSpg1 = kabar.kirim.filter((k) => k.userId === spg1);
    expect(keSpg1).toHaveLength(10);
    expect(keSpg1.filter((k) => !k.data.requestId)).toHaveLength(1);
  });

  it("never throws — a failing push leaves the status written", async () => {
    const id = await minta({});
    await stok(toko, `${tag}-KAOS-L`, 1);
    kabar.gagal = true;
    await expect(kabariTitipanTersedia(toko)).resolves.toBeUndefined();
    expect(await status(id)).toBe("TERSEDIA");
    await expect(kabariTitipanTersedia("toko-yang-tidak-ada")).resolves.toBeUndefined();
  });

  it("race: two triggers at once mark each request exactly once", async () => {
    const ids = [await minta({}), await minta({}), await minta({ variantSku: "" })];
    await stok(toko, `${tag}-KAOS-L`, 3);
    const [a, b] = await Promise.all([tandaiTitipanTersedia(toko), tandaiTitipanTersedia(toko)]);
    const semua = [...a, ...b].map((x) => x.id).sort();
    expect(semua).toEqual([...ids].sort());
    for (const id of ids) expect(await status(id)).toBe("TERSEDIA");
  });
});
