'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getWorkOrderById,
  updateWorkOrder,
  getMaterialPlan,
  computePlannedQtyFromConsumption,
  suggestFabricRollAllocation,
  getAvailableFabricRolls
} from '@/app/actions/production';
import { getItemsByType, getConsumptionRules, getItemById } from '@/app/actions/items';
import { getPOs } from '@/app/actions/purchase-orders';
import { ItemType } from '@prisma/client';

interface TailorSupplier {
  id: string;
  code: string;
  name: string;
  type?: { id: string; code: string; name: string } | null;
}

interface FinishedGood {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  uom: { id: string; code: string };
  variants?: Array<Record<string, string>>;
}

interface ConsumptionRuleOption {
  materialId: string;
  materialName: string;
  uomCode: string;
}

interface ConsumptionResult {
  plannedQty: number;
  remainder: number;
  actualConsumption: number;
  uomCode: string;
}

interface MaterialPlanRow {
  itemId: string;
  itemName: string;
  uomCode: string;
  qtyRequired: number;
  wastePercent: number;
  plannedQty: number;
  availableStock: number;
  shortage: number;
}

interface WorkOrderStepForm {
  sequence: number;
  supplierId: string;
  stepName: string;
  servicePrice: number;
  servicePpnIncluded: boolean;
  qty: number;
  notes?: string;
}

type WO = Awaited<ReturnType<typeof getWorkOrderById>>;

