import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { susunFaktur, type FakturKeluaran, type NotaUntukFaktur, type PeringatanFaktur } from "./coretax";
import type { PengaturanPpn } from "./ppn";

/**
 * Nota tagihan putus untuk ekspor faktur keluaran Coretax — KHUSUS SERVER.
 * Satu nota = satu faktur (`FieldSalesDelivery` + `TaxInvoice`-nya). Nota
 * yang ditandai "tidak perlu faktur" tidak pernah ikut; bawaan hanya yang
 * masih menunggu faktur (PENDING).
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type SertakanFaktur = "MENUNGGU" | "SEMUA";

export type BarisEkspor = {
  deliveryId: string;
  nomor: string;
  tanggal: string;
  toko: string;
  tokoPkp: boolean;
  total: number;
  statusFaktur: string;
  nomorFaktur: string | null;
  dpp: number;
  ppn: number;
  peringatan: PeringatanFaktur[];
};

export const BATAS_EKSPOR = 500;

export async function notaUntukEkspor(
  opsi: { mulai: Date; sampai: Date; sertakan: SertakanFaktur; pengaturan: PengaturanPpn },
  client: Klien = prisma,
): Promise<{ baris: BarisEkspor[]; faktur: FakturKeluaran[]; terpotong: boolean }> {
  const nota = await client.fieldSalesDelivery.findMany({
    where: {
      invoiceDate: { gte: opsi.mulai, lt: opsi.sampai },
      taxInvoice: opsi.sertakan === "MENUNGGU" ? { is: { status: "PENDING" } } : { is: { status: { in: ["PENDING", "CREATED"] } } },
    },
    orderBy: [{ invoiceDate: "asc" }, { docNo: "asc" }],
    take: BATAS_EKSPOR + 1,
    select: {
      id: true,
      docNo: true,
      invoiceDate: true,
      total: true,
      discountAmount: true,
      taxInvoice: { select: { status: true, invoiceNo: true } },
      order: { select: { store: { select: { name: true, address: true, isPkp: true } } } },
      lines: { select: { productName: true, qty: true, unitPrice: true, discountAmount: true }, orderBy: { id: "asc" } },
    },
  });
  const terpotong = nota.length > BATAS_EKSPOR;
  const baris: BarisEkspor[] = [];
  const faktur: FakturKeluaran[] = [];
  for (const n of nota.slice(0, BATAS_EKSPOR)) {
    const masukan: NotaUntukFaktur = {
      nomor: n.docNo,
      tanggal: formatDateOnlyJakarta(n.invoiceDate),
      // Skema toko belum punya kolom NPWP/NITKU — selalu kosong (lihat peringatan).
      pembeli: { nama: n.order.store.name, alamat: n.order.store.address, npwp: null, pkp: n.order.store.isPkp },
      diskonNota: Number(n.discountAmount),
      baris: n.lines.map((l) => ({ nama: l.productName, qty: l.qty, hargaSatuan: Number(l.unitPrice ?? 0), diskon: Number(l.discountAmount) })),
    };
    const { faktur: f, peringatan } = susunFaktur(masukan, opsi.pengaturan);
    faktur.push(f);
    baris.push({
      deliveryId: n.id,
      nomor: n.docNo,
      tanggal: masukan.tanggal,
      toko: n.order.store.name,
      tokoPkp: n.order.store.isPkp,
      total: Number(n.total),
      statusFaktur: n.taxInvoice?.status ?? "PENDING",
      nomorFaktur: n.taxInvoice?.invoiceNo ?? null,
      dpp: f.jumlahDpp,
      ppn: f.jumlahPpn,
      peringatan,
    });
  }
  return { baris, faktur, terpotong };
}
