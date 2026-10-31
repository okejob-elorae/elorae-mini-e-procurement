import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Penulis rekomendasi terhadap basis data uji: membuat (izin pembuat,
 * idempotensi, varian), semua transisi, dan balapan SPG menerima vs salesman
 * membatalkan. Kabar dipalsukan supaya penerimanya bisa diperiksa.
 *
 * Semua baris milik fixture buatan tes (kode acak); teardown hanya lewat id
 * yang diseed. Pengaturan kunci toko TIDAK diubah (pengaturan bersama) — tes
 * toko tanpa pemegang membaca nilainya dan mengharapkan hasil yang sesuai.
 */

const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; data: Record<string, string> }[] }));
// Tanpa modul aslinya: ia memuat Firebase admin, yang tidak dibutuhkan di sini.
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { REKOMENDASI_MASUK: "REKOMENDASI_MASUK", REKOMENDASI_DIJAWAB: "REKOMENDASI_DIJAWAB" },
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; data: Record<string, string> }) => {
    kabar.kirim.push({ userId, jenis: k.jenis, data: k.data });
  }),
}));

const { batalkanRekomendasi, buatRekomendasi, tandaiTokoSetuju, terimaRekomendasi, tolakRekomendasi } = await import("./rekomendasi");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `REK-${Math.random().toString(36).slice(2, 10)}`;

