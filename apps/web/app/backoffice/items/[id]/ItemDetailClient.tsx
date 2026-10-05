'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { updateItem, saveConsumptionRules } from '@/app/actions/items';
import { pushItemStockToJubelio } from '@/app/actions/jubelio-outbox';
import type { ItemFormData } from '@/lib/items/mutations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Barcode } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ItemType } from '@/lib/constants/enums';
import { PriceHistoryTable } from './PriceHistoryTable';
import { alamatLabel } from "@/lib/items/label";

type ItemDetailClientProps = {
  initialData: Parameters<typeof ItemForm>[0]['initialData'];
  itemType: ItemType;
  nameId: string;
  nameEn: string;
  isActive: boolean;
  gallerySlot?: React.ReactNode;
};

const itemTypeKeys: Record<ItemType, 'fabric' | 'accessories' | 'finishedGood'> = {
  FABRIC: 'fabric',
  ACCESSORIES: 'accessories',
  FINISHED_GOOD: 'finishedGood',
};

export function ItemDetailClient({
  initialData,
  itemType,
  nameId,
  nameEn,
  isActive,
  gallerySlot,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tItems = useTranslations('items');
  const tLabel = useTranslations("labelBarcode");
  const [isSaving, setIsSaving] = useState(false);
  const itemTypeLabel = tItems(itemTypeKeys[itemType]);
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;

  const handlePushStock = async () => {
    if (!initialData?.id) return;
    if (!confirm(tItems('detail.pushStockConfirm'))) return;
    const r = await pushItemStockToJubelio(initialData.id);
    if (r.ok) toast.success(tItems('detail.pushStockQueued'));
    else toast.error(tItems('detail.pushStockFailed'));
  };

  const handleSubmit = async (
    data: ItemFormData,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>
  ) => {
    if (!initialData?.id) return;
    setIsSaving(true);
    try {
      await updateItem(initialData.id, data);
      if (data.type === ItemType.FINISHED_GOOD && consumptionRules) {
        await saveConsumptionRules(initialData.id, consumptionRules);
      }
      toast.success(tItems('detail.updatedToast'));
      router.push('/backoffice/items');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tItems('detail.updateFailed');
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/backoffice/items">
            <Button
              variant="ghost"
              size="icon"
              aria-label={tItems('detail.backToItems')}
              title={tItems('detail.backToItems')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">{nameId}</h1>
              <TombolBantuan judul={nameId} />
            </div>
            <p className="text-muted-foreground">{nameEn}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {itemType === ItemType.FINISHED_GOOD && initialData?.id ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={alamatLabel({ itemId: initialData.id })}>
                <Barcode className="h-4 w-4" />
                {tLabel("tombolHalamanBarang")}
              </Link>
            </Button>
          ) : null}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => void handlePushStock()}>
              {tItems('detail.pushStock')}
            </Button>
          )}
          <Badge variant={isActive ? 'default' : 'secondary'}>{itemTypeLabel}</Badge>
        </div>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">{tItems('detail.tabDetails')}</TabsTrigger>
          <TabsTrigger value="price-history">{tItems('priceHistory.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-4">
          <ItemForm initialData={initialData} onSubmit={handleSubmit} isLoading={isSaving} />
          {gallerySlot}
        </TabsContent>
        <TabsContent value="price-history">
          {initialData?.id ? (
            <PriceHistoryTable itemId={initialData.id} />
          ) : (
            <div className="text-sm text-muted-foreground">
              {tItems('detail.saveFirst')}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
