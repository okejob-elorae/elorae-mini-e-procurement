import { prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { bacaVarian } from "@/lib/salesman/analisa-toko";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { bacaTitipPesan, KUNCI_TITIP_PESAN } from "./pengaturan";
import { hpLokal } from "./pelanggan";
import {
  bolehDikabari,
  hariWib,
  kelompokTitip,
  labelVarian,
  lewatMasaSimpan,
  STATUS_TITIP_TERBUKA,
  stokUntukPermintaan,
  type KelompokTitip,
} from "./titip";
import { saldoBarangToko } from "./titip-saldo";

/**
 * Titip pesan untuk HP SPG. Semua bacaan dikunci ke toko pemanggil. Kelompok
 * "Sudah datang" dihitung SAAT dibuka dari buku stok toko, tidak hanya dari
 * status yang ditulis pemicu otomatis. Tanpa harga sama sekali.
 */

export type TeksDwibahasa = { id: string; en: string };
const tanggal = (d: Date): TeksDwibahasa => ({ id: formatDisplayDate(d, "id"), en: formatDisplayDate(d, "en") });
const tanggalJam = (d: Date): TeksDwibahasa => ({ id: formatDisplayDateTime(d, "id"), en: formatDisplayDateTime(d, "en") });
const hariTampil = (hari: string): TeksDwibahasa => tanggal(new Date(`${hari}T12:00:00+07:00`));

export type BarisTitipHp = {
  id: string;
  pembeli: string;
  keterangan: string;
  qty: number;
  status: string;
  kelompok: KelompokTitip;
  /** Potong yang ada di toko sekarang; null untuk keterangan bebas (tanpa barang katalog). */
  stok: number | null;
  dibuat: TeksDwibahasa;
  /** `YYYY-MM-DD` hari terakhir disimpankan (sesudah dikabari). */
  holdUntil: string | null;
  sampai: TeksDwibahasa | null;
  lewat: boolean;
};

export type DaftarTitipHp = { datang: BarisTitipHp[]; dikabari: BarisTitipHp[]; menunggu: BarisTitipHp[] };

const BATAS_DAFTAR = 300;

/** Titip pesan yang masih terbuka di toko ini, dalam tiga kelompok. */
export async function daftarTitipHp(storeId: string, sekarang: Date = new Date()): Promise<DaftarTitipHp> {
  const rows = await prisma.customerRequest.findMany({
    where: { storeId, status: { in: [...STATUS_TITIP_TERBUKA] } },
    orderBy: { createdAt: "asc" },
    take: BATAS_DAFTAR,
    select: { id: true, customerId: true, description: true, qty: true, status: true, itemId: true, variantSku: true, createdAt: true, holdUntil: true },
  });
  const [saldo, pelanggan] = await Promise.all([
    saldoBarangToko(prisma, storeId, rows.filter((r) => r.itemId).map((r) => r.itemId as string)),
    prisma.storeCustomer.findMany({ where: { storeId, id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } }),
  ]);
  const nama = new Map(pelanggan.map((p) => [p.id, p.name]));
  const hariIni = hariWib(sekarang);
  const hasil: DaftarTitipHp = { datang: [], dikabari: [], menunggu: [] };
  for (const r of rows) {
    const stok = r.itemId ? stokUntukPermintaan(r.itemId, r.variantSku, saldo) : null;
    const kelompok = kelompokTitip(r.status, stok ?? 0);
    if (kelompok === "tutup") continue;
    hasil[kelompok].push({
      id: r.id,
      pembeli: nama.get(r.customerId) ?? "—",
      keterangan: r.description,
      qty: r.qty,
      status: r.status,
      kelompok,
      stok,
      dibuat: tanggal(r.createdAt),
      holdUntil: r.holdUntil,
      sampai: r.holdUntil ? hariTampil(r.holdUntil) : null,
      lewat: r.status === "DIKABARI" && lewatMasaSimpan(r.holdUntil, hariIni),
    });
  }
  // Yang sudah dikabari: yang masa simpannya paling dulu habis (atau sudah lewat) di atas.
  hasil.dikabari.sort((a, b) => (a.holdUntil ?? "").localeCompare(b.holdUntil ?? ""));
  return hasil;
}

export type RincianTitipHp = {
  id: string;
  status: string;
  kelompok: KelompokTitip;
  pembeli: { id: string; nama: string; hp: string; adaWa: boolean };
  keterangan: string;
  barang: { nama: string; sku: string; varian: string | null } | null;
  qty: number;
  stok: number | null;
  dibuat: TeksDwibahasa;
  dikabariPada: TeksDwibahasa | null;
  /** `YYYY-MM-DD` — hari terakhir disimpankan; null sebelum dikabari. */
  holdUntil: string | null;
  sampai: TeksDwibahasa | null;
  lewat: boolean;
  ditutupPada: TeksDwibahasa | null;
  alasanTutup: string | null;
  dariDicari: boolean;
  dariNota: string | null;
  bolehKabari: boolean;
  /** Bahan pesan WhatsApp (dirakit di HP saat diketuk, `pesanTitipTersedia`). */
  pesan: { namaPembeli: string; namaToko: string; barang: string; varian: string | null; qty: number; nomorWa: string | null };
  hariSimpan: number;
};

/** Satu titip pesan toko ini; `null` kalau bukan milik toko ini. */
export async function rincianTitipHp(storeId: string, id: string, sekarang: Date = new Date()): Promise<RincianTitipHp | null> {
  const r = await prisma.customerRequest.findFirst({ where: { id, storeId } });
  if (!r) return null;
  const [pelanggan, item, toko, setelan, saldo, nota] = await Promise.all([
    prisma.storeCustomer.findFirst({ where: { id: r.customerId, storeId }, select: { id: true, name: true, phone: true } }),
    r.itemId ? prisma.item.findUnique({ where: { id: r.itemId }, select: { nameId: true, sku: true, variants: true } }) : Promise.resolve(null),
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_TITIP_PESAN }, select: { value: true } }),
    saldoBarangToko(prisma, storeId, r.itemId ? [r.itemId] : []),
    r.spgSaleId ? prisma.spgSale.findFirst({ where: { id: r.spgSaleId, storeId }, select: { docNo: true } }) : Promise.resolve(null),
  ]);
  const stok = r.itemId ? stokUntukPermintaan(r.itemId, r.variantSku, saldo) : null;
  const varian = item && r.variantSku ? labelVarian(bacaVarian(item.variants, r.variantSku, item.sku), r.variantSku) : null;
  const wa = nomorWhatsApp(pelanggan?.phone);
  return {
    id: r.id,
    status: r.status,
    kelompok: kelompokTitip(r.status, stok ?? 0),
    pembeli: { id: r.customerId, nama: pelanggan?.name ?? "—", hp: hpLokal(pelanggan?.phone), adaWa: Boolean(wa) },
    keterangan: r.description,
    barang: item ? { nama: item.nameId, sku: item.sku, varian } : null,
    qty: r.qty,
    stok,
    dibuat: tanggalJam(r.createdAt),
    dikabariPada: r.notifiedAt ? tanggalJam(r.notifiedAt) : null,
    holdUntil: r.holdUntil,
    sampai: r.holdUntil ? hariTampil(r.holdUntil) : null,
    lewat: r.status === "DIKABARI" && lewatMasaSimpan(r.holdUntil, hariWib(sekarang)),
    ditutupPada: r.closedAt ? tanggalJam(r.closedAt) : null,
    alasanTutup: r.closeReason,
    dariDicari: r.lostSaleId !== null,
    dariNota: nota?.docNo ?? null,
    bolehKabari: Boolean(wa) && bolehDikabari(r.status, stok ?? 0, r.itemId !== null),
    pesan: {
      namaPembeli: pelanggan?.name ?? "",
      namaToko: toko?.name ?? "",
      barang: item?.nameId ?? r.description,
      varian,
      qty: r.qty,
      nomorWa: wa,
    },
    hariSimpan: bacaTitipPesan(setelan?.value).hariSimpan,
  };
}
