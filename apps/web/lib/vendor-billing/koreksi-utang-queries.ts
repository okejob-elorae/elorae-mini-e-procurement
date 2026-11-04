import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { STATUS_KOREKSI_UTANG, type RincianSelisih, type StatusKoreksiUtang } from "./koreksi-utang-aturan";
import { grnLineKey, grnLineSource } from "./bill-paid-rule";
import { invoicedReturnedQtyByGrnLine } from "./billable";

/*
 * Pembaca koreksi utang pemasok (selisih harga invoice). KHUSUS SERVER: komponen klien hanya boleh
 * `import type` dari berkas ini. Tabel koreksinya ada di MariaDB DAN PostgreSQL (penulis pembayaran
 * pemasok membacanya pada setiap pembayaran); tabel tagihan vendor hanya di MariaDB, jadi setiap
 * bacaan tagihan di sini dilakukan sesudah ada koreksinya.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const SUMBER_KOREKSI = { GRN: "GRN", WO_STEP: "WO_STEP" } as const;
export type SumberKoreksi = (typeof SUMBER_KOREKSI)[keyof typeof SUMBER_KOREKSI];

export const SUMBER_JURNAL_KOREKSI_UTANG = "SUPPLIER_PAYABLE_CORRECTION";
export const SUMBER_JURNAL_KOREKSI_UTANG_BALIK = "SUPPLIER_PAYABLE_CORRECTION_REVERSAL";

const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Baca `breakdown` tersimpan; baris yang tidak terbaca dilewati. */
export function bacaRincianKoreksi(raw: unknown): Array<RincianSelisih & { lokasi?: Array<{ jenis: "MAIN" | "STORE" | "VAN"; lokasiId: string; nilai: number }> }> {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (r): r is RincianSelisih => typeof r === "object" && r !== null && typeof (r as RincianSelisih).itemId === "string" && typeof (r as RincianSelisih).dokumenId === "string",
  );
}

/**
 * Penerimaan yang punya selisih harga MENUNGGU keputusan — seluruh penerimaan itu belum bisa dibayar
 * (keputusan pemilik 2026-11-02, P50). Kunci = `kunciDokumenHutang(jenis, id)`. Dibaca penulis
 * pembayaran pemasok DI DALAM transaksi serializable-nya.
 */
export async function penerimaanKoreksiMenunggu(db: Db, kunci: string[]): Promise<Map<string, Array<{ billId: string; vendorInvoiceNo: string }>>> {
  const hasil = new Map<string, Array<{ billId: string; vendorInvoiceNo: string }>>();
  const perJenis = new Map<string, Set<string>>();
  for (const k of new Set(kunci)) {
    const i = k.indexOf("|");
    if (i <= 0) continue;
    const jenis = k.slice(0, i);
    if (jenis !== SUMBER_KOREKSI.GRN && jenis !== SUMBER_KOREKSI.WO_STEP) continue;
    const set = perJenis.get(jenis) ?? new Set<string>();
    set.add(k.slice(i + 1));
    perJenis.set(jenis, set);
  }
  if (perJenis.size === 0) return hasil;
  const rows = await db.supplierPayableCorrection.findMany({
    where: {
      status: STATUS_KOREKSI_UTANG.MENUNGGU,
      OR: [...perJenis].map(([jenis, ids]) => ({ sourceType: jenis, sourceId: { in: [...ids] } })),
    },
    select: { sourceType: true, sourceId: true, billId: true },
  });
  if (rows.length === 0) return hasil;
  const bills = await db.vendorBill.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.billId))] } },
    select: { id: true, vendorInvoiceNo: true },
  });
  const nomor = new Map(bills.map((b) => [b.id, b.vendorInvoiceNo]));
  for (const r of rows) {
    const k = kunciDokumenHutang(r.sourceType, r.sourceId);
    const daftar = hasil.get(k) ?? [];
    if (!daftar.some((d) => d.billId === r.billId)) daftar.push({ billId: r.billId, vendorInvoiceNo: nomor.get(r.billId) ?? "" });
    hasil.set(k, daftar);
  }
  return hasil;
}

/**
 * Hutang usaha dari koreksi selisih harga yang SUDAH dijurnal, per penerimaan: Σ (kredit − debit)
 * akun hutang usaha di jurnal koreksi dan pembaliknya yang berlaku (sama dengan buku besar), dan DPP
 * koreksi yang jurnalnya masih berdiri (dasar potongan PPh jasa). Kunci = `kunciDokumenHutang`.
 */
