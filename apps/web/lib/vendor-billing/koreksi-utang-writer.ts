import { lockMainInventoryValueRow, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { peranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { SUMBER_JURNAL_PENERIMAAN_FG } from "@/lib/production/fg-receipt-journal";
import { selaraskanLunasPoSesudahKoreksi } from "@/lib/purchasing/pembayaran-writer";
import {
  barisJurnalBalikKoreksiUtang,
  barisJurnalKoreksiUtang,
  bolehKoreksiInvoice,
  KEPUTUSAN_SELISIH,
  MAKS_CATATAN_KEPUTUSAN,
  MIN_SELISIH,
  STATUS_KOREKSI_UTANG,
  type KeputusanSelisih,
  type PeranStokKoreksi,
  type RincianSelisih,
  type SelisihUtang,
} from "./koreksi-utang-aturan";
import { postKoreksiUtangJournal, postKoreksiUtangReversalJournal } from "./koreksi-utang-journal";
import { bacaRincianKoreksi, SUMBER_KOREKSI } from "./koreksi-utang-queries";
import { grnLineKey, grnLineSource } from "./bill-paid-rule";
import { invoicedReturnedQtyByGrnLine } from "./billable";
import { susunKabarSelisihHarga, VENDOR_BILL_PRICE_DIFFERENCE, type NotifikasiKantor } from "./kabar-pemasok";
import { bacaSebaranLapisan, bacaSisaSejakEntri } from "./sisa-lapisan-queries";
import { bagiNilaiPerLokasi } from "./sisa-lapisan";
import { nilaiUlangStokToko, nilaiUlangStokUtama, nilaiUlangStokVan } from "./nilai-ulang-stok";

/*
 * Penulis koreksi utang pemasok — selisih harga invoice (keputusan pemilik 2026-11-02, P20, P27, P49,
 * P50, P53). KHUSUS SERVER, tanpa `@/lib/auth`: izinnya diperiksa aksinya
 * (`putuskanSelisihHargaAction`, `vendor_bills:decide_price`).
 *
 * - `buatKoreksiUtang`: di dalam transaksi `createVendorBill`, satu baris MENUNGGU per baris invoice
 *   yang harganya berbeda dari utang tercatat (naik ATAU turun), jejaknya, dan SATU lonceng
 *   `VENDOR_BILL_PRICE_DIFFERENCE` per tagihan. Invoice tidak pernah membuat utang kedua; hanya koreksi
 *   yang diterima menggerakkan utang.
 * - `putuskanSelisihHarga`: TERIMA (dua arah) atau KOREKSI_INVOICE (hanya invoice lebih tinggi), satu
 *   `runSerializable`. Setiap penolakan diperiksa SEBELUM tulisan pertama; yang bisa gagal sesudahnya
 *   (jurnal) MELEMPAR, karena `runSerializable` menyimpan apa pun yang dikembalikan callback-nya.
 * - `batalkanKoreksiTagihan`: di dalam transaksi `voidVendorBill` — MENUNGGU dan INVOICE_DIKOREKSI
 *   dibatalkan, DITERIMA dibalik (jurnal pembalik + penilaian ulang sisa stok yang masih ada).
 * Setiap keputusan meninggalkan jejaknya (`JEJAK`) di transaksi yang sama.
 */

type Tx = Prisma.TransactionClient;

export type KodeGalatKoreksi =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "TAGIHAN_DIBATALKAN"
  | "KEPUTUSAN_TIDAK_SAH"
  | "CATATAN_TERLALU_PANJANG"
  | "PENERIMAAN_BELUM_BERJURNAL"
  | "KOREKSI_TIDAK_BOLEH_NAIK"
  | "ADA_CMT_LAMA"
  | "ADA_RETUR"
  | "UNMAPPED_ROLE"
  | "JURNAL_GAGAL";

class TolakKoreksi extends Error {
  constructor(
    public kode: KodeGalatKoreksi,
    public peran?: string,
  ) {
    super(kode);
  }
}

const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const rp = (s: number) => Math.round(s) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type BarisKoreksiBaru = {
  billLineId: string;
  jenis: "GRN" | "WO_STEP";
  sumberId: string;
  itemId: string | null;
  variantSku: string | null;
  qty: number;
  hargaTercatat: number;
  hargaInvoice: number;
  selisih: SelisihUtang;
};

/**
 * Di dalam transaksi tagihan: koreksi MENUNGGU untuk setiap baris yang selisihnya ≥ Rp 0,01, jejak per
 * baris, dan satu lonceng per tagihan (dikembalikan untuk dikirim SESUDAH commit).
 */
export async function buatKoreksiUtang(
  tx: Tx,
  a: {
    bill: { id: string; docNumber: string; vendorInvoiceNo: string; billDate: Date; supplierId: string; namaPemasok: string };
    baris: BarisKoreksiBaru[];
    olehUserId: string;
  },
): Promise<{ jumlah: number; notifikasi: NotifikasiKantor | null }> {
  const ada = a.baris.filter((b) => Math.abs(b.selisih.jumlah) >= MIN_SELISIH);
  if (ada.length === 0) return { jumlah: 0, notifikasi: null };
  let totalSen = 0;
  for (const b of ada) {
    const k = await tx.supplierPayableCorrection.create({
      data: {
        billId: a.bill.id,
        billLineId: b.billLineId,
        supplierId: a.bill.supplierId,
        sourceType: b.jenis,
        sourceId: b.sumberId,
        itemId: b.itemId,
        variantSku: b.variantSku,
        qty: b.qty,
        recordedPrice: round2(b.hargaTercatat),
        invoicePrice: round2(b.hargaInvoice),
        amount: b.selisih.jumlah,
        dppAmount: b.selisih.dpp,
        ppnInputAmount: b.selisih.ppnMasukan,
        inventoryAmount: b.selisih.persediaan,
        breakdown: b.selisih.rincian as unknown as Prisma.InputJsonValue,
        status: STATUS_KOREKSI_UTANG.MENUNGGU,
        createdById: a.olehUserId,
      },
      select: { id: true },
    });
    totalSen += sen(b.selisih.jumlah);
    await catatJejak(tx, {
      userId: a.olehUserId,
      action: JEJAK.KOREKSI_UTANG_DIBUAT,
      entityType: "SupplierPayableCorrection",
      entityId: k.id,
      changes: {
        after: {
          status: STATUS_KOREKSI_UTANG.MENUNGGU,
          billId: a.bill.id,
          billLineId: b.billLineId,
          sumber: `${b.jenis}|${b.sumberId}`,
          qty: b.qty,
          hargaTercatat: round2(b.hargaTercatat),
          hargaInvoice: round2(b.hargaInvoice),
          jumlah: b.selisih.jumlah,
        },
      },
      metadata: { billDocNumber: a.bill.docNumber, vendorInvoiceNo: a.bill.vendorInvoiceNo },
    });
  }
  const teks = susunKabarSelisihHarga({
    namaPemasok: a.bill.namaPemasok,
    vendorInvoiceNo: a.bill.vendorInvoiceNo,
    docNumber: a.bill.docNumber,
    jumlah: ada.length,
    totalSelisih: rp(totalSen),
  });
  const n = await tx.adminNotification.create({
    data: {
      category: VENDOR_BILL_PRICE_DIFFERENCE,
      severity: "WARNING",
      title: teks.title,
      message: teks.message,
      metadata: { billId: a.bill.id, supplierId: a.bill.supplierId, docNumber: a.bill.docNumber, count: ada.length, amountSen: totalSen },
    },
    select: { id: true, category: true, title: true, message: true, metadata: true },
  });
  return { jumlah: ada.length, notifikasi: n };
}

type BarisTerapan = RincianSelisih & { lokasi: Array<{ jenis: "MAIN" | "STORE" | "VAN"; lokasiId: string; nilai: number }>; keluar: number };

function peranLokasi(jenis: "MAIN" | "STORE" | "VAN", tipeBarang: string | null): PeranStokKoreksi {
  if (jenis === "STORE") return "INVENTORY_CONSIGNMENT";
  if (jenis === "VAN") return "INVENTORY_VAN";
  return peranPersediaan(tipeBarang);
}

/** Stok tersisa dari tiap baris rincian dinilai ulang (dikunci dulu); bagian yang sudah keluar dikembalikan. */
async function terapkanKeStok(tx: Tx, k: { id: string }, rincian: RincianSelisih[], nomor: (r: RincianSelisih) => string, olehUserId: string): Promise<BarisTerapan[]> {
  const hasil: BarisTerapan[] = [];
  for (const r of rincian) {
    await lockMainInventoryValueRow(tx, r.itemId, r.variantSku);
    const sebaran = await bacaSebaranLapisan(tx, {
      refType: r.dokumen === "GRN" ? "GRN" : "FGReceipt",
      refId: r.dokumenId,
      itemId: r.itemId,
      variantSku: r.variantSku,
    });
    const nilaiSen = sen(r.persediaan);
    const bagi = bagiNilaiPerLokasi(nilaiSen, [sebaran.utama, ...sebaran.tujuan.map((t) => t.porsi)]);
    let keluarSen = bagi.keluar;
    const lokasi: BarisTerapan["lokasi"] = [];
    const umum = { itemId: r.itemId, variantSku: r.variantSku, refType: "SupplierPayableCorrection" as const, refId: k.id, refDocNumber: nomor(r), olehUserId };
    const utama = await nilaiUlangStokUtama(tx, { ...umum, selisihSen: bagi.lokasi[0] });
    keluarSen += bagi.lokasi[0] - utama.diterapkanSen;
    if (utama.diterapkanSen !== 0) lokasi.push({ jenis: "MAIN", lokasiId: "", nilai: rp(utama.diterapkanSen) });
    for (let i = 0; i < sebaran.tujuan.length; i++) {
      const t = sebaran.tujuan[i];
      const bagian = bagi.lokasi[i + 1];
      const d =
        t.jenis === "STORE"
          ? await nilaiUlangStokToko(tx, t.lokasiId, { ...umum, selisihSen: bagian })
          : await nilaiUlangStokVan(tx, t.lokasiId, { ...umum, selisihSen: bagian });
      keluarSen += bagian - d.diterapkanSen;
      if (d.diterapkanSen !== 0) lokasi.push({ jenis: t.jenis, lokasiId: t.lokasiId, nilai: rp(d.diterapkanSen) });
    }
    hasil.push({ ...r, lokasi, keluar: rp(keluarSen) });
  }
  return hasil;
}

function stokPerPeran(baris: ReadonlyArray<{ tipeBarang: string | null; lokasi: ReadonlyArray<{ jenis: "MAIN" | "STORE" | "VAN"; nilai: number }> }>) {
  return baris.flatMap((b) => b.lokasi.map((l) => ({ peran: peranLokasi(l.jenis, b.tipeBarang), nilai: l.nilai })));
}

export type HasilPutuskanSelisih = { ok: true; billId: string } | { ok: false; kode: KodeGalatKoreksi; peran?: string };

/**
 * Putuskan satu selisih harga. TERIMA: utang dikoreksi lewat jurnal `SUPPLIER_PAYABLE_CORRECTION`, sisa
 * stok penerimaan itu dinilai ulang (Gudang Utama, Gudang Toko konsinyasi, van), bagian yang sudah
 * keluar menjadi `PURCHASE_PRICE_VARIANCE` (P49). KOREKSI_INVOICE: baris invoice dan totalnya turun ke
 * harga penerimaan; tanpa jurnal dan tanpa stok. TERIMA ditolak `ADA_RETUR` kalau barang yang sudah
 * ditagih pada kunci GRN itu kemudian diretur ke pemasok (`invoicedReturnedQtyByGrnLine`).
 */
export async function putuskanSelisihHarga(i: { koreksiId: string; keputusan: unknown; catatan?: unknown; olehUserId: string }): Promise<HasilPutuskanSelisih> {
  if (typeof i.keputusan !== "string" || !(KEPUTUSAN_SELISIH as readonly string[]).includes(i.keputusan)) return { ok: false, kode: "KEPUTUSAN_TIDAK_SAH" };
  const keputusan = i.keputusan as KeputusanSelisih;
  const catatan = typeof i.catatan === "string" ? i.catatan.trim() : "";
  if (catatan.length > MAKS_CATATAN_KEPUTUSAN) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  try {
    return await runSerializable(
      async (tx): Promise<HasilPutuskanSelisih> => {
        const k = await tx.supplierPayableCorrection.findUnique({ where: { id: i.koreksiId } });
        if (!k) return { ok: false, kode: "TIDAK_DITEMUKAN" };
        if (k.status !== STATUS_KOREKSI_UTANG.MENUNGGU) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
        const bill = await tx.vendorBill.findUnique({ where: { id: k.billId }, select: { id: true, status: true, docNumber: true, vendorInvoiceNo: true, billDate: true, total: true } });
        if (!bill || bill.status === "VOID") return { ok: false, kode: "TAGIHAN_DIBATALKAN" };
        const line = await tx.vendorBillLine.findUnique({ where: { id: k.billLineId }, select: { id: true, qty: true, price: true, amount: true } });
        if (!line) return { ok: false, kode: "TIDAK_DITEMUKAN" };
        const rincian = bacaRincianKoreksi(k.breakdown);
        const jumlah = Number(k.amount);

        // Semua penolakan SEBELUM tulisan pertama.
        if (keputusan === "KOREKSI_INVOICE") {
          const adaCmtLama = k.sourceType === SUMBER_KOREKSI.WO_STEP && Number(line.qty) - Number(k.qty) > 0.005;
          const boleh = bolehKoreksiInvoice({ jumlah, adaCmtLama });
          if (boleh !== "OK") return { ok: false, kode: boleh };
        } else {
          const dokumen =
            k.sourceType === SUMBER_KOREKSI.GRN
              ? [{ sourceType: "GRN", sourceId: k.sourceId }]
              : [...new Set(rincian.map((r) => r.dokumenId))].map((id) => ({ sourceType: SUMBER_JURNAL_PENERIMAAN_FG, sourceId: id }));
          if (dokumen.length === 0) return { ok: false, kode: "PENERIMAAN_BELUM_BERJURNAL" };
          const berjurnal = await tx.journal.count({ where: { status: "POSTED", OR: dokumen } });
          if (berjurnal < dokumen.length) return { ok: false, kode: "PENERIMAAN_BELUM_BERJURNAL" };
          // Barang yang sudah ditagih invoice lalu diretur ke pemasok: kredit returnya hanya sebesar harga
          // PO, jadi menerima selisih atas qty invoice itu menagih selisih untuk barang yang sudah kembali.
          // Ditolak; tagihannya dibatalkan lalu dicatat ulang tanpa barang yang diretur (Q17).
          if (k.sourceType === SUMBER_KOREKSI.GRN && k.itemId) {
            const diretur = await invoicedReturnedQtyByGrnLine(tx, [k.sourceId]);
            if (diretur.has(grnLineSource(k.sourceId, grnLineKey(k.itemId, k.variantSku)))) return { ok: false, kode: "ADA_RETUR" };
          }
        }

        const kini = new Date();
        const cas = await tx.supplierPayableCorrection.updateMany({
          where: { id: k.id, status: STATUS_KOREKSI_UTANG.MENUNGGU },
          data: { status: keputusan === "TERIMA" ? STATUS_KOREKSI_UTANG.DITERIMA : STATUS_KOREKSI_UTANG.INVOICE_DIKOREKSI, decidedAt: kini, decidedById: i.olehUserId, decisionNote: catatan || null },
        });
        if (cas.count !== 1) throw new TolakKoreksi("SUDAH_DIPUTUSKAN");

        if (keputusan === "KOREKSI_INVOICE") {
          const harga = round2(Number(k.recordedPrice));
          const amount = round2(Number(line.qty) * harga);
          await tx.vendorBillLine.update({ where: { id: line.id }, data: { price: harga, amount } });
          const semua = await tx.vendorBillLine.findMany({ where: { billId: bill.id }, select: { amount: true } });
          const total = rp(semua.reduce((s, l) => s + sen(l.amount), 0));
          await tx.vendorBill.update({ where: { id: bill.id }, data: { total } });
          await catatJejak(tx, {
            userId: i.olehUserId,
            action: JEJAK.KOREKSI_UTANG_INVOICE_DIKOREKSI,
            entityType: "SupplierPayableCorrection",
            entityId: k.id,
            changes: {
              before: { status: STATUS_KOREKSI_UTANG.MENUNGGU, hargaBaris: Number(line.price), totalTagihan: Number(bill.total) },
              after: { status: STATUS_KOREKSI_UTANG.INVOICE_DIKOREKSI, hargaBaris: harga, totalTagihan: total },
            },
            metadata: { billId: bill.id, billDocNumber: bill.docNumber, vendorInvoiceNo: bill.vendorInvoiceNo },
            reason: catatan || null,
          });
          return { ok: true, billId: bill.id };
        }

        const nomorDok = new Map<string, string>();
        if (k.sourceType === SUMBER_KOREKSI.GRN) {
          const g = await tx.gRN.findUnique({ where: { id: k.sourceId }, select: { docNumber: true } });
          nomorDok.set(k.sourceId, g?.docNumber ?? "");
        }
        const terapan = await terapkanKeStok(tx, k, rincian, (r) => r.nomor || nomorDok.get(r.dokumenId) || bill.docNumber, i.olehUserId);
        const stok = stokPerPeran(terapan);
        const stokSen = stok.reduce((s, x) => s + sen(x.nilai), 0);
        const keluarSen = sen(k.inventoryAmount) - stokSen;
        const baris = barisJurnalKoreksiUtang({ jumlah, dpp: Number(k.dppAmount), ppnMasukan: Number(k.ppnInputAmount), stok, keluar: rp(keluarSen) });
        const res = await postKoreksiUtangJournal(tx, {
          koreksiId: k.id,
          baris,
          tanggal: bill.billDate,
          keterangan: `Koreksi utang pemasok ${bill.docNumber} (${bill.vendorInvoiceNo})`,
          olehUserId: i.olehUserId,
        });
        if (!res.ok) throw new TolakKoreksi(res.code === "UNMAPPED_ROLE" ? "UNMAPPED_ROLE" : "JURNAL_GAGAL", res.role);
        await tx.supplierPayableCorrection.update({
          where: { id: k.id },
          data: { stockAmount: rp(stokSen), soldAmount: rp(keluarSen), breakdown: terapan as unknown as Prisma.InputJsonValue },
        });
        await catatJejak(tx, {
          userId: i.olehUserId,
          action: JEJAK.KOREKSI_UTANG_DITERIMA,
          entityType: "SupplierPayableCorrection",
          entityId: k.id,
          changes: {
            before: { status: STATUS_KOREKSI_UTANG.MENUNGGU, utangTercatat: round2(Number(k.qty) * Number(k.recordedPrice)) },
            after: { status: STATUS_KOREKSI_UTANG.DITERIMA, jumlah, keStok: rp(stokSen), sudahKeluar: rp(keluarSen) },
          },
          metadata: { billId: bill.id, billDocNumber: bill.docNumber, vendorInvoiceNo: bill.vendorInvoiceNo, journalId: res.journalId },
          reason: catatan || null,
        });
        if (k.sourceType === SUMBER_KOREKSI.GRN) {
          const g = await tx.gRN.findUnique({ where: { id: k.sourceId }, select: { poId: true } });
          if (g?.poId) await selaraskanLunasPoSesudahKoreksi(tx, [g.poId], i.olehUserId, bill.docNumber);
        }
        return { ok: true, billId: bill.id };
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof TolakKoreksi) return { ok: false, kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) };
    throw e;
  }
}

/**
 * Di dalam transaksi pembatalan tagihan (`voidVendorBill`), sesudah tanda VOID-nya: koreksi MENUNGGU dan
 * INVOICE_DIKOREKSI → DIBATALKAN; DITERIMA → jurnal pembalik `SUPPLIER_PAYABLE_CORRECTION_REVERSAL`
 * bertanggal pembatalan, dan penilaian ulang yang masih tersisa di tiap lokasi dibalik sebesar bagiannya
 * yang masih ada (`bacaSisaSejakEntri`); sisanya ke `PURCHASE_PRICE_VARIANCE`. Kegagalan jurnal MELEMPAR,
 * jadi pembatalannya ikut gagal.
 */
export async function batalkanKoreksiTagihan(tx: Tx, a: { billId: string; alasan: string; olehUserId: string; waktu: Date }): Promise<{ dibatalkan: number; dibalik: number }> {
  const daftar = await tx.supplierPayableCorrection.findMany({
    where: { billId: a.billId, status: { not: STATUS_KOREKSI_UTANG.DIBATALKAN } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let dibatalkan = 0;
  let dibalik = 0;
  const poTersentuh = new Set<string>();
  for (const k of daftar) {
    if (k.status === STATUS_KOREKSI_UTANG.DITERIMA) {
      const rincian = bacaRincianKoreksi(k.breakdown);
      const stok: Array<{ peran: PeranStokKoreksi; nilai: number }> = [];
      for (const r of rincian) {
        for (const l of r.lokasi ?? []) {
          const nilaiSen = sen(l.nilai);
          if (nilaiSen === 0) continue;
          if (l.jenis === "MAIN") await lockMainInventoryValueRow(tx, r.itemId, r.variantSku);
          const sisa = await bacaSisaSejakEntri(tx, { lokasi: { jenis: l.jenis, lokasiId: l.lokasiId }, refType: "SupplierPayableCorrection", refId: k.id, itemId: r.itemId, variantSku: r.variantSku });
          const balikSen = Math.round(nilaiSen * sisa);
          const umum = { itemId: r.itemId, variantSku: r.variantSku, selisihSen: -balikSen, refType: "SupplierPayableCorrectionReversal" as const, refId: k.id, refDocNumber: r.nomor, olehUserId: a.olehUserId };
          const d =
            l.jenis === "MAIN" ? await nilaiUlangStokUtama(tx, umum) : l.jenis === "STORE" ? await nilaiUlangStokToko(tx, l.lokasiId, umum) : await nilaiUlangStokVan(tx, l.lokasiId, umum);
          if (d.diterapkanSen !== 0) stok.push({ peran: peranLokasi(l.jenis, r.tipeBarang), nilai: rp(-d.diterapkanSen) });
        }
      }
      const stokSen = stok.reduce((s, x) => s + sen(x.nilai), 0);
      const baris = barisJurnalBalikKoreksiUtang({
        jumlah: Number(k.amount),
        dpp: Number(k.dppAmount),
        ppnMasukan: Number(k.ppnInputAmount),
        stok,
        keluar: rp(sen(k.inventoryAmount) - stokSen),
      });
      const res = await postKoreksiUtangReversalJournal(tx, {
        koreksiId: k.id,
        baris,
        tanggal: a.waktu,
        keterangan: `Pembatalan koreksi utang pemasok (tagihan dibatalkan)`,
        olehUserId: a.olehUserId,
      });
      if (!res.ok) throw new TolakKoreksi(res.code === "UNMAPPED_ROLE" ? "UNMAPPED_ROLE" : "JURNAL_GAGAL", res.role);
      dibalik += 1;
      if (k.sourceType === SUMBER_KOREKSI.GRN) {
        const g = await tx.gRN.findUnique({ where: { id: k.sourceId }, select: { poId: true } });
        if (g?.poId) poTersentuh.add(g.poId);
      }
    } else {
      dibatalkan += 1;
    }
    const cas = await tx.supplierPayableCorrection.updateMany({
      where: { id: k.id, status: k.status },
      data: { status: STATUS_KOREKSI_UTANG.DIBATALKAN, cancelledAt: a.waktu, cancelReason: a.alasan },
    });
    if (cas.count !== 1) throw new TolakKoreksi("SUDAH_DIPUTUSKAN");
    await catatJejak(tx, {
      userId: a.olehUserId,
      action: JEJAK.KOREKSI_UTANG_DIBATALKAN,
      entityType: "SupplierPayableCorrection",
      entityId: k.id,
      changes: { before: { status: k.status }, after: { status: STATUS_KOREKSI_UTANG.DIBATALKAN } },
      metadata: { billId: a.billId, dibalik: k.status === STATUS_KOREKSI_UTANG.DITERIMA },
      reason: a.alasan,
    });
  }
  if (poTersentuh.size > 0) {
    const bill = await tx.vendorBill.findUnique({ where: { id: a.billId }, select: { docNumber: true } });
    await selaraskanLunasPoSesudahKoreksi(tx, [...poTersentuh], a.olehUserId, bill?.docNumber ?? a.billId);
  }
  return { dibatalkan, dibalik };
}

/** Untuk pemanggil di luar penulis ini (pembatalan tagihan): kode penolakan dari galat yang dilempar di sini. */
export function kodeTolakKoreksi(e: unknown): { kode: KodeGalatKoreksi; peran?: string } | null {
  return e instanceof TolakKoreksi ? { kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) } : null;
}
