import { notFound, redirect } from 'next/navigation';
import { isJubelioStockPushEnabled, prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { getItemById } from '@/lib/items/queries';
import { ItemType } from '@/lib/constants/enums';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { getItemImages } from '@/lib/items/images/queries';
import { jubelioCreateEligibility } from '@/lib/items/jubelio-create-eligibility';
import { ItemDetailClient } from './ItemDetailClient';
import { ItemGalleryEditor } from '@/components/items/ItemGalleryEditor';
import { bacaHppBarang } from "@/lib/items/hpp-barang-queries";
import { bacaHppTerbaru, bacaRiwayatHpp } from "@/lib/items/riwayat-hpp-queries";
import { bacaHargaJubelioBarang } from "@/lib/jubelio/harga/queries";
import { alasanTidakBisaDiaktifkan, alasanTidakBisaDinonaktifkan, hargaKeTeks } from "@/lib/jubelio/harga/aturan";
import { aturanDariKolom } from "@/lib/items/rekomendasi-harga";
import { formatDisplayDateTime } from "@/lib/date-only";

export const dynamic = 'force-dynamic';

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/login');
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];

  const { id } = await params;
  const item = await getItemById(id);
  if (!item) notFound();

  const initialData = {
    id: item.id,
    sku: item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    type: item.type as ItemType,
    uomId: item.uomId,
    categoryId: item.categoryId ?? undefined,
    description: (item.description as string | null) || undefined,
    variants: item.variants as Array<Record<string, string>> | undefined,
    reorderPoint: item.reorderPoint != null ? Number(item.reorderPoint) : undefined,
    overReceiveThreshold:
      item.overReceiveThreshold != null ? Number(item.overReceiveThreshold) : undefined,
    sellingPrice: item.sellingPrice != null ? Number(item.sellingPrice) : undefined,
    targetMarginPercent:
      item.targetMarginPercent != null ? Number(item.targetMarginPercent) : undefined,
    priceRuleBasis: item.priceRuleBasis,
    additionalCost: item.additionalCost != null ? Number(item.additionalCost) : undefined,
    salesChannel: item.type === ItemType.FINISHED_GOOD ? item.salesChannel : undefined,
    pantone: item.pantone
      ? { ...item.pantone, hex: item.pantone.hex.startsWith('#') ? item.pantone.hex : `#${item.pantone.hex}` }
      : null,
    material: item.material ?? null,
    careInstructions: item.careInstructions ?? null,
    sizeChartId: item.sizeChartId ?? null,
    kgPerRoll: item.kgPerRoll != null ? Number(item.kgPerRoll) : null,
    commissionPerPcs: item.commissionPerPcs != null ? Number(item.commissionPerPcs) : 0,
    consumptionRules: (
      item.fgConsumptions as Array<{
        materialId: string;
        qtyRequired: number;
        wastePercent: number;
        notes?: string | null;
        colorId?: string | null;
        size?: string | null;
        material?: {
          sku: string;
          nameId: string;
          nameEn: string;
          uom: { code: string };
        } | null;
      }>
    )
      ?.filter((rule): rule is typeof rule & { material: NonNullable<typeof rule.material> } =>
        Boolean(rule.material)
      )
      .filter((rule) => rule.material != null)
      .map((rule) => ({
        materialId: rule.materialId,
        material: {
          sku: rule.material!.sku,
          nameId: rule.material!.nameId,
          nameEn: rule.material!.nameEn,
          uom: { code: rule.material!.uom.code },
        },
        qtyRequired: Number(rule.qtyRequired),
        wastePercent: Number(rule.wastePercent),
        notes: rule.notes || undefined,
        colorId: rule.colorId ?? null,
        size: rule.size ?? null,
      })),
  };

  const images = await getItemImages(item.id);
  const jubelioStockPushEnabled = await isJubelioStockPushEnabled(prisma);
  const barangJadi = item.type === ItemType.FINISHED_GOOD;
  // Rata-rata stok dan rincian penerimaan terakhir (barang jadi saja, hanya dibaca).
  const hpp = barangJadi ? await bacaHppBarang(prisma, item.id) : null;
  // Riwayat HPP (setiap penerimaan/pembelian, angka tersimpan) dan HPP terbaru — dasar rekomendasi harga.
  const bolehLihatHpp = hasPermission(perms, PERMISSIONS.ITEMS_VIEW);
  const riwayatHppAwal = bolehLihatHpp ? await bacaRiwayatHpp(prisma, item.id) : null;
  const hppTerbaru = riwayatHppAwal ? await bacaHppTerbaru(prisma, item.id, riwayatHppAwal) : null;
  // Pasangan markup/margin bawaan dan bantalan margin bawaan (Pengaturan Jubelio) — dipakai
  // rekomendasi bila barang tidak punya sendiri; pasangan bawaan dipakai utuh (P4).
  const bawaan = barangJadi
    ? await prisma.jubelioPushDefaults.findFirst({
        select: { defaultMarginPercent: true, defaultPriceRuleBasis: true, defaultAdditionalCost: true },
      })
    : null;
  const bawaanRekomendasi = {
    aturan: aturanDariKolom(bawaan?.defaultMarginPercent, bawaan?.defaultPriceRuleBasis),
    biaya: bawaan?.defaultAdditionalCost != null ? Number(bawaan.defaultAdditionalCost) : null,
  };
  const canManage = hasPermission(perms, PERMISSIONS.ITEMS_MANAGE);
  const jubelioCreateState = hasPermission(perms, PERMISSIONS.ITEMS_EDIT)
    ? await jubelioCreateEligibility(item.id)
    : null;
  // Kartu "Harga di Jubelio" (keputusan pemilik 2026-11-02): harga yang terakhir dikonfirmasi untuk
  // Jubelio dan apakah ada harga baru yang menunggu. Tanggal diformat di server.
  const hargaJubelioBaca = barangJadi ? await bacaHargaJubelioBarang(item.id) : null;
  const hargaJubelio =
    hargaJubelioBaca && bolehLihatHpp
      ? {
          ...hargaJubelioBaca,
          dikonfirmasiPadaTampil: hargaJubelioBaca.dikonfirmasiPada ? formatDisplayDateTime(hargaJubelioBaca.dikonfirmasiPada) : null,
          kirimanTerakhirTampil: hargaJubelioBaca.kirimanTerakhir ? formatDisplayDateTime(hargaJubelioBaca.kirimanTerakhir.waktu) : null,
          terbacaPadaTampil: hargaJubelioBaca.terbacaPada ? formatDisplayDateTime(hargaJubelioBaca.terbacaPada) : null,
          bedaTerbacaPadaTampil: hargaJubelioBaca.beda ? formatDisplayDateTime(hargaJubelioBaca.beda.terbacaPada) : null,
        }
      : null;
  /*
   * Centang saluran jual (P3/P72): kapan melepas Marketplace pada produk yang sudah di Jubelio harus
   * dikunci, dihitung di server dengan aturan yang sama dengan penulisnya (`lib/items/mutations.ts`).
   */
  let saluranInfo:
    | {
        terpetakan: boolean;
        beda: boolean;
        alasanNonaktif: ReturnType<typeof alasanTidakBisaDinonaktifkan>;
        alasanAktif: ReturnType<typeof alasanTidakBisaDiaktifkan>;
      }
    | undefined = undefined;
  if (barangJadi && hargaJubelioBaca) {
    const [kategoriTerpetakan, bawaanAda] = await Promise.all([
      item.categoryId
        ? prisma.jubelioCategoryMapping.count({ where: { itemCategoryId: item.categoryId } }).then((n) => n > 0)
        : Promise.resolve(false),
      prisma.jubelioPushDefaults.count().then((n) => n > 0),
    ]);
    saluranInfo = {
      terpetakan: hargaJubelioBaca.terpetakan,
      beda: hargaJubelioBaca.beda != null,
      alasanNonaktif: alasanTidakBisaDinonaktifkan({
        hargaTerkonfirmasi: hargaKeTeks(item.jubelioConfirmedPrice),
        kategoriTerpetakan,
        bawaanAda,
      }),
      alasanAktif: alasanTidakBisaDiaktifkan({ kategoriTerpetakan, bawaanAda }),
    };
  }
  const bolehKonfirmasiHarga = hasPermission(perms, PERMISSIONS.JUBELIO_PRICES_CONFIRM);
  const itemVariants = (item.variants as Array<Record<string, string>> | null | undefined) ?? [];
  const variantSkus = itemVariants
    .map((v) => v["sku"])
    .filter((sku): sku is string => typeof sku === "string")
    .map((sku) => ({ sku }));

  return (
    <ItemDetailClient
      initialData={{ ...initialData, saluranInfo }}
      hpp={hpp}
      hppTerbaru={hppTerbaru}
      riwayatHppAwal={riwayatHppAwal}
      bawaanRekomendasi={bawaanRekomendasi}
      satuan={item.uom?.code ?? null}
      itemType={item.type as ItemType}
      nameId={item.nameId}
      nameEn={item.nameEn}
      isActive={Boolean(item.isActive)}
      jubelioStockPushEnabled={jubelioStockPushEnabled}
      jubelioCreateState={jubelioCreateState}
      hargaJubelio={hargaJubelio}
      bolehKonfirmasiHarga={bolehKonfirmasiHarga}
      gallerySlot={
        <ItemGalleryEditor
          itemId={item.id}
          variants={variantSkus}
          initial={images}
          canManage={canManage}
        />
      }
    />
  );
}
