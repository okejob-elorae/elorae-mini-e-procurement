import { prisma } from "@elorae/db";
import { nilaiBersihSpg } from "@/lib/dashboard/tren";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { hpLokal, hpUntukCari } from "./pelanggan";
import { kelompokTitip, STATUS_TITIP_TERBUKA, stokUntukPermintaan, type KelompokTitip } from "./titip";
import { saldoBarangToko } from "./titip-saldo";

/**
 * Data pembeli untuk HP SPG. SEMUA bacaan dikunci ke toko pemanggil (toko
 * tetap SPG): pelanggan toko lain tidak pernah keluar dari sini, juga lewat id
 * yang ditebak. Tanggal diformat di server untuk kedua bahasa — bahasa layar
 * dipilih di HP, server tidak tahu.
 */

export type TeksDwibahasa = { id: string; en: string };
const tanggal = (d: Date): TeksDwibahasa => ({ id: formatDisplayDate(d, "id"), en: formatDisplayDate(d, "en") });
const tanggalJam = (d: Date): TeksDwibahasa => ({ id: formatDisplayDateTime(d, "id"), en: formatDisplayDateTime(d, "en") });

export const BATAS_DAFTAR_PELANGGAN = 100;

export type BarisPelangganHp = {
  id: string;
  nama: string;
  /** Bentuk lokal `0812…` — SPG toko ini memang menghubunginya. */
  hp: string;
  jumlahNota: number;
  belanjaTerakhir: TeksDwibahasa | null;
  titipTerbuka: number;
};

/** Pelanggan toko ini, urut nama; dengan `q` dicari di nama atau nomor HP. */
export async function daftarPelangganHp(storeId: string, opsi: { q?: string | null } = {}): Promise<{ baris: BarisPelangganHp[]; total: number }> {
  const teks = (opsi.q ?? "").trim().slice(0, 60);
  const hp = hpUntukCari(teks);
  const atau = [
    ...(teks ? [{ name: { contains: teks, mode: "insensitive" as const } }] : []),
    ...(hp.length >= 4 ? [{ phone: { contains: hp } }] : []),
  ];
  const where = { storeId, ...(atau.length ? { OR: atau } : {}) };
  const [rows, total] = await Promise.all([
    prisma.storeCustomer.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: BATAS_DAFTAR_PELANGGAN, select: { id: true, name: true, phone: true } }),
    prisma.storeCustomer.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const [nota, titip] = ids.length
    ? await Promise.all([
        prisma.spgSale.groupBy({ by: ["customerId"], where: { storeId, customerId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
        prisma.customerRequest.groupBy({
          by: ["customerId"],
          where: { storeId, customerId: { in: ids }, status: { in: [...STATUS_TITIP_TERBUKA] } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const notaPer = new Map(nota.map((n) => [n.customerId, n]));
  const titipPer = new Map(titip.map((t) => [t.customerId, t._count._all]));
  return {
    total,
    baris: rows.map((r) => {
      const n = notaPer.get(r.id);
      return {
        id: r.id,
        nama: r.name,
        hp: hpLokal(r.phone),
        jumlahNota: n?._count._all ?? 0,
        belanjaTerakhir: n?._max.createdAt ? tanggal(n._max.createdAt) : null,
        titipTerbuka: titipPer.get(r.id) ?? 0,
      };
    }),
  };
}

export const BATAS_RIWAYAT_PELANGGAN = 50;

export type NotaPelangganHp = {
  id: string;
  docNo: string;
  waktu: TeksDwibahasa;
  barang: { nama: string; qty: number; kembali: number }[];
  /** Total sesudah potongan dan sesudah barang yang dikembalikan pembeli. */
  totalBersih: number;
};

export type TitipPelangganHp = {
  id: string;
  keterangan: string;
  qty: number;
  status: string;
  kelompok: KelompokTitip;
  dibuat: TeksDwibahasa;
};

export type RincianPelangganHp = {
  id: string;
  nama: string;
  hp: string;
  /** Tautan obrolan WhatsApp (tanpa pesan); null kalau nomornya tidak lagi sah. */
  tautanWa: string | null;
  catatan: string | null;
  setujuPada: TeksDwibahasa;
  dicatatPada: TeksDwibahasa;
  jumlahNota: number;
  totalBelanja: number;
  riwayat: NotaPelangganHp[];
  titip: TitipPelangganHp[];
};

/**
 * Satu pelanggan toko ini, dengan riwayat belanjanya DI TOKO INI dan titip
 * pesannya. `null` kalau id itu bukan pelanggan toko ini.
 */
export async function rincianPelangganHp(storeId: string, id: string): Promise<RincianPelangganHp | null> {
  const p = await prisma.storeCustomer.findFirst({
    where: { id, storeId },
    select: { id: true, name: true, phone: true, note: true, consentAt: true, createdAt: true },
  });
  if (!p) return null;
  const [nota, jumlah, titip] = await Promise.all([
    prisma.spgSale.findMany({
      where: { storeId, customerId: p.id },
      orderBy: { createdAt: "desc" },
      take: BATAS_RIWAYAT_PELANGGAN,
      select: {
        id: true,
        docNo: true,
        createdAt: true,
        total: true,
        lines: { select: { productName: true, qty: true, returnedQty: true, unitPrice: true, lineTotal: true } },
      },
    }),
    prisma.spgSale.findMany({
      where: { storeId, customerId: p.id },
      select: { total: true, lines: { where: { returnedQty: { gt: 0 } }, select: { qty: true, returnedQty: true, unitPrice: true, lineTotal: true } } },
    }),
    prisma.customerRequest.findMany({
      where: { storeId, customerId: p.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, description: true, qty: true, status: true, itemId: true, variantSku: true, createdAt: true },
    }),
  ]);
  const saldo = await saldoBarangToko(
    prisma,
    storeId,
    titip.filter((t) => t.status === "MENUNGGU" && t.itemId).map((t) => t.itemId as string),
  );
  const wa = nomorWhatsApp(p.phone);
  return {
    id: p.id,
    nama: p.name,
    hp: hpLokal(p.phone),
    tautanWa: wa ? `https://wa.me/${wa}` : null,
    catatan: p.note,
    setujuPada: tanggal(p.consentAt),
    dicatatPada: tanggal(p.createdAt),
    jumlahNota: jumlah.length,
    totalBelanja: jumlah.reduce((s, n) => s + nilaiBersihSpg(n.total, n.lines), 0),
    riwayat: nota.map((n) => ({
      id: n.id,
      docNo: n.docNo,
      waktu: tanggalJam(n.createdAt),
      barang: n.lines.map((l) => ({ nama: l.productName, qty: l.qty, kembali: l.returnedQty })),
      totalBersih: nilaiBersihSpg(n.total, n.lines),
    })),
    titip: titip.map((t) => ({
      id: t.id,
      keterangan: t.description,
      qty: t.qty,
      status: t.status,
      kelompok: kelompokTitip(t.status, stokUntukPermintaan(t.itemId, t.variantSku, saldo)),
      dibuat: tanggal(t.createdAt),
    })),
  };
}
