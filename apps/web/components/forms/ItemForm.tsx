'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createItemSchema, itemSchema, consumptionRuleSchema } from '@/lib/validations';
import { ItemType } from '@/lib/constants/enums';
import { generateSKU, getVariantBarcodeFormatConfig } from '@/app/actions/items';
import { getUOMs } from '@/app/actions/uom';
import { getItems } from '@/app/actions/items';
import { getItemTypeMasters } from '@/app/actions/item-type-master';
import { getItemCategories } from '@/app/actions/item-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TagsInput } from '@/components/ui/tags-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildVariantSkuCode,
  slugVariantAttributeValue,
  variantSkuBase,
} from "@/lib/items/normalize-variants";
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import {
  buildVariantBarcode,
  type VariantBarcodeFormatConfig,
} from '@/lib/items/variant-barcode';
import {
  type AttributeDef,
  type GridState,
  EMPTY_GRID_ROWS,
  attributesFromSavedVariants,
  cartesianCombinations,
  comboKey,
  contributingAttributes,
  findSavedVariant,
  initialExcludedKeys,
  mapRowValues,
  overlaySavedSpelling,
  resolveGridRows,
  setRowValueAt,
} from '@/lib/items/variant-grid';

type ItemFormData = z.infer<typeof itemSchema>;
type ConsumptionRuleData = z.infer<typeof consumptionRuleSchema>;

type ConsumptionRuleRow = ConsumptionRuleData & { qtyInput?: string };

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

interface ItemCategoryOption {
  id: string;
  name: string;
  code?: string | null;
  isActive: boolean;
}

/**
 * De-duplicates attribute values case-insensitively (trim + lowercase),
 * keeping the FIRST spelling typed — `TagsInput` itself only dedupes
 * case-sensitively, so "merah" typed next to "Merah" would otherwise sit in
 * the list as two values sharing one `comboKey`, unable to be toggled apart.
 */
function dedupeAttributeValues(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim().toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(value);
  });
  return deduped;
}

