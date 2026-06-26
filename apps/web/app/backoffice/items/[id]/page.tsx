import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getItemById } from '@/lib/items/queries';
import { ItemType } from '@/lib/constants/enums';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { getItemImages } from '@/lib/items/images/queries';
import { ItemDetailClient } from './ItemDetailClient';
import { ItemGalleryEditor } from '@/components/items/ItemGalleryEditor';

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
    additionalCost: item.additionalCost != null ? Number(item.additionalCost) : undefined,
    consumptionRules: (
      item.fgConsumptions as Array<{
        materialId: string;
        qtyRequired: number;
        wastePercent: number;
        notes?: string | null;
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
      })),
  };

  const images = await getItemImages(item.id);
  const canManage = hasPermission(perms, PERMISSIONS.ITEMS_MANAGE);
  const itemVariants = (item.variants as Array<Record<string, string>> | null | undefined) ?? [];
  const variantSkus = itemVariants
    .map((v) => v["sku"])
    .filter((sku): sku is string => typeof sku === "string")
    .map((sku) => ({ sku }));

  return (
    <>
      <ItemDetailClient
        initialData={initialData}
        itemType={item.type as ItemType}
        nameId={item.nameId}
        nameEn={item.nameEn}
        isActive={Boolean(item.isActive)}
      />
      <ItemGalleryEditor
        itemId={item.id}
        variants={variantSkus}
        initial={images}
        canManage={canManage}
      />
    </>
  );
}
