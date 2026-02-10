'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { itemSchema, consumptionRuleSchema } from '@/lib/validations';
import { ItemType } from '@/lib/constants/enums';
import { generateSKU } from '@/app/actions/items';
import { getUOMs } from '@/app/actions/uom';
import { getItemsByType } from '@/app/actions/items';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';

type ItemFormData = z.infer<typeof itemSchema>;
type ConsumptionRuleData = z.infer<typeof consumptionRuleSchema>;

interface UOM {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
}

interface Item {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  uom: {
    id: string;
    code: string;
  };
}

interface ItemFormProps {
  initialData?: {
    id?: string;
    sku?: string;
    nameId?: string;
    nameEn?: string;
    type?: ItemType;
    uomId?: string;
    description?: string;
    variants?: Array<Record<string, string>>;
    reorderPoint?: number;
    consumptionRules?: Array<{
      materialId: string;
      material: {
        sku: string;
        nameId: string;
        nameEn: string;
        uom: { code: string };
      };
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>;
  };
  onSubmit: (data: ItemFormData, consumptionRules?: ConsumptionRuleData[]) => Promise<void>;
  isLoading?: boolean;
}

export function ItemForm({ initialData, onSubmit, isLoading = false }: ItemFormProps) {
  const [uoms, setUOMs] = useState<UOM[]>([]);
  const [materials, setMaterials] = useState<Item[]>([]);
  const [sku, setSku] = useState(initialData?.sku || '');
  const [isGeneratingSKU, setIsGeneratingSKU] = useState(false);
  const [consumptionRules, setConsumptionRules] = useState<ConsumptionRuleData[]>(
    initialData?.consumptionRules?.map(r => ({
      materialId: r.materialId,
      qtyRequired: Number(r.qtyRequired),
      wastePercent: Number(r.wastePercent),
      notes: r.notes
    })) || []
  );
  const initialAttributes = useMemo(() => {
    if (!initialData?.variants || initialData.variants.length === 0) return [];
    const map = new Map<string, Set<string>>();
    initialData.variants.forEach((variant) => {
      Object.entries(variant).forEach(([key, value]) => {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(value);
      });
    });
    return Array.from(map.entries()).map(([key, values]) => ({
      key,
      values: Array.from(values),
    }));
  }, [initialData?.variants]);
  const [attributes, setAttributes] = useState<Array<{ key: string; values: string[] }>>(
    initialAttributes
  );

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      nameId: initialData?.nameId || '',
      nameEn: initialData?.nameEn || '',
      type: initialData?.type || ItemType.FABRIC,
      uomId: initialData?.uomId || '',
      description: initialData?.description || '',
      variants: initialData?.variants || [],
      reorderPoint: initialData?.reorderPoint,
    },
  });

  const itemType = watch('type');

  useEffect(() => {
    // Load UOMs
    getUOMs().then(setUOMs).catch(() => toast.error('Failed to load UOMs'));

    // Load materials if type is FINISHED_GOOD
    if (itemType === ItemType.FINISHED_GOOD) {
      getItemsByType(ItemType.FABRIC)
        .then(items => setMaterials(items as Item[]))
        .catch(() => toast.error('Failed to load materials'));
    }
  }, [itemType]);

  const handleGenerateSKU = async () => {
    if (!itemType) {
      toast.error('Please select item type first');
      return;
    }
    setIsGeneratingSKU(true);
    try {
      const newSku = await generateSKU(itemType);
      setSku(newSku);
    } catch (_error) {
      toast.error('Failed to generate SKU');
    } finally {
      setIsGeneratingSKU(false);
    }
  };

  const addConsumptionRule = () => {
    setConsumptionRules([...consumptionRules, {
      materialId: '',
      qtyRequired: 0,
      wastePercent: 0,
    }]);
  };

  const removeConsumptionRule = (index: number) => {
    setConsumptionRules(consumptionRules.filter((_, i) => i !== index));
  };

  const updateConsumptionRule = (index: number, field: keyof ConsumptionRuleData, value: any) => {
    const updated = [...consumptionRules];
    updated[index] = { ...updated[index], [field]: value };
    setConsumptionRules(updated);
  };

  const addAttribute = () => {
    setAttributes([...attributes, { key: '', values: [] }]);
  };

  const removeAttribute = (index: number) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const updateAttributeKey = (index: number, key: string) => {
    const updated = [...attributes];
    updated[index] = { ...updated[index], key };
    setAttributes(updated);
  };

  const updateAttributeValues = (index: number, value: string) => {
    const values = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const updated = [...attributes];
    updated[index] = { ...updated[index], values };
    setAttributes(updated);
  };

  const variantCombinations = useMemo(() => {
    if (attributes.length === 0) return [];
    return attributes.reduce<Array<Record<string, string>>>((acc, attr) => {
      if (!attr.key || attr.values.length === 0) return acc;
      if (acc.length === 0) {
        return attr.values.map((value) => ({ [attr.key]: value }));
      }
      const next: Array<Record<string, string>> = [];
      acc.forEach((combo) => {
        attr.values.forEach((value) => {
          next.push({ ...combo, [attr.key]: value });
        });
      });
      return next;
    }, []);
  }, [attributes]);

  const onFormSubmit = async (data: ItemFormData) => {
    const dataWithSku: ItemFormData = {
      ...data,
      sku: sku || undefined,
    };

    const hasAttributes =
      attributes.length > 0 &&
      attributes.some((attr) => attr.key.trim() || attr.values.length > 0);

    if (hasAttributes) {
      const incomplete = attributes.find((attr) => !attr.key.trim() || attr.values.length === 0);
      if (incomplete) {
        toast.error('Please provide a name and at least one value for each attribute');
        return;
      }
    }

    const variants = variantCombinations.length > 0 ? variantCombinations : undefined;

    // Validate consumption rules if type is FINISHED_GOOD
    if (itemType === ItemType.FINISHED_GOOD && consumptionRules.length > 0) {
      const invalidRules = consumptionRules.filter(
        r => !r.materialId || r.qtyRequired <= 0
      );
      if (invalidRules.length > 0) {
        toast.error('Please fill all consumption rule fields');
        return;
      }
    }

    await onSubmit(
      { ...dataWithSku, variants },
      itemType === ItemType.FINISHED_GOOD ? consumptionRules : undefined
    );
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SKU */}
          <div className="space-y-2">
            <Label htmlFor="sku">SKU</Label>
            <div className="flex gap-2">
              <Input
                id="sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="FAB-00001"
                disabled={!!initialData?.sku}
              />
              {!initialData?.sku && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGenerateSKU}
                  disabled={isGeneratingSKU || !itemType}
                >
                  {isGeneratingSKU ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Generate'
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Bilingual Names */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nameId">Nama (Indonesia) *</Label>
              <Input
                id="nameId"
                {...register('nameId')}
                placeholder="Kain Katun Merah"
              />
              {errors.nameId && (
                <p className="text-sm text-destructive">{errors.nameId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEn">Name (English) *</Label>
              <Input
                id="nameEn"
                {...register('nameEn')}
                placeholder="Red Cotton Fabric"
              />
              {errors.nameEn && (
                <p className="text-sm text-destructive">{errors.nameEn.message}</p>
              )}
            </div>
          </div>

          {/* Type and UOM */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ItemType.FABRIC}>Fabric</SelectItem>
                      <SelectItem value={ItemType.ACCESSORIES}>Accessories</SelectItem>
                      <SelectItem value={ItemType.FINISHED_GOOD}>Finished Good</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.type && (
                <p className="text-sm text-destructive">{errors.type.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="uomId">Unit of Measure *</Label>
              <Controller
                name="uomId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {uoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>
                          {uom.code} - {uom.nameId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.uomId && (
                <p className="text-sm text-destructive">{errors.uomId.message}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Item description..."
              rows={3}
            />
          </div>

          {/* Reorder Point */}
          <div className="space-y-2">
            <Label htmlFor="reorderPoint">Reorder Point</Label>
            <Input
              id="reorderPoint"
              type="number"
              step="0.01"
              min="0"
              {...register('reorderPoint', { valueAsNumber: true })}
              placeholder="0.00"
            />
          </div>
        </CardContent>
      </Card>

      {/* Variants */}
      <Card>
        <CardHeader>
          <CardTitle>Variants (Optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Define attributes (e.g., Color, Size) and their values to generate variant combinations.
            </p>
            <Button type="button" variant="outline" onClick={addAttribute}>
              <Plus className="h-4 w-4 mr-2" />
              Add Attribute
            </Button>
          </div>

          {attributes.length === 0 && (
            <p className="text-sm text-muted-foreground">No attributes added yet.</p>
          )}

          {attributes.map((attr, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-2">
                <Label>Attribute Name</Label>
                <Input
                  value={attr.key}
                  onChange={(e) => updateAttributeKey(index, e.target.value)}
                  placeholder="Color"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Values (comma separated)</Label>
                <div className="flex gap-2">
                  <Input
                    value={attr.values.join(', ')}
                    onChange={(e) => updateAttributeValues(index, e.target.value)}
                    placeholder="Red, Blue, Green"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAttribute(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

        </CardContent>
      </Card>

      {/* Consumption Rules - Only for Finished Goods */}
      {itemType === ItemType.FINISHED_GOOD && (
        <Card>
          <CardHeader>
            <CardTitle>Consumption Rules (BOM)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                Define materials required to produce this finished good
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addConsumptionRule}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Material
              </Button>
            </div>

            {consumptionRules.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No consumption rules added yet
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Qty Required</TableHead>
                    <TableHead>Waste %</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionRules.map((rule, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Select
                          value={rule.materialId}
                          onValueChange={(value) =>
                            updateConsumptionRule(index, 'materialId', value)
                          }
                        >
                          <SelectTrigger className="max-w-[16rem] min-w-0 [&_[data-slot=select-value]]:truncate">
                            <SelectValue placeholder="Select material" />
                          </SelectTrigger>
                          <SelectContent>
                            {materials.map((material) => (
                              <SelectItem key={material.id} value={material.id}>
                                {material.sku} - {material.nameId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={rule.qtyRequired || ''}
                          onChange={(e) =>
                            updateConsumptionRule(
                              index,
                              'qtyRequired',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="0.0000"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={rule.wastePercent || ''}
                          onChange={(e) =>
                            updateConsumptionRule(
                              index,
                              'wastePercent',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={rule.notes || ''}
                          onChange={(e) =>
                            updateConsumptionRule(index, 'notes', e.target.value)
                          }
                          placeholder="Optional notes"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeConsumptionRule(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {initialData ? 'Update Item' : 'Create Item'}
        </Button>
      </div>
    </form>
  );
}
