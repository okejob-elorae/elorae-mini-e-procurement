import { prisma, Prisma, sqlId } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import {
  alasanTidakBisaDikirim,
  hargaKeTeks,
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
 * kedua sisi; -1 sebagai pengganti NULL aman karena harga selalu ≥ 0.
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

/** FROM + WHERE barang yang menunggu konfirmasi. Alias `i` = Item, `m` = pemetaan Jubelio. */
function sumberMenunggu(opsi: { hanyaBarang?: string[]; jenis?: JenisMenunggu }): Prisma.Sql {
  const ubah = Prisma.sql`(m.${sqlId("itemId")} IS NOT NULL AND ${hargaBerlakuSql("sellingPrice")} <> ${hargaBerlakuSql("jubelioConfirmedPrice")})`;
  const baru = Prisma.sql`(m.${sqlId("itemId")} IS NULL AND i.${sqlId("source")} = 'ERP' AND i.${sqlId("jubelioCreateRequestedAt")} IS NOT NULL)`;
  const syarat = opsi.jenis === "UBAH" ? ubah : opsi.jenis === "BARU" ? baru : Prisma.sql`(${ubah} OR ${baru})`;
  return Prisma.sql`
    FROM ${sqlId("Item")} i
    LEFT JOIN (SELECT DISTINCT ${sqlId("itemId")} FROM ${sqlId("JubelioProductMapping")}) m ON m.${sqlId("itemId")} = i.${sqlId("id")}
    WHERE i.${sqlId("type")} = 'FINISHED_GOOD'
      AND ${syarat}
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
  /** ISO waktu pengajuan — token compare-and-swap "Batalkan pengajuan". */
  diajukanPada: string | null;
  kategoriTerpetakan: boolean;
  alasan: AlasanTidakBisaDikirim | null;
};

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

  const cari = opsi.cari?.trim();
  if (cari && ids.length > 0) {
    const cocok = new Set(
      (
        await prisma.item.findMany({
          where: { id: { in: ids }, OR: [{ sku: cariTeks(cari) }, { nameId: cariTeks(cari) }, { nameEn: cariTeks(cari) }] },
          select: { id: true },
        })
      ).map((b) => b.id),
    );
    ids = ids.filter((id) => cocok.has(id));
  }

  const total = ids.length;
  const tampil = ids.slice(0, MAKS_DAFTAR_HARGA);
  if (tampil.length === 0) return { baris: [], total, terpotong: false };

  const barang = await prisma.item.findMany({
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
      priceChangeLogs: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true, changedById: true } },
    },
  });
  const perId = new Map(barang.map((b) => [b.id, b]));

  const idPengguna = new Set<string>();
  const idKategori = new Set<string>();
  for (const b of barang) {
    const log = b.priceChangeLogs[0];
    if (log?.changedById) idPengguna.add(log.changedById);
    if (b.jubelioCreateRequestedById) idPengguna.add(b.jubelioCreateRequestedById);
    if (b.categoryId) idKategori.add(b.categoryId);
  }
  const [pengguna, kategori] = await Promise.all([
    idPengguna.size > 0
      ? prisma.user.findMany({ where: { id: { in: [...idPengguna] } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    idKategori.size > 0
      ? prisma.jubelioCategoryMapping.findMany({ where: { itemCategoryId: { in: [...idKategori] } }, select: { itemCategoryId: true } })
      : Promise.resolve([]),
  ]);
  const namaPengguna = new Map(pengguna.map((u) => [u.id, u.name || u.email || null]));
  const kategoriTerpetakan = new Set(kategori.map((k) => k.itemCategoryId));

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
    });
  }
  return { baris, total, terpotong: total > tampil.length };
}

/**
 * Barang jadi yang sudah di Jubelio tetapi tanpa harga di kedua sisi (kosong atau 0). Tidak
 * menunggu apa pun, tetapi setiap kirimannya dilewati (`price_not_confirmed`) sampai harganya
 * diisi dan dikonfirmasi — halaman konfirmasi menyebut jumlahnya.
 */
export async function hitungBarangJubelioTanpaHarga(opsi: { hanyaBarang?: string[] } = {}): Promise<number> {
  if (opsi.hanyaBarang && opsi.hanyaBarang.length === 0) return 0;
  return prisma.item.count({
    where: {
      ...(opsi.hanyaBarang ? { id: { in: opsi.hanyaBarang } } : {}),
      type: "FINISHED_GOOD",
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
  hargaJubelio: string | null;
  hargaErp: string | null;
  dikonfirmasiPada: string | null;
  dikonfirmasiOleh: string | null;
  diajukanPada: string | null;
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
      sellingPrice: true,
      jubelioConfirmedPrice: true,
      jubelioConfirmedAt: true,
      jubelioConfirmedById: true,
      jubelioCreateRequestedAt: true,
    },
  });
  if (!b) return null;
  const [jumlahPemetaan, kiriman, olehNama] = await Promise.all([
    prisma.jubelioProductMapping.count({ where: { itemId: b.id } }),
    prisma.jubelioOutbox.findFirst({
      where: { entityType: "product_push", entityId: b.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, skipReason: true, createdAt: true, processedAt: true, deadAt: true, lastEnqueuedAt: true },
    }),
    b.jubelioConfirmedById
      ? prisma.user.findUnique({ where: { id: b.jubelioConfirmedById }, select: { name: true, email: true } })
      : Promise.resolve(null),
  ]);
  const hargaErp = hargaKeTeks(b.sellingPrice);
  const hargaJubelio = hargaKeTeks(b.jubelioConfirmedPrice);
  return {
    keadaan: keadaanHargaJubelio({
      barangJadi: b.type === "FINISHED_GOOD",
      sumber: b.source,
      terpetakan: jumlahPemetaan > 0,
      hargaErp,
      hargaJubelio,
      diajukanPada: b.jubelioCreateRequestedAt,
    }),
    hargaJubelio,
    hargaErp,
    dikonfirmasiPada: b.jubelioConfirmedAt?.toISOString() ?? null,
    dikonfirmasiOleh: olehNama ? olehNama.name || olehNama.email || null : null,
    diajukanPada: b.jubelioCreateRequestedAt?.toISOString() ?? null,
    kirimanTerakhir: kiriman
      ? {
          status: kiriman.status,
          skipReason: kiriman.skipReason,
          waktu: (kiriman.processedAt ?? kiriman.deadAt ?? kiriman.lastEnqueuedAt ?? kiriman.createdAt).toISOString(),
        }
      : null,
  };
}
