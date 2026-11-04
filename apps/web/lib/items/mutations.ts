import { isiKategoriPenjualanSpg, prisma, Prisma, sqlId } from "@elorae/db";
import { generateSKU } from '@/lib/sku-generator';
import { unknownVariantColors, validateAndNormalizeVariants } from '@/lib/items/normalize-variants';
import { loadColorIndex } from '@/lib/items/variant-colors';
import { parseItemVariants } from "@/lib/items/variants";
import {
  ColorsNotInMasterError,
  ItemSkuExistsError,
  SalesChannelCannotActivateError,
  SalesChannelCannotDeactivateError,
  SalesChannelPushInFlightError,
  SalesChannelRequiredError,
} from "@/lib/items/save-refusals";
import {
  findVariantSkuCollisions,
  loadOtherItemsForCollisions,
  skusIntroducedByEdit,
  findVariantBarcodeCollisions,
  VariantBarcodeTakenError,
  VariantSkuTakenError,
} from "@/lib/items/variant-sku-collisions";
import { bacaInfoProduk, periksaInfoProduk, type InfoProdukBarang } from "./info-produk";
import { bacaKgPerRoll, periksaKgPerRoll } from "./kg-per-roll";
import { bacaKomisiPerPcs, periksaKomisiPerPcs } from "./komisi-spg";
import { aturanHargaSah, type DasarAturanHarga } from "./rekomendasi-harga";
import { bacaSaluranJual, dijualDiMarketplace, JEJAK_SALURAN_JUAL, type SaluranJual } from "./saluran-jual";
import { dataPengajuanJubelio } from "@/lib/jubelio/harga/pengajuan";
import {
  alasanTidakBisaDiaktifkan,
  alasanTidakBisaDinonaktifkan,
  hargaKeTeks,
  JEJAK_HARGA_JUBELIO,
} from "@/lib/jubelio/harga/aturan";
import { createProductPushRow } from "@/lib/jubelio/product-push";
import { JEJAK_KATEGORI_BARANG } from "@/lib/spg/kategori-saat-jual";

/** Batas kolom `Item.additionalCost` (Decimal(15,2)). */
const BIAYA_TAMBAHAN_MAKS = 9_999_999_999_999.99;

/**
 * Margin / biaya tambahan dari kiriman formulir: tidak ada = tidak disentuh
 * (`undefined`), kosong = dikosongkan (`null`), bukan angka = NaN (ditolak
 * `validateItemPayload`, bukan diam-diam dijadikan 0).
 */
function bacaAngkaRekomendasi(val: unknown): number | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || (typeof val === 'string' && val.trim() === '')) return null;
  const n = typeof val === 'number' ? val : typeof val === 'string' ? Number(val.trim().replace(',', '.')) : Number.NaN;
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Saluran jual dari kiriman formulir: tidak ada / kosong = tidak disentuh; nilai asing ditolak. */
function bacaSaluranKiriman(val: unknown): SaluranJual | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const saluran = bacaSaluranJual(val);
  if (!saluran) throw new Error("salesChannel: Saluran jual tidak sah");
  return saluran;
}

/** Dasar persen rekomendasi (markup/margin): tidak ada = tidak disentuh; selain MARKUP/MARGIN ditolak. */
function bacaDasarKiriman(val: unknown): DasarAturanHarga | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  if (val === "MARKUP" || val === "MARGIN") return val;
  throw new Error("priceRuleBasis: Dasar aturan harga tidak sah");
}

/** Persen rekomendasi di dalam batas dasarnya (markup 0–999,99; margin 0–99,99). */
function periksaPersenAturan(persen: number | null | undefined, dasar: DasarAturanHarga) {
  if (persen == null) return;
  if (!aturanHargaSah({ dasar, persen })) {
    throw new Error(
      dasar === "MARGIN"
        ? "targetMarginPercent: Margin harus 0 sampai 99,99"
        : "targetMarginPercent: Markup harus 0 sampai 999,99",
    );
  }
}

