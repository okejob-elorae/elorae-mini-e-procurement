import { prisma } from "@elorae/db";
import { formatDisplayDateTime } from "@/lib/date-only";
import { geserHari, jumlahHari } from "@/lib/tanggal-isian";
import {
  adaSelisih,
  bacaFotoLaporan,
  batasHariWib,
  ENTITAS_TUTUP_HARI,
  hitungAngkaPenjualan,
  konversiPersen,
  MAKS_HARI_REKAP,
  pesanTutupHariWa,
  potongNota,
  selisihKasir,
  susunRingkasanTutupHari,
  type AngkaPenjualan,
  type BahanTutupHari,
  type NilaiLaporanTutup,
  type ReturTutup,
  type RingkasanTutupHari,
} from "./tutup-hari";

/**
 * Kueri laporan tutup hari SPG (server saja — mengimpor Prisma; klien hanya
 * boleh `import type` dari sini). Angka penjualan selalu dihitung dari nota
 * sungguhan lewat pembangun murni di `tutup-hari.ts`, jadi HP, laporan yang
 * disimpan, dan layar kantor membaca definisi yang sama.
 */

const angka = (v: unknown) => Number(v ?? 0);
const angkaAtauNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const namaOrang = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

async function namaPengguna(ids: string[]): Promise<Record<string, string>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return {};
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return Object.fromEntries(rows.map((u) => [u.id, namaOrang(u)]));
}

/** Bahan mentah satu toko satu hari WIB — semua SPG toko itu, bukan hanya yang membuka layar. */
export async function bahanTutupHari(storeId: string, day: string): Promise<BahanTutupHari | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true } });
  if (!toko) return null;
  const { awal, akhir } = batasHariWib(day);
  const rentang = { gte: awal, lt: akhir };

  const [nota, retur, kiriman, dicari, spg] = await Promise.all([
    prisma.spgSale.findMany({
      where: { storeId, createdAt: rentang },
      orderBy: { createdAt: "asc" },
      select: {
        salesmanId: true,
        subtotal: true,
        discountTotal: true,
        total: true,
        lines: { select: { itemId: true, variantSku: true, productName: true, qty: true } },
      },
    }),
    prisma.spgSaleReturnLine.findMany({
      where: { saleReturn: { storeId, createdAt: rentang } },
      select: { qty: true, saleLine: { select: { qty: true, lineTotal: true, unitPrice: true } } },
    }),
    prisma.storeReceipt.findMany({
      where: { storeId, receivedAt: rentang },
      orderBy: { receivedAt: "asc" },
      select: {
        sourceType: true,
        sourceDocNo: true,
        receivedAt: true,
        receivedById: true,
        lines: { select: { qtyReceived: true, qtyDamaged: true } },
      },
    }),
    prisma.lostSale.findMany({
      where: { storeId, createdAt: rentang },
      orderBy: { createdAt: "asc" },
      select: { description: true, qty: true },
    }),
    prisma.user.findMany({ where: { assignedStoreId: storeId }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);

  const nama = await namaPengguna([...nota.map((n) => n.salesmanId), ...kiriman.map((k) => k.receivedById)]);

  return {
    storeId,
    namaToko: toko.name,
    day,
    nota: nota.map((n) => ({
      salesmanId: n.salesmanId,
      subtotal: angka(n.subtotal),
      discountTotal: angka(n.discountTotal),
      total: angka(n.total),
      baris: n.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, productName: l.productName, qty: l.qty })),
    })),
    retur: retur.map((r) => ({
      qty: r.qty,
      saleLine: { qty: r.saleLine.qty, lineTotal: angkaAtauNull(r.saleLine.lineTotal), unitPrice: angka(r.saleLine.unitPrice) },
    })),
    kiriman: kiriman.map((k) => ({
      docNo: k.sourceDocNo,
      sourceType: k.sourceType,
      waktu: k.receivedAt.toISOString(),
      diterima: k.lines.reduce((s, l) => s + l.qtyReceived, 0),
      rusak: k.lines.reduce((s, l) => s + l.qtyDamaged, 0),
      penerima: nama[k.receivedById] ?? null,
    })),
    dicari: dicari.map((d) => ({ description: d.description, qty: d.qty })),
    spg: spg.map((u) => ({ id: u.id, nama: namaOrang(u) })),
    namaPengguna: nama,
  };
}

export async function ringkasanTutupHari(storeId: string, day: string): Promise<RingkasanTutupHari | null> {
  const bahan = await bahanTutupHari(storeId, day);
  return bahan ? susunRingkasanTutupHari(bahan) : null;
}

/** Laporan yang tersimpan, dibaca sebagai angka biasa. */
export type LaporanTutup = NilaiLaporanTutup & {
  id: string;
  storeId: string;
  day: string;
  closedByName: string;
  createdAt: string;
  updatedAt: string;
};

