import { prisma, Prisma, sqlId } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import type { SaluranJual } from "@/lib/items/saluran-jual";
import {
  ALASAN_KIRIMAN,
  alasanTidakBisaDikirim,
  alasanTidakBisaDikirimUlang,
  bedaDiJubelio,
  hargaBerlaku,
  hargaKeTeks,
  hargaSama,
  keadaanHargaJubelio,
  MAKS_DAFTAR_HARGA,
  type AlasanTidakBisaDikirim,
  type JenisMenunggu,
  type KeadaanHargaJubelio,
} from "./aturan";

/**
 * Bacaan halaman Jubelio → Konfirmasi harga, kartu "Harga di Jubelio" di halaman barang, dan
 * hitungan Beranda (keputusan pemilik 2026-11-02). Tanpa `"use server"` dan tanpa pemeriksaan
 * izin — pemanggilnya yang memeriksa.
 *
 * Daftar dan hitungan Beranda memakai SATU fragmen SQL (`sumberMenunggu`), kembaran
 * `keadaanHargaJubelio` di aturan.ts, jadi angka di Beranda sama dengan jumlah baris saat
 * tautannya dibuka. Harga 0 atau kurang dibaca sebagai tidak ada harga (`CASE WHEN x > 0`) di
 * kedua sisi; -1 sebagai pengganti NULL aman karena harga selalu ≥ 0. Barang "Toko offline saja"
 * tidak pernah menunggu (P3a).
 *
 * "Harga di Jubelio berbeda dengan ERP" (BEDA, P2/P75) juga SATU fragmen (`sumberBeda`), kembaran
 * `bedaDiJubelio`, dipakai daftar, hitungan Beranda, sapuan lonceng, dan sapuan pelepas kiriman
 * yang ditahan.
 *
 * Fragmen dibangun dengan `Prisma.sql` modul ini sendiri dan seluruh kuerinya diserahkan sebagai
 * SATU argumen ke `$queryRaw` — tidak pernah fragmen yang disisipkan ke template bertanda
 * (docs/landmines/database-ops.md).
 */

function saringanBarang(hanyaBarang: string[] | undefined): Prisma.Sql {
  if (hanyaBarang === undefined) return Prisma.empty;
  return Prisma.sql`AND i.${sqlId("id")} IN (${Prisma.join(hanyaBarang)})`;
}

function hargaBerlakuSql(kolom: string): Prisma.Sql {
  return Prisma.sql`COALESCE(CASE WHEN i.${sqlId(kolom)} > 0 THEN i.${sqlId(kolom)} END, -1)`;
}

/** Ada kiriman produk barang `i` yang masih PENDING/PROCESSING. */
function sedangDikirimSql(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ${sqlId("JubelioOutbox")} o
    WHERE o.${sqlId("entityType")} = 'product_push' AND o.${sqlId("entityId")} = i.${sqlId("id")}
      AND o.${sqlId("status")} IN ('PENDING', 'PROCESSING')
  )`;
}

/** Kiriman produk TERAKHIR barang `i` (terbaru menurut createdAt, lalu id) memenuhi `syarat` (alias `o`). */
function kirimanTerakhirSql(syarat: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ${sqlId("JubelioOutbox")} o
    WHERE o.${sqlId("entityType")} = 'product_push' AND o.${sqlId("entityId")} = i.${sqlId("id")}
      AND ${syarat}
      AND NOT EXISTS (
        SELECT 1 FROM ${sqlId("JubelioOutbox")} o2
        WHERE o2.${sqlId("entityType")} = 'product_push' AND o2.${sqlId("entityId")} = i.${sqlId("id")}
          AND (o2.${sqlId("createdAt")} > o.${sqlId("createdAt")}
            OR (o2.${sqlId("createdAt")} = o.${sqlId("createdAt")} AND o2.${sqlId("id")} > o.${sqlId("id")}))
      )
  )`;
}

