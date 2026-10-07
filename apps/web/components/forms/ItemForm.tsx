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
import { Plus, Trash2, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  buildVariantBarcode,
  type VariantBarcodeFormatConfig,
} from '@/lib/items/variant-barcode';
import Link from "next/link";
import { pilihanTabelUkuranAction } from "@/app/actions/size-charts";
import { BATAS_INFO_PRODUK } from "@/lib/items/info-produk";
import type { PilihanTabelUkuran } from "@/lib/items/size-chart-queries";
import { rapikanNamaBarang } from "@/app/backoffice/items/nama-barang";

type ItemFormData = z.infer<typeof itemSchema>;
/** Info produk untuk pembeli (barang jadi): bahan, cara rawat, tabel ukuran (null = ikut bawaan kategori). */
type InfoProdukIsian = { material?: string | null; careInstructions?: string | null; sizeChartId?: string | null };
/** Nilai pilihan "ikut bawaan kategori" di pemilih tabel ukuran. */
const IKUT_KATEGORI = "__kategori__";
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

/** Normalize attribute value for variant SKU segment (e.g. red → RED, light blue → LIGHTBLUE). */
function slugVariantAttributeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

/**
 * Pattern: `{base}-{v1}-…-{vn}` with n = number of attribute columns (e.g. OUTERWEAR-RED-S).
 * Base is the item category code when the category has one; otherwise the parent item SKU (server accepts both prefixes).
 */
