import { prisma, type Prisma } from "@elorae/db";
import {
  capaianUntuk,
  capaianUntukHp,
  dokumenSpg,
  kemajuanRinci,
  tanpaKonsiDiHp,
  rentangBulanWib,
  susunCapaianRinci,
  TANPA_KATEGORI,
  type BarisTarget,
  type CapaianRinci,
  type DokumenJual,
  type KemajuanRinci,
  type LingkupTarget,
  type UkuranTarget,
} from "./target-rinci";

/**
 * Kueri target per kategori/barang.
 *
 * `capaianRinciSales` memakai SUMBER DAN ATURAN TANGGAL yang sama persis
 * dengan `penjualanSalesman` (`lib/salesman/queries.ts`), yang menjadi angka
 * "Bulan ini" di beranda HP:
 *   putus = `FieldSalesDelivery` milik pesanan PUTUS sales itu, menurut tanggal kirim;
 *   konsi = `FieldSalesOrder` KONSI berstatus APPROVED, menurut tanggal disetujui;
 *   van   = `VanSale` sales itu, menurut tanggal jual;
 * dibatasi ke bulan kalender WIB dan tidak melewati akhir hari ini — persis
 * titik-titik grafik beranda yang dijumlahkan kartunya. Kalau aturan di
 * `penjualanSalesman` berubah, ubah juga di sini: tes
 * `target-rinci-queries.test.ts` membandingkan keduanya dan akan gagal.
 */

const angka = (v: unknown) => Number(v ?? 0);
const sen = (v: unknown) => Math.round(angka(v) * 100);

const capaianKosong = (): CapaianRinci => ({
  total: 0,
  kanal: { putus: 0, konsi: 0, van: 0, spg: 0 },
  kategori: {},
  barang: {},
  barangKonsi: {},
});

/** Capaian per kategori dan per barang untuk beberapa sales sekaligus, satu bulan. */
export async function capaianRinciSales(
  salesmanIds: readonly string[],
  bulan: string,
  hariIni: Date,
): Promise<Map<string, CapaianRinci>> {
  const hasil = new Map<string, CapaianRinci>(salesmanIds.map((id) => [id, capaianKosong()]));
  const rentang = rentangBulanWib(bulan, hariIni);
  if (!rentang || salesmanIds.length === 0) return hasil;
  const ids = [...salesmanIds];
  const waktu = { gte: rentang.awal, lt: rentang.akhir };

  const [kirim, konsi, van] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: waktu, order: { salesmanId: { in: ids }, orderType: "PUTUS" } },
      select: {
        total: true,
        order: { select: { salesmanId: true } },
        lines: {
          select: {
            itemId: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            discountAmount: true,
            orderLine: { select: { isBonus: true } },
          },
        },
      },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { salesmanId: { in: ids }, orderType: "KONSI", status: "APPROVED", approvedAt: waktu },
      select: {
        salesmanId: true,
        total: true,
        lines: { select: { itemId: true, qty: true, lineTotal: true, discountAmount: true, isBonus: true } },
      },
    }),
    prisma.vanSale.findMany({
      where: { salesmanId: { in: ids }, createdAt: waktu },
      select: { salesmanId: true, total: true, lines: { select: { itemId: true, qty: true, lineTotal: true } } },
    }),
  ]);

  const perSales = new Map<string, DokumenJual[]>();
  const masukkan = (salesmanId: string, d: DokumenJual) => {
    const daftar = perSales.get(salesmanId);
    if (daftar) daftar.push(d);
    else perSales.set(salesmanId, [d]);
  };
  const itemIds = new Set<string>();

  for (const d of kirim) {
    masukkan(d.order.salesmanId, {
      jenis: "putus",
      totalSen: sen(d.total),
      baris: d.lines.map((l) => {
        itemIds.add(l.itemId);
        // Kiriman lama bisa tanpa lineTotal; bobot hanya perbandingan, jadi qty × harga cukup.
        const kotor = l.lineTotal !== null ? sen(l.lineTotal) : sen(angka(l.unitPrice) * l.qty);
        return { itemId: l.itemId, qty: l.qty, bobotSen: kotor - sen(l.discountAmount), bonus: l.orderLine.isBonus };
      }),
    });
  }
  for (const o of konsi) {
    masukkan(o.salesmanId, {
      jenis: "konsi",
      totalSen: sen(o.total),
      baris: o.lines.map((l) => {
        itemIds.add(l.itemId);
        return { itemId: l.itemId, qty: l.qty, bobotSen: sen(l.lineTotal) - sen(l.discountAmount), bonus: l.isBonus };
      }),
    });
  }
  for (const v of van) {
    masukkan(v.salesmanId, {
      jenis: "van",
      totalSen: sen(v.total),
      baris: v.lines.map((l) => {
        itemIds.add(l.itemId);
        return { itemId: l.itemId, qty: angka(l.qty), bobotSen: sen(l.lineTotal), bonus: false };
      }),
    });
  }

  const kategoriBarang = await kategoriDariBarang(itemIds);
  for (const [id, dokumen] of perSales) hasil.set(id, susunCapaianRinci(dokumen, kategoriBarang));
  return hasil;
}