export type ItemFormData = {
  sku?: string;
  nameId: string;
  nameEn: string;
  type: 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD';
  uomId: string;
  categoryId?: string;
  description?: string;
  variants?: Array<Record<string, string>>;
  reorderPoint?: number;
  overReceiveThreshold?: number;
  /** Harga jual — selalu diketik pengguna; sistem tidak pernah menghitung atau menimpanya. */
  sellingPrice?: number;
  /**
   * Persen rekomendasi (markup ATAU margin, dasarnya di `priceRuleBasis`) dan bantalan margin per
   * pcs (barang jadi) — HANYA bahan rekomendasi harga (`lib/items/rekomendasi-harga.ts`);
   * menyimpannya tidak pernah mengubah harga jual. `undefined` = tidak disentuh, `null` = dikosongkan.
   */
  targetMarginPercent?: number | null;
  additionalCost?: number | null;
  /** Dasar `targetMarginPercent` (P4); barang jadi saja, `undefined` = tidak disentuh. */
  priceRuleBasis?: DasarAturanHarga;
  /**
   * Di mana barang jadi dijual (P3): Marketplace saja, Toko offline saja, atau keduanya. Wajib
   * untuk barang jadi baru; `undefined` saat mengubah = tidak disentuh.
   */
  salesChannel?: SaluranJual;
  /** Optional Pantone of a colour-specific material; finished goods carry colour per variant instead. */
  pantoneTcx?: string | null;
  /** Bahan bersatuan kg: kg per roll (kolom Roll di PO). `undefined` = tidak disentuh. */
  kgPerRoll?: number | null;
  /**
   * Komisi SPG per pcs (barang jadi) — kolom lama, bukan sumber angka komisi sejak
   * 2026-11-01 (tarif per kategori). Formulir barang tidak lagi mengirimnya.
   * `undefined` = tidak disentuh; `null`/kosong = 0.
   */
  commissionPerPcs?: number | null;
} & InfoProdukBarang;

export type SerializedItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  categoryId: string | null;
  reorderPoint: number | null;
  overReceiveThreshold: number | null;
  sellingPrice: number | null;
  [k: string]: unknown;
};

const ITEM_TYPES = ['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD'] as const;

function validateItemPayload(p: ReturnType<typeof normalizeItemPayload>): asserts p is ItemFormData {
  if (!p.nameId?.trim()) throw new Error('nameId: Nama item wajib diisi');
  if (!p.nameEn?.trim()) throw new Error('nameEn: Item name is required');
  if (!ITEM_TYPES.includes(p.type)) throw new Error('type: Invalid item type');
  if (!p.uomId?.trim()) throw new Error('uomId: Pilih satuan');
  if (p.categoryId != null && p.categoryId.trim() === '') throw new Error('categoryId: Invalid category');
  if (p.reorderPoint != null && (Number.isNaN(p.reorderPoint) || p.reorderPoint < 0)) {
    throw new Error('reorderPoint: Must be 0 or greater');
  }
  if (p.overReceiveThreshold != null && (Number.isNaN(p.overReceiveThreshold) || p.overReceiveThreshold < 0)) {
    throw new Error('overReceiveThreshold: Must be 0 or greater');
  }
  if (p.sellingPrice != null && (Number.isNaN(p.sellingPrice) || p.sellingPrice < 0)) {
    throw new Error('sellingPrice: Must be 0 or greater');
  }
  periksaPersenAturan(p.targetMarginPercent, p.priceRuleBasis ?? "MARKUP");
  if (p.additionalCost != null && !(p.additionalCost >= 0 && p.additionalCost <= BIAYA_TAMBAHAN_MAKS)) {
    throw new Error("additionalCost: Biaya tambahan harus 0 atau lebih");
  }
  const infoProduk = periksaInfoProduk(p);
  if (infoProduk) throw new Error(infoProduk);
  const kgPerRoll = periksaKgPerRoll(p.kgPerRoll);
  if (kgPerRoll) throw new Error(kgPerRoll);
  const komisi = periksaKomisiPerPcs(p.commissionPerPcs ?? undefined, p.type);
  if (komisi) throw new Error(komisi);
}

/** Tabel ukuran yang dipilih harus ada (kosong = ikut bawaan kategori). */
async function pastikanTabelUkuran(client: Prisma.TransactionClient | typeof prisma, sizeChartId: string | null | undefined) {
  if (!sizeChartId) return;
  const ada = await client.sizeChart.findUnique({ where: { id: sizeChartId }, select: { id: true } });
  if (!ada) throw new Error("sizeChartId: Tabel ukuran tidak ditemukan");
}

async function resolveCategoryCode(categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId?.trim()) return null;
  const row = await prisma.itemCategory.findUnique({
    where: { id: categoryId },
    select: { code: true },
  });
  const c = row?.code?.trim();
  return c || null;
}