/** FROM + WHERE barang yang menunggu konfirmasi. Alias `i` = Item, `m` = pemetaan Jubelio. */
function sumberMenunggu(opsi: { hanyaBarang?: string[]; jenis?: JenisMenunggu }): Prisma.Sql {
  const ubah = Prisma.sql`(m.${sqlId("itemId")} IS NOT NULL AND ${hargaBerlakuSql("sellingPrice")} <> ${hargaBerlakuSql("jubelioConfirmedPrice")})`;
  const baru = Prisma.sql`(m.${sqlId("itemId")} IS NULL AND i.${sqlId("source")} = 'ERP' AND i.${sqlId("jubelioCreateRequestedAt")} IS NOT NULL)`;
  const syarat = opsi.jenis === "UBAH" ? ubah : opsi.jenis === "BARU" ? baru : Prisma.sql`(${ubah} OR ${baru})`;
  return Prisma.sql`
    FROM ${sqlId("Item")} i
    LEFT JOIN (SELECT DISTINCT ${sqlId("itemId")} FROM ${sqlId("JubelioProductMapping")}) m ON m.${sqlId("itemId")} = i.${sqlId("id")}
    WHERE i.${sqlId("type")} = 'FINISHED_GOOD'
      AND i.${sqlId("salesChannel")} <> 'OFFLINE'
      AND ${syarat}
      ${saringanBarang(opsi.hanyaBarang)}
  `;
}

/**
 * FROM + WHERE barang BEDA (alias `i`, `m`) — kembaran `bedaDiJubelio`: barang jadi di Jubelio,
 * pernah terbaca, harga terbaca tertinggi ATAU terendah ≠ harga terkonfirmasi, dan bukan
 * "keputusan berlaku + kiriman sedang berjalan". Apa pun salurannya (R22): "Toko offline saja" yang
 * sudah dinonaktifkan di Jubelio ikut diawasi, sama dengan penahanan kiriman di apps/api.
 */
export function sumberBeda(opsi: { hanyaBarang?: string[] } = {}): Prisma.Sql {
  const terkonfirmasi = hargaBerlakuSql("jubelioConfirmedPrice");
  const keputusanBerlaku = Prisma.sql`(i.${sqlId("jubelioPriceDecidedAt")} IS NOT NULL
    AND (i.${sqlId("jubelioObservedChangedAt")} IS NULL OR i.${sqlId("jubelioObservedChangedAt")} <= i.${sqlId("jubelioPriceDecidedAt")}))`;
  return Prisma.sql`
    FROM ${sqlId("Item")} i
    JOIN (SELECT DISTINCT ${sqlId("itemId")} FROM ${sqlId("JubelioProductMapping")}) m ON m.${sqlId("itemId")} = i.${sqlId("id")}
    WHERE i.${sqlId("type")} = 'FINISHED_GOOD'
      AND i.${sqlId("jubelioObservedAt")} IS NOT NULL
      AND (${hargaBerlakuSql("jubelioObservedPriceMax")} <> ${terkonfirmasi} OR ${hargaBerlakuSql("jubelioObservedPriceMin")} <> ${terkonfirmasi})
      AND NOT (${keputusanBerlaku} AND ${sedangDikirimSql()})
      ${saringanBarang(opsi.hanyaBarang)}
  `;
}

