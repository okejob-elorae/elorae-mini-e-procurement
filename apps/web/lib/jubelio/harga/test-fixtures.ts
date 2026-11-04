import { prisma, seededId } from "@elorae/db";

/**
 * Fixture bersama tes basis data konfirmasi harga Jubelio (queries, writer, pengajuan, isian awal
 * migrasi). Semua id disimpan di satu objek `keadaan` yang dikosongkan di awal setiap `siapkan`,
 * dan setiap filter pembersihan lewat `seededId` — basis data uji :3308 juga berisi data
 * pengembangan sungguhan, jadi filter yang kosong tidak boleh melebar ke seluruh tabel.
 */
export type KeadaanFixtureHarga = {
  uomId: string;
  kategoriId: string;
  kategoriTanpaPetaId: string;
  petaKategoriId: string;
  userId: string;
  userLainId: string;
  itemIds: string[];
  mappingIds: string[];
};

export type BarangUji = {
  type?: "FINISHED_GOOD" | "FABRIC" | "ACCESSORIES";
  source?: "ERP" | "JUBELIO_INGEST";
  sellingPrice?: number | null;
  jubelioConfirmedPrice?: number | null;
  jubelioCreateRequestedAt?: Date | null;
  jubelioCreateRequestedById?: string | null;
  terpetakan?: boolean;
  /** "terpetakan" (bawaan) = kategori yang dipetakan ke Jubelio; "tidak" = kategori tanpa peta; "kosong" = tanpa kategori. */
  kategori?: "terpetakan" | "tidak" | "kosong";
  isActive?: boolean;
  /** Saluran jual (P3); bawaan BOTH seperti kolomnya. */
  salesChannel?: "MARKETPLACE" | "OFFLINE" | "BOTH";
  /** Yang terakhir terbaca di Jubelio (P1/P2); tanpa `terbacaPada` = belum pernah terbaca. */
  jubelioTertinggi?: number | null;
  jubelioTerendah?: number | null;
  terbacaPada?: Date | null;
  berubahPada?: Date | null;
  /** Keputusan harga admin terakhir (P75). */
  diputuskanPada?: Date | null;
};

export type KirimanUji = {
  status: "PENDING" | "PROCESSING" | "DONE" | "SKIPPED" | "DEAD";
  skipReason?: string | null;
  createdAt?: Date;
};