export default function EditWorkOrderPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const t = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const router = useRouter();
  const { data: session } = useSession();
  const [wo, setWO] = useState<WO>(null);
  const [isLoadingWO, setIsLoadingWO] = useState(true);
  const prefillDoneRef = useRef(false);
  const consumptionPrefillDoneRef = useRef(false);

  const [tailors, setTailors] = useState<TailorSupplier[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [materialPlan, setMaterialPlan] = useState<MaterialPlanRow[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isLoadingFG, setIsLoadingFG] = useState(true);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuggestingRolls, setIsSuggestingRolls] = useState(false);

  const [vendorId, setVendorId] = useState('');
  const [finishedGoodId, setFinishedGoodId] = useState('');
  const [outputMode, setOutputMode] = useState<'GENERIC' | 'SKU'>('GENERIC');
  const [consumptionRules, setConsumptionRules] = useState<ConsumptionRuleOption[]>([]);
  const [consumptionMaterialId, setConsumptionMaterialId] = useState('');
  const [consumptionInput, setConsumptionInput] = useState('');
  const [consumptionInputDebounced, setConsumptionInputDebounced] = useState('');
  const [consumptionResult, setConsumptionResult] = useState<ConsumptionResult | null>(null);
  const [isComputingConsumption, setIsComputingConsumption] = useState(false);
  const consumptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const DEBOUNCE_MS = 1500;
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rollBreakdown, setRollBreakdown] = useState<Array<{ rollRef: string; qty: number; notes?: string }>>([]);
  const [availableRolls, setAvailableRolls] = useState<Array<{ rollId: string; rollCode: string; rollRef: string; remainingLength: number }>>([]);
  const [addRollValue, setAddRollValue] = useState('');
  const [poId, setPoId] = useState('');
  const [purchaseOrders, setPurchaseOrders] = useState<Array<{ id: string; docNumber: string }>>([]);
  const [isLoadingPOs, setIsLoadingPOs] = useState(true);
  const [selectedVariantSku, setSelectedVariantSku] = useState('');
  const [selectedVariantAttributes, setSelectedVariantAttributes] = useState<Record<string, string> | null>(null);
  const [variantRatios, setVariantRatios] = useState<Array<{ variantSku: string; ratioPercent: number }>>([]);
  const [finishedGoodVariants, setFinishedGoodVariants] = useState<Array<{ sku?: string; attributes: Record<string, string> }>>([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);
  const [steps, setSteps] = useState<WorkOrderStepForm[]>([]);

  const plannedNum = consumptionResult?.plannedQty ?? 0;

  useEffect(() => {
    if (!id) return;
    getWorkOrderById(id)
      .then((data) => {
        setWO(data);
        if (data && data.status !== 'DRAFT') {
          router.replace('/backoffice/work-orders');
          return;
        }
      })
      .catch(() => {
        toast.error(t('failedToLoadData'));
        router.replace('/backoffice/work-orders');
      })
      .finally(() => setIsLoadingWO(false));
  }, [id, router, t]);

  useEffect(() => {
    const load = async () => {
      try {
        const [suppliersRes, fgList, posResult] = await Promise.all([
          fetch('/api/suppliers?approvedOnly=true'),
          getItemsByType(ItemType.FINISHED_GOOD),
          getPOs({ statusIn: ['SUBMITTED', 'PARTIAL'] }, { page: 1, pageSize: 200 }),
        ]);
        if (suppliersRes.ok) {
          const data = await suppliersRes.json();
          const list = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data)) ? data.data : [];
          setTailors(list as TailorSupplier[]);
        }
        setFinishedGoods((fgList as FinishedGood[]) || []);
        const pos = (posResult as { items?: Array<{ id: string; docNumber: string }> })?.items ?? [];
        setPurchaseOrders(pos);
      } catch {
        toast.error(t('failedToLoadData'));
      } finally {
        setIsLoadingSuppliers(false);
        setIsLoadingFG(false);
        setIsLoadingPOs(false);
      }
    };
    load();
  }, [t]);

  useEffect(() => {
    if (!wo || wo.status !== 'DRAFT' || !tailors.length || !finishedGoods.length) return;
    if (prefillDoneRef.current) return;
    prefillDoneRef.current = true;

    const w = wo as any;
    setVendorId(w.vendorId ?? '');
    setFinishedGoodId(w.finishedGoodId ?? '');
    setOutputMode((w.outputMode ?? 'GENERIC') as 'GENERIC' | 'SKU');
    setTargetDate(w.targetDate ? new Date(w.targetDate).toISOString().slice(0, 10) : '');
    setNotes(w.notes ?? '');
    setPoId(w.poId ?? '');
    const rolls = Array.isArray(w.rollBreakdown) ? w.rollBreakdown : [];
    setRollBreakdown(rolls.map((r: { rollRef?: string; qty?: number; notes?: string }) => ({
      rollRef: r.rollRef ?? '',
      qty: typeof r.qty === 'number' ? r.qty : 0,
      notes: r.notes,
    })));

    const stepList = Array.isArray(w.steps) ? w.steps : [];
    setSteps(stepList.map((s: { sequence: number; supplierId: string; stepName?: string; servicePrice?: number; servicePpnIncluded?: boolean; qty?: number; notes?: string }) => ({
      sequence: s.sequence,
      supplierId: s.supplierId ?? '',
      stepName: s.stepName ?? '',
      servicePrice: Number(s.servicePrice) || 0,
      servicePpnIncluded: s.servicePpnIncluded ?? false,
      qty: Number(s.qty) || 0,
      notes: s.notes ?? '',
    })).sort((a: WorkOrderStepForm, b: WorkOrderStepForm) => a.sequence - b.sequence));

    // Variant (SKU) selection is applied after variants load (see variants effect) so options exist first
  }, [wo, tailors.length, finishedGoods.length]);

  useEffect(() => {
    if (!finishedGoodId) {
      setConsumptionRules([]);
      setConsumptionMaterialId('');
      setConsumptionInput('');
      setConsumptionResult(null);
      return;
    }
    getConsumptionRules(finishedGoodId)
      .then((rules) => {
        setConsumptionRules(
          rules.map((r: { materialId: string; material: { nameId: string; uom: { code: string } } }) => ({
            materialId: r.materialId,
            materialName: r.material.nameId,
            uomCode: r.material.uom.code,
          }))
        );
        setConsumptionMaterialId('');
        setConsumptionInput('');
        setConsumptionInputDebounced('');
        setConsumptionResult(null);
      })
      .catch(() => {
        setConsumptionRules([]);
        toast.error(t('failedToLoadData'));
      });
  }, [finishedGoodId, t]);

  useEffect(() => {
    if (!wo || wo.status !== 'DRAFT' || !finishedGoodId || consumptionRules.length === 0) return;
    if (consumptionPrefillDoneRef.current) return;
    const w = wo as any;
    if (w.finishedGoodId !== finishedGoodId) return;
    const cMid = w.consumptionMaterialId ?? '';
    const expConsumption = w.expectedConsumption;
    if (!cMid || expConsumption == null) return;

    consumptionPrefillDoneRef.current = true;
    setConsumptionMaterialId(cMid);
    const val = String(expConsumption);
    setConsumptionInput(val);
    setConsumptionInputDebounced(val);
    setIsComputingConsumption(true);
    computePlannedQtyFromConsumption(w.finishedGoodId, cMid, Number(expConsumption))
      .then(setConsumptionResult)
      .catch(() => setConsumptionResult(null))
      .finally(() => setIsComputingConsumption(false));
  }, [wo, finishedGoodId, consumptionRules.length]);

  useEffect(() => {
    if (!finishedGoodId || outputMode !== 'SKU') {
      setFinishedGoodVariants([]);
      setSelectedVariantSku('');
      setSelectedVariantAttributes(null);
      return;
    }
    setIsLoadingVariants(true);
    getItemById(finishedGoodId)
      .then((item: { variants?: unknown } | null) => {
        const raw = item?.variants;
        const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })() : [];
        const variants = list.map((v: Record<string, string>) => {
          const { sku: vs, ...attrs } = v;
          return { sku: vs, attributes: attrs };
        });
        setFinishedGoodVariants(variants);
        if (wo && wo.status === 'DRAFT') {
          const sku = (wo as { skuBreakdown?: { variantSku?: string; attributes?: Record<string, string> } | Array<{ variantSku: string; ratioPercent: number }> }).skuBreakdown;
          if (Array.isArray(sku) && sku.length > 0) {
            setVariantRatios(sku.map((x) => ({ variantSku: x.variantSku, ratioPercent: Number(x.ratioPercent) || 0 })));
            setSelectedVariantSku('');
          } else if (sku && typeof sku === 'object' && 'variantSku' in sku && sku.variantSku) {
            setSelectedVariantSku(sku.variantSku);
            setSelectedVariantAttributes((sku as { attributes?: Record<string, string> }).attributes ?? null);
            setVariantRatios([]);
          } else {
            setVariantRatios([]);
          }
        } else if (variants.length > 1) {
          const equal = Math.floor(100 / variants.length);
          const remainder = 100 - equal * variants.length;
          setVariantRatios(variants.map((v, i) => ({ variantSku: v.sku ?? `variant-${i}`, ratioPercent: i === 0 ? equal + remainder : equal })));
        } else {
          setVariantRatios([]);
        }
      })
      .catch(() => setFinishedGoodVariants([]))
      .finally(() => setIsLoadingVariants(false));
  }, [finishedGoodId, outputMode, wo]);

  useEffect(() => {
    if (consumptionDebounceRef.current) clearTimeout(consumptionDebounceRef.current);
    consumptionDebounceRef.current = setTimeout(() => {
      setConsumptionInputDebounced(consumptionInput);
      consumptionDebounceRef.current = null;
    }, DEBOUNCE_MS);
    return () => {
      if (consumptionDebounceRef.current) clearTimeout(consumptionDebounceRef.current);
    };
  }, [consumptionInput]);

  useEffect(() => {
    if (!finishedGoodId || !consumptionMaterialId || consumptionInputDebounced === '') {
      if (!prefillDoneRef.current) return;
      setConsumptionResult(null);
      return;
    }
    const amount = Number(consumptionInputDebounced);
    if (!Number.isFinite(amount) || amount <= 0) {
      setConsumptionResult(null);
      return;
    }
    let cancelled = false;
    setIsComputingConsumption(true);
    computePlannedQtyFromConsumption(finishedGoodId, consumptionMaterialId, amount)
      .then((res) => {
        if (!cancelled) setConsumptionResult(res);
      })
      .catch(() => {
        if (!cancelled) setConsumptionResult(null);
      })
      .finally(() => {
        if (!cancelled) setIsComputingConsumption(false);
      });
    return () => { cancelled = true; };
  }, [finishedGoodId, consumptionMaterialId, consumptionInputDebounced, t]);

  useEffect(() => {
    if (!finishedGoodId || plannedNum <= 0) {
      setMaterialPlan([]);
      return;
    }
    let cancelled = false;
    setIsLoadingPlan(true);
    getMaterialPlan(finishedGoodId, plannedNum)
      .then((plan) => {
        if (!cancelled) setMaterialPlan(plan);
      })
      .catch(() => {
        if (!cancelled) setMaterialPlan([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPlan(false);
      });
    return () => { cancelled = true; };
  }, [finishedGoodId, plannedNum, t]);

  useEffect(() => {
    if (!consumptionMaterialId) {
      setAvailableRolls([]);
      return;
    }
    getAvailableFabricRolls(consumptionMaterialId)
      .then(setAvailableRolls)
      .catch(() => setAvailableRolls([]));
  }, [consumptionMaterialId]);

  const hasShortage = materialPlan.some((m) => m.shortage > 0);
  const rollSum = rollBreakdown.reduce((s, r) => s + r.qty, 0);
  const materialPlannedQtyForRolls = consumptionResult?.actualConsumption ?? 0;
  const rollValid = rollBreakdown.length === 0 || rollSum >= materialPlannedQtyForRolls - 1e-6;
  const variantRatioSum = variantRatios.reduce((s, x) => s + x.ratioPercent, 0);
  const skuVariantValid =
    outputMode !== 'SKU' ||
    (outputMode === 'SKU' && (variantRatios.length > 1 ? Math.abs(variantRatioSum - 100) < 0.01 : selectedVariantSku.length > 0));
  const noVariantsForSku = outputMode === 'SKU' && finishedGoodId && !isLoadingVariants && finishedGoodVariants.length === 0;
  const canSubmit =
    session?.user?.id &&
    vendorId &&
    finishedGoodId &&
    consumptionResult &&
    plannedNum > 0 &&
    !hasShortage &&
    rollValid &&
    skuVariantValid &&
    !noVariantsForSku &&
    !isSubmitting;

  const addRollBySelection = (roll: { rollId: string; rollCode: string; rollRef: string; remainingLength: number }) => {
    setRollBreakdown((prev) => [...prev, { rollRef: roll.rollCode || roll.rollRef, qty: roll.remainingLength, notes: '' }]);
  };
  const updateRollRow = (i: number, field: 'rollRef' | 'qty' | 'notes', value: string | number) => {
    setRollBreakdown((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };
  const removeRollRow = (i: number) => {
    setRollBreakdown((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSuggestRolls = async () => {
    if (!consumptionMaterialId || !consumptionResult?.actualConsumption) return;
    setIsSuggestingRolls(true);
    try {
      const suggestion = await suggestFabricRollAllocation(
        consumptionMaterialId,
        consumptionResult.actualConsumption
      );
      if (suggestion.selected.length === 0) {
        toast.error('No available fabric rolls found');
        return;
      }
      setRollBreakdown(
        suggestion.selected.map((row) => ({
          rollRef: row.rollCode ?? row.rollRef,
          qty: row.qty,
        }))
      );
      if (suggestion.unallocated > 0) {
        toast.error(`Insufficient roll stock, unallocated: ${suggestion.unallocated.toFixed(2)}`);
      } else {
        toast.success('Best-fit roll suggestion applied');
      }
    } catch {
      toast.error('Failed to suggest roll allocation');
    } finally {
      setIsSuggestingRolls(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !session?.user?.id || !id) return;
    setIsSubmitting(true);
    try {
      await updateWorkOrder(
        id,
        {
          vendorId,
          finishedGoodId,
          outputMode,
          plannedQty: plannedNum,
          expectedConsumption: consumptionInput.trim() ? Number(consumptionInput) : undefined,
          consumptionMaterialId: consumptionMaterialId || undefined,
          targetDate: targetDate ? new Date(targetDate) : undefined,
          poId: poId.trim() || undefined,
          notes: notes.trim() || undefined,
          rollBreakdown: rollBreakdown.length > 0 ? rollBreakdown : undefined,
          skuBreakdown:
            outputMode === 'SKU'
              ? variantRatios.length > 1
                ? variantRatios
                : selectedVariantSku
                  ? { variantSku: selectedVariantSku, attributes: selectedVariantAttributes ?? undefined }
                  : undefined
              : undefined,
          steps:
            steps.length > 0
              ? steps
                  .filter((step) => step.supplierId)
                  .map((step, idx) => ({
                    sequence: idx + 1,
                    supplierId: step.supplierId,
                    stepName: step.stepName || undefined,
                    servicePrice: Number(step.servicePrice || 0),
                    servicePpnIncluded: step.servicePpnIncluded ?? false,
                    qty: Number(step.qty || 0) || undefined,
                    notes: step.notes?.trim() || undefined,
                  }))
              : undefined,
        },
        session.user.id
      );
      toast.success('Work order updated');
      router.push(`/backoffice/work-orders/${id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update work order');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingWO || !wo) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (wo.status !== 'DRAFT') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/backoffice/work-orders/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Work Order</h1>
          <p className="text-muted-foreground">
            {(wo as any).docNumber} · Update draft details
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Work Order</CardTitle>
            <CardDescription>
              Select vendor (tailor) and finished good. Material needs are
              calculated from BOM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Vendor (Tailor)</Label>
                <SearchableCombobox
                  options={tailors.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder="Select vendor"
                  disabled={isLoadingSuppliers}
                />
              </div>
              <div className="space-y-2">
                <Label>Finished Good</Label>
                <SearchableCombobox
                  options={finishedGoods.map((fg) => ({ value: fg.id, label: `${fg.nameId} (${fg.sku})` }))}
                  value={finishedGoodId}
                  onValueChange={setFinishedGoodId}
                  placeholder="Select finished good"
                  disabled={isLoadingFG}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tWO('outputMode')}</Label>
                <Select
                  value={outputMode}
                  onValueChange={(v) => setOutputMode(v as 'GENERIC' | 'SKU')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERIC">{tWO('genericPieces')}</SelectItem>
                    <SelectItem value="SKU">{tWO('skuByVariant')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {outputMode === 'SKU' && finishedGoodVariants.length > 1 && (
                <div className="space-y-2">
                  <Label>Variant ratio % (sum = 100%)</Label>
                  {variantRatios.map((row, i) => (
                    <div key={row.variantSku} className="flex items-center gap-2">
                      <span className="w-48 truncate text-sm">{row.variantSku}</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={row.ratioPercent === 0 ? '' : row.ratioPercent}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setVariantRatios((prev) => prev.map((p, j) => (j === i ? { ...p, ratioPercent: v } : p)));
                        }}
                        className="w-20"
                      />
                      %
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Sum: {variantRatioSum}%</p>
                </div>
              )}
              {outputMode === 'SKU' && finishedGoodVariants.length <= 1 && (
                <div className="space-y-2">
                  <Label>{tWO('variantSku')}</Label>
                  <SearchableCombobox
                    options={finishedGoodVariants.map((v, idx) => {
                      const label = v.sku ? `${v.sku} (${Object.entries(v.attributes ?? {}).map(([k, val]) => `${k}: ${val}`).join(', ')})` : Object.entries(v.attributes ?? {}).map(([k, val]) => `${k}: ${val}`).join(', ');
                      const value = v.sku ?? `variant-${idx}`;
                      return { value, label };
                    })}
                    value={selectedVariantSku}
                    onValueChange={(val) => {
                      const v = finishedGoodVariants.find((x, i) => {
                        const valueForVariant = x.sku ?? `variant-${i}`;
                        return valueForVariant === val;
                      });
                      if (v) {
                        setSelectedVariantSku(v.sku ?? '');
                        setSelectedVariantAttributes(v.attributes ?? null);
                      }
                    }}
                    placeholder={noVariantsForSku ? tWO('noVariantsDefineFirst') : tWO('selectVariant')}
                    disabled={isLoadingVariants || finishedGoodVariants.length === 0}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>PO Reference (optional)</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: 'None' },
                    ...purchaseOrders.map((po) => ({ value: po.id, label: po.docNumber })),
                  ]}
                  value={poId || '__none__'}
                  onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
                  placeholder="None"
                  disabled={isLoadingPOs}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                rows={2}
              />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Production Steps (optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSteps((prev) => [
                      ...prev,
                      {
                        sequence: prev.length + 1,
                        supplierId: '',
                        stepName: '',
                        servicePrice: 0,
                        servicePpnIncluded: false,
                        qty: 0,
                        notes: '',
                      },
                    ])
                  }
                >
                  + Add step
                </Button>
              </div>
              {steps.map((step, index) => (
                <div key={index} className="grid gap-2 rounded border p-2 sm:grid-cols-5">
                  <Input
                    placeholder="Step name"
                    value={step.stepName}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, stepName: e.target.value } : s))
                      )
                    }
                  />
                  <SearchableCombobox
                    options={[
                      { value: '__none__', label: 'Select supplier' },
                      ...tailors.map((supplier) => ({ value: supplier.id, label: `${supplier.name} (${supplier.code})` })),
                    ]}
                    value={step.supplierId || '__none__'}
                    onValueChange={(v) =>
                      setSteps((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, supplierId: v === '__none__' ? '' : v } : s))
                      )
                    }
                    placeholder="Select supplier"
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder="Service price"
                    value={step.servicePrice || ''}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, i) =>
                          i === index ? { ...s, servicePrice: Number(e.target.value) || 0 } : s
                        )
                      )
                    }
                  />
                  <Select
                    value={step.servicePpnIncluded ? 'include' : 'exclude'}
                    onValueChange={(v) =>
                      setSteps((prev) =>
                        prev.map((s, i) =>
                          i === index ? { ...s, servicePpnIncluded: v === 'include' } : s
                        )
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="PPN" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">Exclude PPN</SelectItem>
                      <SelectItem value="include">Include PPN</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {finishedGoodId && (
          <Card>
            <CardHeader>
              <CardTitle>Material Plan</CardTitle>
              <CardDescription>
                Required materials from BOM. Creation is blocked if any shortage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {consumptionRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tWO('defineBomFirst')}</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{tWO('materialConsumptionDriver')}</Label>
                      <SearchableCombobox
                        options={consumptionRules.map((r) => ({
                          value: r.materialId,
                          label: `${r.materialName} (${r.uomCode})`,
                        }))}
                        value={consumptionMaterialId}
                        onValueChange={(v) => {
                          setConsumptionMaterialId(v);
                          setConsumptionInput('');
                          setConsumptionInputDebounced('');
                          setConsumptionResult(null);
                        }}
                        placeholder={tWO('selectMaterial')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{tWO('consumption')}</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={consumptionInput}
                          onChange={(e) => setConsumptionInput(e.target.value)}
                          placeholder={consumptionMaterialId ? consumptionRules.find((r) => r.materialId === consumptionMaterialId)?.uomCode : ''}
                          disabled={!consumptionMaterialId}
                          className={isComputingConsumption ? 'pr-9' : ''}
                        />
                        {isComputingConsumption && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden>
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </span>
                        )}
                      </div>
                    </div>
                    {(isComputingConsumption || consumptionResult) && (
                      <div className="sm:col-span-2 space-y-1 text-sm">
                        <p className="flex items-center gap-2">
                          <span className="font-medium">{tWO('plannedQtyCalculated')}:</span>
                          {isComputingConsumption ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                              <span className="text-muted-foreground">Calculating…</span>
                            </>
                          ) : (
                            <span>{plannedNum} pcs</span>
                          )}
                        </p>
                        {consumptionResult && (
                          <>
                            <p className="text-muted-foreground">
                              {tWO('actualConsumption')}: {consumptionResult.actualConsumption.toLocaleString(undefined, { maximumFractionDigits: 4 })} {consumptionResult.uomCode}
                            </p>
                            <p className="text-muted-foreground">
                              {tWO('remainder')}: {consumptionResult.remainder.toLocaleString(undefined, { maximumFractionDigits: 4 })} {consumptionResult.uomCode}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {plannedNum > 0 && (
                    <>
                      {isLoadingPlan ? (
                        <div className="py-8 text-center text-muted-foreground">
                          Loading plan...
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Material</TableHead>
                                <TableHead className="text-right">
                                  {tWO('estimatedConsumptionPerPcs')} (waste %)
                                </TableHead>
                                <TableHead className="text-right">Available</TableHead>
                                <TableHead className="text-right">Shortage</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {materialPlan.map((m) => (
                                <TableRow
                                  key={m.itemId}
                                  className={
                                    m.shortage > 0 ? 'bg-destructive/10' : undefined
                                  }
                                >
                                  <TableCell className="font-medium">
                                    {m.itemName}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.plannedQty.toLocaleString()} {m.uomCode} (
                                    {m.wastePercent}%)
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.availableStock.toLocaleString()} {m.uomCode}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.shortage > 0 ? (
                                      <span className="text-destructive font-medium">
                                        -{m.shortage.toLocaleString()} {m.uomCode}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {hasShortage && (
                        <p className="text-sm text-destructive">
                          Stok tidak mencukupi. Tambah stok atau kurangi qty rencana.
                        </p>
                      )}

                      <div className="space-y-2 border-t pt-4">
                        <Label>Alokasi per roll (opsional)</Label>
                        <p className="text-xs text-muted-foreground">
                          Total qty per roll minimal sama dengan kebutuhan material ({consumptionResult ? `${materialPlannedQtyForRolls.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${consumptionResult.uomCode}` : '—'}). Boleh melebihi.
                        </p>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Roll / Ref</TableHead>
                                <TableHead className="text-right">Qty (whole roll)</TableHead>
                                <TableHead>Notes</TableHead>
                                <TableHead className="w-12" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rollBreakdown.map((row, i) => (
                                <TableRow key={i}>
                                  <TableCell className="font-medium">{row.rollRef}</TableCell>
                                  <TableCell className="text-right">{Number(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                  <TableCell>
                                    <Input
                                      value={row.notes ?? ''}
                                      onChange={(e) => updateRollRow(i, 'notes', e.target.value)}
                                      placeholder="Optional"
                                      className="h-8"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => removeRollRow(i)}
                                    >
                                      ×
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SearchableCombobox
                            options={availableRolls
                              .filter((r) => !rollBreakdown.some((b) => b.rollRef === r.rollCode || b.rollRef === r.rollRef))
                              .map((r) => ({
                                value: r.rollId,
                                label: `${r.rollCode} — ${r.remainingLength.toLocaleString()} remaining`,
                              }))}
                            value={addRollValue}
                            onValueChange={(value) => {
                              const roll = availableRolls.find((r) => r.rollId === value);
                              if (roll) {
                                addRollBySelection(roll);
                                setAddRollValue('');
                              }
                            }}
                            placeholder="Add roll..."
                            emptyMessage="No more rolls"
                            triggerClassName="w-[280px]"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSuggestRolls}
                            disabled={!consumptionMaterialId || isSuggestingRolls}
                          >
                            {isSuggestingRolls ? 'Suggesting...' : 'Suggest best-fit'}
                          </Button>
                        </div>
                        {rollBreakdown.length > 0 && (
                          <p className="text-sm">
                            Total allocated: {rollSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}{consumptionResult ? ` ${consumptionResult.uomCode}` : ''}.
                            {rollSum >= materialPlannedQtyForRolls - 1e-6
                              ? ` +${(rollSum - materialPlannedQtyForRolls).toLocaleString(undefined, { maximumFractionDigits: 2 })} over`
                              : ` ${(rollSum - materialPlannedQtyForRolls).toLocaleString(undefined, { maximumFractionDigits: 2 })} short`}
                          </p>
                        )}
                        {rollBreakdown.length > 0 && !rollValid && (
                          <p className="text-sm text-destructive">
                            Total roll ({rollSum.toLocaleString(undefined, { maximumFractionDigits: 4 })}{consumptionResult ? ` ${consumptionResult.uomCode}` : ''}) kurang dari kebutuhan material ({consumptionResult ? `${materialPlannedQtyForRolls.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${consumptionResult.uomCode}` : '—'}).
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-4">
          <Button type="submit" disabled={!canSubmit}>
            {isSubmitting ? 'Updating...' : 'Update Work Order'}
          </Button>
          <Link href={`/backoffice/work-orders/${id}`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