/** Hitungan Beranda "Harga menunggu konfirmasi Jubelio" — persis baris yang ditampilkan halaman tanpa saringan. */
export async function hitungHargaMenungguKonfirmasi(opsi: { hanyaBarang?: string[] } = {}): Promise<number> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number | string }>>(
    Prisma.sql`SELECT COUNT(*) AS ${sqlId("n")} ${sumberMenunggu({ hanyaBarang: opsi.hanyaBarang })}`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Hitungan Beranda "Harga di Jubelio berbeda dengan ERP" — persis baris daftar `?jenis=BEDA`. */
export async function hitungHargaBedaDiJubelio(opsi: { hanyaBarang?: string[] } = {}): Promise<number> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number | string }>>(
    Prisma.sql`SELECT COUNT(*) AS ${sqlId("n")} ${sumberBeda({ hanyaBarang: opsi.hanyaBarang })}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export type BarisHargaMenunggu = {
  itemId: string;
  sku: string;
  nama: string;
  isActive: boolean;
  jenis: JenisMenunggu;
  /** Harga terkonfirmasi untuk Jubelio ("150000.00"); null = belum ada. */
  hargaJubelio: string | null;
  /** Harga jual ERP sekarang — juga token compare-and-swap yang dikirim balik saat menyetujui. */
  hargaErp: string | null;
  diubahOleh: string | null;
  /** ISO. Perubahan harga: riwayat harga jual terbaru; produk baru: waktu pengajuan. */
  diubahPada: string | null;
  /** ISO waktu pengajuan. */
  diajukanPada: string | null;
  kategoriTerpetakan: boolean;
  alasan: AlasanTidakBisaDikirim | null;
  /** Baris ini juga BEDA: harga yang terbaca di Jubelio bukan harga terkonfirmasi. */
  bedaDiJubelio: boolean;
  /** Yang terakhir terbaca di Jubelio — tertinggi dan terendah ("150000.00"); null = belum terbaca. */
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
  /**
   * ISO `jubelioObservedChangedAt` — token compare-and-swap kedua yang dikirim balik saat menyetujui
   * atau mengembalikan: bacaan Jubelio yang berubah sesudah halaman dibuka ditolak (P75). null =
   * bacaannya belum pernah berubah.
   */
  berubahPada: string | null;
};

/** Barang yang punya kiriman produk PENDING/PROCESSING, di antara `ids`. */
async function idSedangDikirim(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.jubelioOutbox.findMany({
    where: { entityType: "product_push", entityId: { in: ids }, status: { in: ["PENDING", "PROCESSING"] } },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId));
}

/** Kiriman produk terakhir per barang (createdAt, lalu id — sama dengan `kirimanTerakhirSql`). */
async function kirimanTerakhirPerBarang(ids: string[]): Promise<Map<string, { status: string; skipReason: string | null }>> {
  const hasil = new Map<string, { status: string; skipReason: string | null }>();
  if (ids.length === 0) return hasil;
  const rows = await prisma.jubelioOutbox.findMany({
    where: { entityType: "product_push", entityId: { in: ids } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, status: true, skipReason: true },
  });
  for (const r of rows) if (!hasil.has(r.entityId)) hasil.set(r.entityId, { status: r.status, skipReason: r.skipReason });
  return hasil;
}

async function kategoriTerpetakanDari(idKategori: Set<string>): Promise<Set<string>> {
  if (idKategori.size === 0) return new Set();
  const rows = await prisma.jubelioCategoryMapping.findMany({
    where: { itemCategoryId: { in: [...idKategori] } },
    select: { itemCategoryId: true },
  });
  return new Set(rows.map((k) => k.itemCategoryId));
}

/**
 * Daftar yang menunggu konfirmasi, terbaru dulu. Sengaja tanpa halaman: orang mencentang lalu
 * menyetujui banyak sekaligus; dibatasi `MAKS_DAFTAR_HARGA` baris dengan catatan bila terpotong.
 */
export async function daftarHargaMenunggu(
  opsi: { jenis?: JenisMenunggu; cari?: string; hanyaBarang?: string[] } = {},
): Promise<{ baris: BarisHargaMenunggu[]; total: number; terpotong: boolean }> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return { baris: [], total: 0, terpotong: false };

  const urutan = await prisma.$queryRaw<Array<{ id: string; jenis: string }>>(Prisma.sql`
    SELECT i.${sqlId("id")} AS ${sqlId("id")},
      CASE WHEN m.${sqlId("itemId")} IS NULL THEN 'BARU' ELSE 'UBAH' END AS ${sqlId("jenis")}
    ${sumberMenunggu({ hanyaBarang: opsi.hanyaBarang, jenis: opsi.jenis })}
    ORDER BY COALESCE(
      CASE WHEN m.${sqlId("itemId")} IS NULL THEN i.${sqlId("jubelioCreateRequestedAt")} END,
      (SELECT MAX(l.${sqlId("changedAt")}) FROM ${sqlId("ItemPriceChangeLog")} l WHERE l.${sqlId("itemId")} = i.${sqlId("id")}),
      i.${sqlId("updatedAt")}
    ) DESC, i.${sqlId("sku")} ASC
  `);

  let ids = urutan.map((r) => r.id);
  const jenisPerId = new Map(urutan.map((r) => [r.id, r.jenis === "BARU" ? ("BARU" as const) : ("UBAH" as const)]));

  ids = await saringCari(ids, opsi.cari);

  const total = ids.length;
  const tampil = ids.slice(0, MAKS_DAFTAR_HARGA);
  if (tampil.length === 0) return { baris: [], total, terpotong: false };

  const [barang, dikirim] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: tampil } },
      select: {
        id: true,
        sku: true,
        nameId: true,
        nameEn: true,
        isActive: true,
        categoryId: true,
        sellingPrice: true,
        jubelioConfirmedPrice: true,
        jubelioCreateRequestedAt: true,
        jubelioCreateRequestedById: true,
        jubelioObservedPriceMax: true,
        jubelioObservedPriceMin: true,
        jubelioObservedAt: true,
        jubelioObservedChangedAt: true,
        jubelioPriceDecidedAt: true,
        priceChangeLogs: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true, changedById: true } },
      },
    }),
    idSedangDikirim(tampil),
  ]);
  const perId = new Map(barang.map((b) => [b.id, b]));

  const idPengguna = new Set<string>();
  const idKategori = new Set<string>();
  for (const b of barang) {
    const log = b.priceChangeLogs[0];
    if (log?.changedById) idPengguna.add(log.changedById);
    if (b.jubelioCreateRequestedById) idPengguna.add(b.jubelioCreateRequestedById);
    if (b.categoryId) idKategori.add(b.categoryId);
  }
  const [pengguna, kategoriTerpetakan] = await Promise.all([
    idPengguna.size > 0
      ? prisma.user.findMany({ where: { id: { in: [...idPengguna] } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    kategoriTerpetakanDari(idKategori),
  ]);
  const namaPengguna = new Map(pengguna.map((u) => [u.id, u.name || u.email || null]));

  const baris: BarisHargaMenunggu[] = [];
  for (const id of tampil) {
    const b = perId.get(id);
    const jenis = jenisPerId.get(id);
    if (!b || !jenis) continue;
    const hargaErp = hargaKeTeks(b.sellingPrice);
    const terpetakanKategori = b.categoryId ? kategoriTerpetakan.has(b.categoryId) : false;
    const log = b.priceChangeLogs[0];
    const diajukanPada = b.jubelioCreateRequestedAt?.toISOString() ?? null;
    const diubahOlehId = jenis === "BARU" ? b.jubelioCreateRequestedById : (log?.changedById ?? null);
    const jubelioTertinggi = hargaKeTeks(b.jubelioObservedPriceMax);
    const jubelioTerendah = hargaKeTeks(b.jubelioObservedPriceMin);
    baris.push({
      itemId: b.id,
      sku: b.sku,
      nama: b.nameId || b.nameEn || b.sku,
      isActive: b.isActive,
      jenis,
      hargaJubelio: jenis === "BARU" ? null : hargaKeTeks(b.jubelioConfirmedPrice),
      hargaErp,
      diubahOleh: diubahOlehId ? (namaPengguna.get(diubahOlehId) ?? null) : null,
      diubahPada: jenis === "BARU" ? diajukanPada : (log?.changedAt.toISOString() ?? null),
      diajukanPada,
      kategoriTerpetakan: terpetakanKategori,
      alasan: alasanTidakBisaDikirim({ hargaErp, kategoriTerpetakan: terpetakanKategori }),
      bedaDiJubelio: bedaDiJubelio({
        barangJadi: true,
        terpetakan: jenis === "UBAH",
        terbacaPada: b.jubelioObservedAt,
        jubelioTertinggi,
        jubelioTerendah,
        hargaTerkonfirmasi: hargaKeTeks(b.jubelioConfirmedPrice),
        diputuskanPada: b.jubelioPriceDecidedAt,
        berubahPada: b.jubelioObservedChangedAt,
        sedangDikirim: dikirim.has(b.id),
      }),
      jubelioTertinggi: b.jubelioObservedAt ? jubelioTertinggi : null,
      jubelioTerendah: b.jubelioObservedAt ? jubelioTerendah : null,
      berubahPada: b.jubelioObservedChangedAt?.toISOString() ?? null,
    });
  }
  return { baris, total, terpotong: total > tampil.length };
}

/** `ids` yang SKU/namanya cocok dengan `cari`, urutannya dipertahankan; tanpa `cari` = semua. */
async function saringCari(ids: string[], cari: string | undefined): Promise<string[]> {
  const kata = cari?.trim();
  if (!kata || ids.length === 0) return ids;
  const cocok = new Set(
    (
      await prisma.item.findMany({
        where: { id: { in: ids }, OR: [{ sku: cariTeks(kata) }, { nameId: cariTeks(kata) }, { nameEn: cariTeks(kata) }] },
        select: { id: true },
      })
    ).map((b) => b.id),
  );
  return ids.filter((id) => cocok.has(id));
}

export type BarisHargaBeda = {
  itemId: string;
  sku: string;
  nama: string;
  isActive: boolean;
  saluran: SaluranJual;
  /** Terbaca di Jubelio ("150000.00"; "0.00" = ada varian tanpa harga; null = tanpa harga). */
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
  hargaTerkonfirmasi: string | null;
  hargaErp: string | null;
  /** ISO terakhir dibaca. */
  terbacaPada: string;
  /** ISO bacaan terakhir berubah — juga token compare-and-swap "Kirim ulang harga ERP". */
  berubahPada: string | null;
  /** Ada harga ERP baru yang menunggu konfirmasi (baris "Perubahan harga"). */
  menungguKonfirmasi: boolean;
  /** Kiriman terakhirnya ditahan karena beda harga ini. */
  kirimanDitahan: boolean;
  kategoriTerpetakan: boolean;
  alasan: ReturnType<typeof alasanTidakBisaDikirimUlang>;
};

/** Daftar BEDA, yang bacaannya paling baru berubah dulu; dibatasi `MAKS_DAFTAR_HARGA`. */
export async function daftarHargaBedaDiJubelio(
  opsi: { cari?: string; hanyaBarang?: string[] } = {},
): Promise<{ baris: BarisHargaBeda[]; total: number; terpotong: boolean }> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return { baris: [], total: 0, terpotong: false };
  const urutan = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i.${sqlId("id")} AS ${sqlId("id")}
    ${sumberBeda({ hanyaBarang: opsi.hanyaBarang })}
    ORDER BY i.${sqlId("jubelioObservedChangedAt")} DESC, i.${sqlId("sku")} ASC
  `);
  const ids = await saringCari(
    urutan.map((r) => r.id),
    opsi.cari,
  );
  const total = ids.length;
  const tampil = ids.slice(0, MAKS_DAFTAR_HARGA);
  if (tampil.length === 0) return { baris: [], total, terpotong: false };

  const [barang, terakhir] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: tampil } },
      select: {
        id: true,
        sku: true,
        nameId: true,
        nameEn: true,
        isActive: true,
        salesChannel: true,
        categoryId: true,
        sellingPrice: true,
        jubelioConfirmedPrice: true,
        jubelioObservedPriceMax: true,
        jubelioObservedPriceMin: true,
        jubelioObservedAt: true,
        jubelioObservedChangedAt: true,
      },
    }),
    kirimanTerakhirPerBarang(tampil),
  ]);
  const perId = new Map(barang.map((b) => [b.id, b]));
  const kategoriTerpetakan = await kategoriTerpetakanDari(
    new Set(barang.map((b) => b.categoryId).filter((k): k is string => k != null)),
  );

  const baris: BarisHargaBeda[] = [];
  for (const id of tampil) {
    const b = perId.get(id);
    if (!b || !b.jubelioObservedAt) continue;
    const hargaErp = hargaKeTeks(b.sellingPrice);
    const hargaTerkonfirmasi = hargaKeTeks(b.jubelioConfirmedPrice);
    const jubelioTertinggi = hargaKeTeks(b.jubelioObservedPriceMax);
    const jubelioTerendah = hargaKeTeks(b.jubelioObservedPriceMin);
    const terpetakanKategori = b.categoryId ? kategoriTerpetakan.has(b.categoryId) : false;
    const menungguKonfirmasi = b.salesChannel !== "OFFLINE" && !hargaSama(hargaBerlaku(hargaErp), hargaBerlaku(hargaTerkonfirmasi));
    const kiriman = terakhir.get(b.id);
    baris.push({
      itemId: b.id,
      sku: b.sku,
      nama: b.nameId || b.nameEn || b.sku,
      isActive: b.isActive,
      saluran: b.salesChannel,
      jubelioTertinggi,
      jubelioTerendah,
      hargaTerkonfirmasi,
      hargaErp,
      terbacaPada: b.jubelioObservedAt.toISOString(),
      berubahPada: b.jubelioObservedChangedAt?.toISOString() ?? null,
      menungguKonfirmasi,
      kirimanDitahan: kiriman?.status === "SKIPPED" && kiriman.skipReason === ALASAN_KIRIMAN.DITAHAN,
      kategoriTerpetakan: terpetakanKategori,
      alasan: alasanTidakBisaDikirimUlang({
        hargaTerkonfirmasi,
        kategoriTerpetakan: terpetakanKategori,
        menungguKonfirmasi,
        hargaErp,
        jubelioTertinggi,
        jubelioTerendah,
      }),
    });
  }
  return { baris, total, terpotong: total > tampil.length };
}

