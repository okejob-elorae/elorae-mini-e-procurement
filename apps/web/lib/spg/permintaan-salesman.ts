import { prisma } from "@elorae/db";
import type { StatusPermintaan } from "./kantor-queries";
import { bacaAlasan, STATUS_PERMINTAAN, type AlasanPermintaan } from "./saran-minta";

/**
 * Kotak masuk salesman: permintaan barang SPG dari toko yang ia PEGANG
 * (`Store.salesmanId`). Pemegang toko inilah yang dikabari saat SPG meminta,
 * dan dialah yang bisa langsung membuatkan pesanannya dari katalog.
 *
 * Penyaringan pemegang ada DI KUERI, bukan di layar: permintaan toko orang lain
 * sama dengan tidak ada. Kantor (`stores:manage`) boleh membuka rinciannya
 * (`kelolaSemua`), tapi daftarnya tetap toko yang dipegang.
 */

// Konstanta tinggal di modul aman-klien: layar kotak masuk memakainya, dan
// mengimpor NILAI dari berkas ini menyeret Prisma ke bundel peramban.
export { STATUS_PERMINTAAN };

/** `?status=` → status yang dipilih; null bila tidak ada / tidak dikenal (halaman memilih bawaannya). */
export function bacaSaringPermintaan(x: unknown): StatusPermintaan | null {
  const v = Array.isArray(x) ? x[0] : x;
  return (STATUS_PERMINTAAN as readonly unknown[]).includes(v) ? (v as StatusPermintaan) : null;
}

/** Tanpa pilihan: tab yang menunggu tindakan lebih dulu — Baru, lalu Diproses. */
export function saringBawaan(hitung: Record<StatusPermintaan, number>): StatusPermintaan {
  if (hitung.BARU > 0) return "BARU";
  if (hitung.DIPROSES > 0) return "DIPROSES";
  return "BARU";
}

export type PermintaanMasuk = {
  id: string;
  status: StatusPermintaan;
  toko: { id: string; nama: string };
  peminta: string;
  /** ISO — diformat di halaman server. */
  dibuat: string;
  jumlahBaris: number;
  totalQty: number;
  /** Beberapa nama barang pertama, untuk mengenali permintaan di daftar. */
  contoh: string[];
  catatan: string | null;
  pesanan: { orderNo: string } | null;
};

const BATAS_DAFTAR = 50;
const JUMLAH_CONTOH = 2;