export function normalizeItemPayload(data: unknown): ItemFormData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid item data');
  }
  const raw = data as Record<string, unknown>;
  const parseThresholdDefaultZero = (val: unknown): number => {
    if (val === undefined || val === null || val === '') return 0;
    const n = Number(val);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  };
  const reorderPointNum = parseThresholdDefaultZero(raw.reorderPoint);
  const sellingPrice = raw.sellingPrice;
  const overReceiveThresholdNum = parseThresholdDefaultZero(raw.overReceiveThreshold);
  const categoryIdRaw = raw.categoryId;

  const sellingPriceNum =
    sellingPrice === undefined || sellingPrice === null || sellingPrice === ''
      ? undefined
      : Number(sellingPrice);
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as Array<Record<string, unknown>>).map((record) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(record)) {
          if (typeof v === 'string') out[k] = v;
        }
        return out;
      })
    : undefined;
  return {
    nameId: String(raw.nameId ?? ''),
    nameEn: String(raw.nameEn ?? ''),
    type: raw.type as 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD',
    uomId: String(raw.uomId ?? ''),
    categoryId:
      categoryIdRaw === undefined || categoryIdRaw === null || String(categoryIdRaw).trim() === ''
        ? undefined
        : String(categoryIdRaw),
    description: raw.description != null ? String(raw.description) : undefined,
    variants: variants && variants.length > 0 ? variants : undefined,
    reorderPoint: reorderPointNum,
    overReceiveThreshold: overReceiveThresholdNum,
    sellingPrice:
      sellingPriceNum !== undefined && !Number.isNaN(sellingPriceNum) && sellingPriceNum >= 0
        ? sellingPriceNum
        : undefined,
    // Bahan rekomendasi harga saja (barang jadi); tidak pernah menggeser harga jual.
    targetMarginPercent: raw.type === 'FINISHED_GOOD' ? bacaAngkaRekomendasi(raw.targetMarginPercent) : undefined,
    additionalCost: raw.type === 'FINISHED_GOOD' ? bacaAngkaRekomendasi(raw.additionalCost) : undefined,
    priceRuleBasis: raw.type === "FINISHED_GOOD" ? bacaDasarKiriman(raw.priceRuleBasis) : undefined,
    salesChannel: raw.type === "FINISHED_GOOD" ? bacaSaluranKiriman(raw.salesChannel) : undefined,
    sku: raw.sku != null ? String(raw.sku) : undefined,
    pantoneTcx:
      raw.type !== 'FINISHED_GOOD' && typeof raw.pantoneTcx === 'string' && raw.pantoneTcx.trim()
        ? raw.pantoneTcx.trim()
        : null,
    ...bacaInfoProduk(raw),
    kgPerRoll: bacaKgPerRoll(raw.kgPerRoll),
    commissionPerPcs: bacaKomisiPerPcs(raw.commissionPerPcs),
  };
}

/* relationMode = "prisma" has no FK, so an unknown TCX would be stored silently. */
async function assertPantoneExists(tcx: string | null | undefined) {
  if (!tcx) return;
  const found = await prisma.pantoneColor.findUnique({ where: { tcx }, select: { tcx: true } });
  if (!found) throw new Error(`pantoneTcx: Kode Pantone ${tcx} tidak ditemukan`);
}

