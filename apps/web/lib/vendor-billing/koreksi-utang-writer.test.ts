import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createVendorBill, voidVendorBill } from "./bill-writer";
import { putuskanSelisihHarga } from "./koreksi-utang-writer";
import { koreksiTagihan } from "./koreksi-utang-queries";
import { bacaInvoiceUntukBayar } from "./invoice-bayar-queries";
import { withSupplierPaid } from "./supplier-paid";
import { catatPembayaranPemasok } from "../purchasing/pembayaran-writer";
import { bacaHutangPemasok } from "../purchasing/pembayaran-hutang-queries";
import { isiDariInvoice } from "../purchasing/bayar-dari-invoice";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

/*
 * Selisih harga invoice yang DITERIMA menaikkan HPP penerimaannya (keputusan pemilik 2026-11-02, P49):
 * sisa stok di Gudang Utama dinilai ulang lewat `moveMainStock` qty 0, bagian yang sudah terjual menjadi
 * `PURCHASE_PRICE_VARIANCE`, utang dikoreksi lewat jurnal `SUPPLIER_PAYABLE_CORRECTION`. Basis data uji;
 * pemetaan akun dipulihkan lewat fixture terjaga.
 *
 * Skenario P49: stok 100 @ 7.000, lalu GRN 100 @ 8.000 (rata-rata 7.500), lalu 50 terjual → 150 tersisa,
 * 75 di antaranya dari GRN itu. Invoice 100 @ 8.500 diterima: stok naik 37.500, 12.500 HPP periode itu.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const ROLES = ["AP", "INVENTORY_FG", "PURCHASE_PRICE_VARIANCE", "PPN_MASUKAN", "BANK"] as const;
/** Tanggal pembayaran uji (WIB), dikirim juga sebagai "hari ini" supaya tidak bergantung jam mesin. */
const HARI = "2026-11-04";

