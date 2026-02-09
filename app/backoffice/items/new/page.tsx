'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { createItem } from '@/app/actions/items';
import { saveConsumptionRules } from '@/app/actions/items';
import { toast } from 'sonner';
import { useState } from 'react';

export default function NewItemPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    data: Parameters<typeof ItemForm>[0]['onSubmit'] extends (data: infer T, ...args: any[]) => any ? T : never,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>
  ) => {
    if (!session?.user?.id) {
      toast.error('You must be logged in');
      return;
    }

    setIsLoading(true);
    try {
      const item = await createItem(data);
      
      // Save consumption rules if provided (for Finished Goods)
      if (consumptionRules && consumptionRules.length > 0) {
        await saveConsumptionRules(item.id, consumptionRules);
      }

      toast.success('Item created successfully');
      router.push(`/backoffice/items/${item.id}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create item');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create New Item</h1>
        <p className="text-muted-foreground">
          Add a new item to your catalog
        </p>
      </div>

      <ItemForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