function serializeSingleItem(item: {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  categoryId?: string | null;
  description?: string | null;
  variants?: unknown;
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  isActive?: boolean;
  [k: string]: unknown;
}): SerializedItem {
  return {
    id: item.id,
    sku: item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    type: item.type,
    uomId: item.uomId,
    categoryId: item.categoryId ?? null,
    description: item.description ?? undefined,
    variants: Array.isArray(item.variants) ? item.variants : undefined,
    reorderPoint: item.reorderPoint != null ? Number(item.reorderPoint) : null,
    overReceiveThreshold:
      item.overReceiveThreshold != null ? Number(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? Number(item.sellingPrice) : null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
    isActive: item.isActive,
  } as SerializedItem;
}

/** Finished-good Warna comes from the colour master; a colour already on the item is grandfathered. */
async function assertColorsInMaster(
  variants: Array<Record<string, string>>,
  existing: Array<Record<string, string>> = [],
) {
  if (variants.length === 0) return;
  const unknown = unknownVariantColors(variants, await loadColorIndex(), existing);
  if (unknown.length > 0) {
    throw new ColorsNotInMasterError(unknown);
  }
}

/**
 * Barang jadi baru wajib memilih saluran jualnya (jawaban pemilik P3, 2026-11-02). Yang dijual di
 * Marketplace (saja atau keduanya) DIAJUKAN ke Jubelio di transaksi pembuatnya: ia menunggu di
 * Jubelio → Konfirmasi harga dan baru dibuat di Jubelio sesudah harganya dikonfirmasi. "Toko
 * offline saja" tidak pernah diajukan (P3a). Tidak ada kiriman produk dari sini.
 */
export async function createItem(data: ItemFormData, opsi: { olehUserId?: string | null } = {}) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku: inputSku, salesChannel, priceRuleBasis, ...rest } = normalized;
  if (rest.type === "FINISHED_GOOD" && !salesChannel) throw new SalesChannelRequiredError();

  await assertPantoneExists(rest.pantoneTcx);
  const finalSku = inputSku?.trim() || (await generateSKU(rest.type));

  const existing = await prisma.item.findUnique({ where: { sku: finalSku } });
  if (existing) {
    throw new ItemSkuExistsError(finalSku);
  }

  const categoryCode = await resolveCategoryCode(rest.categoryId ?? null);
  const normalizedVariants = validateAndNormalizeVariants(finalSku, rest.variants, {
    categoryCode,
    generateFrom: "parent",
    fixedAxes: rest.type === 'FINISHED_GOOD',
  });
  if (rest.type === 'FINISHED_GOOD') await assertColorsInMaster(normalizedVariants);
  await pastikanTabelUkuran(prisma, rest.sizeChartId);

  const item = await prisma.$transaction(async (tx) => {
    const others = await loadOtherItemsForCollisions(tx);
    /* The parent SKU joins the check: one equal to another item's variant SKU shares its namespace. */
    const createCollisions = findVariantSkuCollisions(others, {
      skus: [finalSku, ...normalizedVariants.map((v) => v.sku)],
    });
    if (createCollisions.length > 0) throw new VariantSkuTakenError(createCollisions);
    const createBarcodeCollisions = findVariantBarcodeCollisions(others, {
      barcodes: normalizedVariants.map((v) => v.barcode ?? ""),
    });
    if (createBarcodeCollisions.length > 0) throw new VariantBarcodeTakenError(createBarcodeCollisions);

    const newItem = await tx.item.create({
      data: {
        ...rest,
        sku: finalSku,
        categoryId: rest.categoryId ?? null,
        variants: normalizedVariants.length ? normalizedVariants : [],
        reorderPoint: rest.reorderPoint ?? null,
        overReceiveThreshold: rest.overReceiveThreshold ?? null,
        sellingPrice: rest.sellingPrice ?? null,
        // Kolom wajib: `null` dari isian sudah menjadi 0 di `normalizeItemPayload`.
        commissionPerPcs: rest.commissionPerPcs ?? undefined,
        ...(rest.type === "FINISHED_GOOD" && salesChannel ? { salesChannel } : {}),
        ...(priceRuleBasis ? { priceRuleBasis } : {}),
        ...(rest.type === "FINISHED_GOOD" && dijualDiMarketplace(salesChannel)
          ? dataPengajuanJubelio(opsi.olehUserId ?? null)
          : {}),
      },
    });

    await tx.inventoryValue.create({
      data: {
        itemId: newItem.id,
        variantSku: null,
        qtyOnHand: 0,
        avgCost: 0,
        totalValue: 0,
      },
    });

    return newItem;
  });

  return { item, serialized: serializeSingleItem(item) };
}

/**
 * Mengunci baris barang untuk ubahan ini (`SELECT … FOR UPDATE`, kedua dialek) — pernyataan
 * PERTAMA transaksi `updateItem`, supaya saluran jual, tanda pengajuan, pemetaan, kiriman yang
 * berjalan dan harga terkonfirmasi dibaca SESUDAH penulis harga Jubelio lain selesai dengan barang
 * yang sama. Dibangun utuh dengan `Prisma.sql` dan diserahkan sebagai satu argumen.
 */