/** Parse number inputs; blank or invalid → 0 (avoids NaN from valueAsNumber). */
function parseNumberFieldDefaultZero(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

interface ItemFormProps {
  initialData?: {
    id?: string;
    sku?: string;
    nameId?: string;
    nameEn?: string;
    type?: ItemType;
    uomId?: string;
    categoryId?: string | null;
    description?: string;
    variants?: Array<Record<string, string>>;
    reorderPoint?: number;
    overReceiveThreshold?: number;
    sellingPrice?: number;
    targetMarginPercent?: number;
    additionalCost?: number;
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
  const tValidation = useTranslations('validation');
  const tToasts = useTranslations('toasts');
  const itemSchemaT = useMemo(() => createItemSchema((k) => tValidation(k)), [tValidation]);
  const [uoms, setUOMs] = useState<UOM[]>([]);
  const [materials, setMaterials] = useState<Item[]>([]);
  const [itemCategories, setItemCategories] = useState<ItemCategoryOption[]>([]);
  const [sku, setSku] = useState(initialData?.sku || '');
  const [isGeneratingSKU, setIsGeneratingSKU] = useState(false);
  const [consumptionRules, setConsumptionRules] = useState<ConsumptionRuleRow[]>(
    initialData?.consumptionRules?.map(r => ({
      materialId: r.materialId,
      qtyRequired: Number(r.qtyRequired),
      wastePercent: Number(r.wastePercent),
      notes: r.notes
    })) || []
  );

  const normalizedVariants = useMemo((): Array<Record<string, string>> => {
    const raw = initialData?.variants;
    if (Array.isArray(raw)) return raw as Array<Record<string, string>>;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as Array<Record<string, string>>) : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [initialData?.variants]);

  const initialAttributes = useMemo(
    () => attributesFromSavedVariants(normalizedVariants),
    [normalizedVariants]
  );
  const [attributes, setAttributes] = useState<AttributeDef[]>(initialAttributes);

  /**
   * The variant table (`grid.rows`) and the last complete grid it carries
   * codes from (`grid.snapshot`), in ONE state value, so a code can never
   * sit next to a combination from a different layout. Only two paths write
   * it, both through pure helpers in `variant-grid.ts`: `commitAttributes`
   * (`resolveGridRows`, in the same event that changes the attributes) and
   * the SKU/barcode handlers (`setRowValueAt` / `mapRowValues`).
   */
  const [grid, setGrid] = useState<GridState>(() =>
    resolveGridRows({
      attributes: initialAttributes,
      savedVariants: normalizedVariants,
      rows: EMPTY_GRID_ROWS,
      snapshot: EMPTY_GRID_ROWS,
    })
  );
  const gridRows = grid.rows;
  const [barcodeFormatConfig, setBarcodeFormatConfig] = useState<VariantBarcodeFormatConfig | null>(
    null
  );
  const [itemTypeMasters, setItemTypeMasters] = useState<Awaited<ReturnType<typeof getItemTypeMasters>>>([]);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<ItemFormData>({
    resolver: zodResolver(itemSchemaT) as Resolver<ItemFormData>,
    defaultValues: {
      nameId: initialData?.nameId || '',
      nameEn: initialData?.nameEn || '',
      type: initialData?.type || ItemType.FABRIC,
      uomId: initialData?.uomId || '',
      categoryId: initialData?.categoryId || '',
      description: initialData?.description || '',
      variants: normalizedVariants,
      reorderPoint: initialData?.reorderPoint ?? 0,
      overReceiveThreshold: initialData?.overReceiveThreshold ?? 0,
      sellingPrice: initialData?.sellingPrice,
      targetMarginPercent: initialData?.targetMarginPercent,
      additionalCost: initialData?.additionalCost,
    },
  });

  const itemType = watch('type');
  const watchedCategoryId = watch('categoryId');

  const categoryCodePrefix = useMemo(() => {
    const id = (watchedCategoryId ?? '').trim();
    if (!id) return '';
    const row = itemCategories.find((c) => c.id === id);
    return (row?.code ?? '').trim();
  }, [watchedCategoryId, itemCategories]);

  useEffect(() => {
    // Load UOMs
    getUOMs().then(setUOMs).catch(() => toast.error(tToasts('failedToLoadUOMs')));
    getItemTypeMasters().then(setItemTypeMasters).catch(() => {});
    getItemCategories(true).then((rows) => setItemCategories(rows as ItemCategoryOption[])).catch(() => {});
    getVariantBarcodeFormatConfig()
      .then(setBarcodeFormatConfig)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    if (itemType === ItemType.FINISHED_GOOD) {
      getItems({ type: 'raw', isActive: true })
        .then((result) => setMaterials(Array.isArray(result) ? (result as unknown as Item[]) : []))
        .catch(() => toast.error(tToasts('failedToLoadMaterials')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itemType drives fetch
  }, [itemType]);

  const handleGenerateSKU = async () => {
    if (!itemType) {
      toast.error(tToasts('pleaseSelectItemTypeFirst'));
      return;
    }
    setIsGeneratingSKU(true);
    try {
      const newSku = await generateSKU(itemType);
      setSku(newSku);
    } catch {
      toast.error(tToasts('failedToGenerateSKU'));
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

  const updateConsumptionRule = (index: number, field: keyof ConsumptionRuleRow, value: unknown) => {
    const updated = [...consumptionRules];
    updated[index] = { ...updated[index], [field]: value };
    setConsumptionRules(updated);
  };

  const stripConsumptionRuleRows = (rows: ConsumptionRuleRow[]): ConsumptionRuleData[] =>
    rows.map((row) => {
      const next = { ...row };
      delete next.qtyInput;
      return next as ConsumptionRuleData;
    });

  /**
   * Every attribute change goes through here, so the table rows are
   * re-resolved in the same event and commit as the attributes themselves —
   * no effect, and no render where the rows lag the attributes.
   */
  const commitAttributes = (next: AttributeDef[]) => {
    setAttributes(next);
    setGrid((prev) =>
      resolveGridRows({
        attributes: next,
        savedVariants: normalizedVariants,
        rows: prev.rows,
        snapshot: prev.snapshot,
      })
    );
  };

  const addAttribute = () => {
    commitAttributes([...attributes, { key: '', values: [] }]);
  };

  const removeAttribute = (index: number) => {
    commitAttributes(attributes.filter((_, i) => i !== index));
  };

  const updateAttributeKey = (index: number, key: string) => {
    const updated = [...attributes];
    updated[index] = { ...updated[index], key };
    commitAttributes(updated);
  };

  const updateAttributeValues = (index: number, values: string[]) => {
    const deduped = dedupeAttributeValues(values);
    if (deduped.length < values.length) {
      toast.info(tToasts('duplicateAttributeValue'));
    }
    const updated = [...attributes];
    updated[index] = { ...updated[index], values: deduped };
    commitAttributes(updated);
  };

  /**
   * Exclusions are keyed by `comboKey` under `gridRows.keys`, not by row
   * index. Adding or removing a whole attribute changes that key list, so
   * every combination's key changes with it and `excludedKeys` stops
   * matching anything — every row comes back included. Acceptable: only a
   * value edit (not an attribute add/remove) is expected to preserve
   * exclusions.
   */
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(() =>
    initialExcludedKeys(
      cartesianCombinations(initialAttributes),
      normalizedVariants,
      contributingAttributes(initialAttributes).map((attr) => attr.key)
    )
  );

  const includedCount = useMemo(
    () =>
      gridRows.combos.filter((combo) => !excludedKeys.has(comboKey(combo, gridRows.keys))).length,
    [gridRows, excludedKeys]
  );

  const toggleCombinationIncluded = (rowKey: string) => {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  const parentSku = (initialData?.sku ?? sku) || '';
  const variantSkuBasePrefix = variantSkuBase(parentSku, categoryCodePrefix);

  const setVariantSkuAt = (idx: number, value: string) => {
    setGrid((prev) => setRowValueAt(prev, 'skus', idx, value));
  };

  const setVariantBarcodeAt = (idx: number, value: string) => {
    setGrid((prev) => setRowValueAt(prev, 'barcodes', idx, value));
  };

  const applyVariantSkuCodeAt = (idx: number) => {
    if (!variantSkuBasePrefix) {
      toast.error(tToasts('setParentSkuBeforeVariantCode'));
      return;
    }
    setGrid((prev) =>
      mapRowValues(prev, 'skus', (combo, current, i) =>
        i === idx ? buildVariantSkuCode(variantSkuBasePrefix, combo, prev.rows.keys) : current
      )
    );
  };

  const applyVariantBarcodeAt = (idx: number) => {
    if (!barcodeFormatConfig) return;
    if (!categoryCodePrefix && !parentSku.trim()) {
      toast.error(tToasts('setParentSkuBeforeBarcode'));
      return;
    }
    const formatConfig = barcodeFormatConfig;
    setGrid((prev) =>
      mapRowValues(prev, 'barcodes', (combo, current, i) =>
        i === idx
          ? buildVariantBarcode(formatConfig, {
              parentSku: parentSku.trim(),
              categoryCode: categoryCodePrefix,
              combo,
              orderedAttributeKeys: prev.rows.keys,
            })
          : current
      )
    );
  };

  const applyAllVariantCodes = () => {
    if (!variantSkuBasePrefix) {
      toast.error(tToasts('setParentSkuBeforeVariantCode'));
      return;
    }
    if (!barcodeFormatConfig) return;
    const formatConfig = barcodeFormatConfig;
    setGrid((prev) => {
      const keys = prev.rows.keys;
      const withSkus = mapRowValues(prev, 'skus', (combo, current) =>
        excludedKeys.has(comboKey(combo, keys))
          ? current
          : buildVariantSkuCode(variantSkuBasePrefix, combo, keys)
      );
      return mapRowValues(withSkus, 'barcodes', (combo, current) =>
        excludedKeys.has(comboKey(combo, keys))
          ? current
          : buildVariantBarcode(formatConfig, {
              parentSku: parentSku.trim(),
              categoryCode: categoryCodePrefix,
              combo,
              orderedAttributeKeys: keys,
            })
      );
    });
  };

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
        toast.error(tToasts('provideNameAndAttributeValues'));
        return;
      }
    }

    if (gridRows.combos.length > 0 && includedCount === 0) {
      toast.error(tToasts('includeAtLeastOneVariant'));
      return;
    }

    const variantSkuPrefixes = [
      categoryCodePrefix,
      parentSku.trim(),
    ].filter((p, i, arr) => p && arr.indexOf(p) === i);

    const variants =
      gridRows.combos.length > 0
        ? gridRows.combos.flatMap((rawCombo, i) => {
            if (excludedKeys.has(comboKey(rawCombo, gridRows.keys))) return [];
            const combo = overlaySavedSpelling(rawCombo, normalizedVariants);
            let variantSku = gridRows.skus[i]?.trim() || '';
            const variantBarcode = gridRows.barcodes[i]?.trim() || '';
            const autoBase = variantSkuBasePrefix;
            if (variantSku && autoBase) {
              const hasValidPrefix = variantSkuPrefixes.some((p) => variantSku.startsWith(p));
              if (!hasValidPrefix) {
                const bare =
                  slugVariantAttributeValue(variantSku) ||
                  variantSku.replace(/\s+/g, '-').toUpperCase();
                variantSku = `${autoBase}-${bare}`;
              }
            }
            return [
              {
                ...combo,
                ...(variantSku ? { sku: variantSku } : {}),
                ...(variantBarcode ? { barcode: variantBarcode } : {}),
              },
            ];
          })
        : undefined;

    // Validate consumption rules if type is FINISHED_GOOD
    if (itemType === ItemType.FINISHED_GOOD && consumptionRules.length > 0) {
      const invalidRules = consumptionRules.filter(
        r => !r.materialId || r.qtyRequired <= 0
      );
      if (invalidRules.length > 0) {
        toast.error(tToasts('fillConsumptionRuleFields'));
        return;
      }
    }

    await onSubmit(
      { ...dataWithSku, variants },
      itemType === ItemType.FINISHED_GOOD ? stripConsumptionRuleRows(consumptionRules) : undefined
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
                aria-invalid={!!errors.nameId}
                className={errors.nameId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
              />
              {errors.nameId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.nameId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEn">Name (English) *</Label>
              <Input
                id="nameEn"
                {...register('nameEn')}
                placeholder="Red Cotton Fabric"
                aria-invalid={!!errors.nameEn}
                className={errors.nameEn ? 'border-destructive focus-visible:ring-destructive/20' : ''}
              />
              {errors.nameEn && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.nameEn.message}
                </p>
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
                  <SearchableCombobox
                    id="type"
                    options={
                      itemTypeMasters.length > 0
                        ? itemTypeMasters.map((m) => ({ value: m.code, label: m.nameEn }))
                        : [
                            { value: ItemType.FABRIC, label: 'Fabric' },
                            { value: ItemType.ACCESSORIES, label: 'Accessories' },
                            { value: ItemType.FINISHED_GOOD, label: 'Finished Good' },
                          ]
                    }
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Select type"
                    aria-invalid={!!errors.type}
                    className={errors.type ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                  />
                )}
              />
              {errors.type && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.type.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="uomId">Unit of Measure *</Label>
              <Controller
                name="uomId"
                control={control}
                render={({ field }) => (
                  <SearchableCombobox
                    id="uomId"
                    options={uoms.map((uom) => ({
                      value: uom.id,
                      label: `${uom.code} - ${uom.nameId}`,
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Select UOM"
                    aria-invalid={!!errors.uomId}
                    className={errors.uomId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                  />
                )}
              />
              {errors.uomId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.uomId.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Category</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <SearchableCombobox
                    id="categoryId"
                    options={[
                      { value: '__none__', label: 'No category' },
                      ...itemCategories.map((category) => ({
                        value: category.id,
                        label: (category.code ? `${category.code} - ` : '') + category.name,
                      })),
                    ]}
                    value={field.value || '__none__'}
                    onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}
                    placeholder="Select category"
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="overReceiveThreshold">Over-receive threshold</Label>
              <Input
                id="overReceiveThreshold"
                type="number"
                step="0.01"
                min="0"
                {...register('overReceiveThreshold', {
                  setValueAs: parseNumberFieldDefaultZero,
                })}
                placeholder="0.00"
                aria-invalid={!!errors.overReceiveThreshold}
                className={errors.overReceiveThreshold ? 'border-destructive focus-visible:ring-destructive/20' : ''}
              />
              {errors.overReceiveThreshold && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.overReceiveThreshold.message}
                </p>
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
              aria-invalid={!!errors.description}
              className={errors.description ? 'border-destructive focus-visible:ring-destructive/20' : ''}
            />
            {errors.description && (
              <p className="text-sm text-destructive" role="alert">
                {errors.description.message}
              </p>
            )}
          </div>

          {/* Reorder Point */}
          <div className="space-y-2">
            <Label htmlFor="reorderPoint">Reorder Point</Label>
            <Input
              id="reorderPoint"
              type="number"
              step="0.01"
              min="0"
              {...register('reorderPoint', {
                setValueAs: parseNumberFieldDefaultZero,
              })}
              placeholder="0.00"
              aria-invalid={!!errors.reorderPoint}
              className={errors.reorderPoint ? 'border-destructive focus-visible:ring-destructive/20' : ''}
            />
            {errors.reorderPoint && (
              <p className="text-sm text-destructive" role="alert">
                {errors.reorderPoint.message}
              </p>
            )}
          </div>

          {/* Pricing (Finished goods only) */}
          {itemType === ItemType.FINISHED_GOOD && (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="sellingPrice">Harga Jual (Selling price)</Label>
                <Input
                  id="sellingPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('sellingPrice', { valueAsNumber: true })}
                  placeholder="0.00"
                  aria-invalid={!!errors.sellingPrice}
                  className={errors.sellingPrice ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                />
                {errors.sellingPrice && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.sellingPrice.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetMarginPercent">
                  Target Margin (%) <span className="text-xs text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="targetMarginPercent"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("targetMarginPercent", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                  aria-invalid={!!errors.targetMarginPercent}
                  className={errors.targetMarginPercent ? "border-destructive focus-visible:ring-destructive/20" : ""}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank to use the default from Jubelio push settings.
                </p>
                {errors.targetMarginPercent && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.targetMarginPercent.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="additionalCost">
                  Additional Cost per pcs (Rp) <span className="text-xs text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="additionalCost"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("additionalCost", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                  aria-invalid={!!errors.additionalCost}
                  className={errors.additionalCost ? "border-destructive focus-visible:ring-destructive/20" : ""}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Flat add-on per unit (packaging, etc).
                </p>
                {errors.additionalCost && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.additionalCost.message}
                  </p>
                )}
              </div>
            </div>
          )}
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
                  <TagsInput
                    value={attr.values}
                    onChange={(values) => updateAttributeValues(index, values)}
                    placeholder="Red, Blue, Green"
                    separator={[',', '\n']}
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

          {gridRows.combos.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Variant SKU must start with the parent item SKU
                  {parentSku ? ` (${parentSku})` : ''} or the category code
                  {categoryCodePrefix ? ` (${categoryCodePrefix})` : ' (when the category has one)'}. Leave empty to save and the server will auto-fill using the same
                  base. Use <span className="font-medium text-foreground">Generate code</span> for{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{base}-{attr1}-…-{attrN}`}</code>
                  {variantSkuBasePrefix ? (
                    <>
                      {' '}
                      (e.g. {variantSkuBasePrefix}-RED-S).
                    </>
                  ) : (
                    <> (set the item SKU first).</>
                  )}
                  {' '}Barcodes follow the format in{' '}
                  <span className="font-medium text-foreground">Settings → Item codes</span>.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={applyAllVariantCodes}
                  disabled={!variantSkuBasePrefix || !barcodeFormatConfig}
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  Generate all
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {includedCount} of {gridRows.combos.length} combinations included
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Include</TableHead>
                    {attributes.map((attr) => (
                      <TableHead key={attr.key}>{attr.key}</TableHead>
                    ))}
                    <TableHead className="min-w-56">Variant SKU</TableHead>
                    <TableHead className="min-w-56">Barcode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gridRows.combos.map((combo, idx) => {
                    const rowKey = comboKey(combo, gridRows.keys);
                    const excluded = excludedKeys.has(rowKey);
                    const savedMatch = findSavedVariant(combo, normalizedVariants);
                    const showSavedVariantWarning = excluded && Boolean(savedMatch);
                    const comboLabel = attributes
                      .map((attr) => combo[attr.key] ?? '')
                      .filter((value) => value.length > 0)
                      .join(' / ');
                    const mutedCellClassName = excluded ? 'opacity-60' : undefined;
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <label className="flex h-10 min-h-10 w-10 cursor-pointer items-center justify-center">
                            <Checkbox
                              checked={!excluded}
                              onCheckedChange={() => toggleCombinationIncluded(rowKey)}
                              aria-label={`Include ${comboLabel}`}
                            />
                          </label>
                          {showSavedVariantWarning && (
                            <p className="mt-1 max-w-40 text-xs text-amber-700 dark:text-amber-400">
                              Saved variant — excluding removes it from the catalog; its stock stays under this SKU.
                            </p>
                          )}
                        </TableCell>
                        {attributes.map((attr) => (
                          <TableCell key={attr.key} className={mutedCellClassName}>
                            {combo[attr.key] ?? '—'}
                          </TableCell>
                        ))}
                        <TableCell className={mutedCellClassName}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Input
                              className="min-w-0 flex-1 font-mono text-sm"
                              value={gridRows.skus[idx] ?? ''}
                              disabled={excluded}
                              onChange={(e) => setVariantSkuAt(idx, e.target.value)}
                              placeholder={variantSkuBasePrefix ? `${variantSkuBasePrefix}-…` : 'e.g. OUTERWEAR-RED'}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={() => applyVariantSkuCodeAt(idx)}
                              disabled={excluded || !variantSkuBasePrefix}
                              title={
                                variantSkuBasePrefix
                                  ? `Build ${variantSkuBasePrefix}-{values}`
                                  : 'Select a category with code or set item SKU'
                              }
                            >
                              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                              Generate code
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className={mutedCellClassName}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Input
                              className="min-w-0 flex-1 font-mono text-sm"
                              value={gridRows.barcodes[idx] ?? ''}
                              disabled={excluded}
                              onChange={(e) => setVariantBarcodeAt(idx, e.target.value)}
                              placeholder="e.g. 0224000016T03"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={() => applyVariantBarcodeAt(idx)}
                              disabled={excluded || !barcodeFormatConfig}
                              title="Build barcode from global format template"
                            >
                              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                              Generate code
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

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
                        <SearchableCombobox
                          options={materials.map((material) => ({
                            value: material.id,
                            label: `${material.sku} - ${material.nameId}`,
                          }))}
                          value={rule.materialId}
                          onValueChange={(value) =>
                            updateConsumptionRule(index, 'materialId', value)
                          }
                          placeholder="Select material"
                          triggerClassName="max-w-[16rem] min-w-0"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={
                            rule.qtyInput !== undefined
                              ? rule.qtyInput
                              : rule.qtyRequired > 0
                                ? String(rule.qtyRequired)
                                : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                            const n = parseFloat(raw);
                            const qtyRequired = raw === '' || Number.isNaN(n) ? 0 : n;
                            const updated = [...consumptionRules];
                            updated[index] = {
                              ...updated[index],
                              qtyRequired,
                              qtyInput: raw,
                            };
                            setConsumptionRules(updated);
                          }}
                          onBlur={() => {
                            const row = consumptionRules[index];
                            if (row?.qtyInput === undefined) return;
                            const n = parseFloat(row.qtyInput);
                            const updated = [...consumptionRules];
                            if (Number.isFinite(n) && n > 0) {
                              updated[index] = {
                                ...row,
                                qtyRequired: n,
                                qtyInput: undefined,
                              };
                            } else {
                              updated[index] = {
                                ...row,
                                qtyRequired: 0,
                                qtyInput: undefined,
                              };
                            }
                            setConsumptionRules(updated);
                          }}
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
