'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ItemForm } from '@/components/forms/ItemForm';
import { PageHeader } from '@/components/ui/page-header';
import { createItem, saveConsumptionRules } from '@/app/actions/items';
import type { ItemFormData } from '@/lib/items/mutations';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export function NewItemPageClient() {
  const router = useRouter();
  const tItems = useTranslations('items');
  const tDetail = useTranslations('itemDetail');
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
      toast.success(tDetail('dibuat'));
      router.push(`/backoffice/items/${item.id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tDetail('gagalBuat');
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={tItems('newPage.title')} />
      <ItemForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
