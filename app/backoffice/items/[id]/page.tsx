'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { getItemById, updateItem } from '@/app/actions/items';
import { saveConsumptionRules } from '@/app/actions/items';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { ItemType } from '@/lib/constants/enums';

export default function ItemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [item, setItem] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (params.id && typeof params.id === 'string') {
      getItemById(params.id)
        .then(setItem)
        .catch(() => {
          toast.error('Failed to load item');
          router.push('/backoffice/items');
        })
        .finally(() => setIsLoading(false));
    }
  }, [params.id, router]);

  const handleSubmit = async (
    data: Parameters<typeof ItemForm>[0]['onSubmit'] extends (data: infer T, ...args: any[]) => any ? T : never,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>
  ) => {
    if (!session?.user?.id || !item) {
      return;
    }

    setIsSaving(true);
    try {
      await updateItem(item.id, data);
      
      // Save consumption rules if provided (for Finished Goods)
      if (data.type === ItemType.FINISHED_GOOD && consumptionRules) {
        await saveConsumptionRules(item.id, consumptionRules);
      }

      toast.success('Item updated successfully');
      router.push('/backoffice/items');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update item');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return null;
  }

  const itemTypeLabels: Record<ItemType, string> = {
    FABRIC: 'Fabric',
    ACCESSORIES: 'Accessories',
    FINISHED_GOOD: 'Finished Good',
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
            <h1 className="text-2xl font-bold tracking-tight">{item.nameId}</h1>
            <p className="text-muted-foreground">{item.nameEn}</p>
          </div>
        </div>
        <Badge variant={item.isActive ? 'default' : 'secondary'}>
          {itemTypeLabels[item.type as ItemType]}
        </Badge>
      </div>

      {/* Edit Form */}
      <ItemForm
        initialData={{
          id: item.id,
          sku: item.sku,
          nameId: item.nameId,
          nameEn: item.nameEn,
          type: item.type,
          uomId: item.uomId,
          description: item.description || undefined,
          variants: item.variants as Array<Record<string, string>> | undefined,
          reorderPoint: item.reorderPoint ? Number(item.reorderPoint) : undefined,
          consumptionRules: item.fgConsumptions?.map((rule: any) => ({
            materialId: rule.materialId,
            material: {
              sku: rule.material.sku,
              nameId: rule.material.nameId,
              nameEn: rule.material.nameEn,
              uom: { code: rule.material.uom.code },
            },
            qtyRequired: Number(rule.qtyRequired),
            wastePercent: Number(rule.wastePercent),
            notes: rule.notes || undefined,
          })),
        }}
        onSubmit={handleSubmit}
        isLoading={isSaving}
      />
    </div>
  );
}
