import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { hitungSisaPiutang, type StatusKlaim } from "@/lib/receivables/rules";
import { PILIH_POTONGAN, potonganRetur } from "@/lib/receivables/deductions";
import { kanalMarketplace, KANAL_MARKETPLACE, type KanalJurnal } from "@/lib/finance/journals/kanal";
import type { EntriHutang, EntriPiutangMarketplace, EntriPiutangToko } from "./jenis";
import type { BarisStok } from "./persediaan";
import { dariSen, keSen } from "./jurnal";

/*
 * Angka saldo awal yang DIHITUNG dari modul operasional, per tanggal mulai
 * buku besar. Hanya membaca. Setiap fungsi menerima cakupan (id dokumen) —
 * tanpa cakupan ia membaca seluruh basis data; tes selalu memakai cakupan.
 */

type AnyClient = PrismaClient | Prisma.TransactionClient;

const POTONGAN = 1000;

function potong<T>(xs: readonly T[]): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < xs.length; i += POTONGAN) hasil.push(xs.slice(i, i + POTONGAN));
  return hasil;
}

/**
 * Piutang toko per tanggal mulai, per toko, dari modul piutang — aturan uangnya
 * sama dengan `daftarPiutang` (`hitungSisaPiutang` + `potonganRetur`), dengan
 * satu beda: hanya pelunasan (BKM) yang DIVERIFIKASI SEBELUM tanggal mulai yang
 * mengurangi. Pelunasan sesudahnya dijurnal sendiri (DR Bank / CR Piutang),
 * jadi faktur itu harus masih utuh di saldo awal.
 *
 * Hanya faktur bertanggal sebelum tanggal mulai, dan toko KONSINYASI tidak
 * pernah ikut (sama dengan modul piutang).
 */
export async function hitungPiutangTokoAwal(
  tanggalMulai: Date,
  opsi: { storeIds?: string[]; client?: AnyClient } = {},
): Promise<EntriPiutangToko[]> {
  const client = opsi.client ?? prisma;
  const rows = await client.receivable.findMany({
    where: {
      invoiceDate: { lt: tanggalMulai },
      store: { termsType: { not: "KONSI" } },
      ...(opsi.storeIds ? { storeId: { in: opsi.storeIds } } : {}),
    },
    select: {
      storeId: true,
      amount: true,
      paidBeforeImport: true,
      store: { select: { code: true, name: true } },
      claimLinks: {
        select: {
          settledAmount: true,
          paymentClaim: {
            select: {
              status: true,
              invoiceAmount: true,
              verifiedAt: true,
              updatedAt: true,
              deductions: { select: PILIH_POTONGAN },
            },
          },
        },
      },
    },
  });

  const perToko = new Map<string, EntriPiutangToko & { sen: number }>();
  for (const r of rows) {
    const klaimList = r.claimLinks.map((l) => {
      const k = l.paymentClaim;
      const waktuVerifikasi = k.verifiedAt ?? k.updatedAt;
      const diakuiSebelum = k.status === "TERVERIFIKASI" && waktuVerifikasi < tanggalMulai;
      return {
        status: (diakuiSebelum ? "TERVERIFIKASI" : "DIKIRIM") as StatusKlaim,
        nilaiFaktur: Number(k.invoiceAmount),
        potonganRetur: potonganRetur(k.deductions),
        nilaiDilunasiPiutangIni: Number(l.settledAmount),
      };
    });
    const sisa = hitungSisaPiutang(Number(r.amount), klaimList, Number(r.paidBeforeImport));
    if (sisa <= 0) continue;
    const ada = perToko.get(r.storeId) ?? { storeId: r.storeId, kode: r.store.code, nama: r.store.name, faktur: 0, jumlah: 0, sen: 0 };
    ada.faktur += 1;
    ada.sen += keSen(sisa);
    perToko.set(r.storeId, ada);
  }
  return [...perToko.values()]
    .map(({ sen, ...e }) => ({ ...e, jumlah: dariSen(sen) }))
    .sort((a, b) => (a.nama ?? "").localeCompare(b.nama ?? "", "id"));
}

/**
 * Piutang marketplace per tanggal mulai, per kanal: pesanan TERKIRIM sebelum
 * tanggal mulai (definisi "terkirim" dan tanggalnya sama dengan sapuan jurnal
 * penjualan: status SHIPPED/COMPLETED atau fulfillment SHIPPED, bertanggal
 * `shippedAt`, atau `transactionDate` bila kosong) yang dananya BELUM cair per
 * tanggal itu — belum masuk settlement mana pun, atau settlement-nya berakhir
 * pada/sesudah tanggal mulai (settlement itu yang nanti mengkredit piutangnya).
 * Pesanan yang sudah punya jurnal pendapatan dilewati (piutangnya sudah di
 * buku besar). Nilai = `grandTotal`, dasar yang sama dengan jurnal penjualan.
 */
