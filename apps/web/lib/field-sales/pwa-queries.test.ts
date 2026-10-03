import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  alamatPesanan,
  bacaBatas,
  bacaCatatanKredit,
  bacaTab,
  BATAS_BAWAAN,
  hasilBanding,
  hitungPerTab,
  keadaanPesanan,
  nilaiTampil,
  pesananSaya,
  pesananSayaById,
  susunLinimasa,
  syaratTab,
  tahapPesanan,
  TAB_PESANAN,
  type TabPesanan,
} from "./pwa-queries";

type Status = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
type Jenis = "PUTUS" | "KONSI";
type Kirim = "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";

const SEMUA: Array<{ status: Status; orderType: Jenis; deliveryStatus: Kirim }> = [];
for (const status of ["PENDING_APPROVAL", "APPROVED", "REJECTED"] as const) {
  for (const orderType of ["PUTUS", "KONSI"] as const) {
    for (const deliveryStatus of ["PENDING", "PARTIAL", "DELIVERED", "CLOSED"] as const) {
      SEMUA.push({ status, orderType, deliveryStatus });
    }
  }
}

/** Menilai bentuk `where` yang dihasilkan `syaratTab` terhadap satu pesanan, di JS. */
function cocok(where: ReturnType<typeof syaratTab>, o: (typeof SEMUA)[number]): boolean {
  if (!where.OR) return true;
  return (where.OR as Array<Record<string, unknown>>).some((k) => {
    if (k.status !== o.status || k.orderType !== o.orderType) return false;
    const kirim = k.deliveryStatus as { in: string[] } | undefined;
    return kirim === undefined || kirim.in.includes(o.deliveryStatus);
  });
}