/** Semua barang BEDA dengan waktu bacaannya berubah — untuk sapuan lonceng (tanpa batas). */
export async function idHargaBedaDiJubelio(
  opsi: { hanyaBarang?: string[] } = {},
): Promise<Array<{ itemId: string; berubahPada: string | null }>> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string; berubah: Date | string | null }>>(Prisma.sql`
    SELECT i.${sqlId("id")} AS ${sqlId("id")}, i.${sqlId("jubelioObservedChangedAt")} AS ${sqlId("berubah")}
    ${sumberBeda({ hanyaBarang: opsi.hanyaBarang })}
    ORDER BY i.${sqlId("jubelioObservedChangedAt")} ASC, i.${sqlId("id")} ASC
  `);
  return rows.map((r) => ({
    itemId: r.id,
    berubahPada: r.berubah == null ? null : (r.berubah instanceof Date ? r.berubah : new Date(r.berubah)).toISOString(),
  }));
}

/**
 * Barang yang kiriman produk TERAKHIR-nya ditahan (`price_differs_held`), masih terpetakan di
 * Jubelio, sudah tidak BEDA, dan tidak punya kiriman yang sedang berjalan — siap dilepas oleh sapuan
 * web (P75: ditahan sampai bedanya selesai, lalu dikirim). Barang yang pemetaannya sudah hilang
 * (produknya dihapus dari Jubelio) tidak ikut: melepasnya akan membuat produk baru, dan tanpa
 * saringan ini ia menduduki jatah `MAKS_LEPAS_TAHANAN` setiap putaran untuk selamanya.
 */