/** Kategori SAAT INI tiap barang — dipakai kedua jenis capaian. */
async function kategoriDariBarang(itemIds: ReadonlySet<string>): Promise<Map<string, string | null>> {
  const kategoriBarang = new Map<string, string | null>();
  if (itemIds.size === 0) return kategoriBarang;
  const barang = await prisma.item.findMany({
    where: { id: { in: [...itemIds] } },
    select: { id: true, categoryId: true },
  });
  for (const b of barang) kategoriBarang.set(b.id, b.categoryId);
  return kategoriBarang;
}

/**
 * Capaian SPG per kategori dan per barang, satu bulan: nota penjualannya
 * sendiri (`SpgSale.salesmanId` = SPG itu) menurut tanggal nota, BERSIH dari
 * retur pembeli (`dokumenSpg`). Aturan tanggalnya sama dengan sales: bulan
 * kalender WIB, tidak melewati akhir hari ini.
 *
 * Milik orangnya, bukan milik tokonya: dua SPG di satu counter masing-masing
 * hanya dihitung dari notanya sendiri, dan SPG yang pindah toko di tengah
 * bulan membawa penjualannya.
 */
export async function capaianRinciSpg(
  spgIds: readonly string[],
  bulan: string,
  hariIni: Date,
): Promise<Map<string, CapaianRinci>> {
  const hasil = new Map<string, CapaianRinci>(spgIds.map((id) => [id, capaianKosong()]));
  const rentang = rentangBulanWib(bulan, hariIni);
  if (!rentang || spgIds.length === 0) return hasil;

  const nota = await prisma.spgSale.findMany({
    where: { salesmanId: { in: [...spgIds] }, createdAt: { gte: rentang.awal, lt: rentang.akhir } },
    select: {
      salesmanId: true,
      total: true,
      lines: { select: { itemId: true, qty: true, lineTotal: true, returnedQty: true } },
    },
  });
  const perSpg = new Map<string, DokumenJual[]>();
  const itemIds = new Set<string>();
  for (const n of nota) {
    for (const l of n.lines) itemIds.add(l.itemId);
    const d = dokumenSpg(n);
    const daftar = perSpg.get(n.salesmanId);
    if (daftar) daftar.push(d);
    else perSpg.set(n.salesmanId, [d]);
  }
  const kategoriBarang = await kategoriDariBarang(itemIds);
  for (const [id, dokumen] of perSpg) hasil.set(id, susunCapaianRinci(dokumen, kategoriBarang));
  return hasil;
}

/**
 * Capaian untuk campuran sales dan SPG — layar kantor menampilkan keduanya
 * dalam satu tabel. Setiap orang dihitung dengan sumbernya sendiri.
 */
export async function capaianRinciOrang(
  orang: { salesmanIds: readonly string[]; spgIds: readonly string[] },
  bulan: string,
  hariIni: Date,
): Promise<Map<string, CapaianRinci>> {
  const [sales, spg] = await Promise.all([
    capaianRinciSales(orang.salesmanIds, bulan, hariIni),
    capaianRinciSpg(orang.spgIds, bulan, hariIni),
  ]);
  return new Map([...sales, ...spg]);
}

