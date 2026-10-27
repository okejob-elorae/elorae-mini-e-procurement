'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ItemForm } from '@/components/forms/ItemForm';
import { createItem, saveConsumptionRules } from '@/app/actions/items';
import type { ItemFormData } from '@/lib/items/mutations';
import { toast } from 'sonner';
import { ItemType } from '@/lib/constants/enums';

export function NewItemPageClient() {
  const router = useRouter();
  const tItems = useTranslations("items");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    data: ItemFormData,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
      colorId?: string | null;
      size?: string | null;
    }>
  ) => {
    setIsLoading(true);
    try {
      const result = await createItem(data);
      if (!result.success) {
        toast.error(tItems(`saveRefusal.${result.code}`, { detail: result.detail }));
        return;
      }
      const item = result.item;
      if (consumptionRules && consumptionRules.length > 0) {
        await saveConsumptionRules(item.id, consumptionRules);
      }
      toast.success('Item created successfully');
      router.push(`/backoffice/items/${item.id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create item';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create New Item</h1>
        <p className="text-muted-foreground">Add a new item to your catalog</p>
      </div>
      <ItemForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