export async function idKirimanTertahanSiapDilepas(opsi: { hanyaBarang?: string[] } = {}): Promise<string[]> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i.${sqlId("id")} AS ${sqlId("id")}
    FROM ${sqlId("Item")} i
    WHERE i.${sqlId("type")} = 'FINISHED_GOOD'
      AND EXISTS (SELECT 1 FROM ${sqlId("JubelioProductMapping")} m WHERE m.${sqlId("itemId")} = i.${sqlId("id")})
      AND ${kirimanTerakhirSql(Prisma.sql`o.${sqlId("status")} = 'SKIPPED' AND o.${sqlId("skipReason")} = ${ALASAN_KIRIMAN.DITAHAN}`)}
      AND NOT ${sedangDikirimSql()}
      AND i.${sqlId("id")} NOT IN (SELECT i.${sqlId("id")} ${sumberBeda({ hanyaBarang: opsi.hanyaBarang })})
      ${saringanBarang(opsi.hanyaBarang)}
    ORDER BY i.${sqlId("id")} ASC
  `);
  return rows.map((r) => r.id);
}

/**
 * Barang jadi yang sudah di Jubelio tetapi tanpa harga di kedua sisi (kosong atau 0). Tidak
 * menunggu apa pun, tetapi setiap kirimannya dilewati (`price_not_confirmed`) sampai harganya
 * diisi dan dikonfirmasi — halaman konfirmasi menyebut jumlahnya. "Toko offline saja" tidak
 * dihitung (P3a).
 */
export async function hitungBarangJubelioTanpaHarga(opsi: { hanyaBarang?: string[] } = {}): Promise<number> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return 0;
  return prisma.item.count({
    where: {
      ...(opsi.hanyaBarang ? { id: { in: opsi.hanyaBarang } } : {}),
      type: "FINISHED_GOOD",
      salesChannel: { not: "OFFLINE" },
      jubelioProductMappings: { some: {} },
      AND: [
        { OR: [{ sellingPrice: null }, { sellingPrice: { lte: 0 } }] },
        { OR: [{ jubelioConfirmedPrice: null }, { jubelioConfirmedPrice: { lte: 0 } }] },
      ],
    },
  });
}

export type HargaJubelioBarang = {
  keadaan: KeadaanHargaJubelio;
  saluran: SaluranJual;
  terpetakan: boolean;
  hargaJubelio: string | null;
  hargaErp: string | null;
  dikonfirmasiPada: string | null;
  dikonfirmasiOleh: string | null;
  diajukanPada: string | null;
  /** ISO terakhir dibaca dari Jubelio; null = belum pernah. */
  terbacaPada: string | null;
  /** Harga di Jubelio berbeda dengan ERP (BEDA); null = tidak. */
  beda: {
    tertinggi: string | null;
    terendah: string | null;
    terbacaPada: string;
    berubahPada: string | null;
    /** Kiriman terakhirnya ditahan karena beda ini (P75). */
    ditahan: boolean;
  } | null;
  kirimanTerakhir: { status: string; skipReason: string | null; waktu: string } | null;
};

/** Kartu "Harga di Jubelio" di halaman barang; null bila barangnya tidak ada. */
export async function bacaHargaJubelioBarang(itemId: string): Promise<HargaJubelioBarang | null> {
  const b = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      type: true,
      source: true,
      salesChannel: true,
      sellingPrice: true,
      jubelioConfirmedPrice: true,
      jubelioConfirmedAt: true,
      jubelioConfirmedById: true,
      jubelioCreateRequestedAt: true,
      jubelioObservedPriceMax: true,
      jubelioObservedPriceMin: true,
      jubelioObservedAt: true,
      jubelioObservedChangedAt: true,
      jubelioPriceDecidedAt: true,
    },
  });
  if (!b) return null;
  const [jumlahPemetaan, kiriman, olehNama, jumlahDikirim] = await Promise.all([
    prisma.jubelioProductMapping.count({ where: { itemId: b.id } }),
    prisma.jubelioOutbox.findFirst({
      where: { entityType: "product_push", entityId: b.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, skipReason: true, createdAt: true, processedAt: true, deadAt: true, lastEnqueuedAt: true },
    }),
    b.jubelioConfirmedById
      ? prisma.user.findUnique({ where: { id: b.jubelioConfirmedById }, select: { name: true, email: true } })
      : Promise.resolve(null),
    // Hitungan PENDING/PROCESSING, sama dengan `sedangDikirimSql`.
    prisma.jubelioOutbox.count({ where: { entityType: "product_push", entityId: b.id, status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);
  const hargaErp = hargaKeTeks(b.sellingPrice);
  const hargaJubelio = hargaKeTeks(b.jubelioConfirmedPrice);
  const terpetakan = jumlahPemetaan > 0;
  const tertinggi = hargaKeTeks(b.jubelioObservedPriceMax);
  const terendah = hargaKeTeks(b.jubelioObservedPriceMin);
  const beda =
    b.jubelioObservedAt &&
    bedaDiJubelio({
      barangJadi: b.type === "FINISHED_GOOD",
      terpetakan,
      terbacaPada: b.jubelioObservedAt,
      jubelioTertinggi: tertinggi,
      jubelioTerendah: terendah,
      hargaTerkonfirmasi: hargaJubelio,
      diputuskanPada: b.jubelioPriceDecidedAt,
      berubahPada: b.jubelioObservedChangedAt,
      sedangDikirim: jumlahDikirim > 0,
    })
      ? {
          tertinggi,
          terendah,
          terbacaPada: b.jubelioObservedAt.toISOString(),
          berubahPada: b.jubelioObservedChangedAt?.toISOString() ?? null,
          ditahan: kiriman?.status === "SKIPPED" && kiriman.skipReason === ALASAN_KIRIMAN.DITAHAN,
        }
      : null;
  return {
    keadaan: keadaanHargaJubelio({
      barangJadi: b.type === "FINISHED_GOOD",
      sumber: b.source,
      saluran: b.salesChannel,
      terpetakan,
      hargaErp,
      hargaJubelio,
      diajukanPada: b.jubelioCreateRequestedAt,
    }),
    saluran: b.salesChannel,
    terpetakan,
    hargaJubelio,
    hargaErp,
    dikonfirmasiPada: b.jubelioConfirmedAt?.toISOString() ?? null,
    dikonfirmasiOleh: olehNama ? olehNama.name || olehNama.email || null : null,
    diajukanPada: b.jubelioCreateRequestedAt?.toISOString() ?? null,
    terbacaPada: b.jubelioObservedAt?.toISOString() ?? null,
    beda,
    kirimanTerakhir: kiriman
      ? {
          status: kiriman.status,
          skipReason: kiriman.skipReason,
          waktu: (kiriman.processedAt ?? kiriman.deadAt ?? kiriman.lastEnqueuedAt ?? kiriman.createdAt).toISOString(),
        }
      : null,
  };
}
