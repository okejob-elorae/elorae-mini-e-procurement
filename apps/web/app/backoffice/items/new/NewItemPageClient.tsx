'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ItemForm } from '@/components/forms/ItemForm';
import { createItem, saveConsumptionRules } from '@/app/actions/items';
import type { ItemFormData } from '@/lib/items/mutations';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export function NewItemPageClient() {
  const router = useRouter();
  const tItems = useTranslations('items');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    data: ItemFormData,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>
  ) => {
    setIsLoading(true);
    try {
      const item = await createItem(data);
      if (consumptionRules && consumptionRules.length > 0) {
        await saveConsumptionRules(item.id, consumptionRules);
      }
      toast.success(tItems('newPage.createdToast'));
      router.push(`/backoffice/items/${item.id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tItems('newPage.createFailed');
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tItems('newPage.title')}</h1>
        <p className="text-muted-foreground">{tItems('newPage.description')}</p>
      </div>
      <ItemForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
