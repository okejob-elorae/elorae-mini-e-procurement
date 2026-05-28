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
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ItemType } from '@/lib/constants/enums';

type ItemDetailClientProps = {
  initialData: Parameters<typeof ItemForm>[0]['initialData'];
  itemType: ItemType;
  nameId: string;
  nameEn: string;
  isActive: boolean;
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
}: ItemDetailClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tItems = useTranslations('items');
  const [isSaving, setIsSaving] = useState(false);
  const itemTypeLabel = tItems(itemTypeKeys[itemType]);
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;

  const handlePushStock = async () => {
    if (!initialData?.id) return;
    if (!confirm("Push this item's current stock to Jubelio?")) return;
    const r = await pushItemStockToJubelio(initialData.id);
    if (r.ok) toast.success("Queued. Pushes within ~5 seconds.");
    else toast.error("Push failed (admin only).");
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/backoffice/items">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{nameId}</h1>
            <p className="text-muted-foreground">{nameEn}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => void handlePushStock()}>
              Push stock to Jubelio
            </Button>
          )}
          <Badge variant={isActive ? 'default' : 'secondary'}>{itemTypeLabel}</Badge>
        </div>
      </div>

      <ItemForm initialData={initialData} onSubmit={handleSubmit} isLoading={isSaving} />
    </div>
  );
}