async function namaOrang(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

/** Daftar permintaan dari toko yang dipegang `userId`, terbaru dulu. */
export async function daftarPermintaanMasuk(
  userId: string,
  opsi: { status?: StatusPermintaan; storeId?: string; batas?: number } = {},
): Promise<PermintaanMasuk[]> {
  const rows = await prisma.stockRequest.findMany({
    where: {
      store: { salesmanId: userId },
      ...(opsi.status ? { status: opsi.status } : {}),
      ...(opsi.storeId ? { storeId: opsi.storeId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opsi.batas ?? BATAS_DAFTAR,
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      requestedById: true,
      fieldSalesOrderId: true,
      store: { select: { id: true, name: true } },
      lines: { select: { productName: true, qty: true }, orderBy: { productName: "asc" } },
    },
  });
  const idPesanan = [...new Set(rows.flatMap((r) => (r.fieldSalesOrderId ? [r.fieldSalesOrderId] : [])))];
  const [nama, pesanan] = await Promise.all([
    namaOrang(rows.map((r) => r.requestedById)),
    idPesanan.length ? prisma.fieldSalesOrder.findMany({ where: { id: { in: idPesanan } }, select: { id: true, orderNo: true } }) : [],
  ]);
  const noPesanan = new Map(pesanan.map((p) => [p.id, p.orderNo]));

  return rows.map((r) => {
    const orderNo = r.fieldSalesOrderId ? noPesanan.get(r.fieldSalesOrderId) : undefined;
    return {
      id: r.id,
      status: r.status,
      toko: { id: r.store.id, nama: r.store.name },
      peminta: nama.get(r.requestedById) ?? "—",
      dibuat: r.createdAt.toISOString(),
      jumlahBaris: r.lines.length,
      totalQty: r.lines.reduce((n, l) => n + l.qty, 0),
      contoh: r.lines.slice(0, JUMLAH_CONTOH).map((l) => l.productName),
      catatan: r.note,
      pesanan: orderNo ? { orderNo } : null,
    };
  });
}

/** Jumlah permintaan per status dari toko yang dipegang (untuk tab dan lencana "Baru"). */
export async function hitungPermintaanMasuk(userId: string, storeId?: string): Promise<Record<StatusPermintaan, number>> {
  const grup = await prisma.stockRequest.groupBy({
    by: ["status"],
    where: { store: { salesmanId: userId }, ...(storeId ? { storeId } : {}) },
    _count: { _all: true },
  });
  const hasil: Record<StatusPermintaan, number> = { BARU: 0, DIPROSES: 0, SELESAI: 0, DITOLAK: 0 };
  for (const g of grup) hasil[g.status] = g._count._all;
  return hasil;
}

/** Nama salesman pemegang toko (yang akan menerima permintaan SPG); null bila tanpa pemegang. */
export async function namaPemegangToko(storeId: string): Promise<string | null> {
  const s = await prisma.store.findUnique({ where: { id: storeId }, select: { salesman: { select: { name: true, email: true } } } });
  return s?.salesman ? (s.salesman.name ?? s.salesman.email) : null;
}

/** Toko yang dipegang `userId` — untuk label saringan `?toko=`. null bila bukan tokonya. */
export async function tokoDipegang(userId: string, storeId: string): Promise<{ id: string; nama: string } | null> {
  const s = await prisma.store.findFirst({ where: { id: storeId, salesmanId: userId }, select: { id: true, name: true } });
  return s ? { id: s.id, nama: s.name } : null;
}

export type RincianPermintaanMasuk = {
  id: string;
  status: StatusPermintaan;
  toko: { id: string; nama: string; termsType: "PUTUS" | "KONSI" };
  peminta: string;
  dibuat: string;
  catatan: string | null;
  baris: { id: string; productName: string; variantSku: string; qty: number; alasan: AlasanPermintaan | null }[];
  totalQty: number;
  ditangani: { oleh: string | null; pada: string | null; catatan: string | null };
  /** Pesanan yang dibuatkan dari permintaan ini. `milikSaya` = penonton boleh membuka rinciannya di HP. */
  pesanan: { id: string; orderNo: string; status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"; milikSaya: boolean } | null;
  /** Penonton adalah pemegang toko — hanya dia yang bisa mengisi keranjang dari permintaan ini. */
  pemegang: boolean;
};

/**
 * Satu permintaan untuk penonton `userId`: pemegang tokonya, atau — dengan
 * `kelolaSemua` (kantor, `stores:manage`) — siapa pun. null bila tidak boleh
 * dilihat atau tidak ada.
 */
export async function rincianPermintaanMasuk(
  id: string,
  userId: string,
  opsi: { kelolaSemua: boolean },
): Promise<RincianPermintaanMasuk | null> {
  const r = await prisma.stockRequest.findFirst({
    where: { id, ...(opsi.kelolaSemua ? {} : { store: { salesmanId: userId } }) },
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      requestedById: true,
      handledById: true,
      handledAt: true,
      handleNote: true,
      fieldSalesOrderId: true,
      store: { select: { id: true, name: true, termsType: true, salesmanId: true } },
      lines: { select: { id: true, productName: true, variantSku: true, qty: true, alasan: true }, orderBy: { productName: "asc" } },
    },
  });
  if (!r) return null;
  const [nama, pesanan] = await Promise.all([
    namaOrang([r.requestedById, ...(r.handledById ? [r.handledById] : [])]),
    r.fieldSalesOrderId
      ? prisma.fieldSalesOrder.findUnique({ where: { id: r.fieldSalesOrderId }, select: { id: true, orderNo: true, status: true, salesmanId: true } })
      : null,
  ]);
  return {
    id: r.id,
    status: r.status,
    toko: { id: r.store.id, nama: r.store.name, termsType: r.store.termsType },
    peminta: nama.get(r.requestedById) ?? "—",
    dibuat: r.createdAt.toISOString(),
    catatan: r.note,
    baris: r.lines.map((l) => ({ id: l.id, productName: l.productName, variantSku: l.variantSku, qty: l.qty, alasan: bacaAlasan(l.alasan) })),
    totalQty: r.lines.reduce((n, l) => n + l.qty, 0),
    ditangani: {
      oleh: r.handledById ? (nama.get(r.handledById) ?? null) : null,
      pada: r.handledAt ? r.handledAt.toISOString() : null,
      catatan: r.handleNote,
    },
    pesanan: pesanan
      ? { id: pesanan.id, orderNo: pesanan.orderNo, status: pesanan.status, milikSaya: pesanan.salesmanId === userId }
      : null,
    pemegang: r.store.salesmanId === userId,
  };
}