export function buatFixtureHarga() {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let urut = 0;
  const keadaan: KeadaanFixtureHarga = {
    uomId: "",
    kategoriId: "",
    kategoriTanpaPetaId: "",
    petaKategoriId: "",
    userId: "",
    userLainId: "",
    itemIds: [],
    mappingIds: [],
  };

  async function siapkan() {
    keadaan.uomId = "";
    keadaan.kategoriId = "";
    keadaan.kategoriTanpaPetaId = "";
    keadaan.petaKategoriId = "";
    keadaan.userId = "";
    keadaan.userLainId = "";
    keadaan.itemIds = [];
    keadaan.mappingIds = [];
    urut += 1;
    const run = `${token}-${urut}`;
    keadaan.userId = (await prisma.user.create({ data: { email: `hj-${run}@uji.local`, name: "Admin uji harga" }, select: { id: true } })).id;
    keadaan.userLainId = (
      await prisma.user.create({ data: { email: `hj2-${run}@uji.local`, name: "Pengubah harga uji" }, select: { id: true } })
    ).id;
    keadaan.uomId = (await prisma.uOM.create({ data: { code: `HJ${run}`, nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    keadaan.kategoriId = (await prisma.itemCategory.create({ data: { name: `Uji harga ${run}` }, select: { id: true } })).id;
    keadaan.kategoriTanpaPetaId = (await prisma.itemCategory.create({ data: { name: `Uji harga tanpa peta ${run}` }, select: { id: true } })).id;
    keadaan.petaKategoriId = (
      await prisma.jubelioCategoryMapping.create({
        data: { jubelioCategoryId: Math.floor(Math.random() * 1e9) + 1e9, itemCategoryId: keadaan.kategoriId },
        select: { id: true },
      })
    ).id;
  }

  async function barang(isi: BarangUji = {}): Promise<string> {
    urut += 1;
    const sku = `HJ-${token}-${urut}`;
    const kategori = isi.kategori ?? "terpetakan";
    const item = await prisma.item.create({
      data: {
        sku,
        nameId: `Kaos uji harga ${urut}`,
        nameEn: `Test tee ${urut}`,
        type: isi.type ?? "FINISHED_GOOD",
        source: isi.source ?? "ERP",
        uomId: keadaan.uomId,
        categoryId: kategori === "terpetakan" ? keadaan.kategoriId : kategori === "tidak" ? keadaan.kategoriTanpaPetaId : null,
        sellingPrice: isi.sellingPrice === undefined ? 100_000 : isi.sellingPrice,
        jubelioConfirmedPrice: isi.jubelioConfirmedPrice ?? null,
        jubelioConfirmedAt: isi.jubelioConfirmedPrice != null ? new Date() : null,
        jubelioCreateRequestedAt: isi.jubelioCreateRequestedAt ?? null,
        jubelioCreateRequestedById: isi.jubelioCreateRequestedById ?? null,
        isActive: isi.isActive ?? true,
        ...(isi.salesChannel ? { salesChannel: isi.salesChannel } : {}),
        jubelioObservedPriceMax: isi.terbacaPada ? (isi.jubelioTertinggi ?? null) : null,
        jubelioObservedPriceMin: isi.terbacaPada ? (isi.jubelioTerendah ?? null) : null,
        jubelioObservedAt: isi.terbacaPada ?? null,
        jubelioObservedChangedAt: isi.terbacaPada ? (isi.berubahPada ?? isi.terbacaPada) : null,
        jubelioPriceDecidedAt: isi.diputuskanPada ?? null,
      },
      select: { id: true },
    });
    keadaan.itemIds.push(item.id);
    if (isi.terpetakan) {
      const angka = Math.floor(Math.random() * 1e9) + 1e9;
      const m = await prisma.jubelioProductMapping.create({
        data: { itemId: item.id, jubelioItemGroupId: angka, jubelioItemId: angka, jubelioItemCode: `${sku}-J`, erpVariantSku: "" },
        select: { id: true },
      });
      keadaan.mappingIds.push(m.id);
    }
    return item.id;
  }

  /** Satu baris kiriman produk untuk barang ini (keadaan kiriman sebelumnya di outbox). */
  async function kiriman(itemId: string, isi: KirimanUji): Promise<string> {
    const r = await prisma.jubelioOutbox.create({
      data: {
        entityType: "product_push",
        entityId: seededId(itemId),
        payload: {},
        status: isi.status,
        skipReason: isi.skipReason ?? null,
        ...(isi.createdAt ? { createdAt: isi.createdAt } : {}),
      },
      select: { id: true },
    });
    return r.id;
  }

  /** Keadaan kolom harga Jubelio sebuah barang, dalam angka biasa. */
  async function baca(itemId: string) {
    const b = await prisma.item.findUniqueOrThrow({
      where: { id: seededId(itemId) },
      select: {
        sellingPrice: true,
        jubelioConfirmedPrice: true,
        jubelioConfirmedAt: true,
        jubelioConfirmedById: true,
        jubelioCreateRequestedAt: true,
        jubelioCreateRequestedById: true,
        salesChannel: true,
        jubelioPriceDecidedAt: true,
      },
    });
    return {
      saluran: b.salesChannel,
      diputuskanPada: b.jubelioPriceDecidedAt,
      harga: b.sellingPrice == null ? null : Number(b.sellingPrice),
      dikonfirmasi: b.jubelioConfirmedPrice == null ? null : Number(b.jubelioConfirmedPrice),
      dikonfirmasiPada: b.jubelioConfirmedAt,
      dikonfirmasiOleh: b.jubelioConfirmedById,
      diajukanPada: b.jubelioCreateRequestedAt,
      diajukanOleh: b.jubelioCreateRequestedById,
    };
  }

  async function bersihkan() {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: keadaan.itemIds.map(seededId) } } });
    await prisma.jubelioOutbox.deleteMany({ where: { entityId: { in: keadaan.itemIds.map(seededId) } } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: { in: keadaan.itemIds.map(seededId) } } });
    await prisma.jubelioProductMapping.deleteMany({ where: { id: { in: keadaan.mappingIds.map(seededId) } } });
    await prisma.item.deleteMany({ where: { id: { in: keadaan.itemIds.map(seededId) } } });
    await prisma.jubelioCategoryMapping.deleteMany({ where: { id: seededId(keadaan.petaKategoriId) } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: [keadaan.kategoriId, keadaan.kategoriTanpaPetaId].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(keadaan.uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [keadaan.userId, keadaan.userLainId].map(seededId) } } });
  }

  return { keadaan, siapkan, barang, kiriman, baca, bersihkan };
}
