import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { recordVanSale } from "./sale-writer";
import { bacaSimpananKeranjangVan, kirimPenjualanVan } from "@/app/pwa/van/keranjang";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Layar jual van mengirim ulang dengan kunci kirim yang SAMA setelah sinyal
 * putus atau halaman dimuat ulang (kuncinya disimpan di sessionStorage HP).
 * Penjualan yang sudah tercatat harus dikembalikan, bukan dicatat lagi —
 * termasuk ketika dua kiriman tiba bersamaan (ketuk ganda + kirim ulang
 * otomatis peramban).
 *
 * Salesman DIPINJAM dari seed; barang, satuan, dan stok van dibuat sendiri;
 * setiap penghapusan lewat `seededId()`/`seededIds()`.
 */
d("recordVanSale — kirim ulang dengan kunci sama (test bed only)", () => {
  const tag = `VKU-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let salesmanId = "";
  let kunci = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    salesmanId = "";
    kunci = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
    const uom = await prisma.uOM.create({ data: { code: `U-${kunci}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: kunci, nameId: "Kaos uji van", nameEn: "Van test tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
    });
    itemId = item.id;
    const s = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    salesmanId = s.id;
    await prisma.vanStock.create({ data: { userId: salesmanId, itemId, variantSku: "", qty: 20, avgCost: 2000 } });
  });

  afterEach(async () => {
    // Hanya baris milik tes ini: penjualan dicari lewat kunci kirimnya sendiri.
    const sales = await prisma.vanSale.findMany({ where: { idempotencyKey: seededId(kunci) }, select: { id: true, docNo: true } });
    const saleIds = sales.map((s) => s.id);
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.vanSaleLine.deleteMany({ where: { vanSaleId: { in: seededIds(saleIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.vanStock.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const baris = (qty: number) => [{ itemId, variantSku: null, qty }];
  const stokVan = async () => Number((await prisma.vanStock.findFirstOrThrow({ where: { userId: salesmanId, itemId } })).qty);
  const jumlahPenjualan = () => prisma.vanSale.count({ where: { idempotencyKey: seededId(kunci) } });
  const jumlahRiwayat = () => prisma.salesHistory.count({ where: { itemId: seededId(itemId) } });

  it("dua kiriman berurutan dengan kunci sama → satu VanSale, stok van berkurang sekali", async () => {
    const a = await recordVanSale({ salesmanId, lines: baris(3), amountPaid: 20000, idempotencyKey: kunci });
    const b = await recordVanSale({ salesmanId, lines: baris(3), amountPaid: 20000, idempotencyKey: kunci });
    if (!a.ok || !b.ok) throw new Error("kedua kiriman harus ok");
    expect(b.saleId).toBe(a.saleId);
    expect(b.docNo).toBe(a.docNo);
    expect(b.changeAmount).toBe(5000); // 3 × 5.000 = 15.000; dibayar 20.000
    expect(await jumlahPenjualan()).toBe(1);
    expect(await stokVan()).toBe(17); // 20 − 3, sekali
    expect(await jumlahRiwayat()).toBe(1);
  });

  it("kiriman ulang dengan keranjang berubah tetap mengembalikan penjualan pertama, tidak mencatat yang kedua", async () => {
    const a = await recordVanSale({ salesmanId, lines: baris(3), amountPaid: 15000, idempotencyKey: kunci });
    const b = await recordVanSale({ salesmanId, lines: baris(5), amountPaid: 25000, idempotencyKey: kunci });
    if (!a.ok || !b.ok) throw new Error("kedua kiriman harus ok");
    expect(b.saleId).toBe(a.saleId);
    expect(b.changeAmount).toBe(0); // angka penjualan pertama, bukan kiriman kedua
    expect(await jumlahPenjualan()).toBe(1);
    expect(await stokVan()).toBe(17);
  });

  it("layar HP: jawaban pertama hilang setelah server mencatat, kirim ulang dari simpanan → satu VanSale, simpanan terhapus", async () => {
    const isi = new Map<string, string>();
    const sesi = { getItem: (k: string) => isi.get(k) ?? null, setItem: (k: string, v: string) => void isi.set(k, v), removeItem: (k: string) => void isi.delete(k) };
    const simpanan = { idempotencyKey: kunci, baris: [{ itemId, variantSku: "", qty: 2 }], mode: "adhoc" as const, storeId: "", uangDiterima: "10000" };
    // Kirim lewat writer sungguhan; hasilnya dibentuk seperti aksi server.
    const catat = async (k: string) => {
      const r = await recordVanSale({ salesmanId, lines: baris(2), amountPaid: 10000, idempotencyKey: k });
      return r.ok ? r : { ok: false as const, reason: r.code };
    };

    const pertama = await kirimPenjualanVan({
      penyimpanan: sesi,
      userId: salesmanId,
      simpanan,
      kirim: async (k) => {
        await catat(k);
        throw new TypeError("Failed to fetch"); // server sudah menulis, jawabannya tidak sampai
      },
    });
    expect(pertama).toEqual({ jenis: "terputus" });
    expect(await jumlahPenjualan()).toBe(1);
    const tersimpan = bacaSimpananKeranjangVan(sesi, salesmanId);
    expect(tersimpan?.idempotencyKey).toBe(kunci);

    const kedua = await kirimPenjualanVan({ penyimpanan: sesi, userId: salesmanId, simpanan: tersimpan!, kirim: catat });
    expect(kedua.jenis).toBe("tercatat");
    expect(await jumlahPenjualan()).toBe(1);
    expect(await stokVan()).toBe(18); // 20 − 2, sekali
    expect(bacaSimpananKeranjangVan(sesi, salesmanId)).toBeNull();
  });

  it("dua kiriman BERSAMAAN dengan kunci sama → satu VanSale, stok van berkurang sekali", async () => {
    const [a, b] = await Promise.all([
      recordVanSale({ salesmanId, lines: baris(4), amountPaid: 20000, idempotencyKey: kunci }),
      recordVanSale({ salesmanId, lines: baris(4), amountPaid: 20000, idempotencyKey: kunci }),
    ]);
    if (!a.ok || !b.ok) throw new Error("kedua kiriman harus ok");
    expect(b.saleId).toBe(a.saleId);
    expect(await jumlahPenjualan()).toBe(1);
    expect(await stokVan()).toBe(16); // 20 − 4, sekali
    expect(await jumlahRiwayat()).toBe(1);
  });
});
