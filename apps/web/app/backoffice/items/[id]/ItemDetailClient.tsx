'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { updateItem, saveConsumptionRules } from '@/app/actions/items';
import { pushItemStockToJubelio } from '@/app/actions/jubelio-outbox';
import { createItemInJubelio } from '@/app/actions/jubelio-product-push';
import type { ItemFormData } from '@/lib/items/mutations';
import type { JubelioCreateEligibility } from '@/lib/items/jubelio-create-eligibility';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ItemType } from '@/lib/constants/enums';
import { PriceHistoryTable } from './PriceHistoryTable';

type ItemDetailClientProps = {
  initialData: Parameters<typeof ItemForm>[0]['initialData'];
  itemType: ItemType;
  nameId: string;
  nameEn: string;
  isActive: boolean;
  gallerySlot?: React.ReactNode;
  jubelioStockPushEnabled: boolean;
  /* null when the viewer lacks items:edit; only `eligible` and `category_unmapped` render anything. */
  jubelioCreateState: JubelioCreateEligibility | null;
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
  jubelioStockPushEnabled,
  jubelioCreateState,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tItems = useTranslations('items');
  const [isSaving, setIsSaving] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isCreatingInJubelio, setIsCreatingInJubelio] = useState(false);
  const [jubelioCreated, setJubelioCreated] = useState(false);
  const itemTypeLabel = tItems(itemTypeKeys[itemType]);
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;
  const showCreateInJubelio =
    (jubelioCreateState === 'eligible' || jubelioCreateState === 'category_unmapped') && !jubelioCreated;

  const handlePushStock = async () => {
    if (!initialData?.id) return;
    if (!confirm(tItems("pushToJubelioConfirm"))) return;
    setIsPushing(true);
    try {
      const r = await pushItemStockToJubelio(initialData.id);
      if (r.ok) toast.success(tItems("pushToJubelioQueued"));
      else if (r.reason === "push_disabled") toast.error(tItems("pushToJubelioDisabledHint"));
      else if (r.reason === "not_admin") toast.error(tItems("pushToJubelioFailed"));
      else toast.error(tItems("pushToJubelioUnexpectedFailed"));
    } catch {
      toast.error(tItems("pushToJubelioUnexpectedFailed"));
    } finally {
      setIsPushing(false);
    }
  };

  const handleCreateInJubelio = async () => {
    if (!initialData?.id) return;
    if (!confirm(tItems("createInJubelioConfirm"))) return;
    setIsCreatingInJubelio(true);
    try {
      const r = await createItemInJubelio(initialData.id);
      if (r.ok) {
        setJubelioCreated(true);
        toast.success(tItems("createInJubelioQueued"));
      } else if (r.reason === "already_queued" || r.reason === "already_mapped") {
        setJubelioCreated(true);
        toast.info(tItems("createInJubelioAlready"));
      } else if (r.reason === "category_unmapped") {
        toast.error(tItems("createInJubelioNeedsCategory"));
      } else {
        toast.error(tItems("createInJubelioFailed"));
      }
    } catch {
      toast.error(tItems("createInJubelioFailed"));
    } finally {
      setIsCreatingInJubelio(false);
    }
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
      toast.success('Item updated successfully');
      router.push('/backoffice/items');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update item';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/backoffice/items">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{nameId}</h1>
            <p className="text-muted-foreground">{nameEn}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showCreateInJubelio && (
            <div className='flex flex-col items-end gap-1'>
              <Button
                variant='outline'
                size='sm'
                disabled={isCreatingInJubelio || jubelioCreateState === 'category_unmapped'}
                onClick={() => void handleCreateInJubelio()}
              >
                {isCreatingInJubelio ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
                {tItems('createInJubelio')}
              </Button>
              {jubelioCreateState === 'category_unmapped' && (
                <p className='max-w-xs text-right text-xs text-muted-foreground'>
                  {tItems('createInJubelioNeedsCategory')}
                </p>
              )}
            </div>
          )}
          {isAdmin && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!jubelioStockPushEnabled || isPushing}
                onClick={() => void handlePushStock()}
              >
                {isPushing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {tItems("pushToJubelio")}
              </Button>
              {!jubelioStockPushEnabled && (
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  {tItems("pushToJubelioDisabledHint")}
                </p>
              )}
            </div>
          )}
          <Badge variant={isActive ? 'default' : 'secondary'}>{itemTypeLabel}</Badge>
        </div>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="price-history">Price History</TabsTrigger>
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
              Save the item first to see price history.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
