'use server';

import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { rincianRetur } from '@/lib/receivables/return-queries';
import { rincianKlaim } from '@/lib/receivables/claim-queries';
import { rincianSiklus } from '@/lib/konsinyasi/queries';
import {
  bolehMembacaPelunasan,
  bolehMembacaPiutang,
  bolehMembacaRetur,
  bolehMembukaKonsi,
} from '@/lib/receivables/izin';

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Pengambil data untuk halaman cetak.
 *
 * Terpisah dari kuerinya sendiri karena halaman cetak adalah komponen klien —
 * ia butuh `window.print()` — jadi datanya harus melewati batas aksi server.
 *
 * Pagar bacanya ADA DI SINI, bukan di halaman: `/print/*` tidak dipetakan di
 * ROUTE_PERMISSIONS dan layoutnya hanya menuntut sudah masuk, dan setiap aksi
 * server bisa dipanggil langsung. Izinnya sama dengan halaman yang menautkan
 * cetakannya. Yang ditolak mendapat `null`, sama dengan dokumen yang tidak ada —
 * lembar cetak berbunyi "tidak ditemukan" dan tidak membocorkan bahwa ia ada.
 */

/** Izin pengguna yang masuk, atau `null` bila belum masuk. */
async function izinSesi(): Promise<string[] | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user.permissions ?? [];
}

export async function ambilCetakRetur(id: string) {
  const izin = await izinSesi();
  if (!izin || !bolehMembacaRetur(izin)) return null;
  return rincianRetur(id);
}

export async function ambilCetakKlaim(id: string) {
  const izin = await izinSesi();
  if (!izin || !bolehMembacaPelunasan(izin)) return null;
  return rincianKlaim(id);
}

/** Membuka harga konsinyasi dan gaji/komisi SPG — izin konsinyasi, bukan piutang. */
export async function ambilCetakSiklus(id: string) {
  const izin = await izinSesi();
  if (!izin || !bolehMembukaKonsi(izin)) return null;
  return rincianSiklus(id);
}

export type CetakFaktur = {
  invoiceNo: string;
  storeName: string;
  storeAddress: string | null;
  salesmanName: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  outstanding: number;
  items: { itemName: string; qty: number; price: number; amount: number }[];
};

export async function ambilCetakFaktur(id: string): Promise<CetakFaktur | null> {
  const izin = await izinSesi();
  if (!izin || !bolehMembacaPiutang(izin)) return null;

  const r = await prisma.receivable.findUnique({
    where: { id },
    select: {
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      amount: true,
      outstanding: true,
      store: { select: { name: true, address: true } },
      salesman: { select: { name: true } },
      items: { select: { itemName: true, qty: true, price: true, amount: true } },
    },
  });
  if (!r) return null;

  return {
    invoiceNo: r.invoiceNo,
    storeName: r.store.name,
    storeAddress: r.store.address,
    salesmanName: r.salesman?.name ?? null,
    invoiceDate: r.invoiceDate.toISOString(),
    dueDate: r.dueDate.toISOString(),
    amount: angka(r.amount),
    outstanding: angka(r.outstanding),
    items: r.items.map((i) => ({
      itemName: i.itemName,
      qty: i.qty,
      price: angka(i.price),
      amount: angka(i.amount),
    })),
  };
}
