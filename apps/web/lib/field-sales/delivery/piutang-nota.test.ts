import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { keadaanTagihanToko } from "@/lib/salesman/tagihan-toko";
import { recordFieldSalesDelivery, buatPiutangNota, isiPiutangNotaLama, NomorPiutangDipakaiError } from "./writer";

/* Menggerakkan stok — jangan pernah di basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TGL_NOTA = new Date("2026-10-05T00:00:00.000+07:00");
const TGL_TEMPO = new Date("2026-11-04T00:00:00.000+07:00");

/**
 * Keputusan pemilik: setiap nota tagihan pengiriman putus otomatis menjadi piutang, supaya cek
 * kredit toko (yang membaca piutang) tidak buta terhadap nota yang baru keluar.
 *
 * Pesanan uji (Rp): A 4 pcs × 150.000 dengan promo 60.000, B 2 pcs × 100.000, C 1 pcs bonus (0).
 * Total pesanan 740.000.
 */
d("nota tagihan putus menjadi piutang (basis data uji)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let salesmanId = "";
  let adminId = "";
  let orderId = "";
  let lineAId = "";
  let lineBId = "";
  let lineCId = "";
  let piutangLainId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; salesmanId = ""; adminId = ""; orderId = "";
    lineAId = ""; lineBId = ""; lineCId = ""; piutangLainId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-PN-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-PN-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 150000 },
    });
    itemId = item.id;
    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 7, reservedQty: 7, avgCost: 50000, totalValue: 350000 },
    });
    invId = inv.id;
    const store = await prisma.store.create({
      data: { code: `TEST-PN-STORE-${token}`, name: "Toko uji piutang nota", address: "Jl. Uji", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;
    const salesman = await prisma.user.create({ data: { email: `test-pn-sales-${token}@example.com`, name: "Sales uji nota" } });
    salesmanId = salesman.id;
    const admin = await prisma.user.create({ data: { email: `test-pn-admin-${token}@example.com`, name: "Gudang uji nota" } });
    adminId = admin.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-PN-${token}`,
        storeId,
        salesmanId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 800000,
        total: 740000,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Uji A", qty: 4, unitPrice: 150000, lineTotal: 600000, discountAmount: 60000 },
            { itemId, variantSku: "", productName: "Uji B", qty: 2, unitPrice: 100000, lineTotal: 200000 },
            { itemId, variantSku: "", productName: "Uji C bonus", qty: 1, unitPrice: 0, lineTotal: 0 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Uji A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Uji B")!.id;
    lineCId = order.lines.find((l) => l.productName === "Uji C bonus")!.id;
    for (const [lineId, qty] of [[lineAId, 4], [lineBId, 2], [lineCId, 1]] as const) {
      await prisma.stockReservation.create({
        data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty, state: "RESERVED" },
      });
    }
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { storeId: seededId(storeId) } });
    if (piutangLainId) await prisma.receivable.deleteMany({ where: { id: seededId(piutangLainId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(adminId)] } } });
  });

  const kirim = (lines: Array<{ orderLineId: string; qty: number }>, idempotencyKey?: string) =>
    recordFieldSalesDelivery({
      orderId,
      deliveredById: adminId,
      lines,
      invoiceDate: TGL_NOTA,
      dueDate: TGL_TEMPO,
      idempotencyKey,
    });

  it("satu pengiriman → tepat satu piutang dengan nomor, tanggal, toko, sales, dan nilai yang sama", async () => {
    const { deliveryId, docNo } = await kirim([{ orderLineId: lineAId, qty: 2 }]);

    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) } });
    expect(Number(nota.total)).toBe(270000); // 2 × 150.000 − (60.000 × 2/4)

    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
    expect(piutang).toHaveLength(1);
    const p = piutang[0];
    expect(p.source).toBe("DELIVERY");
    expect(p.deliveryId).toBe(deliveryId);
    expect(p.invoiceNo).toBe(docNo);
    expect(p.storeId).toBe(storeId);
    // Sales pemilik pesanan, BUKAN orang gudang yang mencatat pengiriman.
    expect(p.salesmanId).toBe(salesmanId);
    expect(p.invoiceDate.getTime()).toBe(TGL_NOTA.getTime());
    expect(p.dueDate.getTime()).toBe(TGL_TEMPO.getTime());
    expect(Number(p.amount)).toBe(270000);
    expect(Number(p.outstanding)).toBe(270000);
    expect(p.settledAt).toBeNull();
  });

  it("cek kredit toko langsung melihat nota yang baru keluar (dulu buta sampai ada yang mengetik piutangnya)", async () => {
    const sebelum = await keadaanTagihanToko(storeId, 0);
    expect(sebelum.keadaan.sisa).toBe(0);

    await kirim([{ orderLineId: lineAId, qty: 2 }]);

    const sesudah = await keadaanTagihanToko(storeId, 0);
    expect(sesudah.keadaan.sisa).toBe(270000);
    expect(sesudah.keadaan.fakturTerbuka).toBe(1);
  });

  it("kiriman ulang dengan kunci idempoten yang sama tidak membuat piutang kedua", async () => {
    const kunci = `pn-ulang-${token}`;
    const pertama = await kirim([{ orderLineId: lineAId, qty: 1 }], kunci);
    const kedua = await kirim([{ orderLineId: lineAId, qty: 1 }], kunci);

    expect(kedua.deliveryId).toBe(pertama.deliveryId);
    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
    expect(piutang).toHaveLength(1);
    expect(Number(piutang[0].amount)).toBe(135000); // 150.000 − 15.000
  });

  it("dua kiriman serentak dengan kunci yang sama → satu pengiriman, satu piutang", async () => {
    const kunci = `pn-balapan-${token}`;
    const hasil = await Promise.allSettled([
      kirim([{ orderLineId: lineAId, qty: 2 }], kunci),
      kirim([{ orderLineId: lineAId, qty: 2 }], kunci),
    ]);
    expect(hasil.some((h) => h.status === "fulfilled")).toBe(true);

    const nota = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(orderId) } });
    expect(nota).toHaveLength(1);
    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
    expect(piutang).toHaveLength(1);
    expect(piutang[0].deliveryId).toBe(nota[0].id);
    expect(Number(piutang[0].amount)).toBe(270000);
  });

  it("pesanan yang dikirim dua kali → dua piutang yang menjumlah persis ke total pesanan", async () => {
    await kirim([{ orderLineId: lineAId, qty: 2 }]);
    await kirim([
      { orderLineId: lineAId, qty: 2 },
      { orderLineId: lineBId, qty: 2 },
      { orderLineId: lineCId, qty: 1 },
    ]);

    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) }, orderBy: { createdAt: "asc" } });
    expect(piutang.map((p) => Number(p.amount))).toEqual([270000, 470000]);
    expect(piutang.reduce((s, p) => s + Number(p.amount), 0)).toBe(740000);
  });

  it("nota bernilai 0 (hanya barang bonus) tidak menjadi piutang — tidak ada yang ditagih", async () => {
    const { deliveryId } = await kirim([{ orderLineId: lineCId, qty: 1 }]);
    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) } });
    expect(Number(nota.total)).toBe(0);
    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
    expect(piutang).toHaveLength(0);
  });

  it("sisa pembulatan float di bawah satu sen bukan tagihan (tidak menjadi piutang Rp 0,00)", async () => {
    // 1.000,10 − 1.000 − 0,10 dalam float = 2,27e-14, bukan 0.
    const residu = 1000.1 - 1000 - 0.1;
    expect(residu).toBeGreaterThan(0);
    const hasil = await runSerializable((tx) =>
      buatPiutangNota(tx, {
        deliveryId: "nota-residu-yang-tidak-ada",
        docNo: `TEST-PN-RESIDU-${token}`,
        storeId,
        salesmanId,
        invoiceDate: TGL_NOTA,
        dueDate: TGL_TEMPO,
        total: residu,
      }),
    );
    expect(hasil).toEqual({ dibuat: false, alasan: "NOL" });
    expect(await prisma.receivable.count({ where: { storeId: seededId(storeId) } })).toBe(0);
  });

  it("pesanan konsinyasi tidak pernah dikirim lewat nota tagihan, jadi tidak pernah menjadi piutang", async () => {
    await prisma.fieldSalesOrder.update({ where: { id: seededId(orderId) }, data: { orderType: "KONSI" } });
    await expect(kirim([{ orderLineId: lineAId, qty: 2 }])).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    expect(await prisma.receivable.count({ where: { storeId: seededId(storeId) } })).toBe(0);
  });

  it("nomor nota yang sudah dipakai piutang lain ditolak, bukan ditumpuk", async () => {
    const lain = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-PN-NOMOR-${token}`,
        storeId,
        invoiceDate: TGL_NOTA,
        dueDate: TGL_TEMPO,
        amount: 500000,
        outstanding: 500000,
        source: "MANUAL",
      },
    });
    piutangLainId = lain.id;

    await expect(
      runSerializable((tx) =>
        buatPiutangNota(tx, {
          deliveryId: "nota-yang-tidak-ada",
          docNo: `TEST-PN-NOMOR-${token}`,
          storeId,
          salesmanId,
          invoiceDate: TGL_NOTA,
          dueDate: TGL_TEMPO,
          total: 270000,
        }),
      ),
    ).rejects.toBeInstanceOf(NomorPiutangDipakaiError);

    const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
    expect(piutang).toHaveLength(1);
    expect(piutang[0].id).toBe(lain.id);
  });

  /**
   * Nomor DLV berikutnya menurut penghitung, persis cara generator memilihnya: penghitung + 1 pada
   * periode yang sama (atau 1 bila periodenya berganti), dan bila nomor itu sudah dipakai nota,
   * lompat ke atas nomor nota terbesar periode ini.
   */
  async function nomorNotaBerikutnya(): Promise<{ awalan: string; angka: number; padding: number }> {
    const now = new Date();
    const tahun = now.getFullYear();
    const bulan = now.getMonth() + 1;
    const cfg = await prisma.docNumberConfig.findUnique({ where: { docType: "DELIVERY" } });
    const prefix = cfg?.prefix ?? "DLV/";
    const padding = cfg?.padding || 4;
    const awalan = `${prefix.endsWith("/") ? prefix : `${prefix}/`}${tahun}/${String(bulan).padStart(2, "0")}/`;
    let angka = cfg && cfg.year === tahun && cfg.month === bulan ? cfg.lastNumber + 1 : 1;
    const terpakai = await prisma.fieldSalesDelivery.findMany({ where: { docNo: { startsWith: awalan } }, select: { docNo: true } });
    const nomorTerpakai = new Set(terpakai.map((t) => t.docNo));
    if (nomorTerpakai.has(`${awalan}${String(angka).padStart(padding, "0")}`)) {
      const ekor = terpakai.map((t) => Number.parseInt(t.docNo.slice(awalan.length), 10)).filter((n) => Number.isFinite(n));
      angka = Math.max(...ekor) + 1;
    }
    return { awalan, angka, padding };
  }

  it("nomor nota berikutnya yang sudah dipegang piutang lain dilompati: pengiriman tetap tercatat dan menjadi piutang", async () => {
    /*
     * Faktur manual/impor yang kebetulan bernomor seperti nota berikutnya dulu menolak pengiriman
     * — dan karena penghitung ikut ter-rollback, SETIAP pengiriman bulan itu ditolak dengan nomor
     * yang sama, tanpa layar untuk mengganti nomor piutang. Lima nomor berikutnya dihalangi.
     */
    const { awalan, angka, padding } = await nomorNotaBerikutnya();
    const dihalangi = Array.from({ length: 5 }, (_, i) => `${awalan}${String(angka + i).padStart(padding, "0")}`);
    await prisma.receivable.createMany({
      data: dihalangi.map((invoiceNo) => ({
        invoiceNo,
        storeId,
        invoiceDate: TGL_NOTA,
        dueDate: TGL_TEMPO,
        amount: 111000,
        outstanding: 111000,
        source: "MANUAL" as const,
      })),
      skipDuplicates: true,
    });

    const { deliveryId, docNo } = await kirim([{ orderLineId: lineAId, qty: 2 }]);

    expect(dihalangi).not.toContain(docNo);
    expect(docNo.startsWith(awalan)).toBe(true);
    expect(Number.parseInt(docNo.slice(awalan.length), 10)).toBeGreaterThan(angka + 4);

    const piutangNota = await prisma.receivable.findUniqueOrThrow({ where: { deliveryId: seededId(deliveryId) } });
    expect(piutangNota.invoiceNo).toBe(docNo);
    expect(Number(piutangNota.amount)).toBe(270000);

    // Faktur yang menghalangi tidak disentuh.
    const penghalang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId), deliveryId: null } });
    expect(penghalang.map((p) => p.invoiceNo).sort()).toEqual([...dihalangi].sort());
    expect(penghalang.every((p) => Number(p.amount) === 111000 && Number(p.outstanding) === 111000)).toBe(true);
  });

  describe("isi piutang untuk nota lama", () => {
    /** Nota lama: dibuat langsung tanpa penulis, jadi tanpa piutang — bentuk data sebelum aturan ini. */
    async function notaLama(docNo: string, total: number): Promise<string> {
      const nota = await prisma.fieldSalesDelivery.create({
        data: {
          docNo,
          orderId,
          deliveredAt: TGL_NOTA,
          deliveredById: adminId,
          invoiceDate: TGL_NOTA,
          dueDate: TGL_TEMPO,
          subtotal: total,
          discountAmount: 0,
          total,
        },
        select: { id: true },
      });
      return nota.id;
    }

    it("mode kering melaporkan tanpa menulis; mode terapkan membuat piutangnya; jalan kedua tidak menggandakan", async () => {
      const id1 = await notaLama(`TEST-PN-LAMA1-${token}`, 450000);
      const id0 = await notaLama(`TEST-PN-LAMA0-${token}`, 0);

      const kering = await isiPiutangNotaLama({ terapkan: false, deliveryIds: [id1, id0] });
      expect(kering.diperiksa).toBe(2);
      expect(kering.akanDibuat).toBe(1);
      expect(kering.nilaiAkanDibuat).toBe(450000);
      expect(kering.dibuat).toBe(0);
      expect(kering.nol.map((n) => n.docNo)).toEqual([`TEST-PN-LAMA0-${token}`]);
      expect(await prisma.receivable.count({ where: { storeId: seededId(storeId) } })).toBe(0);

      const terapkan = await isiPiutangNotaLama({ terapkan: true, deliveryIds: [id1, id0] });
      expect(terapkan.dibuat).toBe(1);
      const piutang = await prisma.receivable.findMany({ where: { storeId: seededId(storeId) } });
      expect(piutang).toHaveLength(1);
      expect(piutang[0].deliveryId).toBe(id1);
      expect(piutang[0].invoiceNo).toBe(`TEST-PN-LAMA1-${token}`);
      expect(piutang[0].salesmanId).toBe(salesmanId);
      expect(Number(piutang[0].amount)).toBe(450000);
      expect(Number(piutang[0].outstanding)).toBe(450000);

      const lagi = await isiPiutangNotaLama({ terapkan: true, deliveryIds: [id1, id0] });
      expect(lagi.dibuat).toBe(0);
      expect(lagi.sudahPunya).toBe(1);
      expect(await prisma.receivable.count({ where: { storeId: seededId(storeId) } })).toBe(1);
    });

    it("nota yang mungkin sudah ditagih dengan nomor lain (toko & nilai sama, tanggal berdekatan) dilaporkan, tidak dibuat", async () => {
      /*
       * Sebelum aturan ini, nota tagihan dicatat kantor ke piutang dengan tangan atau lewat impor
       * SSG — nomornya lain. Nomornya tidak bisa dicocokkan, jadi tanpa penjaga ini backfill
       * menagih toko DUA KALI untuk barang yang sama.
       */
      const id = await notaLama(`TEST-PN-GANDA-${token}`, 320000);
      const idLain = await notaLama(`TEST-PN-BEDA-${token}`, 410000);
      const impor = await prisma.receivable.create({
        data: {
          invoiceNo: `TEST-PN-SSG-${token}`,
          storeId,
          invoiceDate: new Date("2026-10-08T00:00:00.000+07:00"),
          dueDate: TGL_TEMPO,
          amount: 320000,
          outstanding: 320000,
          source: "IMPORT",
        },
      });
      piutangLainId = impor.id;

      const kering = await isiPiutangNotaLama({ terapkan: false, deliveryIds: [id, idLain] });
      expect(kering.akanDibuat).toBe(1);
      expect(kering.nilaiAkanDibuat).toBe(410000);
      expect(kering.dugaanGanda).toEqual([
        { docNo: `TEST-PN-GANDA-${token}`, total: 320000, receivableId: impor.id, invoiceNo: `TEST-PN-SSG-${token}`, source: "IMPORT" },
      ]);

      const terapkan = await isiPiutangNotaLama({ terapkan: true, deliveryIds: [id, idLain] });
      expect(terapkan.dibuat).toBe(1);
      expect(await prisma.receivable.count({ where: { deliveryId: seededId(id) } })).toBe(0);
      expect(await prisma.receivable.count({ where: { deliveryId: seededId(idLain) } })).toBe(1);

      // Sesudah diperiksa orang dan memang bukan tagihan yang sama: disertakan dengan sengaja.
      const sertakan = await isiPiutangNotaLama({ terapkan: true, deliveryIds: [id, idLain], sertakanDugaanGanda: true });
      expect(sertakan.dibuat).toBe(1);
      expect(Number((await prisma.receivable.findUniqueOrThrow({ where: { deliveryId: seededId(id) } })).amount)).toBe(320000);
    });

    it("piutang bernilai sama tetapi jauh tanggalnya (lebih dari sebulan) tidak dianggap ganda", async () => {
      const id = await notaLama(`TEST-PN-JAUH-${token}`, 250000);
      const jauh = await prisma.receivable.create({
        data: {
          invoiceNo: `TEST-PN-JAUH-SSG-${token}`,
          storeId,
          invoiceDate: new Date("2026-06-01T00:00:00.000+07:00"),
          dueDate: new Date("2026-07-01T00:00:00.000+07:00"),
          amount: 250000,
          outstanding: 250000,
          source: "MANUAL",
        },
      });
      piutangLainId = jauh.id;

      const kering = await isiPiutangNotaLama({ terapkan: false, deliveryIds: [id] });
      expect(kering.dugaanGanda).toEqual([]);
      expect(kering.akanDibuat).toBe(1);
    });

    it("nota yang nomornya sudah dipegang piutang lain dilaporkan, tidak dibuat", async () => {
      const docNo = `TEST-PN-BENTROK-${token}`;
      const id = await notaLama(docNo, 300000);
      const lain = await prisma.receivable.create({
        data: { invoiceNo: docNo, storeId, invoiceDate: TGL_NOTA, dueDate: TGL_TEMPO, amount: 300000, outstanding: 300000, source: "IMPORT" },
      });
      piutangLainId = lain.id;

      const hasil = await isiPiutangNotaLama({ terapkan: true, deliveryIds: [id] });
      expect(hasil.dibuat).toBe(0);
      expect(hasil.nomorDipakai).toEqual([{ docNo, receivableId: lain.id, source: "IMPORT" }]);
      // Piutang yang memegang nomornya sendiri tidak dihitung lagi sebagai dugaan ganda.
      expect(hasil.dugaanGanda).toEqual([]);
      expect(await prisma.receivable.count({ where: { deliveryId: seededId(id) } })).toBe(0);
    });
  });
});