d("putuskanSelisihHarga (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", uom: "", item: "", grn: "", iv: "" };
  const akun: Record<string, string> = {};
  let snapshot: MappingSnapshot = {};
  let mulai = new Date();

  beforeEach(async () => {
    tag = `KUW${Math.floor(Math.random() * 10_000_000)}`;
    mulai = new Date();
    snapshot = await snapshotMappings([...ROLES] as never);
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Uji Keputusan" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Uji" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Pemasok uji", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.item = (await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId: ids.uom, isActive: true } })).id;
    for (const [i, role] of ROLES.entries()) {
      const tipe = role === "AP" ? "LIABILITAS" : role === "PURCHASE_PRICE_VARIANCE" ? "HPP" : "ASET";
      akun[role] = (await prisma.chartAccount.create({ data: { code: `8${tag}${i}`, name: `${role} uji`, type: tipe, depth: 1, isActive: true } })).id;
      await prisma.journalAccountMapping.upsert({ where: { role }, create: { role, chartAccountId: akun[role] }, update: { chartAccountId: akun[role] } });
    }
    ids.grn = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-${tag}`,
          supplierId: ids.supplier,
          receivedBy: ids.user,
          totalAmount: 800_000,
          items: [{ itemId: ids.item, variantSku: null, qty: 100, unitCost: 8_000, totalCost: 800_000, itemType: "FINISHED_GOOD" }],
        },
        select: { id: true },
      })
    ).id;
    await prisma.journal.create({
      data: {
        date: new Date("2026-11-03"),
        description: `GRN uji ${tag}`,
        sourceType: "GRN",
        sourceId: ids.grn,
        postedById: ids.user,
        lines: { create: [{ chartAccountId: akun.INVENTORY_FG, debit: 800_000, credit: 0 }, { chartAccountId: akun.AP, debit: 0, credit: 800_000 }] },
      },
    });
    // The main pool as the ledger saw it: 100 @ 7.000, the GRN's 100 @ 8.000, then 50 sold.
    ids.iv = (await prisma.inventoryValue.create({ data: { itemId: ids.item, variantSku: null, qtyOnHand: 150, avgCost: 7_500, totalValue: 1_125_000 }, select: { id: true } })).id;
    const t0 = Date.now() - 60_000;
    const entri = [
      { refType: "OpeningStock", refId: `awal-${tag}`, qty: 100, balanceQty: 100, at: t0 },
      { refType: "GRN", refId: ids.grn, qty: 100, balanceQty: 200, at: t0 + 1_000 },
      { refType: "SpgSale", refId: `jual-${tag}`, qty: -50, balanceQty: 150, at: t0 + 2_000 },
    ];
    for (const e of entri) {
      await prisma.stockLedgerEntry.create({
        data: { locationType: "MAIN", itemId: ids.item, variantSku: "", type: e.qty > 0 ? "IN" : "OUT", qty: e.qty, balanceQty: e.balanceQty, refType: e.refType, refId: e.refId, createdAt: new Date(e.at) },
      });
    }
  });

  afterEach(async () => {
    if (ids.user) {
      const j = await prisma.journal.findMany({ where: { postedById: seededId(ids.user) }, select: { id: true } });
      if (j.length > 0) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(j.map((x) => x.id)) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(j.map((x) => x.id)) } } });
      }
    }
    await restoreMappings(snapshot);
    if (ids.supplier) {
      const bills = await prisma.vendorBill.findMany({ where: { supplierId: seededId(ids.supplier) }, select: { id: true } });
      const billIds = new Set(bills.map((b) => b.id));
      const bells = await prisma.adminNotification.findMany({ where: { category: "VENDOR_BILL_PRICE_DIFFERENCE", createdAt: { gte: mulai } }, select: { id: true, metadata: true } });
      const milik = bells.filter((n) => billIds.has(String((n.metadata as { billId?: unknown } | null)?.billId ?? ""))).map((n) => n.id);
      if (milik.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      await prisma.supplierPayableCorrection.deleteMany({ where: { supplierId: seededId(ids.supplier) } });
      await prisma.vendorBillLine.deleteMany({ where: { bill: { supplierId: seededId(ids.supplier) } } });
      await prisma.vendorBill.deleteMany({ where: { supplierId: seededId(ids.supplier) } });
      // Alokasinya ikut terhapus (onDelete: Cascade); jurnalnya sudah terhapus lewat postedById di atas.
      await prisma.supplierPayment.deleteMany({ where: { supplierId: seededId(ids.supplier) } });
      await prisma.vendorReturn.deleteMany({ where: { vendorId: seededId(ids.supplier) } });
    }
    if (ids.item) {
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(ids.item) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(ids.item) } });
    }
    if (ids.grn) await prisma.gRN.deleteMany({ where: { id: seededId(ids.grn) } });
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    const akunIds = Object.values(akun).filter(Boolean);
    if (akunIds.length > 0) await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    Object.keys(akun).forEach((k) => delete akun[k]);
    if (ids.item) await prisma.item.deleteMany({ where: { id: seededId(ids.item) } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: seededId(ids.supplier) } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  const tagih = (no: string, price: number, qty = 100) =>
    createVendorBill(
      {
        supplierId: ids.supplier,
        vendorInvoiceNo: `INV-${no}-${tag}`,
        billDate: new Date("2026-11-03"),
        lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.item, variantSku: null, qty, price }],
      },
      ids.user,
    );
  const koreksiOf = (billId: string) => prisma.supplierPayableCorrection.findFirstOrThrow({ where: { billId } });
  /** Retur ke pemasok yang SELESAI atas GRN uji (hanya baris dokumennya; stok tidak disentuh di sini). */
  const retur = (qty: number) =>
    prisma.vendorReturn.create({
      data: {
        docNumber: `RET-${tag}-${qty}`,
        vendorId: ids.supplier,
        grnId: ids.grn,
        lines: [{ itemId: ids.item, variantSku: null, qty }],
        totalItems: 1,
        totalValue: qty * 8_000,
        status: "COMPLETED",
        completedAt: new Date(),
        createdById: ids.user,
      },
      select: { id: true },
    });
  const bayar = (jumlah: number) =>
    catatPembayaranPemasok({
      pemasokId: ids.supplier,
      tanggal: HARI,
      hariIni: HARI,
      cara: "TRANSFER",
      rekeningId: akun.BANK,
      jenisPotong: "",
      alokasi: [{ jenis: "GRN", id: ids.grn, jumlah }],
      olehUserId: ids.user,
    });
  /** Buku pembantu hutang (Bayar Supplier) untuk GRN uji, dalam sen. */
  const hutangGrnSen = async () =>
    (await bacaHutangPemasok({ supplierIds: [ids.supplier] })).pemasok[0]?.dokumen.find((x) => x.jenis === "GRN" && x.id === ids.grn)?.hutangSen ?? null;
  /** Hutang usaha GRN uji di buku besar: jurnal penerimaannya + jurnal koreksi dan pembaliknya, dalam sen. */
  const apBukuBesarSen = async () => {
    const koreksi = (await prisma.supplierPayableCorrection.findMany({ where: { supplierId: seededId(ids.supplier) }, select: { id: true } })).map((x) => x.id);
    const jurnal = await prisma.journal.findMany({
      where: {
        status: "POSTED",
        OR: [
          { sourceType: "GRN", sourceId: seededId(ids.grn) },
          { sourceType: { in: ["SUPPLIER_PAYABLE_CORRECTION", "SUPPLIER_PAYABLE_CORRECTION_REVERSAL"] }, sourceId: { in: seededIds(koreksi) } },
        ],
      },
      include: { lines: true },
    });
    return jurnal
      .flatMap((j) => j.lines)
      .filter((l) => l.chartAccountId === akun.AP)
      .reduce((t, l) => t + Math.round(Number(l.credit) * 100) - Math.round(Number(l.debit) * 100), 0);
  };
  const garis = async (koreksiId: string, sourceType = "SUPPLIER_PAYABLE_CORRECTION") => {
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: koreksiId } }, include: { lines: true } });
    const peran = new Map(Object.entries(akun).map(([r, id]) => [id, r]));
    return j ? j.lines.map((l) => [peran.get(l.chartAccountId), Number(l.debit), Number(l.credit)]).sort() : null;
  };

  it("TERIMA raises the remaining stock's cost and puts the sold part in the period's HPP (P49)", async () => {
    const bill = await tagih("A", 8_500);
    const k = await koreksiOf(bill.id);
    expect([k.status, Number(k.amount), Number(k.recordedPrice)]).toEqual(["MENUNGGU", 50_000, 8_000]);
    expect(await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", catatan: "harga naik disetujui", olehUserId: ids.user })).toEqual({ ok: true, billId: bill.id });

    const after = await koreksiOf(bill.id);
    expect([after.status, Number(after.stockAmount), Number(after.soldAmount)]).toEqual(["DITERIMA", 37_500, 12_500]);
    const iv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } });
    expect([Number(iv.qtyOnHand), Number(iv.totalValue), Number(iv.avgCost)]).toEqual([150, 1_162_500, 7_750]);
    const entri = await prisma.stockLedgerEntry.findFirstOrThrow({ where: { refType: "SupplierPayableCorrection", refId: k.id } });
    expect([Number(entri.qty), Number(entri.balanceValue), Number(entri.totalCost)]).toEqual([0, 1_162_500, 37_500]);
    expect(await garis(k.id)).toEqual(
      [
        ["AP", 0, 50_000],
        ["INVENTORY_FG", 37_500, 0],
        ["PURCHASE_PRICE_VARIANCE", 12_500, 0],
      ].sort(),
    );
    expect(await prisma.auditLog.count({ where: { entityId: k.id, action: "SUPPLIER_PAYABLE_CORRECTION_ACCEPTED" } })).toBe(1);
    expect(await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("a lower invoice accepted lowers the cost; it can never be corrected upward (P53)", async () => {
    const bill = await tagih("B", 7_500);
    const k = await koreksiOf(bill.id);
    expect(await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "KOREKSI_INVOICE", olehUserId: ids.user })).toEqual({ ok: false, kode: "KOREKSI_TIDAK_BOLEH_NAIK" });
    expect((await koreksiOf(bill.id)).status).toBe("MENUNGGU");
    expect((await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    expect(Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } })).totalValue)).toBe(1_087_500);
  });

  it("KOREKSI_INVOICE takes the invoice at the receipt price with no journal and no stock movement", async () => {
    const bill = await tagih("C", 8_500, 10);
    const k = await koreksiOf(bill.id);
    expect((await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "KOREKSI_INVOICE", olehUserId: ids.user })).ok).toBe(true);
    const saved = await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id }, include: { lines: true } });
    expect([Number(saved.total), Number(saved.lines[0].price), Number(saved.lines[0].amount)]).toEqual([80_000, 8_000, 80_000]);
    expect((await koreksiOf(bill.id)).status).toBe("INVOICE_DIKOREKSI");
    expect(await garis(k.id)).toBeNull();
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "SupplierPayableCorrection", refId: k.id } })).toBe(0);
  });

  it("refuses with the unmapped role and leaves the correction waiting and the stock untouched", async () => {
    const bill = await tagih("D", 8_500);
    const k = await koreksiOf(bill.id);
    await prisma.journalAccountMapping.deleteMany({ where: { role: "PURCHASE_PRICE_VARIANCE" } });
    expect(await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).toEqual({ ok: false, kode: "UNMAPPED_ROLE", peran: "PURCHASE_PRICE_VARIANCE" });
    expect((await koreksiOf(bill.id)).status).toBe("MENUNGGU");
    expect(Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } })).totalValue)).toBe(1_125_000);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "SupplierPayableCorrection" , refId: k.id } })).toBe(0);
  });

  it("voiding the bill reverses an accepted correction by what is still in stock", async () => {
    const bill = await tagih("E", 8_500);
    const k = await koreksiOf(bill.id);
    await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user });
    await voidVendorBill(bill.id, "invoice salah", ids.user);
    expect((await koreksiOf(bill.id)).status).toBe("DIBATALKAN");
    expect(Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } })).totalValue)).toBe(1_125_000);
    expect(await garis(k.id, "SUPPLIER_PAYABLE_CORRECTION_REVERSAL")).toEqual(
      [
        ["AP", 50_000, 0],
        ["INVENTORY_FG", 0, 37_500],
        ["PURCHASE_PRICE_VARIANCE", 0, 12_500],
      ].sort(),
    );
  });

  it("the payable sub-ledger equals the GL after TERIMA and after the void reverses it", async () => {
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([80_000_000, 80_000_000]);
    const bill = await tagih("S", 8_500);
    const k = await koreksiOf(bill.id);
    // Menunggu keputusan: invoice tidak membuat utang kedua.
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([80_000_000, 80_000_000]);
    expect((await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([85_000_000, 85_000_000]);
    await voidVendorBill(bill.id, "invoice salah", ids.user);
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([80_000_000, 80_000_000]);
  });

  /*
   * Retur ke pemasok × selisih harga. Batas tagihan mengurangi retur selesai SEBELUM invoice boleh
   * menagih, jadi retur keluar dari pcs yang belum ditagih lebih dulu. Retur yang selesai SESUDAH
   * invoice menagih pcs-nya hanya mengkredit harga PO (`kredit-retur-writer.ts`, tidak diubah); menerima
   * selisih atas qty invoice itu menagih selisih untuk barang yang sudah kembali, jadi ditolak
   * (`ADA_RETUR`), dan tagihannya dibatalkan lalu dicatat ulang tanpa barang yang diretur.
   */
  it("ADA_RETUR: billed, then returned — TERIMA refused before any write; void and re-record bills the kept pieces", async () => {
    const bill = await tagih("H", 8_500);
    const k = await koreksiOf(bill.id);
    await retur(20);
    expect((await koreksiTagihan(bill.id)).map((x) => x.barangDiretur)).toEqual([20]);
    expect(await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).toEqual({ ok: false, kode: "ADA_RETUR" });
    const tetap = await koreksiOf(bill.id);
    expect([tetap.status, tetap.decidedAt, tetap.stockAmount]).toEqual(["MENUNGGU", null, null]);
    expect(await garis(k.id)).toBeNull();
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "SupplierPayableCorrection", refId: k.id } })).toBe(0);
    expect(Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } })).totalValue)).toBe(1_125_000);
    expect(await prisma.auditLog.count({ where: { entityId: k.id, action: "SUPPLIER_PAYABLE_CORRECTION_ACCEPTED" } })).toBe(0);
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([80_000_000, 80_000_000]);
    // Selama ada pcs tertagih yang sudah kembali, tidak ada sisa untuk ditagih lagi.
    await expect(tagih("H2", 8_500, 1)).rejects.toThrow();

    await voidVendorBill(bill.id, "sebagian barang diretur", ids.user);
    await expect(tagih("H3", 8_500, 81)).rejects.toThrow();
    const ulang = await tagih("H4", 8_500, 80);
    const k2 = await koreksiOf(ulang.id);
    expect(Number(k2.amount)).toBe(40_000);
    expect((await koreksiTagihan(ulang.id)).map((x) => x.barangDiretur)).toEqual([0]);
    expect((await putuskanSelisihHarga({ koreksiId: k2.id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([84_000_000, 84_000_000]);
  });

  it("a return completed after TERIMA is flagged on the decided row; void and re-record leaves the difference on kept pieces only", async () => {
    const bill = await tagih("J", 8_500);
    const k = await koreksiOf(bill.id);
    expect((await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    await retur(20);
    const [baris] = await koreksiTagihan(bill.id);
    expect([baris.status, baris.barangDiretur]).toEqual(["DITERIMA", 20]);
    await voidVendorBill(bill.id, "sebagian barang diretur sesudah diterima", ids.user);
    const ulang = await tagih("J2", 8_500, 80);
    expect((await putuskanSelisihHarga({ koreksiId: (await koreksiOf(ulang.id)).id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    // GRN uji tanpa PO: retur tidak mengkredit PO mana pun, jadi yang tersisa hanya 800.000 + 80 × 500.
    expect([await hutangGrnSen(), await apBukuBesarSen()]).toEqual([84_000_000, 84_000_000]);
  });

  it("Bayar per invoice: paying the fill for a ticked invoice makes it read PAID (R20 = R8)", async () => {
    const bill = await tagih("I", 8_500, 60);
    const k = await koreksiOf(bill.id);
    expect((await putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })).ok).toBe(true);
    const data = await bacaInvoiceUntukBayar(ids.supplier);
    const penerimaan = data.penerimaan.find((x) => x.jenis === "GRN" && x.id === ids.grn);
    expect(penerimaan?.qtyBelumDitagih).toBe(40);
    const isi = isiDariInvoice(data, new Set([bill.id]));
    // 60 pcs × utang tercatat 8.000 + selisih 30.000 yang diterima; 40 pcs tanpa invoice tidak diisi.
    expect(isi.get(penerimaan!.kunci)).toEqual({ isiSen: 51_000_000, ikutInvoiceLebihDulu: [], terhalang: null });
    expect((await bayar(isi.get(penerimaan!.kunci)!.isiSen / 100)).ok).toBe(true);
    const row = await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id }, select: { id: true, total: true, status: true } });
    const [dibaca] = await withSupplierPaid([{ id: row.id, total: Number(row.total), paidAmount: 0, status: row.status }]);
    expect([dibaca.status, dibaca.paidAmount]).toEqual(["PAID", 510_000]);
    expect(isiDariInvoice(await bacaInvoiceUntukBayar(ids.supplier), new Set([bill.id])).get(penerimaan!.kunci)?.terhalang).toBe("LUNAS");
  });

  /*
   * Pembayaran × invoice yang harganya berbeda pada GRN yang sama (P50: penerimaan menunggu keputusan).
   * Hasil yang sah hanya dua urutan serial: pembayaran lebih dulu (berhasil, invoice lalu mencatat
   * selisihnya), atau invoice lebih dulu (pembayaran ditolak KOREKSI_MENUNGGU). Kedua penulis selesai di
   * urutan mana pun — deadlock diulang `runSerializable`, tidak dilempar — dan sesudahnya pembayaran baru
   * atas penerimaan itu selalu menunggu. Dijalankan dua arah.
   */
  it.each([
    ["the invoice starts a few ms later", 0, 5],
    ["the payment starts a few ms later", 5, 0],
  ])("RACE: payment × an invoice with a different price on the same GRN (%s)", async (_n, tundaBayar, tundaTagih) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const [b, t] = await Promise.allSettled([sleep(tundaBayar).then(() => bayar(100_000)), sleep(tundaTagih).then(() => tagih(`R${tundaBayar}`, 8_500))]);
    expect(b.status).toBe("fulfilled");
    expect(t.status).toBe("fulfilled");
    if (b.status !== "fulfilled" || t.status !== "fulfilled") return;
    expect((await koreksiOf(t.value.id)).status).toBe("MENUNGGU");
    const dicatat = await prisma.supplierPayment.count({ where: { supplierId: seededId(ids.supplier) } });
    if (b.value.ok) expect(dicatat).toBe(1);
    else {
      expect(b.value).toEqual({ ok: false, kode: "KOREKSI_MENUNGGU", baris: 1 });
      expect(dicatat).toBe(0);
    }
    expect(await bayar(1_000)).toEqual({ ok: false, kode: "KOREKSI_MENUNGGU", baris: 1 });
  });

  it("RACE: two decisions on one correction — exactly one wins, one journal, one revaluation", async () => {
    const bill = await tagih("F", 8_500);
    const k = await koreksiOf(bill.id);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hasil = await Promise.all([
      putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user }),
      sleep(5).then(() => putuskanSelisihHarga({ koreksiId: k.id, keputusan: "KOREKSI_INVOICE", olehUserId: ids.user })),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIPUTUSKAN"]);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "SupplierPayableCorrection", refId: k.id } })).toBeLessThanOrEqual(1);
    expect(await prisma.journal.count({ where: { sourceType: "SUPPLIER_PAYABLE_CORRECTION", sourceId: k.id } })).toBeLessThanOrEqual(1);
  });

  /*
   * Status CAS `batalkanKoreksiTagihan` (di dalam `voidVendorBill`) melawan CAS keputusan. Hasil yang sah
   * hanya dua urutan serial: diterima lalu dibalik saat tagihan dibatalkan, atau dibatalkan dulu lalu
   * keputusannya ditolak. Yang TIDAK boleh: tagihan VOID sementara koreksinya DITERIMA, atau utang/stok
   * koreksi yang masih berdiri tanpa pembaliknya. Dijalankan dua arah — penulis yang lebih pendek bisa
   * selalu menang kalau mulainya tidak digeser.
   */
  it.each([
    ["the void starts a few ms later", 0, 5],
    ["the decision starts a few ms later", 5, 0],
  ])("RACE: TERIMA × void (%s) — never a void bill with an accepted correction still standing", async (_n, tundaTerima, tundaBatal) => {
    const bill = await tagih(`G${tundaTerima}`, 8_500);
    const k = await koreksiOf(bill.id);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const [terima, batal] = await Promise.allSettled([
      sleep(tundaTerima).then(() => putuskanSelisihHarga({ koreksiId: k.id, keputusan: "TERIMA", olehUserId: ids.user })),
      sleep(tundaBatal).then(() => voidVendorBill(bill.id, "invoice salah", ids.user)),
    ]);
    // Tidak ada pembayaran, jadi pembatalan selalu berhasil — di urutan mana pun.
    expect(batal.status).toBe("fulfilled");
    expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("VOID");
    expect((await koreksiOf(bill.id)).status).toBe("DIBATALKAN");

    const diterima = terima.status === "fulfilled" && terima.value.ok;
    if (diterima) {
      expect(await garis(k.id)).not.toBeNull();
      expect(await garis(k.id, "SUPPLIER_PAYABLE_CORRECTION_REVERSAL")).not.toBeNull();
    } else {
      expect(terima.status).toBe("fulfilled");
      if (terima.status === "fulfilled" && !terima.value.ok) expect(["TAGIHAN_DIBATALKAN", "SUDAH_DIPUTUSKAN"]).toContain(terima.value.kode);
      expect(await garis(k.id)).toBeNull();
      expect(await garis(k.id, "SUPPLIER_PAYABLE_CORRECTION_REVERSAL")).toBeNull();
    }
    // Utang dari koreksi dan pembaliknya bersih nol, dan nilai stok kembali seperti semula.
    const jurnal = await prisma.journal.findMany({
      where: { sourceId: k.id, sourceType: { in: ["SUPPLIER_PAYABLE_CORRECTION", "SUPPLIER_PAYABLE_CORRECTION_REVERSAL"] } },
      include: { lines: true },
    });
    const apBersih = jurnal.flatMap((j) => j.lines).filter((l) => l.chartAccountId === akun.AP).reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    expect(apBersih).toBe(0);
    expect(Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id: ids.iv } })).totalValue)).toBe(1_125_000);
  });
});