export async function hitungPiutangMarketplaceAwal(
  tanggalMulai: Date,
  opsi: { orderIds?: string[]; client?: AnyClient } = {},
): Promise<EntriPiutangMarketplace[]> {
  const client = opsi.client ?? prisma;
  const pesanan = await client.salesOrder.findMany({
    where: {
      isCanceled: false,
      ...(opsi.orderIds ? { id: { in: opsi.orderIds } } : {}),
      AND: [
        { OR: [{ status: { in: ["SHIPPED", "COMPLETED"] } }, { fulfillmentStatus: "SHIPPED" }] },
        { OR: [{ shippedAt: { lt: tanggalMulai } }, { shippedAt: null, transactionDate: { lt: tanggalMulai } }] },
      ],
    },
    select: { id: true, channel: true, grandTotal: true },
  });

  const keluar = new Set<string>();
  for (const ids of potong(pesanan.map((p) => p.id))) {
    const [berjurnal, cair] = await Promise.all([
      client.journal.findMany({ where: { sourceType: "SALESORDER_REVENUE", sourceId: { in: ids } }, select: { sourceId: true } }),
      client.settlementLine.findMany({
        where: { matchedSalesOrderId: { in: ids }, settlement: { periodTo: { lt: tanggalMulai } } },
        select: { matchedSalesOrderId: true },
      }),
    ]);
    for (const j of berjurnal) if (j.sourceId) keluar.add(j.sourceId);
    for (const s of cair) if (s.matchedSalesOrderId) keluar.add(s.matchedSalesOrderId);
  }

  const perKanal = new Map<KanalJurnal, { sen: number; pesanan: number }>();
  for (const p of pesanan) {
    if (keluar.has(p.id)) continue;
    const kanal = kanalMarketplace(p.channel);
    const ada = perKanal.get(kanal) ?? { sen: 0, pesanan: 0 };
    ada.sen += keSen(Number(p.grandTotal));
    ada.pesanan += 1;
    perKanal.set(kanal, ada);
  }
  return KANAL_MARKETPLACE.filter((k) => perKanal.has(k)).map((kanal) => ({
    kanal,
    pesanan: perKanal.get(kanal)!.pesanan,
    jumlah: dariSen(perKanal.get(kanal)!.sen),
  }));
}

/**
 * Hutang pemasok per tanggal mulai, per pemasok: penerimaan barang (GRN)
 * sebelum tanggal mulai yang belum dibayar per tanggal itu (PO-nya belum
 * ditandai lunas, atau ditandai lunas pada/sesudah tanggal mulai), tidak
 * ditolak pemilik, dan BELUM punya jurnal GRN (yang sudah berjurnal hutangnya
 * sudah di buku besar). Dikurangi alokasi pembayaran pemasok sebelum tanggal
 * mulai ke GRN itu. Nilai = `GRN.totalAmount`, dasar yang sama dengan jurnal GRN.
 */
export async function hitungHutangPemasokAwal(
  tanggalMulai: Date,
  opsi: { grnIds?: string[]; client?: AnyClient } = {},
): Promise<EntriHutang[]> {
  const client = opsi.client ?? prisma;
  const grn = await client.gRN.findMany({
    where: {
      grnDate: { lt: tanggalMulai },
      ownerDeclinedAt: null,
      ...(opsi.grnIds ? { id: { in: opsi.grnIds } } : {}),
    },
    select: {
      id: true,
      supplierId: true,
      totalAmount: true,
      supplier: { select: { code: true, name: true } },
      po: { select: { paidAt: true } },
    },
  });
  const belumLunas = grn.filter((g) => !(g.po?.paidAt && g.po.paidAt < tanggalMulai));

  const berjurnal = new Set<string>();
  const dibayarSen = new Map<string, number>();
  for (const ids of potong(belumLunas.map((g) => g.id))) {
    const [jurnal, alokasi] = await Promise.all([
      client.journal.findMany({ where: { sourceType: "GRN", sourceId: { in: ids } }, select: { sourceId: true } }),
      client.supplierPaymentAllocation.findMany({
        where: { targetType: "GRN", targetId: { in: ids }, payment: { status: "POSTED", date: { lt: tanggalMulai } } },
        select: { targetId: true, amount: true },
      }),
    ]);
    for (const j of jurnal) if (j.sourceId) berjurnal.add(j.sourceId);
    for (const a of alokasi) if (a.targetId) dibayarSen.set(a.targetId, (dibayarSen.get(a.targetId) ?? 0) + keSen(Number(a.amount)));
  }

  const perPemasok = new Map<string, EntriHutang & { sen: number }>();
  for (const g of belumLunas) {
    if (berjurnal.has(g.id)) continue;
    const sisaSen = keSen(Number(g.totalAmount)) - (dibayarSen.get(g.id) ?? 0);
    if (sisaSen <= 0) continue;
    const ada = perPemasok.get(g.supplierId) ?? { supplierId: g.supplierId, kode: g.supplier.code, nama: g.supplier.name, grn: 0, jumlah: 0, sen: 0 };
    ada.grn = (ada.grn ?? 0) + 1;
    ada.sen += sisaSen;
    perPemasok.set(g.supplierId, ada);
  }
  return [...perPemasok.values()]
    .map(({ sen, ...e }) => ({ ...e, jumlah: dariSen(sen) }))
    .sort((a, b) => (a.nama ?? "").localeCompare(b.nama ?? "", "id"));
}

/** Baris stok gudang utama (`InventoryValue`) beserta barangnya. Cakupan = id barang. */
export async function bacaStokSaldoAwal(opsi: { itemIds?: string[]; client?: AnyClient } = {}): Promise<BarisStok[]> {
  const client = opsi.client ?? prisma;
  const rows = await client.inventoryValue.findMany({
    where: opsi.itemIds ? { itemId: { in: opsi.itemIds } } : {},
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      qtyOnHand: true,
      avgCost: true,
      totalValue: true,
      item: { select: { sku: true, nameId: true, type: true } },
    },
    orderBy: [{ item: { sku: "asc" } }, { variantSku: "asc" }],
  });
  return rows.map((r) => ({
    ivId: r.id,
    itemId: r.itemId,
    skuBarang: r.item.sku,
    variantSku: r.variantSku,
    nama: r.item.nameId,
    tipe: r.item.type,
    qty: Number(r.qtyOnHand),
    avgCost: Number(r.avgCost),
    totalValue: Number(r.totalValue),
  }));
}