export async function apKoreksiPerPenerimaan(
  db: Db,
  s: { grnIds?: string[]; woStepIds?: string[] },
  apAkunId: string,
): Promise<Map<string, { apSen: number; dppSen: number }>> {
  const hasil = new Map<string, { apSen: number; dppSen: number }>();
  const or: Prisma.SupplierPayableCorrectionWhereInput[] = [];
  if (s.grnIds && s.grnIds.length > 0) or.push({ sourceType: SUMBER_KOREKSI.GRN, sourceId: { in: [...new Set(s.grnIds)] } });
  if (s.woStepIds && s.woStepIds.length > 0) or.push({ sourceType: SUMBER_KOREKSI.WO_STEP, sourceId: { in: [...new Set(s.woStepIds)] } });
  if (or.length === 0) return hasil;
  const koreksi = await db.supplierPayableCorrection.findMany({
    where: { OR: or, status: { in: [STATUS_KOREKSI_UTANG.DITERIMA, STATUS_KOREKSI_UTANG.DIBATALKAN] } },
    select: { id: true, sourceType: true, sourceId: true, dppAmount: true },
  });
  if (koreksi.length === 0) return hasil;
  const jurnal = await db.journal.findMany({
    where: {
      sourceType: { in: [SUMBER_JURNAL_KOREKSI_UTANG, SUMBER_JURNAL_KOREKSI_UTANG_BALIK] },
      sourceId: { in: koreksi.map((k) => k.id) },
      status: "POSTED",
    },
    select: { sourceType: true, sourceId: true, lines: { where: { chartAccountId: apAkunId }, select: { debit: true, credit: true } } },
  });
  const apPer = new Map<string, number>();
  const berdiri = new Set<string>();
  const dibalik = new Set<string>();
  for (const j of jurnal) {
    if (!j.sourceId) continue;
    apPer.set(j.sourceId, (apPer.get(j.sourceId) ?? 0) + j.lines.reduce((t, l) => t + sen(l.credit) - sen(l.debit), 0));
    if (j.sourceType === SUMBER_JURNAL_KOREKSI_UTANG) berdiri.add(j.sourceId);
    else dibalik.add(j.sourceId);
  }
  for (const k of koreksi) {
    const ap = apPer.get(k.id) ?? 0;
    const hidup = berdiri.has(k.id) && !dibalik.has(k.id);
    if (ap === 0 && !hidup) continue;
    const kunci = kunciDokumenHutang(k.sourceType, k.sourceId);
    const cur = hasil.get(kunci) ?? { apSen: 0, dppSen: 0 };
    cur.apSen += ap;
    if (hidup) cur.dppSen += sen(k.dppAmount);
    hasil.set(kunci, cur);
  }
  return hasil;
}

/** Jumlah selisih harga yang menunggu keputusan (baris Beranda). */
export async function hitungSelisihHargaMenunggu(db: Db = prisma): Promise<number> {
  return db.supplierPayableCorrection.count({ where: { status: STATUS_KOREKSI_UTANG.MENUNGGU } });
}

export type BarisSelisihHarga = {
  id: string;
  billId: string;
  billLineId: string;
  /** Qty baris tagihannya; lebih dari `qty` = baris itu ikut membukukan ongkos jahit lama (KOREKSI_INVOICE ditolak). */
  lineQty: number;
  billDocNumber: string;
  vendorInvoiceNo: string;
  billDate: string;
  billVoid: boolean;
  supplierId: string;
  supplierName: string;
  sourceType: SumberKoreksi;
  sourceId: string;
  /** "GRN/2026/11/0003" atau "WO-… · 1 Jahit". */
  penerimaan: string;
  poId: string | null;
  poNomor: string | null;
  barang: string;
  variantSku: string | null;
  qty: number;
  recordedPrice: number;
  invoicePrice: number;
  amount: number;
  dppAmount: number;
  ppnInputAmount: number;
  inventoryAmount: number;
  stockAmount: number | null;
  soldAmount: number | null;
  status: StatusKoreksiUtang;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  /**
   * Pcs yang sudah ditagih pada kunci GRN-nya lalu diretur ke pemasok (`invoicedReturnedQtyByGrnLine`);
   * 0 untuk langkah WO. Di atas nol: selisihnya tetap boleh diterima (P27/P53), tetapi utangnya ikut
   * menghitung selisih atas barang yang diretur — angka yang tepat didapat dengan membatalkan tagihan lalu
   * mencatat ulang.
   */
  barangDiretur: number;
};