d("rekomendasi ke toko — penulis (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let spg = "";
  let spgLain = "";
  let kaos = "";
  let kemeja = "";
  let mati = "";
  let tokoSpg = "";
  let tokoTanpaSpg = "";
  let tokoTanpaPemegang = "";
  let tokoLain = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = "";
    sales = "";
    salesLain = "";
    spg = "";
    spgLain = "";
    kaos = "";
    kemeja = "";
    mati = "";
    tokoSpg = "";
    tokoTanpaSpg = "";
    tokoTanpaPemegang = "";
    tokoLain = "";

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (n: string, assignedStoreId?: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");

    const barang = async (kode: string, variants?: object[], isActive = true) =>
      (
        await prisma.item.create({
          data: { sku: `${tag}-${kode}`, nameId: `Barang ${kode}`, nameEn: kode, type: "FINISHED_GOOD", uomId, isActive, ...(variants ? { variants } : {}) },
        })
      ).id;
    kaos = await barang("KAOS", [
      { sku: `${tag}-KAOS-M`, size: "M", color: "Hitam" },
      { sku: `${tag}-KAOS-L`, size: "L", color: "Hitam" },
    ]);
    kemeja = await barang("KEMEJA");
    mati = await barang("MATI", undefined, false);
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaos, variantSku: `${tag}-KAOS-M`, qtyOnHand: 10, reservedQty: 0, avgCost: 0, totalValue: 0 },
        { itemId: kemeja, variantSku: null, qtyOnHand: 5, reservedQty: 0, avgCost: 0, totalValue: 0 },
      ],
    });

    const toko = async (kode: string, termsType: "PUTUS" | "KONSI", salesmanId: string | null) =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "x", termsType, salesmanId } })).id;
    tokoSpg = await toko("SPG", "KONSI", sales);
    tokoTanpaSpg = await toko("TANPA", "PUTUS", sales);
    tokoTanpaPemegang = await toko("BEBAS", "PUTUS", null);
    tokoLain = await toko("LAIN", "PUTUS", salesLain);
    spg = await pengguna("spg", tokoSpg);
    spgLain = await pengguna("spg2", tokoLain);
  });

  const tokoIds = () => seededIds([tokoSpg, tokoTanpaSpg, tokoTanpaPemegang, tokoLain].filter(Boolean));

  beforeEach(() => {
    kabar.kirim = [];
  });

  afterEach(async () => {
    const rek = await prisma.storeRecommendation.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const ids = rek.map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreRecommendation", entityId: { in: seededIds(ids) } } });
    await prisma.storeRecommendation.deleteMany({ where: { id: { in: seededIds(ids) } } });
  });

  afterAll(async () => {
    const itemIds = () => [kaos, kemeja, mati].filter(Boolean);
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(itemIds()) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds()) } } });
    // Toko dulu: Store.salesmanId menunjuk pengguna.
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain, spg, spgLain].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const baris = () => [
    { itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 6, alasan: "LAKU_DI_SINI" },
    { itemId: kemeja, variantSku: "", qty: 3, alasan: "LAKU_DI_TOKO_LAIN" },
  ];
  const buat = async (storeId = tokoSpg, oleh = sales) => {
    const r = await buatRekomendasi({ salesmanId: oleh, storeId, baris: baris(), catatan: "Isi rak depan", idempotencyKey: kunci() });
    if (!r.ok) throw new Error(`buat gagal: ${r.kode}`);
    return r.id;
  };
  const status = async (id: string) => (await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } })).status;
  const jejak = async (id: string) =>
    prisma.auditLog.findMany({ where: { entityType: "StoreRecommendation", entityId: seededId(id) }, orderBy: { createdAt: "asc" } });

  describe("membuat", () => {
    it("pemegang toko membuat: baris dengan nama + ukuran dari server, jejak, kabar ke SPG toko itu saja", async () => {
      const k = kunci();
      const r = await buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: baris(), catatan: " Isi rak depan ", idempotencyKey: k });
      expect(r).toMatchObject({ ok: true, ulang: false });
      if (!r.ok) return;

      const rek = await prisma.storeRecommendation.findUniqueOrThrow({ where: { id: r.id }, include: { lines: { orderBy: { productName: "asc" } } } });
      expect(rek).toMatchObject({ status: "TERKIRIM", salesmanId: sales, storeId: tokoSpg, note: "Isi rak depan", idempotencyKey: k });
      expect(rek.lines.map((l) => ({ productName: l.productName, variantSku: l.variantSku, qty: l.qty, alasan: l.alasan }))).toEqual([
        { productName: "Barang KAOS — Hitam · M", variantSku: `${tag}-KAOS-M`, qty: 6, alasan: "LAKU_DI_SINI" },
        { productName: "Barang KEMEJA", variantSku: "", qty: 3, alasan: "LAKU_DI_TOKO_LAIN" },
      ]);

      const j = await jejak(r.id);
      expect(j).toHaveLength(1);
      expect(j[0]).toMatchObject({ action: "STORE_RECOMMENDATION_SENT", userId: sales });
      expect(j[0].changes).toMatchObject({ after: { status: "TERKIRIM", pcs: 9 } });

      expect(kabar.kirim).toEqual([{ userId: spg, jenis: "REKOMENDASI_MASUK", data: { recommendationId: r.id } }]);
    });

    it("idempotensi diperiksa paling dulu: kiriman ulang mengembalikan yang sama (walau isinya kini tidak sah), kunci orang lain ditolak", async () => {
      const k = kunci();
      const a = await buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: baris(), idempotencyKey: k });
      kabar.kirim = [];
      const b = await buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: [], idempotencyKey: k });
      expect(a.ok && b.ok && b.id === a.id && b.ulang).toBe(true);
      expect(kabar.kirim).toEqual([]);
      if (a.ok) expect(await jejak(a.id)).toHaveLength(1);
      expect(await buatRekomendasi({ salesmanId: salesLain, storeId: tokoSpg, baris: baris(), idempotencyKey: k })).toEqual({
        ok: false,
        kode: "KUNCI_DIPAKAI",
      });
      expect(await buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: baris(), idempotencyKey: " " })).toEqual({ ok: false, kode: "KUNCI_WAJIB" });
    });

    it("dua kiriman kembar bersamaan tetap satu rekomendasi", async () => {
      const k = kunci();
      const [a, b] = await Promise.all([
        buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: baris(), idempotencyKey: k }),
        buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: baris(), idempotencyKey: k }),
      ]);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(a.id).toBe(b.id);
      expect(await prisma.storeRecommendation.count({ where: { idempotencyKey: k } })).toBe(1);
    });

    it("hanya pemegang toko; toko tanpa pemegang mengikuti kunci 'hanya toko sendiri'", async () => {
      expect(await buatRekomendasi({ salesmanId: salesLain, storeId: tokoSpg, baris: baris(), idempotencyKey: kunci() })).toEqual({
        ok: false,
        kode: "BUKAN_PEMEGANG",
      });
      const setelan = await prisma.systemSetting.findUnique({ where: { key: "salesman.tokoTerkunci" }, select: { value: true } });
      const r = await buatRekomendasi({ salesmanId: salesLain, storeId: tokoTanpaPemegang, baris: baris(), idempotencyKey: kunci() });
      if (setelan?.value === "1") expect(r).toEqual({ ok: false, kode: "BUKAN_PEMEGANG" });
      else expect(r).toMatchObject({ ok: true, ulang: false });
      expect(await buatRekomendasi({ salesmanId: sales, storeId: `tidak-ada-${tag}`, baris: baris(), idempotencyKey: kunci() })).toEqual({
        ok: false,
        kode: "TOKO_TIDAK_DITEMUKAN",
      });
    });

    it("varian harus milik barangnya; barang bervarian wajib berukuran; barang mati/asing ditolak", async () => {
      const coba = (b: object[]) => buatRekomendasi({ salesmanId: sales, storeId: tokoSpg, baris: b, idempotencyKey: kunci() });
      expect(await coba([{ itemId: kaos, variantSku: "", qty: 1 }])).toEqual({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
      expect(await coba([{ itemId: kaos, variantSku: `${tag}-KAOS-XXL`, qty: 1 }])).toEqual({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
      expect(await coba([{ itemId: kemeja, variantSku: "X", qty: 1 }])).toEqual({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
      expect(await coba([{ itemId: mati, variantSku: "", qty: 1 }])).toEqual({ ok: false, kode: "BARANG_TIDAK_AKTIF" });
      expect(await coba([{ itemId: `asing-${tag}`, variantSku: "", qty: 1 }])).toEqual({ ok: false, kode: "BARANG_TIDAK_DIKENAL" });
      // Ukuran dari master barang yang belum punya stok gudang tetap sah.
      expect(await coba([{ itemId: kaos, variantSku: `${tag}-KAOS-L`, qty: 2 }])).toMatchObject({ ok: true });
      expect(await prisma.storeRecommendation.count({ where: { storeId: tokoSpg } })).toBe(1);
    });
  });

  describe("jawaban SPG", () => {
    it("SPG toko itu menerima: DITERIMA, jejak, kabar ke pembuat; ketukan kedua = ulang", async () => {
      const id = await buat();
      kabar.kirim = [];
      expect(await terimaRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg, catatan: "Siap" })).toEqual({
        ok: true,
        ulang: false,
        status: "DITERIMA",
      });
      const rek = await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } });
      expect(rek).toMatchObject({ status: "DITERIMA", respondedById: spg, responseNote: "Siap" });
      expect(rek.respondedAt).not.toBeNull();
      expect((await jejak(id)).map((j) => j.action)).toEqual(["STORE_RECOMMENDATION_SENT", "STORE_RECOMMENDATION_ACCEPTED"]);
      expect(kabar.kirim).toEqual([{ userId: sales, jenis: "REKOMENDASI_DIJAWAB", data: { recommendationId: id } }]);

      kabar.kirim = [];
      expect(await terimaRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg })).toMatchObject({ ok: true, ulang: true });
      expect(kabar.kirim).toEqual([]);
      expect(await tolakRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg, alasan: "x" })).toEqual({
        ok: false,
        kode: "SUDAH_BERUBAH",
        status: "DITERIMA",
      });
    });

    it("SPG toko lain ditolak", async () => {
      const id = await buat();
      expect(await terimaRekomendasi({ recommendationId: id, userId: spgLain, storeIdTetap: tokoLain })).toEqual({ ok: false, kode: "BUKAN_TOKO_ANDA" });
      expect(await status(id)).toBe("TERKIRIM");
    });

    it("menolak wajib beralasan", async () => {
      const id = await buat();
      expect(await tolakRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg, alasan: "  " })).toEqual({
        ok: false,
        kode: "ALASAN_WAJIB",
      });
      expect(await tolakRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg, alasan: "Rak penuh" })).toMatchObject({ ok: true });
      expect(await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DITOLAK", responseNote: "Rak penuh" });
      const j = await jejak(id);
      expect(j[1]).toMatchObject({ action: "STORE_RECOMMENDATION_REJECTED", reason: "Rak penuh" });
    });
  });

  describe("toko tanpa SPG", () => {
    it("pembuat menandai toko setuju lewat WhatsApp → DITERIMA, sumber di catatan", async () => {
      const id = await buat(tokoTanpaSpg);
      expect(await tandaiTokoSetuju({ recommendationId: id, salesmanId: salesLain, sumber: "WHATSAPP" })).toEqual({ ok: false, kode: "BUKAN_PEMBUAT" });
      expect(await tandaiTokoSetuju({ recommendationId: id, salesmanId: sales, sumber: "EMAIL" })).toEqual({ ok: false, kode: "SUMBER_TIDAK_VALID" });
      expect(await tandaiTokoSetuju({ recommendationId: id, salesmanId: sales, sumber: "WHATSAPP", catatan: "Bu Ani" })).toMatchObject({ ok: true, ulang: false });
      expect(await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "DITERIMA",
        respondedById: sales,
        responseNote: "Toko setuju lewat WhatsApp: Bu Ani",
      });
      const j = await jejak(id);
      expect(j[1]).toMatchObject({ action: "STORE_RECOMMENDATION_STORE_AGREED", metadata: { sumber: "WHATSAPP" } });
    });

    it("toko yang punya SPG: SPG yang menjawab, bukan salesman", async () => {
      const id = await buat(tokoSpg);
      expect(await tandaiTokoSetuju({ recommendationId: id, salesmanId: sales, sumber: "LANGSUNG" })).toEqual({ ok: false, kode: "TOKO_PUNYA_SPG" });
      expect(await status(id)).toBe("TERKIRIM");
    });
  });

  describe("pembatalan", () => {
    it("pembuat membatalkan dari TERKIRIM dan DITERIMA; bukan pembuat ditolak; yang sudah SELESAI tidak bisa", async () => {
      const a = await buat();
      expect(await batalkanRekomendasi({ recommendationId: a, salesmanId: salesLain })).toEqual({ ok: false, kode: "BUKAN_PEMBUAT" });
      expect(await batalkanRekomendasi({ recommendationId: a, salesmanId: sales, alasan: "Salah toko" })).toMatchObject({ ok: true, ulang: false });
      expect(await status(a)).toBe("DIBATALKAN");
      expect((await jejak(a))[1]).toMatchObject({ action: "STORE_RECOMMENDATION_CANCELLED", reason: "Salah toko" });
      expect(await batalkanRekomendasi({ recommendationId: a, salesmanId: sales })).toMatchObject({ ok: true, ulang: true });

      const b = await buat();
      await terimaRekomendasi({ recommendationId: b, userId: spg, storeIdTetap: tokoSpg });
      expect(await batalkanRekomendasi({ recommendationId: b, salesmanId: sales })).toMatchObject({ ok: true, ulang: false });

      const c = await buat();
      await prisma.storeRecommendation.update({ where: { id: c }, data: { status: "SELESAI" } });
      expect(await batalkanRekomendasi({ recommendationId: c, salesmanId: sales })).toEqual({ ok: false, kode: "SUDAH_BERUBAH", status: "SELESAI" });
      // SPG tidak bisa menjawab yang sudah dibatalkan.
      expect(await terimaRekomendasi({ recommendationId: a, userId: spg, storeIdTetap: tokoSpg })).toEqual({
        ok: false,
        kode: "SUDAH_BERUBAH",
        status: "DIBATALKAN",
      });
    });
  });

  describe("balapan", () => {
    it("SPG menerima dan salesman membatalkan bersamaan: tepat satu yang menang", async () => {
      for (let i = 0; i < 3; i++) {
        const id = await buat();
        const [terima, batal] = await Promise.all([
          terimaRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg }),
          batalkanRekomendasi({ recommendationId: id, salesmanId: sales }),
        ]);
        const akhir = await status(id);
        const transisi = (await jejak(id)).filter((j) => j.action !== "STORE_RECOMMENDATION_SENT");
        if (terima.ok && batal.ok) {
          // Hanya mungkin berurutan: diterima lalu dibatalkan (pembatalan sah dari DITERIMA).
          expect(akhir).toBe("DIBATALKAN");
          expect(transisi.map((j) => j.action)).toEqual(["STORE_RECOMMENDATION_ACCEPTED", "STORE_RECOMMENDATION_CANCELLED"]);
        } else {
          expect([terima.ok, batal.ok].filter(Boolean)).toHaveLength(1);
          expect(akhir).toBe(terima.ok ? "DITERIMA" : "DIBATALKAN");
          expect(transisi).toHaveLength(1);
        }
      }
    });

    it("menerima dan menolak bersamaan: tepat satu jawaban yang tercatat", async () => {
      const id = await buat();
      const [a, b] = await Promise.all([
        terimaRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg }),
        tolakRekomendasi({ recommendationId: id, userId: spg, storeIdTetap: tokoSpg, alasan: "Penuh" }),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect((await jejak(id)).filter((j) => j.action !== "STORE_RECOMMENDATION_SENT")).toHaveLength(1);
      expect(await status(id)).toBe(a.ok ? "DITERIMA" : "DITOLAK");
    });
  });
});