type BarisClose = {
  id: string;
  storeId: string;
  day: string;
  closedById: string;
  notaCount: number;
  pcs: number;
  returnPcs: number;
  grossTotal: unknown;
  discountTotal: unknown;
  netTotal: unknown;
  visitorCount: number | null;
  cashierTotal: unknown;
  note: string | null;
  photoUrls: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function bacaLaporan(c: BarisClose, nama: Record<string, string>): LaporanTutup {
  return {
    id: c.id,
    storeId: c.storeId,
    day: c.day,
    closedById: c.closedById,
    closedByName: nama[c.closedById] ?? "—",
    notaCount: c.notaCount,
    pcs: c.pcs,
    returnPcs: c.returnPcs,
    grossTotal: angka(c.grossTotal),
    discountTotal: angka(c.discountTotal),
    netTotal: angka(c.netTotal),
    visitorCount: c.visitorCount,
    cashierTotal: angkaAtauNull(c.cashierTotal),
    note: c.note,
    photoUrls: bacaFotoLaporan(c.photoUrls),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function laporanTutupHari(storeId: string, day: string): Promise<LaporanTutup | null> {
  const c = await prisma.spgDailyClose.findUnique({ where: { storeId_day: { storeId, day } } });
  if (!c) return null;
  return bacaLaporan(c, await namaPengguna([c.closedById]));
}

/**
 * Teks WhatsApp laporan yang tersimpan: angka dari laporan (yang dilaporkan),
 * terlaris dari nota hari itu.
 */
export async function pesanWaLaporan(storeId: string, day: string): Promise<string | null> {
  const [laporan, ringkasan] = await Promise.all([laporanTutupHari(storeId, day), ringkasanTutupHari(storeId, day)]);
  if (!laporan || !ringkasan) return null;
  return pesanTutupHariWa({
    namaToko: ringkasan.namaToko,
    day,
    nota: laporan.notaCount,
    potong: laporan.pcs,
    potongKembali: laporan.returnPcs,
    nilaiBersih: laporan.netTotal,
    potongan: laporan.discountTotal,
    terlaris: ringkasan.terlaris,
    pengunjung: laporan.visitorCount,
    totalKasir: laporan.cashierTotal,
    catatan: laporan.note,
  });
}

// ---------------------------------------------------------------------------
// Kantor
// ---------------------------------------------------------------------------

/** Toko yang punya SPG sekarang, ditambah toko yang punya laporan di rentang itu. */
async function tokoBerSpg(tambahan: string[]): Promise<{ id: string; name: string; code: string; spg: string[] }[]> {
  const spg = await prisma.user.findMany({
    where: { assignedStoreId: { not: null } },
    select: { name: true, email: true, assignedStoreId: true },
    orderBy: { name: "asc" },
  });
  const perToko = new Map<string, string[]>();
  for (const u of spg) {
    if (!u.assignedStoreId) continue;
    perToko.set(u.assignedStoreId, [...(perToko.get(u.assignedStoreId) ?? []), namaOrang(u)]);
  }
  const ids = [...new Set([...perToko.keys(), ...tambahan])];
  if (ids.length === 0) return [];
  const toko = await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } });
  return toko
    .map((t) => ({ ...t, spg: perToko.get(t.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Angka sistem per toko dalam rentang [awal, akhir). */
async function angkaPerToko(storeIds: string[], awal: Date, akhir: Date) {
  const rentang = { gte: awal, lt: akhir };
  const [nota, retur] = await Promise.all([
    prisma.spgSale.findMany({
      where: { storeId: { in: storeIds }, createdAt: rentang },
      select: { storeId: true, createdAt: true, subtotal: true, discountTotal: true, total: true, lines: { select: { qty: true } } },
    }),
    prisma.spgSaleReturnLine.findMany({
      where: { saleReturn: { storeId: { in: storeIds }, createdAt: rentang } },
      select: { qty: true, saleReturn: { select: { storeId: true } }, saleLine: { select: { qty: true, lineTotal: true, unitPrice: true } } },
    }),
  ]);
  const notaPer = new Map<string, { subtotal: number; discountTotal: number; total: number; potong: number }[]>();
  const hariJual = new Map<string, Set<string>>();
  for (const n of nota) {
    const x = { subtotal: angka(n.subtotal), discountTotal: angka(n.discountTotal), total: angka(n.total), potong: potongNota({ baris: n.lines }) };
    notaPer.set(n.storeId, [...(notaPer.get(n.storeId) ?? []), x]);
    const hari = hariJual.get(n.storeId) ?? new Set<string>();
    hari.add(new Date(n.createdAt.getTime() + 7 * 3_600_000).toISOString().slice(0, 10));
    hariJual.set(n.storeId, hari);
  }
  const returPer = new Map<string, ReturTutup[]>();
  for (const r of retur) {
    const x: ReturTutup = { qty: r.qty, saleLine: { qty: r.saleLine.qty, lineTotal: angkaAtauNull(r.saleLine.lineTotal), unitPrice: angka(r.saleLine.unitPrice) } };
    returPer.set(r.saleReturn.storeId, [...(returPer.get(r.saleReturn.storeId) ?? []), x]);
  }
  const hasil = new Map<string, { angka: AngkaPenjualan; hariJual: number }>();
  for (const id of storeIds) {
    hasil.set(id, { angka: hitungAngkaPenjualan(notaPer.get(id) ?? [], returPer.get(id) ?? []), hariJual: hariJual.get(id)?.size ?? 0 });
  }
  return hasil;
}

export type LaporanKantor = {
  id: string;
  oleh: string;
  /** "3 Okt 2026, 21.10" — jam kiriman terakhir, WIB. */
  jam: string;
  nota: number;
  potong: number;
  nilaiBersih: number;
  pengunjung: number | null;
  konversi: number | null;
  kasir: number | null;
  selisih: number | null;
  adaSelisih: boolean;
  catatan: string | null;
  foto: string[];
};

export type BarisKantorHari = {
  storeId: string;
  toko: string;
  kode: string;
  spg: string[];
  /** Angka sistem saat ini (live). */
  sistem: AngkaPenjualan;
  laporan: LaporanKantor | null;
  /** Nota/nilai berubah sejak ditutup (mis. nota dari antrean HP terkirim sesudahnya). */
  berubah: boolean;
};

export type DaftarTutupHariKantor = {
  day: string;
  baris: BarisKantorHari[];
  sudah: number;
  belum: number;
  /** Belum tutup padahal sudah ada nota — yang perlu dikejar. */
  belumAdaNota: number;
};

function laporanKantor(l: LaporanTutup): LaporanKantor {
  const selisih = selisihKasir(l.cashierTotal, l.netTotal);
  return {
    id: l.id,
    oleh: l.closedByName,
    jam: formatDisplayDateTime(l.updatedAt),
    nota: l.notaCount,
    potong: l.pcs,
    nilaiBersih: l.netTotal,
    pengunjung: l.visitorCount,
    konversi: konversiPersen(l.notaCount, l.visitorCount),
    kasir: l.cashierTotal,
    selisih,
    adaSelisih: adaSelisih(selisih),
    catatan: l.note,
    foto: l.photoUrls,
  };
}

export async function daftarTutupHariKantor(day: string): Promise<DaftarTutupHariKantor> {
  const laporan = await prisma.spgDailyClose.findMany({ where: { day } });
  const toko = await tokoBerSpg(laporan.map((l) => l.storeId));
  const ids = toko.map((t) => t.id);
  const { awal, akhir } = batasHariWib(day);
  const [sistem, nama] = await Promise.all([angkaPerToko(ids, awal, akhir), namaPengguna(laporan.map((l) => l.closedById))]);
  const perToko = new Map(laporan.map((l) => [l.storeId, bacaLaporan(l, nama)]));

  const baris: BarisKantorHari[] = toko.map((t) => {
    const s = sistem.get(t.id)!.angka;
    const l = perToko.get(t.id) ?? null;
    return {
      storeId: t.id,
      toko: t.name,
      kode: t.code,
      spg: t.spg,
      sistem: s,
      laporan: l ? laporanKantor(l) : null,
      berubah: l !== null && (l.notaCount !== s.nota || Math.round(l.netTotal) !== Math.round(s.nilaiBersih)),
    };
  });
  // Yang belum tutup padahal sudah berjualan di atas: itulah yang dikejar kantor.
  baris.sort((a, b) => urutan(a) - urutan(b) || a.toko.localeCompare(b.toko));
  return {
    day,
    baris,
    sudah: baris.filter((b) => b.laporan).length,
    belum: baris.filter((b) => !b.laporan).length,
    belumAdaNota: baris.filter((b) => !b.laporan && b.sistem.nota > 0).length,
  };
}

const urutan = (b: BarisKantorHari) => (b.laporan ? 1 : b.sistem.nota > 0 ? 0 : 2);

export type BarisRekapToko = {
  storeId: string;
  toko: string;
  kode: string;
  hariJual: number;
  hariTutup: number;
  nota: number;
  potong: number;
  nilaiBersih: number;
  pengunjung: number | null;
  konversi: number | null;
  kasir: number | null;
  selisih: number | null;
  hariSelisih: number;
};

export type RekapTutupHariKantor = { dari: string; sampai: string; hari: number; baris: BarisRekapToko[] };

/**
 * Rekap per toko untuk rentang (paling panjang `MAKS_HARI_REKAP` hari; yang
 * lebih panjang dipangkas dari ujung awal). Nota, potong, dan nilai bersih
 * dari sistem; pengunjung, kasir, dan selisih dari laporan yang dikirim —
 * konversi hanya atas hari yang pengunjungnya diisi, selisih hanya atas hari
 * yang total kasirnya diisi.
 */
export async function rekapTutupHariKantor(dari: string, sampai: string): Promise<RekapTutupHariKantor> {
  let awalHari = dari <= sampai ? dari : sampai;
  const akhirHari = dari <= sampai ? sampai : dari;
  if (jumlahHari(awalHari, akhirHari) > MAKS_HARI_REKAP) awalHari = geserHari(akhirHari, -(MAKS_HARI_REKAP - 1));

  const laporan = await prisma.spgDailyClose.findMany({ where: { day: { gte: awalHari, lte: akhirHari } } });
  const toko = await tokoBerSpg(laporan.map((l) => l.storeId));
  const sistem = await angkaPerToko(
    toko.map((t) => t.id),
    batasHariWib(awalHari).awal,
    batasHariWib(akhirHari).akhir,
  );

  const baris = toko.map((t): BarisRekapToko => {
    const milik = laporan.filter((l) => l.storeId === t.id);
    const s = sistem.get(t.id)!;
    const berPengunjung = milik.filter((l) => l.visitorCount !== null);
    const berKasir = milik.filter((l) => l.cashierTotal !== null);
    const pengunjung = berPengunjung.length > 0 ? berPengunjung.reduce((n, l) => n + (l.visitorCount ?? 0), 0) : null;
    const notaBerPengunjung = berPengunjung.reduce((n, l) => n + l.notaCount, 0);
    const selisihHari = berKasir.map((l) => selisihKasir(angka(l.cashierTotal), angka(l.netTotal)));
    return {
      storeId: t.id,
      toko: t.name,
      kode: t.code,
      hariJual: s.hariJual,
      hariTutup: milik.length,
      nota: s.angka.nota,
      potong: s.angka.potong,
      nilaiBersih: s.angka.nilaiBersih,
      pengunjung,
      konversi: konversiPersen(notaBerPengunjung, pengunjung),
      kasir: berKasir.length > 0 ? Math.round(berKasir.reduce((n, l) => n + angka(l.cashierTotal), 0) * 100) / 100 : null,
      selisih: berKasir.length > 0 ? Math.round(selisihHari.reduce((n: number, x) => n + (x ?? 0), 0) * 100) / 100 : null,
      hariSelisih: selisihHari.filter((x) => adaSelisih(x)).length,
    };
  });
  return { dari: awalHari, sampai: akhirHari, hari: jumlahHari(awalHari, akhirHari), baris };
}

export type JejakTutup = {
  id: string;
  action: string;
  oleh: string;
  jam: string;
  before: Partial<NilaiLaporanTutup> | null;
  after: Partial<NilaiLaporanTutup> | null;
};

export type RincianTutupHariKantor = {
  laporan: LaporanTutup;
  toko: { id: string; nama: string; kode: string };
  ringkasanKantor: LaporanKantor;
  /** Angka sistem saat ini, lengkap (terlaris, kiriman, dicari, per SPG). */
  sistem: RingkasanTutupHari;
  berubah: boolean;
  jejak: JejakTutup[];
};

const objek = (v: unknown): Partial<NilaiLaporanTutup> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<NilaiLaporanTutup>) : null;

export async function rincianTutupHariKantor(id: string): Promise<RincianTutupHariKantor | null> {
  const c = await prisma.spgDailyClose.findUnique({ where: { id } });
  if (!c) return null;
  const [toko, sistem, jejak] = await Promise.all([
    prisma.store.findUnique({ where: { id: c.storeId }, select: { id: true, name: true, code: true } }),
    ringkasanTutupHari(c.storeId, c.day),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_TUTUP_HARI, entityId: c.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, userId: true, createdAt: true, changes: true },
    }),
  ]);
  if (!toko || !sistem) return null;
  const nama = await namaPengguna([c.closedById, ...jejak.map((j) => j.userId)]);
  const laporan = bacaLaporan(c, nama);
  return {
    laporan,
    toko: { id: toko.id, nama: toko.name, kode: toko.code },
    ringkasanKantor: laporanKantor(laporan),
    sistem,
    berubah: laporan.notaCount !== sistem.nota || Math.round(laporan.netTotal) !== Math.round(sistem.nilaiBersih),
    jejak: jejak.map((j) => {
      const ch = objek(j.changes) as { before?: unknown; after?: unknown } | null;
      return {
        id: j.id,
        action: j.action,
        oleh: nama[j.userId] ?? "—",
        jam: formatDisplayDateTime(j.createdAt),
        before: objek(ch?.before),
        after: objek(ch?.after),
      };
    }),
  };
}