async function susunBaris(db: Db, rows: Prisma.SupplierPayableCorrectionGetPayload<object>[]): Promise<BarisSelisihHarga[]> {
  if (rows.length === 0) return [];
  const grnIds = [...new Set(rows.filter((r) => r.sourceType === SUMBER_KOREKSI.GRN).map((r) => r.sourceId))];
  const [bills, suppliers, grns, steps, items, users, lines, diretur] = await Promise.all([
    db.vendorBill.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.billId))] } },
      select: { id: true, docNumber: true, vendorInvoiceNo: true, billDate: true, status: true },
    }),
    db.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } }),
    db.gRN.findMany({
      where: { id: { in: grnIds } },
      select: { id: true, docNumber: true, poId: true, po: { select: { docNumber: true } } },
    }),
    db.workOrderStep.findMany({
      where: { id: { in: rows.filter((r) => r.sourceType === SUMBER_KOREKSI.WO_STEP).map((r) => r.sourceId) } },
      select: { id: true, sequence: true, stepName: true, wo: { select: { docNumber: true, finishedGood: { select: { nameId: true } } } } },
    }),
    db.item.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.itemId ? [r.itemId] : [])))] } }, select: { id: true, nameId: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.decidedById ? [r.decidedById] : [])))] } }, select: { id: true, name: true, email: true } }),
    db.vendorBillLine.findMany({ where: { id: { in: rows.map((r) => r.billLineId) } }, select: { id: true, qty: true } }),
    invoicedReturnedQtyByGrnLine(db, grnIds),
  ]);
  const qtyBaris = new Map(lines.map((l) => [l.id, Number(l.qty)]));
  const bill = new Map(bills.map((b) => [b.id, b]));
  const pemasok = new Map(suppliers.map((s) => [s.id, s.name]));
  const grn = new Map(grns.map((g) => [g.id, g]));
  const step = new Map(steps.map((s) => [s.id, s]));
  const item = new Map(items.map((i) => [i.id, i.nameId]));
  const user = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
  return rows.map((r) => {
    const b = bill.get(r.billId);
    const g = r.sourceType === SUMBER_KOREKSI.GRN ? grn.get(r.sourceId) : undefined;
    const st = r.sourceType === SUMBER_KOREKSI.WO_STEP ? step.get(r.sourceId) : undefined;
    const penerimaan = g ? g.docNumber : st ? `${st.wo.docNumber} · ${st.sequence}${st.stepName ? ` ${st.stepName}` : ""}` : r.sourceId;
    return {
      id: r.id,
      billId: r.billId,
      billLineId: r.billLineId,
      lineQty: qtyBaris.get(r.billLineId) ?? Number(r.qty),
      billDocNumber: b?.docNumber ?? "",
      vendorInvoiceNo: b?.vendorInvoiceNo ?? "",
      billDate: b ? formatDateOnlyJakarta(b.billDate) : "",
      billVoid: b?.status === "VOID",
      supplierId: r.supplierId,
      supplierName: pemasok.get(r.supplierId) ?? "",
      sourceType: r.sourceType as SumberKoreksi,
      sourceId: r.sourceId,
      penerimaan,
      poId: g?.poId ?? null,
      poNomor: g?.po?.docNumber ?? null,
      barang: (r.itemId ? item.get(r.itemId) : undefined) ?? st?.wo.finishedGood?.nameId ?? "",
      variantSku: r.variantSku,
      qty: Number(r.qty),
      recordedPrice: Number(r.recordedPrice),
      invoicePrice: Number(r.invoicePrice),
      amount: Number(r.amount),
      dppAmount: Number(r.dppAmount),
      ppnInputAmount: Number(r.ppnInputAmount),
      inventoryAmount: Number(r.inventoryAmount),
      stockAmount: r.stockAmount == null ? null : Number(r.stockAmount),
      soldAmount: r.soldAmount == null ? null : Number(r.soldAmount),
      status: r.status as StatusKoreksiUtang,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedBy: r.decidedById ? user.get(r.decidedById) ?? null : null,
      decisionNote: r.decisionNote,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt.toISOString(),
      barangDiretur: g && r.itemId ? diretur.get(grnLineSource(r.sourceId, grnLineKey(r.itemId, r.variantSku))) ?? 0 : 0,
    };
  });
}

/** Daftar selisih harga: MENUNGGU, atau yang sudah diputuskan (diterima / invoice dikoreksi). Paling lama 500, terbaru dulu. */
export async function daftarSelisihHarga(o: { status?: "MENUNGGU" | "DIPUTUSKAN"; supplierId?: string }, db: Db = prisma): Promise<BarisSelisihHarga[]> {
  const status =
    o.status === "DIPUTUSKAN"
      ? { in: [STATUS_KOREKSI_UTANG.DITERIMA, STATUS_KOREKSI_UTANG.INVOICE_DIKOREKSI] }
      : STATUS_KOREKSI_UTANG.MENUNGGU;
  const rows = await db.supplierPayableCorrection.findMany({
    where: { status, ...(o.supplierId ? { supplierId: o.supplierId } : {}) },
    orderBy: [{ createdAt: o.status === "DIPUTUSKAN" ? "desc" : "asc" }, { id: "asc" }],
    take: 500,
  });
  return susunBaris(db, rows);
}

/** Koreksi satu tagihan, untuk kartu "Selisih harga invoice" di halaman tagihannya. */
export async function koreksiTagihan(billId: string, db: Db = prisma): Promise<BarisSelisihHarga[]> {
  const rows = await db.supplierPayableCorrection.findMany({ where: { billId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return susunBaris(db, rows);
}