describe("keadaan & tahap pesanan", () => {
  it("memetakan setiap kombinasi ke keadaan yang dibaca salesman", () => {
    expect(keadaanPesanan({ status: "PENDING_APPROVAL", orderType: "PUTUS", deliveryStatus: "PENDING" })).toBe("MENUNGGU");
    expect(keadaanPesanan({ status: "REJECTED", orderType: "KONSI", deliveryStatus: "PENDING" })).toBe("DITOLAK");
    expect(keadaanPesanan({ status: "APPROVED", orderType: "KONSI", deliveryStatus: "PENDING" })).toBe("KONSI_DISETUJUI");
    expect(keadaanPesanan({ status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PENDING" })).toBe("BELUM_DIKIRIM");
    expect(keadaanPesanan({ status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PARTIAL" })).toBe("DIKIRIM_SEBAGIAN");
    expect(keadaanPesanan({ status: "APPROVED", orderType: "PUTUS", deliveryStatus: "DELIVERED" })).toBe("TERKIRIM");
    expect(keadaanPesanan({ status: "APPROVED", orderType: "PUTUS", deliveryStatus: "CLOSED" })).toBe("DITUTUP");
  });

  it("tab 'disetujui' = persis 'siap dikirim' di beranda (PUTUS disetujui, belum/sebagian dikirim)", () => {
    const disetujui = SEMUA.filter((o) => tahapPesanan(o) === "disetujui");
    expect(disetujui).toEqual([
      { status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PENDING" },
      { status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PARTIAL" },
    ]);
  });

  it("konsi yang disetujui jatuh di tab 'dikirim'", () => {
    expect(tahapPesanan({ status: "APPROVED", orderType: "KONSI", deliveryStatus: "PENDING" })).toBe("dikirim");
  });

  it("syarat Prisma setiap tab memilih tepat pesanan yang dipilah ke tab itu", () => {
    for (const tab of TAB_PESANAN) {
      const where = syaratTab(tab);
      for (const o of SEMUA) {
        expect(cocok(where, o), `${tab} ${JSON.stringify(o)}`).toBe(tab === "semua" || tahapPesanan(o) === tab);
      }
    }
  });

  it("setiap pesanan tepat di satu tab selain 'semua'", () => {
    for (const o of SEMUA) {
      const tabs = TAB_PESANAN.filter((t) => t !== "semua" && cocok(syaratTab(t), o));
      expect(tabs).toHaveLength(1);
    }
  });

  it("hitungan tab dijumlahkan lewat pemilah yang sama", () => {
    expect(
      hitungPerTab([
        { status: "PENDING_APPROVAL", orderType: "PUTUS", deliveryStatus: "PENDING", jumlah: 2 },
        { status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PARTIAL", jumlah: 1 },
        { status: "APPROVED", orderType: "KONSI", deliveryStatus: "PENDING", jumlah: 3 },
        { status: "REJECTED", orderType: "PUTUS", deliveryStatus: "PENDING", jumlah: 4 },
      ]),
    ).toEqual({ semua: 10, menunggu: 2, disetujui: 1, dikirim: 3, ditolak: 4 });
  });
});

describe("pembacaan alamat", () => {
  it("tab tidak dikenal jatuh ke 'semua'", () => {
    expect(bacaTab("ditolak")).toBe("ditolak");
    expect(bacaTab(["dikirim", "x"])).toBe("dikirim");
    expect(bacaTab("hapus")).toBe("semua");
    expect(bacaTab(undefined)).toBe("semua");
  });

  it("alamat tab: 'semua' dan batas bawaan tidak ditulis", () => {
    expect(alamatPesanan("semua")).toBe("/pwa/orders");
    expect(alamatPesanan("ditolak")).toBe("/pwa/orders?status=ditolak");
    expect(alamatPesanan("semua", BATAS_BAWAAN)).toBe("/pwa/orders");
    expect(alamatPesanan("dikirim", 60)).toBe("/pwa/orders?status=dikirim&batas=60");
    // Alamat yang dibuat harus terbaca kembali sebagai tab yang sama.
    for (const tab of TAB_PESANAN) {
      const q = new URL(alamatPesanan(tab), "http://x").searchParams;
      expect(bacaTab(q.get("status") ?? undefined)).toBe(tab);
    }
  });

  it("batas: bawaan, dibulatkan, dan dibatasi", () => {
    expect(bacaBatas(undefined)).toBe(BATAS_BAWAAN);
    expect(bacaBatas("abc")).toBe(BATAS_BAWAAN);
    expect(bacaBatas("-5")).toBe(BATAS_BAWAAN);
    expect(bacaBatas("60.7")).toBe(60);
    expect(bacaBatas("100000")).toBe(300);
  });
});

describe("nilai & harga", () => {
  it("nilai konsi tidak pernah tampil di HP; putus selalu tampil", () => {
    expect(nilaiTampil({ orderType: "KONSI", status: "PENDING_APPROVAL" }, 0)).toBeNull();
    expect(nilaiTampil({ orderType: "KONSI", status: "REJECTED" }, 0)).toBeNull();
    // Juga sesudah disetujui: nilai konsinyasi tidak pernah tampil di aplikasi HP.
    expect(nilaiTampil({ orderType: "KONSI", status: "APPROVED" }, 5000)).toBeNull();
    expect(nilaiTampil({ orderType: "PUTUS", status: "PENDING_APPROVAL" }, 7000)).toBe(7000);
  });

  it("hasil banding harga", () => {
    expect(hasilBanding("PENDING_APPROVAL", 9000, 10000)).toEqual({ hasil: "MENUNGGU", hargaAkhir: null });
    expect(hasilBanding("REJECTED", 9000, 10000)).toEqual({ hasil: "BATAL", hargaAkhir: null });
    expect(hasilBanding("APPROVED", 9000, 9000)).toEqual({ hasil: "SESUAI", hargaAkhir: 9000 });
    expect(hasilBanding("APPROVED", 9000, 9500)).toEqual({ hasil: "BERBEDA", hargaAkhir: 9500 });
    // Pembulatan float tidak boleh membuat harga yang sama terbaca berbeda.
    expect(hasilBanding("APPROVED", 0.1 + 0.2, 0.3).hasil).toBe("SESUAI");
  });
});

describe("catatan kredit", () => {
  it("kosong → null", () => {
    expect(bacaCatatanKredit(null)).toBeNull();
    expect(bacaCatatanKredit("   ")).toBeNull();
  });

  it("teks biasa ditampilkan apa adanya", () => {
    expect(bacaCatatanKredit("Toko menunggak 2 faktur")).toEqual({ jenis: "teks", teks: "Toko menunggak 2 faktur" });
  });

  it("JSON penilaian dirakit ulang; alasan rusak dibuang", () => {
    const teks = JSON.stringify({
      tingkat: "TAHAN",
      alasan: [{ kode: "LEWAT_JANJI", nilai: 500000, faktur: 2 }, { kode: "ANEH" }, { kode: "MELEBIHI_BATAS_FAKTUR", faktur: 3, batas: 2 }],
      keadaan: { sisa: 900000, fakturTerbuka: 3, lewatJanji: 500000, fakturLewatJanji: 2 },
    });
    expect(bacaCatatanKredit(teks)).toEqual({
      jenis: "terstruktur",
      tingkat: "TAHAN",
      alasan: [
        { kode: "LEWAT_JANJI", nilai: 500000, faktur: 2 },
        { kode: "MELEBIHI_BATAS_FAKTUR", faktur: 3, batas: 2 },
      ],
      keadaan: { sisa: 900000, fakturTerbuka: 3, lewatJanji: 500000, fakturLewatJanji: 2 },
    });
  });

  it("hasil yang dibungkus { hasil, keadaan } juga terbaca", () => {
    const c = bacaCatatanKredit(JSON.stringify({ hasil: { tingkat: "PERINGATAN", alasan: [] }, keadaan: null }));
    expect(c).toEqual({ jenis: "terstruktur", tingkat: "PERINGATAN", alasan: [], keadaan: null });
  });

  it("JSON tanpa bentuk yang dikenal → teks", () => {
    expect(bacaCatatanKredit('{"x":1}')).toEqual({ jenis: "teks", teks: '{"x":1}' });
    expect(bacaCatatanKredit("[1,2]")).toEqual({ jenis: "teks", teks: "[1,2]" });
  });
});

describe("linimasa", () => {
  it("urut menurut alur, kiriman menurut tanggal; yang tidak terjadi tidak muncul", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 8, h));
    const l = susunLinimasa({
      createdAt: t(1),
      approvedAt: t(2),
      rejectedAt: null,
      rejectReason: null,
      closedAt: t(6),
      closeReason: "sisa habis",
      pengiriman: [
        { docNo: "DLV/2", deliveredAt: t(5), pcs: 2, total: 20000 },
        { docNo: "DLV/1", deliveredAt: t(3), pcs: 4, total: 40000 },
      ],
    });
    expect(l.map((x) => x.jenis)).toEqual(["DIBUAT", "DISETUJUI", "DIKIRIM", "DIKIRIM", "DITUTUP"]);
    expect(l[2]).toMatchObject({ docNo: "DLV/1", pcs: 4 });
    expect(l[4]).toMatchObject({ alasan: "sisa habis" });
  });

  it("jam yang janggal tidak membalik alur (persetujuan tercatat sebelum dibuat)", () => {
    const l = susunLinimasa({
      createdAt: new Date(5000),
      approvedAt: new Date(4000),
      rejectedAt: null,
      rejectReason: null,
      closedAt: null,
      closeReason: null,
      pengiriman: [{ docNo: "DLV/1", deliveredAt: new Date(4000), pcs: 1, total: 1 }],
    });
    expect(l.map((x) => x.jenis)).toEqual(["DIBUAT", "DISETUJUI", "DIKIRIM"]);
  });

  it("pesanan ditolak membawa alasannya", () => {
    const l = susunLinimasa({
      createdAt: new Date(1),
      approvedAt: null,
      rejectedAt: new Date(2),
      rejectReason: "stok kosong",
      closedAt: null,
      closeReason: null,
      pengiriman: [],
    });
    expect(l).toEqual([
      { jenis: "DIBUAT", waktu: new Date(1) },
      { jenis: "DITOLAK", waktu: new Date(2), alasan: "stok kosong" },
    ]);
  });
});

/*
 * Bagian di bawah menulis ke basis data. Jangan pernah dijalankan ke basis data
 * produksi (terowongan :3307 / host VPS).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("pesananSaya & pesananSayaById (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let salesAId = "";
  let salesBId = "";
  let tokoPutusId = "";
  let tokoKonsiId = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  const id: Record<string, string> = {};

  async function pesanan(
    kunci: string,
    data: {
      salesmanId: string;
      storeId: string;
      status: Status;
      orderType: Jenis;
      deliveryStatus?: Kirim;
      total: number;
      rejectReason?: string;
      kreditCatatan?: string;
      lines: Array<{ qty: number; unitPrice: number; requestedUnitPrice?: number; appealReason?: string; deliveredQty?: number }>;
    },
  ) {
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-PSY-${token}-${kunci}`,
        salesmanId: data.salesmanId,
        storeId: data.storeId,
        status: data.status,
        orderType: data.orderType,
        deliveryStatus: data.deliveryStatus ?? "PENDING",
        subtotal: data.total,
        total: data.total,
        rejectReason: data.rejectReason,
        rejectedAt: data.status === "REJECTED" ? new Date() : null,
        approvedAt: data.status === "APPROVED" ? new Date() : null,
        kreditCatatan: data.kreditCatatan,
        lines: {
          create: data.lines.map((l, i) => ({
            itemId,
            variantSku: "",
            productName: `Produk ${i + 1}`,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.qty * l.unitPrice,
            requestedUnitPrice: l.requestedUnitPrice,
            appealReason: l.appealReason,
            deliveredQty: l.deliveredQty ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
    orderIds.push(o.id);
    id[kunci] = o.id;
    return o;
  }

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    salesAId = "";
    salesBId = "";
    tokoPutusId = "";
    tokoKonsiId = "";
    orderIds = [];
    deliveryIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PSY-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-PSY-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId, sellingPrice: 10000 },
      })
    ).id;
    salesAId = (await prisma.user.create({ data: { email: `test-psy-a-${token}@example.com`, name: "Sales A" } })).id;
    salesBId = (await prisma.user.create({ data: { email: `test-psy-b-${token}@example.com`, name: "Sales B" } })).id;
    tokoPutusId = (
      await prisma.store.create({ data: { code: `TEST-PSY-P-${token}`, name: "Toko Putus Uji", address: "x", termsType: "PUTUS" } })
    ).id;
    tokoKonsiId = (
      await prisma.store.create({ data: { code: `TEST-PSY-K-${token}`, name: "Toko Konsi Uji", address: "x", termsType: "KONSI" } })
    ).id;

    await pesanan("menunggu", {
      salesmanId: salesAId, storeId: tokoPutusId, status: "PENDING_APPROVAL", orderType: "PUTUS", total: 30000,
      kreditCatatan: JSON.stringify({ tingkat: "TAHAN", alasan: [{ kode: "LEWAT_JANJI", nilai: 100000, faktur: 1 }] }),
      lines: [{ qty: 2, unitPrice: 10000, requestedUnitPrice: 9000, appealReason: "toko langganan" }, { qty: 1, unitPrice: 10000 }],
    });
    await pesanan("siapKirim", {
      salesmanId: salesAId, storeId: tokoPutusId, status: "APPROVED", orderType: "PUTUS", total: 60000,
      lines: [{ qty: 6, unitPrice: 10000 }],
    });
    const kirim = await pesanan("sebagian", {
      salesmanId: salesAId, storeId: tokoPutusId, status: "APPROVED", orderType: "PUTUS", deliveryStatus: "PARTIAL", total: 40000,
      lines: [{ qty: 4, unitPrice: 9500, requestedUnitPrice: 9000, appealReason: "grosir", deliveredQty: 3 }],
    });
    await pesanan("terkirim", {
      salesmanId: salesAId, storeId: tokoPutusId, status: "APPROVED", orderType: "PUTUS", deliveryStatus: "DELIVERED", total: 20000,
      lines: [{ qty: 2, unitPrice: 10000, deliveredQty: 2 }],
    });
    await pesanan("ditolak", {
      salesmanId: salesAId, storeId: tokoPutusId, status: "REJECTED", orderType: "PUTUS", total: 10000,
      rejectReason: "Harga tidak disetujui", lines: [{ qty: 1, unitPrice: 10000 }],
    });
    await pesanan("konsiMenunggu", {
      salesmanId: salesAId, storeId: tokoKonsiId, status: "PENDING_APPROVAL", orderType: "KONSI", total: 0,
      lines: [{ qty: 5, unitPrice: 0 }],
    });
    await pesanan("konsiDisetujui", {
      salesmanId: salesAId, storeId: tokoKonsiId, status: "APPROVED", orderType: "KONSI", total: 55000,
      lines: [{ qty: 5, unitPrice: 11000 }],
    });
    await pesanan("milikB", {
      salesmanId: salesBId, storeId: tokoPutusId, status: "PENDING_APPROVAL", orderType: "PUTUS", total: 10000,
      lines: [{ qty: 1, unitPrice: 10000 }],
    });

    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-PSY-DLV-${token}`,
        orderId: kirim.id,
        deliveredAt: new Date(),
        deliveredById: salesAId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 28500,
        total: 28500,
        lines: {
          create: [{ orderLineId: kirim.lines[0].id, itemId, variantSku: "", productName: "Produk 1", qty: 3, unitPrice: 9500, lineTotal: 28500 }],
        },
      },
    });
    deliveryIds.push(dlv.id);
  });

  afterAll(async () => {
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutusId, tokoKonsiId].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesAId, salesBId].filter(Boolean)) } } });
  });

  it("hanya pesanan milik sendiri, terbaru dulu, dengan hitungan tab", async () => {
    const r = await pesananSaya(salesAId);
    expect(r.baris.map((b) => b.id)).not.toContain(id.milikB);
    expect(r.baris).toHaveLength(7);
    expect(r.baris[0].id).toBe(id.konsiDisetujui);
    expect(r.jumlah).toEqual({ semua: 7, menunggu: 2, disetujui: 2, dikirim: 2, ditolak: 1 });
    expect(r.adaLagi).toBe(false);
  });

  it("isi setiap tab sama dengan angkanya", async () => {
    const semua = await pesananSaya(salesAId);
    for (const tab of TAB_PESANAN as readonly TabPesanan[]) {
      const r = await pesananSaya(salesAId, { status: tab });
      expect(r.baris, tab).toHaveLength(semua.jumlah[tab]);
    }
    const ditolak = await pesananSaya(salesAId, { status: "ditolak" });
    expect(ditolak.baris[0]).toMatchObject({ id: id.ditolak, rejectReason: "Harga tidak disetujui", keadaan: "DITOLAK" });
  });

  it("baris membawa jumlah barang, tanda banding, dan nilai konsi yang disembunyikan", async () => {
    const { baris } = await pesananSaya(salesAId);
    const byId = new Map(baris.map((b) => [b.id, b]));
    expect(byId.get(id.menunggu)).toMatchObject({ jumlahBaris: 2, jumlahPcs: 3, adaBanding: true, total: 30000, storeName: "Toko Putus Uji" });
    expect(byId.get(id.siapKirim)).toMatchObject({ adaBanding: false, keadaan: "BELUM_DIKIRIM" });
    expect(byId.get(id.konsiMenunggu)?.total).toBeNull();
    expect(byId.get(id.konsiDisetujui)).toMatchObject({ total: null, keadaan: "KONSI_DISETUJUI" });
    expect(typeof byId.get(id.menunggu)?.total).toBe("number");
  });

  it("batas memotong daftar dan menandai ada lagi", async () => {
    const r = await pesananSaya(salesAId, { batas: 2 });
    expect(r.baris).toHaveLength(2);
    expect(r.adaLagi).toBe(true);
    expect(r.jumlah.semua).toBe(7);
  });

  it("detail pesanan orang lain → null", async () => {
    expect(await pesananSayaById(id.milikB, salesAId)).toBeNull();
    expect(await pesananSayaById("tidak-ada", salesAId)).toBeNull();
  });

  it("detail menunggu: banding belum diputus, catatan kredit terbaca", async () => {
    const dtl = await pesananSayaById(id.menunggu, salesAId);
    expect(dtl).not.toBeNull();
    expect(dtl!.storeId).toBe(tokoPutusId);
    expect(dtl!.keadaan).toBe("MENUNGGU");
    const banding = dtl!.baris.find((b) => b.banding !== null)!;
    expect(banding.banding).toEqual({ requestedUnitPrice: 9000, appealReason: "toko langganan", hasil: "MENUNGGU", hargaAkhir: null });
    expect(dtl!.kreditCatatan).toMatchObject({ jenis: "terstruktur", tingkat: "TAHAN" });
    expect(dtl!.linimasa.map((l) => l.jenis)).toEqual(["DIBUAT"]);
    expect(dtl!.total).toBe(30000);
  });

  it("detail dikirim sebagian: pembagian kirim/sisa, harga akhir, pengiriman di linimasa", async () => {
    const dtl = await pesananSayaById(id.sebagian, salesAId);
    expect(dtl!.keadaan).toBe("DIKIRIM_SEBAGIAN");
    expect(dtl!.baris[0]).toMatchObject({ qty: 4, deliveredQty: 3, cancelledQty: 0, outstanding: 1, unitPrice: 9500 });
    expect(dtl!.baris[0].banding).toMatchObject({ hasil: "BERBEDA", hargaAkhir: 9500 });
    expect(dtl!.pengiriman).toEqual([expect.objectContaining({ docNo: `TEST-PSY-DLV-${token}`, pcs: 3, total: 28500 })]);
    expect(dtl!.linimasa.map((l) => l.jenis)).toEqual(["DIBUAT", "DISETUJUI", "DIKIRIM"]);
  });

  it("detail konsi belum disetujui menyembunyikan semua harga dan tidak membawa catatan kredit", async () => {
    const dtl = await pesananSayaById(id.konsiMenunggu, salesAId);
    expect(dtl!.total).toBeNull();
    expect(dtl!.subtotal).toBeNull();
    expect(dtl!.baris[0].unitPrice).toBeNull();
    expect(dtl!.baris[0].lineTotal).toBeNull();
    expect(dtl!.kreditCatatan).toBeNull();
  });
});