/** Parse number inputs; blank or invalid → 0 (avoids NaN from valueAsNumber). */
function parseNumberFieldDefaultZero(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function buildVariantSkuCode(
  basePrefix: string,
  combo: Record<string, string>,
  orderedAttributeKeys: string[]
): string {
  const base = basePrefix.trim();
  const segments = orderedAttributeKeys
    .map((key) => slugVariantAttributeValue(combo[key] ?? ''))
    .filter((s) => s.length > 0);
  if (!base) return segments.join('-');
  if (segments.length === 0) return base;
  return `${base}-${segments.join('-')}`;
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
    material?: string | null;
    careInstructions?: string | null;
    sizeChartId?: string | null;
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
  onSubmit: (data: ItemFormData & InfoProdukIsian, consumptionRules?: ConsumptionRuleData[]) => Promise<void>;
  isLoading?: boolean;
}

export function ItemForm({ initialData, onSubmit, isLoading = false }: ItemFormProps) {
  const tValidation = useTranslations('validation');
  const tToasts = useTranslations('toasts');
  const tInfo = useTranslations("itemProductInfo");
  const tForm = useTranslations('itemForm');
  const locale = useLocale();
  // Nama Inggris tidak wajib: kosong diisi nama Indonesia saat disimpan (rapikanNamaBarang).
  const itemSchemaT = useMemo(
    () => createItemSchema((k) => tValidation(k)).extend({ nameEn: z.string().optional() }),
    [tValidation]
  );
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

  const initialAttributes = useMemo(() => {
    if (normalizedVariants.length === 0) return [];
    const map = new Map<string, Set<string>>();
    normalizedVariants.forEach((variant) => {
      Object.entries(variant).forEach(([key, value]) => {
        // Exclude reserved keys — not variant attributes
        if (key === 'sku' || key === 'barcode') return;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(value);
      });
    });
    return Array.from(map.entries()).map(([key, values]) => ({
      key,
      values: Array.from(values),
    }));
  }, [normalizedVariants]);
  const [attributes, setAttributes] = useState<Array<{ key: string; values: string[] }>>(
    initialAttributes
  );
  const [variantSkus, setVariantSkus] = useState<string[]>([]);
  const [variantBarcodes, setVariantBarcodes] = useState<string[]>([]);
  const [barcodeFormatConfig, setBarcodeFormatConfig] = useState<VariantBarcodeFormatConfig | null>(
    null
  );
  const [itemTypeMasters, setItemTypeMasters] = useState<Awaited<ReturnType<typeof getItemTypeMasters>>>([]);
  const [material, setMaterial] = useState(initialData?.material ?? "");
  const [careInstructions, setCareInstructions] = useState(initialData?.careInstructions ?? "");
  const [sizeChartId, setSizeChartId] = useState(initialData?.sizeChartId ?? "");
  const [pilihanTabel, setPilihanTabel] = useState<PilihanTabelUkuran[]>([]);

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
    pilihanTabelUkuranAction(initialData?.sizeChartId ?? null)
      .then((h) => {
        if (h.ok) setPilihanTabel(h.data);
      })
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

  const tabelBawaan = useMemo(() => {
    const kat = (watchedCategoryId ?? "").trim();
    return kat ? (pilihanTabel.find((p) => p.isActive && p.categoryId === kat) ?? null) : null;
  }, [watchedCategoryId, pilihanTabel]);

  const parentSku = (initialData?.sku ?? sku) || '';
  const variantSkuBasePrefix = categoryCodePrefix || parentSku.trim();

  const applyVariantSkuCodeAt = (idx: number) => {
    if (!variantSkuBasePrefix) {
      toast.error(tToasts('setParentSkuBeforeVariantCode'));
      return;
    }
    const combo = variantCombinations[idx];
    if (!combo) return;
    const keys = attributes.map((a) => a.key).filter((k) => k.trim());
    const code = buildVariantSkuCode(variantSkuBasePrefix, combo, keys);
    setVariantSkus((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push('');
      next[idx] = code;
      return next;
    });
  };

  const applyVariantBarcodeAt = (idx: number) => {
    if (!barcodeFormatConfig) return;
    if (!categoryCodePrefix && !parentSku.trim()) {
      toast.error(tToasts('setParentSkuBeforeBarcode'));
      return;
    }
    const combo = variantCombinations[idx];
    if (!combo) return;
    const keys = attributes.map((a) => a.key).filter((k) => k.trim());
    const code = buildVariantBarcode(barcodeFormatConfig, {
      parentSku: parentSku.trim(),
      categoryCode: categoryCodePrefix,
      combo,
      orderedAttributeKeys: keys,
    });
    setVariantBarcodes((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push('');
      next[idx] = code;
      return next;
    });
  };

  const applyAllVariantCodes = () => {
    if (!variantSkuBasePrefix) {
      toast.error(tToasts('setParentSkuBeforeVariantCode'));
      return;
    }
    if (!barcodeFormatConfig) return;
    const keys = attributes.map((a) => a.key).filter((k) => k.trim());
    setVariantSkus(
      variantCombinations.map((combo) => buildVariantSkuCode(variantSkuBasePrefix, combo, keys))
    );
    setVariantBarcodes(
      variantCombinations.map((combo) =>
        buildVariantBarcode(barcodeFormatConfig, {
          parentSku: parentSku.trim(),
          categoryCode: categoryCodePrefix,
          combo,
          orderedAttributeKeys: keys,
        })
      )
    );
  };

  const variantCombinationsKey = useMemo(
    () => variantCombinations.map((c) => JSON.stringify(c)).join('|'),
    [variantCombinations]
  );
  useEffect(() => {
    if (variantCombinations.length === 0) {
      setVariantSkus([]);
      setVariantBarcodes([]);
      return;
    }
    setVariantSkus((prev) => {
      const next = [...prev];
      while (next.length < variantCombinations.length) next.push('');
      const trimmed = next.slice(0, variantCombinations.length);
      if (!normalizedVariants.length) return trimmed;
      return trimmed.map((current, idx) => {
        const combo = variantCombinations[idx];
        const match = normalizedVariants.find((v) => {
          const { sku, barcode, ...rest } = v;
          void sku;
          void barcode;
          return Object.keys(combo).every((k) => rest[k] === combo[k]);
        });
        return match?.sku?.trim() ?? current;
      });
    });
    setVariantBarcodes((prev) => {
      const next = [...prev];
      while (next.length < variantCombinations.length) next.push('');
      const trimmed = next.slice(0, variantCombinations.length);
      if (!normalizedVariants.length) return trimmed;
      return trimmed.map((current, idx) => {
        const combo = variantCombinations[idx];
        const match = normalizedVariants.find((v) => {
          const { sku, barcode, ...rest } = v;
          void sku;
          void barcode;
          return Object.keys(combo).every((k) => rest[k] === combo[k]);
        });
        return match?.barcode?.trim() ?? current;
      });
    });
  }, [variantCombinationsKey, variantCombinations, normalizedVariants]);

  const onFormSubmit = async (data: ItemFormData) => {
    const dataWithSku: ItemFormData = rapikanNamaBarang({
      ...data,
      sku: sku || undefined,
    });

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

    const variantSkuPrefixes = [
      categoryCodePrefix,
      parentSku.trim(),
    ].filter((p, i, arr) => p && arr.indexOf(p) === i);

    const variants =
      variantCombinations.length > 0
        ? variantCombinations.map((combo, i) => {
            let variantSku = variantSkus[i]?.trim() || '';
            const variantBarcode = variantBarcodes[i]?.trim() || '';
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
            return {
              ...combo,
              ...(variantSku ? { sku: variantSku } : {}),
              ...(variantBarcode ? { barcode: variantBarcode } : {}),
            };
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

    // Info produk hanya untuk barang jadi; jenis lain tidak menyentuh kolomnya.
    const infoProduk: InfoProdukIsian =
      itemType === ItemType.FINISHED_GOOD
        ? { material: material.trim() || null, careInstructions: careInstructions.trim() || null, sizeChartId: sizeChartId || null }
        : {};

    await onSubmit(
      { ...dataWithSku, variants, ...infoProduk },
      itemType === ItemType.FINISHED_GOOD ? stripConsumptionRuleRows(consumptionRules) : undefined
    );
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      {/* Informasi dasar */}
      <Card>
        <CardHeader>
          <CardTitle>{tForm('basicInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SKU */}
          <div className="space-y-2">
            <Label htmlFor="sku">{tForm('sku')}</Label>
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
                    tForm('skuGenerate')
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Bilingual Names */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nameId">{tForm('nameId')} *</Label>
              <Input
                id="nameId"
                {...register('nameId')}
                placeholder={tForm('nameIdPlaceholder')}
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
              <Label htmlFor="nameEn">
                {tForm('nameEn')} <span className="text-xs text-muted-foreground">({tForm('optional')})</span>
              </Label>
              <Input
                id="nameEn"
                {...register('nameEn')}
                placeholder={tForm('nameEnPlaceholder')}
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
              <Label htmlFor="type">{tForm('type')} *</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <SearchableCombobox
                    id="type"
                    options={
                      itemTypeMasters.length > 0
                        ? itemTypeMasters.map((m) => ({ value: m.code, label: locale === 'en' ? m.nameEn : m.nameId }))
                        : [
                            { value: ItemType.FABRIC, label: tForm('typeName.FABRIC') },
                            { value: ItemType.ACCESSORIES, label: tForm('typeName.ACCESSORIES') },
                            { value: ItemType.FINISHED_GOOD, label: tForm('typeName.FINISHED_GOOD') },
                          ]
                    }
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={tForm('typePlaceholder')}
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
              <Label htmlFor="uomId">{tForm('uom')} *</Label>
              <Controller
                name="uomId"
                control={control}
                render={({ field }) => (
                  <SearchableCombobox
                    id="uomId"
                    options={uoms.map((uom) => ({
                      value: uom.id,
                      label: `${uom.code} - ${locale === 'en' ? uom.nameEn : uom.nameId}`,
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={tForm('uomPlaceholder')}
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
              <Label htmlFor="categoryId">{tForm('category')}</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <SearchableCombobox
                    id="categoryId"
                    options={[
                      { value: '__none__', label: tForm('noCategory') },
                      ...itemCategories.map((category) => ({
                        value: category.id,
                        label: (category.code ? `${category.code} - ` : '') + category.name,
                      })),
                    ]}
                    value={field.value || '__none__'}
                    onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}
                    placeholder={tForm('categoryPlaceholder')}
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="overReceiveThreshold">{tForm('overReceive')}</Label>
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
            <Label htmlFor="description">{tForm('description')}</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder={tForm('descriptionPlaceholder')}
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
            <Label htmlFor="reorderPoint">{tForm('reorderPoint')}</Label>
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
                <Label htmlFor="sellingPrice">{tForm('sellingPrice')}</Label>
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
                  {tForm('targetMargin')} <span className="text-xs text-muted-foreground">({tForm('optional')})</span>
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
                  {tForm('targetMarginHint')}
                </p>
                {errors.targetMarginPercent && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.targetMarginPercent.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="additionalCost">
                  {tForm('additionalCost')} <span className="text-xs text-muted-foreground">({tForm('optional')})</span>
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
                  {tForm('additionalCostHint')}
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

      {/* Info produk untuk pembeli — dibaca SPG di HP (Info produk). */}
      {itemType === ItemType.FINISHED_GOOD && (
        <Card>
          <CardHeader>
            <CardTitle>{tInfo("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="material">{tInfo("material")}</Label>
              <Input
                id="material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder={tInfo("materialPlaceholder")}
                maxLength={BATAS_INFO_PRODUK.material}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="careInstructions">{tInfo("care")}</Label>
              <Textarea
                id="careInstructions"
                value={careInstructions}
                onChange={(e) => setCareInstructions(e.target.value)}
                placeholder={tInfo("carePlaceholder")}
                maxLength={BATAS_INFO_PRODUK.careInstructions}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sizeChartId">{tInfo("sizeChart")}</Label>
              <SearchableCombobox
                id="sizeChartId"
                options={[
                  {
                    value: IKUT_KATEGORI,
                    label: tabelBawaan
                      ? tInfo("followCategoryNamed", { name: tabelBawaan.name })
                      : tInfo("followCategory"),
                  },
                  ...pilihanTabel.map((p) => ({
                    value: p.id,
                    label: p.isActive ? p.name : tInfo("inactiveChart", { name: p.name }),
                  })),
                ]}
                value={sizeChartId || IKUT_KATEGORI}
                onValueChange={(v) => setSizeChartId(v === IKUT_KATEGORI ? "" : v)}
                placeholder={tInfo("followCategory")}
              />
              <p className="text-xs text-muted-foreground">
                {sizeChartId
                  ? tInfo("ownChartHelp")
                  : tabelBawaan
                    ? tInfo("categoryChartHelp", { name: tabelBawaan.name })
                    : tInfo("noCategoryChartHelp")}{" "}
                <Link href="/backoffice/items/size-charts" className="font-medium text-primary underline-offset-4 hover:underline">
                  {tInfo("manageLink")}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Variants */}
      <Card>
        <CardHeader>
          <CardTitle>{tForm('variantsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            {attributes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tForm('noAttributes')}</p>
            ) : (
              <span />
            )}
            <Button type="button" variant="outline" onClick={addAttribute}>
              <Plus className="h-4 w-4 mr-2" />
              {tForm('addAttribute')}
            </Button>
          </div>

          {attributes.map((attr, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-2">
                <Label>{tForm('attributeName')}</Label>
                <Input
                  value={attr.key}
                  onChange={(e) => updateAttributeKey(index, e.target.value)}
                  placeholder={tForm('attributeNamePlaceholder')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{tForm('attributeValues')}</Label>
                <div className="flex gap-2">
                  <TagsInput
                    value={attr.values}
                    onChange={(values) => {
                      const updated = [...attributes];
                      updated[index] = { ...updated[index], values };
                      setAttributes(updated);
                    }}
                    placeholder={tForm('attributeValuesPlaceholder')}
                    separator={[',', '\n']}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAttribute(index)}
                    aria-label={tForm('removeAttribute')}
                    title={tForm('removeAttribute')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {variantCombinations.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {variantSkuBasePrefix
                    ? tForm('variantSkuHint', { contoh: `${variantSkuBasePrefix}-MERAH-S` })
                    : tForm('variantSkuNoPrefix')}
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
                  {tForm('generateAll')}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {attributes.map((attr) => (
                      <TableHead key={attr.key}>{attr.key}</TableHead>
                    ))}
                    <TableHead className="min-w-56">{tForm('colVariantSku')}</TableHead>
                    <TableHead className="min-w-56">{tForm('colBarcode')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variantCombinations.map((combo, idx) => (
                    <TableRow key={idx}>
                      {attributes.map((attr) => (
                        <TableCell key={attr.key}>{combo[attr.key] ?? '—'}</TableCell>
                      ))}
                      <TableCell>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="min-w-0 flex-1 font-mono text-sm"
                            value={variantSkus[idx] ?? ''}
                            onChange={(e) => {
                              const next = [...variantSkus];
                              while (next.length <= idx) next.push('');
                              next[idx] = e.target.value;
                              setVariantSkus(next);
                            }}
                            placeholder={variantSkuBasePrefix ? `${variantSkuBasePrefix}-…` : tForm('variantSkuPlaceholder')}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => applyVariantSkuCodeAt(idx)}
                            disabled={!variantSkuBasePrefix}
                            title={
                              variantSkuBasePrefix
                                ? tForm('skuButtonTitle', { awalan: variantSkuBasePrefix })
                                : tForm('variantSkuNoPrefix')
                            }
                          >
                            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                            {tForm('generateCode')}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="min-w-0 flex-1 font-mono text-sm"
                            value={variantBarcodes[idx] ?? ''}
                            onChange={(e) => {
                              const next = [...variantBarcodes];
                              while (next.length <= idx) next.push('');
                              next[idx] = e.target.value;
                              setVariantBarcodes(next);
                            }}
                            placeholder={tForm('barcodePlaceholder')}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => applyVariantBarcodeAt(idx)}
                            disabled={!barcodeFormatConfig}
                            title={tForm('barcodeButtonTitle')}
                          >
                            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                            {tForm('generateCode')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
            <CardTitle>{tForm('bomTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              {consumptionRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tForm('noBom')}</p>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addConsumptionRule}
              >
                <Plus className="h-4 w-4 mr-2" />
                {tForm('addMaterial')}
              </Button>
            </div>

            {consumptionRules.length === 0 ? null : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tForm('colMaterial')}</TableHead>
                    <TableHead>{tForm('colQtyRequired')}</TableHead>
                    <TableHead>{tForm('colWaste')}</TableHead>
                    <TableHead>{tForm('colNotes')}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{tForm('removeMaterial')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionRules.map((rule, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <SearchableCombobox
                          options={materials.map((material) => ({
                            value: material.id,
                            label: `${material.sku} - ${locale === 'en' ? material.nameEn : material.nameId}`,
                          }))}
                          value={rule.materialId}
                          onValueChange={(value) =>
                            updateConsumptionRule(index, 'materialId', value)
                          }
                          placeholder={tForm('selectMaterial')}
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
                          placeholder={tForm('notesPlaceholder')}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeConsumptionRule(index)}
                          aria-label={tForm('removeMaterial')}
                          title={tForm('removeMaterial')}
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

      {/* Tombol simpan */}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {initialData ? tForm('submitUpdate') : tForm('submitCreate')}
        </Button>
      </div>
    </form>
  );
}