// ─── Target tersimpan ─────────────────────────────────────────────────────────

const LINGKUP = new Set<string>(["KATEGORI", "BARANG"]);
const UKURAN = new Set<string>(["NILAI", "PCS"]);

function keBaris(r: { scope: string; refId: string; measure: string; value: unknown }): BarisTarget | null {
  // Baris dengan lingkup/ukuran asing (ditulis tangan ke basis data) dilewati, bukan ditebak.
  if (!LINGKUP.has(r.scope) || !UKURAN.has(r.measure)) return null;
  return { scope: r.scope as LingkupTarget, refId: r.refId, measure: r.measure as UkuranTarget, value: angka(r.value) };
}

/** Target tersimpan satu bulan, per sales. Sales tanpa target tidak ada di peta. */
export async function targetRinciBulan(bulan: string, salesmanIds?: readonly string[]): Promise<Map<string, BarisTarget[]>> {
  const rows = await prisma.salesTarget.findMany({
    where: { month: bulan, ...(salesmanIds ? { salesmanId: { in: [...salesmanIds] } } : {}) },
    select: { salesmanId: true, scope: true, refId: true, measure: true, value: true },
    orderBy: [{ scope: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const peta = new Map<string, BarisTarget[]>();
  for (const r of rows) {
    const b = keBaris(r);
    if (!b) continue;
    const daftar = peta.get(r.salesmanId);
    if (daftar) daftar.push(b);
    else peta.set(r.salesmanId, [b]);
  }
  return peta;
}

/** Berapa target rinci yang dimiliki satu sales pada satu bulan — untuk tautan "Rincian target" di beranda. */
export async function jumlahTargetRinci(salesmanId: string, bulan: string): Promise<number> {
  return prisma.salesTarget.count({ where: { salesmanId, month: bulan } });
}

export type NamaAcuan = { nama: string; sku: string | null; aktif: boolean };

/** Nama kategori dan barang yang dirujuk target, kunci `KATEGORI:<id>` / `BARANG:<id>`. */
export async function namaAcuanTarget(baris: readonly BarisTarget[]): Promise<Map<string, NamaAcuan>> {
  const kat = [...new Set(baris.filter((b) => b.scope === "KATEGORI").map((b) => b.refId))];
  const brg = [...new Set(baris.filter((b) => b.scope === "BARANG").map((b) => b.refId))];
  const [kategori, barang] = await Promise.all([
    kat.length ? prisma.itemCategory.findMany({ where: { id: { in: kat } }, select: { id: true, name: true, isActive: true } }) : [],
    brg.length
      ? prisma.item.findMany({ where: { id: { in: brg } }, select: { id: true, sku: true, nameId: true, isActive: true } })
      : [],
  ]);
  const peta = new Map<string, NamaAcuan>();
  for (const k of kategori) peta.set(`KATEGORI:${k.id}`, { nama: k.name, sku: null, aktif: k.isActive });
  for (const b of barang) peta.set(`BARANG:${b.id}`, { nama: b.nameId, sku: b.sku, aktif: b.isActive });
  return peta;
}

/**
 * Acuan yang BOLEH dipakai target — untuk penulis. Kategori yang ada dan
 * barang JADI yang ada; yang nonaktif tetap dikenal saat menyimpan (baris lama
 * tidak boleh menggagalkan simpanan), tetapi tidak ikut tersalin ke bulan baru
 * (`hanyaAktif`).
 */
export async function acuanDikenal(
  client: Pick<Prisma.TransactionClient, "itemCategory" | "item">,
  baris: readonly { scope: unknown; refId: unknown }[],
  opsi: { hanyaAktif?: boolean } = {},
): Promise<{ kategori: Set<string>; barang: Set<string> }> {
  const ambil = (scope: string) =>
    [...new Set(baris.filter((b) => b.scope === scope && typeof b.refId === "string").map((b) => b.refId as string))].slice(
      0,
      500,
    );
  const kat = ambil("KATEGORI");
  const brg = ambil("BARANG");
  const aktif = opsi.hanyaAktif ? { isActive: true } : {};
  const [kategori, barang] = await Promise.all([
    kat.length ? client.itemCategory.findMany({ where: { id: { in: kat }, ...aktif }, select: { id: true } }) : [],
    brg.length
      ? client.item.findMany({ where: { id: { in: brg }, type: "FINISHED_GOOD", ...aktif }, select: { id: true } })
      : [],
  ]);
  return { kategori: new Set(kategori.map((k) => k.id)), barang: new Set(barang.map((b) => b.id)) };
}

// ─── Bahan layar ─────────────────────────────────────────────────────────────

export type BarisTargetTampil = BarisTarget & {
  nama: string;
  sku: string | null;
  /** Nilai capaian di HP dihitung tanpa konsinyasi (target barang dalam rupiah). */
  tanpaKonsi: boolean;
  aktif: boolean;
  kemajuan: KemajuanRinci;
};

/** Target satu sales satu bulan, lengkap dengan nama acuan dan kemajuannya. */
export function rakitBarisTarget(
  baris: readonly BarisTarget[],
  capaian: CapaianRinci,
  nama: ReadonlyMap<string, NamaAcuan>,
  bulan: string,
  hariIni: Date,
  /** HP salesman: target barang dalam rupiah dihitung tanpa konsinyasi (`capaianUntukHp`). */
  opsi: { untukHp?: boolean } = {},
): BarisTargetTampil[] {
  return baris.map((b) => {
    const n = nama.get(`${b.scope}:${b.refId}`);
    const capai = opsi.untukHp ? capaianUntukHp(capaian, b) : capaianUntuk(capaian, b);
    return {
      ...b,
      nama: n?.nama ?? "—",
      sku: n?.sku ?? null,
      aktif: n?.aktif ?? false,
      tanpaKonsi: opsi.untukHp === true && tanpaKonsiDiHp(b),
      kemajuan: kemajuanRinci(b.value, capai, bulan, hariIni),
    };
  });
}

/**
 * Target rinci milik SATU orang untuk layar HP-nya. SPG (`opsi.spg`) dihitung
 * dari nota penjualannya sendiri (`capaianRinciSpg`); konsinyasi tidak pernah
 * ada di sana, jadi tidak ada yang perlu disembunyikan (`untukHp` hanya untuk
 * sales).
 */
export async function targetSaya(salesmanId: string, bulan: string, hariIni: Date, opsi: { spg?: boolean } = {}) {
  const [peta, capaian] = await Promise.all([
    targetRinciBulan(bulan, [salesmanId]),
    opsi.spg ? capaianRinciSpg([salesmanId], bulan, hariIni) : capaianRinciSales([salesmanId], bulan, hariIni),
  ]);
  const baris = peta.get(salesmanId) ?? [];
  const c = capaian.get(salesmanId) ?? capaianKosong();
  const nama = await namaAcuanTarget(baris);
  return { baris: rakitBarisTarget(baris, c, nama, bulan, hariIni, { untukHp: !opsi.spg }), capaian: c };
}

export type PilihanAcuan = {
  kategori: { id: string; nama: string }[];
  barang: { id: string; sku: string; nama: string; kategori: string | null }[];
};

/** Pilihan untuk menambah target: kategori aktif dan barang jadi aktif. */
export async function pilihanAcuanTarget(): Promise<PilihanAcuan> {
  const [kategori, barang] = await Promise.all([
    prisma.itemCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.item.findMany({
      where: { isActive: true, type: "FINISHED_GOOD" },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, nameId: true, category: { select: { name: true } } },
    }),
  ]);
  return {
    kategori: kategori.map((k) => ({ id: k.id, nama: k.name })),
    barang: barang.map((b) => ({ id: b.id, sku: b.sku, nama: b.nameId, kategori: b.category?.name ?? null })),
  };
}

/** Nama semua kategori yang punya capaian, untuk tabel "Penjualan per kategori". */
export async function namaKategori(ids: readonly string[]): Promise<Map<string, string>> {
  const nyata = ids.filter((id) => id !== TANPA_KATEGORI);
  if (nyata.length === 0) return new Map();
  const rows = await prisma.itemCategory.findMany({ where: { id: { in: nyata } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}