export async function kunciBarangUntukUbah(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT ${sqlId("id")} FROM ${sqlId("Item")} WHERE ${sqlId("id")} = ${id} FOR UPDATE`,
  );
  return rows.length > 0;
}

export async function updateItem(
  tx: Prisma.TransactionClient,
  id: string,
  data: ItemFormData,
  opsi: { olehUserId?: string | null } = {},
) {
  const client = tx;
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, salesChannel, priceRuleBasis, ...rest } = normalized;
  void sku;
  await assertPantoneExists(rest.pantoneTcx);

  await kunciBarangUntukUbah(client, id);
  const existing = await client.item.findUnique({
    where: { id },
    select: {
      sku: true,
      source: true,
      categoryId: true,
      nameId: true,
      nameEn: true,
      description: true,
      sellingPrice: true,
      variants: true,
      isActive: true,
      commissionPerPcs: true,
      salesChannel: true,
      priceRuleBasis: true,
      targetMarginPercent: true,
      jubelioConfirmedPrice: true,
      jubelioCreateRequestedAt: true,
      jubelioCreateRequestedById: true,
    },
  });
  if (!existing) throw new Error('Item not found');
  // Persen yang dikirim tanpa dasarnya diperiksa dengan dasar tersimpan; dasar yang dikirim tanpa
  // persennya memeriksa persen TERSIMPAN dengan dasar baru (R14).
  if (priceRuleBasis === undefined) periksaPersenAturan(rest.targetMarginPercent, existing.priceRuleBasis);
  else if (rest.targetMarginPercent === undefined) {
    periksaPersenAturan(
      existing.targetMarginPercent == null ? null : Number(existing.targetMarginPercent),
      priceRuleBasis,
    );
  }
  const effectiveCategoryId =
    rest.categoryId !== undefined ? rest.categoryId || null : existing.categoryId;
  const categoryCode = await resolveCategoryCode(effectiveCategoryId);
  const normalizedVariants = validateAndNormalizeVariants(existing.sku, rest.variants, {
    categoryCode,
    generateFrom: "parent",
    fixedAxes: rest.type === 'FINISHED_GOOD',
  });
  if (rest.type === 'FINISHED_GOOD') {
    await assertColorsInMaster(normalizedVariants, parseItemVariants(existing.variants));
  }
  const wantedSkus = skusIntroducedByEdit(
    parseItemVariants(existing.variants).map((v) => v.sku ?? ""),
    normalizedVariants.map((v) => v.sku),
  );
  const wantedBarcodes = skusIntroducedByEdit(
    parseItemVariants(existing.variants).map((v) => v.barcode ?? ""),
    normalizedVariants.map((v) => v.barcode ?? ""),
  );
  if (wantedSkus.length > 0 || wantedBarcodes.length > 0) {
    const others = await loadOtherItemsForCollisions(client, id);
    const updateCollisions = findVariantSkuCollisions(others, { skus: wantedSkus });
    if (updateCollisions.length > 0) throw new VariantSkuTakenError(updateCollisions);
    const updateBarcodeCollisions = findVariantBarcodeCollisions(others, { barcodes: wantedBarcodes });
    if (updateBarcodeCollisions.length > 0) throw new VariantBarcodeTakenError(updateBarcodeCollisions);
  }
  await pastikanTabelUkuran(client, rest.sizeChartId);

  const saluran = await rencanaSaluranJual(client, {
    id,
    barangJadi: rest.type === "FINISHED_GOOD",
    sebelum: existing.salesChannel,
    sesudah: salesChannel,
    sumber: existing.source,
    kategoriId: effectiveCategoryId,
    hargaTerkonfirmasi: hargaKeTeks(existing.jubelioConfirmedPrice),
    diajukanPada: existing.jubelioCreateRequestedAt,
    olehUserId: opsi.olehUserId ?? null,
  });

  const item = await client.item.update({
    where: { id },
    data: {
      ...rest,
      categoryId: rest.categoryId ?? null,
      variants: normalizedVariants.length ? normalizedVariants : [],
      reorderPoint: rest.reorderPoint ?? null,
      overReceiveThreshold: rest.overReceiveThreshold ?? null,
      sellingPrice: rest.sellingPrice ?? null,
      commissionPerPcs: rest.commissionPerPcs ?? undefined,
      ...(priceRuleBasis ? { priceRuleBasis } : {}),
      ...saluran.dataBarang,
    },
  });

  let kirimanSaluran: { outboxId: string } | null = null;
  if (saluran.berubah) {
    if (saluran.pengajuan === "DIBATALKAN" && opsi.olehUserId) {
      await client.auditLog.create({
        data: {
          userId: opsi.olehUserId,
          action: JEJAK_HARGA_JUBELIO.PENGAJUAN_DIBATALKAN,
          entityType: "Item",
          entityId: id,
          changes: {
            before: {
              jubelioCreateRequestedAt: existing.jubelioCreateRequestedAt?.toISOString() ?? null,
              jubelioCreateRequestedById: existing.jubelioCreateRequestedById,
            },
            after: { jubelioCreateRequestedAt: null, jubelioCreateRequestedById: null },
            sebab: "SALURAN_OFFLINE",
          },
        },
      });
    }
    if (opsi.olehUserId) {
      await client.auditLog.create({
        data: {
          userId: opsi.olehUserId,
          action: JEJAK_SALURAN_JUAL,
          entityType: "Item",
          entityId: id,
          changes: { before: existing.salesChannel, after: salesChannel ?? null, pengajuan: saluran.pengajuan, kiriman: saluran.kiriman },
        },
      });
    }
    // Penonaktifan / pengaktifan di Jubelio: satu kiriman produk, lahir bersama perubahan saluran.
    if (saluran.kiriman) kirimanSaluran = { outboxId: (await createProductPushRow(client, id, opsi.olehUserId ?? null)).id };
  }

  /*
   * Jejak perubahan kategori (P8/P69): nota SPG dari antrean HP yang sampai sesudah perubahan ini
   * membaca kategori yang berlaku saat terjualnya dari baris ini (`jejakKategoriSesudah`,
   * `lib/spg/kategori-saat-jual.ts`). Ditulis di transaksi yang sama, membandingkan kategori yang
   * benar-benar tersimpan — formulir yang mengosongkan kategori juga tercatat. Ini satu-satunya
   * penulis yang MENGUBAH `Item.categoryId`; barang baru (formulir, impor, Jubelio) tidak punya
   * penjualan sebelum dibuat, jadi tidak perlu jejak.
   */
  const kategoriSebelum = existing.categoryId || null;
  const kategoriSesudah = item.categoryId || null;
  if (opsi.olehUserId && kategoriSebelum !== kategoriSesudah) {
    await client.auditLog.create({
      data: {
        userId: opsi.olehUserId,
        action: JEJAK_KATEGORI_BARANG,
        entityType: "Item",
        entityId: id,
        changes: { before: { categoryId: kategoriSebelum }, after: { categoryId: kategoriSesudah } },
      },
    });
  }

  // Penjualan SPG yang tercatat sebelum barangnya punya kategori diisi kategori ini, sekali.
  if (item.categoryId) await isiKategoriPenjualanSpg(client, { itemId: id, categoryId: item.categoryId, waktu: new Date() });

  // Kolom lama komisi SPG per pcs: kalau ada pemanggil yang masih mengubahnya,
  // perubahannya tetap tercatat di transaksi yang sama.
  const komisiLama = Number(existing.commissionPerPcs ?? 0);
  if (opsi.olehUserId && rest.commissionPerPcs != null && rest.commissionPerPcs !== komisiLama) {
    await client.auditLog.create({
      data: {
        userId: opsi.olehUserId,
        action: 'ITEM_SPG_COMMISSION_CHANGED',
        entityType: 'Item',
        entityId: id,
        changes: { before: { commissionPerPcs: komisiLama }, after: { commissionPerPcs: rest.commissionPerPcs } },
      },
    });
  }

  return {
    item,
    serialized: serializeSingleItem(item),
    kirimanSaluran,
    before: {
      nameId: existing.nameId,
      nameEn: existing.nameEn,
      description: existing.description,
      sellingPrice: existing.sellingPrice == null ? null : Number(existing.sellingPrice),
      variants: (existing.variants as Array<Record<string, string>> | null) ?? null,
      isActive: existing.isActive,
    },
    after: {
      nameId: item.nameId,
      nameEn: item.nameEn,
      description: item.description,
      sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      variants: (item.variants as Array<Record<string, string>> | null) ?? null,
      isActive: item.isActive,
    },
  };
}

type RencanaSaluran = {
  berubah: boolean;
  dataBarang: Prisma.ItemUncheckedUpdateInput;
  pengajuan: "DIAJUKAN" | "DIBATALKAN" | null;
  kiriman: "NONAKTIFKAN" | "AKTIFKAN" | null;
};

/**
 * Perubahan saluran jual barang jadi yang sudah ada (jawaban pemilik P3/P3a/P72/P76, 2026-11-02),
 * dibaca SESUDAH baris barangnya dikunci:
 * - saluran sama → tidak ada apa-apa;
 * - kiriman produk masih PENDING/PROCESSING → ditolak (sama dengan `SEDANG_DIKIRIM` di pengajuan):
 *   konfirmasi yang baru saja dibuat tidak boleh terlewat diam-diam;
 * - sudah di Jubelio → "Toko offline saja": dinonaktifkan di Jubelio dengan SATU kiriman (P72),
 *   ditolak dengan sebabnya bila kiriman itu tidak bisa dibuat (tanpa harga terkonfirmasi, kategori
 *   belum dipetakan, bawaan kiriman belum ada);
 * - belum di Jubelio → "Toko offline saja": pengajuannya ditutup (P3a);
 * - "Toko offline saja" → Marketplace/Keduanya: yang sudah di Jubelio diaktifkan lagi dengan satu
 *   kiriman (ditolak bila kategori/bawaan belum ada), barang jadi ERP yang belum di Jubelio diajukan;
 * - Marketplace ↔ Keduanya: tidak ada akibat ke Jubelio.
 */
async function rencanaSaluranJual(
  tx: Prisma.TransactionClient,
  i: {
    id: string;
    barangJadi: boolean;
    sebelum: SaluranJual;
    sesudah: SaluranJual | undefined;
    sumber: "ERP" | "JUBELIO_INGEST";
    kategoriId: string | null;
    hargaTerkonfirmasi: string | null;
    diajukanPada: Date | null;
    olehUserId: string | null;
  },
): Promise<RencanaSaluran> {
  const tetap: RencanaSaluran = { berubah: false, dataBarang: {}, pengajuan: null, kiriman: null };
  if (!i.barangJadi || i.sesudah === undefined || i.sesudah === i.sebelum) return tetap;

  const [jumlahPeta, jumlahDikirim] = await Promise.all([
    tx.jubelioProductMapping.count({ where: { itemId: i.id } }),
    tx.jubelioOutbox.count({ where: { entityType: "product_push", entityId: i.id, status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);
  if (jumlahDikirim > 0) throw new SalesChannelPushInFlightError();
  const terpetakan = jumlahPeta > 0;
  const dataBarang: Prisma.ItemUncheckedUpdateInput = { salesChannel: i.sesudah };

  const syaratKiriman = async () => ({
    kategoriTerpetakan: i.kategoriId
      ? (await tx.jubelioCategoryMapping.count({ where: { itemCategoryId: i.kategoriId } })) > 0
      : false,
    bawaanAda: (await tx.jubelioPushDefaults.count()) > 0,
  });

  if (i.sesudah === "OFFLINE") {
    if (terpetakan) {
      const alasan = alasanTidakBisaDinonaktifkan({ hargaTerkonfirmasi: i.hargaTerkonfirmasi, ...(await syaratKiriman()) });
      if (alasan) throw new SalesChannelCannotDeactivateError(alasan);
      return { berubah: true, dataBarang, pengajuan: null, kiriman: "NONAKTIFKAN" };
    }
    if (i.diajukanPada) {
      return {
        berubah: true,
        dataBarang: { ...dataBarang, jubelioCreateRequestedAt: null, jubelioCreateRequestedById: null },
        pengajuan: "DIBATALKAN",
        kiriman: null,
      };
    }
    return { berubah: true, dataBarang, pengajuan: null, kiriman: null };
  }

  if (i.sebelum === "OFFLINE") {
    if (terpetakan) {
      const alasan = alasanTidakBisaDiaktifkan(await syaratKiriman());
      if (alasan) throw new SalesChannelCannotActivateError(alasan);
      return { berubah: true, dataBarang, pengajuan: null, kiriman: "AKTIFKAN" };
    }
    if (i.sumber === "ERP" && !i.diajukanPada) {
      return { berubah: true, dataBarang: { ...dataBarang, ...dataPengajuanJubelio(i.olehUserId) }, pengajuan: "DIAJUKAN", kiriman: null };
    }
  }
  return { berubah: true, dataBarang, pengajuan: null, kiriman: null };
}

export const ITEM_DELETE_BLOCKED = "ITEM_DELETE_BLOCKED";

/**
 * Sum of every row that blocks an item delete. `ItemImage` and `ItemPriceChangeLog` cascade on
 * purpose and are reported by `getItemDeleteImpact`, not counted here; `SalesHistory` is un-mapped
 * by `deleteItem`, never a blocker.
 */
export async function countItemDeleteBlockers(id: string): Promise<number> {
  const [
    movements,
    ledgerEntryCount,
    poItems,
    workOrderFinishedGoodCount,
    workOrderConsumptionMaterialCount,
    fabricRollCount,
    stockAdjustmentCount,
    rejectedGoodsCount,
    planAccessoryCount,
    salesReturnItemCount,
    fieldReturnLineCount,
    fieldSalesOrderLineCount,
    fieldSalesDeliveryLineCount,
    promoItemCount,
    storeStockCount,
    konsiTransferLineCount,
    storeTransferLineCount,
    storeStocktakeLineCount,
    storeAssortmentLineCount,
    vanStockCount,
    vanLoadLineCount,
    vanSaleLineCount,
    vanReconcileLineCount,
    spgSaleLineCount,
    konsiSellThroughLineCount,
    itemRequestLineCount,
  ] = await Promise.all([
    /*
     * Two counts guard two different failures, not the same one twice. `StockMovement` writes
     * stopped (history now lands in `StockLedgerEntry`), but its existing rows are a frozen
     * archive, not a retired table — `StockMovement.item` is still a REQUIRED Prisma relation, so
     * an old row left pointing at a deleted item throws "Inconsistent query result" on every read
     * that joins it, forever. Stopping the writes did not make that risk go away; it only stopped
     * new rows from adding to it. `StockLedgerEntry.itemId` carries no relation at all, so an
     * orphaned ledger row cannot crash a read — but it would still silently strand real stock
     * history, which is what this second count refuses. Do not drop the `StockMovement` count
     * because the table stopped being written, and do not fold the two into one.
     */
    prisma.stockMovement.count({ where: { itemId: id } }),
    prisma.stockLedgerEntry.count({ where: { itemId: id } }),
    prisma.pOItem.count({ where: { itemId: id } }),
    prisma.workOrder.count({ where: { finishedGoodId: id } }),
    prisma.workOrder.count({ where: { consumptionMaterialId: id } }),
    prisma.fabricRoll.count({ where: { itemId: id } }),
    prisma.stockAdjustment.count({ where: { itemId: id } }),
    prisma.rejectedGoodsLedger.count({ where: { itemId: id } }),
    prisma.planAccessory.count({ where: { itemId: id } }),
    prisma.salesReturnItem.count({ where: { itemId: id } }),
    prisma.fieldReturnLine.count({ where: { itemId: id } }),
    /**
     * Every one below has a REQUIRED Prisma relation to Item. Under relationMode = "prisma" most of
     * them have no database FK, so nothing stops `tx.item.delete()` below from succeeding while one
     * of these rows still points at it, and the first read that joins it (`select: { item: ... }`,
     * as every one of these documents' detail pages does) throws "Inconsistent query result"
     * forever, with no UI repair path. The two field-sales line tables do carry a real FK
     * (`ON DELETE RESTRICT`); for them this count turns a raw FK error into ITEM_DELETE_BLOCKED.
     */
    prisma.fieldSalesOrderLine.count({ where: { itemId: id } }),
    prisma.fieldSalesDeliveryLine.count({ where: { itemId: id } }),
    prisma.promoItem.count({ where: { itemId: id } }),
    prisma.storeStock.count({ where: { itemId: id } }),
    prisma.konsiTransferLine.count({ where: { itemId: id } }),
    prisma.storeTransferLine.count({ where: { itemId: id } }),
    prisma.storeStocktakeLine.count({ where: { itemId: id } }),
    prisma.storeAssortmentLine.count({ where: { itemId: id } }),
    prisma.vanStock.count({ where: { itemId: id } }),
    prisma.vanLoadLine.count({ where: { itemId: id } }),
    prisma.vanSaleLine.count({ where: { itemId: id } }),
    prisma.vanReconcileLine.count({ where: { itemId: id } }),
    prisma.spgSaleLine.count({ where: { itemId: id } }),
    prisma.konsiSellThroughLine.count({ where: { itemId: id } }),
    // Real FK (`ON DELETE RESTRICT`), as for the field-sales lines above.
    prisma.itemRequestLine.count({ where: { itemId: id } }),
  ]);

  return (
    movements +
    ledgerEntryCount +
    poItems +
    workOrderFinishedGoodCount +
    workOrderConsumptionMaterialCount +
    fabricRollCount +
    stockAdjustmentCount +
    rejectedGoodsCount +
    planAccessoryCount +
    salesReturnItemCount +
    fieldReturnLineCount +
    fieldSalesOrderLineCount +
    fieldSalesDeliveryLineCount +
    promoItemCount +
    storeStockCount +
    konsiTransferLineCount +
    storeTransferLineCount +
    storeStocktakeLineCount +
    storeAssortmentLineCount +
    vanStockCount +
    vanLoadLineCount +
    vanSaleLineCount +
    vanReconcileLineCount +
    spgSaleLineCount +
    konsiSellThroughLineCount +
    itemRequestLineCount
  );
}

export type ItemDeleteImpact = {
  blocked: boolean;
  images: number;
  priceChanges: number;
  salesHistory: number;
};

export async function getItemDeleteImpact(id: string): Promise<ItemDeleteImpact> {
  const [blockers, images, priceChanges, salesHistory] = await Promise.all([
    countItemDeleteBlockers(id),
    prisma.itemImage.count({ where: { itemId: id } }),
    prisma.itemPriceChangeLog.count({ where: { itemId: id } }),
    prisma.salesHistory.count({ where: { itemId: id } }),
  ]);
  return { blocked: blockers > 0, images, priceChanges, salesHistory };
}

export async function deleteItem(id: string) {
  if ((await countItemDeleteBlockers(id)) > 0) {
    throw new Error(ITEM_DELETE_BLOCKED);
  }

  await prisma.$transaction(async (tx) => {
    await tx.consumptionRule.deleteMany({
      where: {
        OR: [{ finishedGoodId: id }, { materialId: id }],
      },
    });

    await tx.inventoryValue.deleteMany({
      where: { itemId: id },
    });

    /**
     * The foreign key alone would null `itemId` and leave the row claiming `MAPPED` with a stale
     * `erpVariantSku` and `jubelioItemId`; un-mapping it puts it back in the import page's
     * unmapped count. `ItemImage` and `ItemPriceChangeLog` cascade on purpose and are reported by
     * `getItemDeleteImpact`, not counted as blockers.
     */
    await tx.salesHistory.updateMany({
      where: { itemId: id },
      data: {
        itemId: null,
        erpVariantSku: null,
        jubelioItemId: null,
        resolutionStatus: "UNMAPPED",
      },
    });

    await tx.item.delete({
      where: { id },
    });
  });
}
