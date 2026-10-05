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
  CardHeader,
  CardTitle,
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
import { DatePicker } from '@/components/ui/date-picker';
import { formatDateOnly, parseDateOnly } from '@/lib/date-only';
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
import { previewChainDays } from '@/app/actions/lead-time';
import { EtaSuggestionHint } from '@/components/lead-time/eta-suggestion-hint';
import { getItemsByType, getConsumptionRules, getItemById } from '@/app/actions/items';
import { getPOs, getPOById } from '@/app/actions/purchase-orders';
import { ItemType } from '@/lib/constants/enums';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';

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
  const tF = useTranslations('workOrders.form');
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
  const [targetTouched, setTargetTouched] = useState(false);
  const [targetPreview, setTargetPreview] = useState<{
    totalDays: number;
    suggestedEta: Date;
    supplierCode: string;
  } | null>(null);
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
        const { getSuppliersForSelect } = await import('@/app/actions/suppliers');
        const [supplierData, fgList, openPos, closedPos] = await Promise.all([
          getSuppliersForSelect({ approvedOnly: true }),
          getItemsByType(ItemType.FINISHED_GOOD),
          getPOs({ statusIn: ["SUBMITTED", "PARTIAL"] }, { page: 1, pageSize: 200 }),
          getPOs({ statusIn: ["CLOSED", "OVER"] }, { page: 1, pageSize: 200 }),
        ]);
        const list = Array.isArray(supplierData) ? supplierData : [];
        setTailors(list as TailorSupplier[]);
        setFinishedGoods((fgList as FinishedGood[]) || []);
        const openItems = (openPos as { items?: Array<{ id: string; docNumber: string }> })?.items ?? [];
        const closedItems = (closedPos as { items?: Array<{ id: string; docNumber: string }> })?.items ?? [];
        const seen = new Set(openItems.map((p) => p.id));
        setPurchaseOrders([...openItems, ...closedItems.filter((p) => !seen.has(p.id))]);
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
    const linkedPoId = (wo as { poId?: string | null } | null)?.poId;
    if (!linkedPoId) return;
    if (purchaseOrders.some((p) => p.id === linkedPoId)) return;
    getPOById(linkedPoId)
      .then((po) => {
        if (!po) return;
        setPurchaseOrders((prev) =>
          prev.some((p) => p.id === po.id)
            ? prev
            : [{ id: po.id, docNumber: po.docNumber }, ...prev]
        );
      })
      .catch(() => undefined);
  }, [wo, purchaseOrders]);

  useEffect(() => {
    if (!wo || wo.status !== 'DRAFT' || !tailors.length || !finishedGoods.length) return;
    if (prefillDoneRef.current) return;
    prefillDoneRef.current = true;

    const w = wo as any;
    setVendorId(w.vendorId ?? '');
    setFinishedGoodId(w.finishedGoodId ?? '');
    setOutputMode((w.outputMode ?? 'GENERIC') as 'GENERIC' | 'SKU');
    setTargetDate(w.targetDate ? formatDateOnly(new Date(w.targetDate)) : '');
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
    if (!vendorId) {
      setTargetPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const preview = await previewChainDays(
            vendorId,
            plannedNum > 0 ? plannedNum : null
          );
          if (preview.totalDays <= 0 || !preview.suggestedEta) {
            setTargetPreview(null);
            return;
          }
          const vendor = tailors.find((x) => x.id === vendorId);
          const suggested = new Date(preview.suggestedEta);
          setTargetPreview({
            totalDays: preview.totalDays,
            suggestedEta: suggested,
            supplierCode: vendor?.code ?? "",
          });
          if (!targetTouched && !targetDate) {
            setTargetDate(formatDateOnly(suggested));
          }
        } catch {
          setTargetPreview(null);
        }
      })();
    }, 400);
    return () => clearTimeout(handle);
  }, [vendorId, plannedNum, tailors, targetTouched, targetDate]);

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
        toast.error(tF('noRollsFound'));
        return;
      }
      setRollBreakdown(
        suggestion.selected.map((row) => ({
          rollRef: row.rollCode ?? row.rollRef,
          qty: row.qty,
        }))
      );
      if (suggestion.unallocated > 0) {
        toast.error(tF('insufficientRolls', { qty: suggestion.unallocated.toFixed(2) }));
      } else {
        toast.success(tF('suggestionApplied'));
      }
    } catch {
      toast.error(tF('suggestFailed'));
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
          targetDate: parseDateOnly(targetDate),
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
      toast.success(tF('updated'));
      router.push(`/backoffice/work-orders/${id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tF('updateFailed'));
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
          <Button variant="ghost" size="icon" aria-label={tWO('recon.backToWO')} title={tWO('recon.backToWO')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{tF('editTitle')}</h1>
            <TombolBantuan judul={tF('editTitle')} />
          </div>
          <p className="text-muted-foreground">
            {tF('editDescription', { docNumber: String((wo as any).docNumber ?? '') })}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{tF('cardTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tF('vendorLabel')}</Label>
                <SearchableCombobox
                  options={tailors.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder={tF('selectVendor')}
                  disabled={isLoadingSuppliers}
                />
              </div>
              <div className="space-y-2">
                <Label>{tF('finishedGoodLabel')}</Label>
                <SearchableCombobox
                  options={finishedGoods.map((fg) => ({ value: fg.id, label: `${fg.nameId} (${fg.sku})` }))}
                  value={finishedGoodId}
                  onValueChange={setFinishedGoodId}
                  placeholder={tF('selectFinishedGood')}
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
                  <Label>{tF('variantRatioLabel')}</Label>
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
                  <p className="text-xs text-muted-foreground">{tF('variantRatioSum', { sum: variantRatioSum })}</p>
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
                <Label htmlFor="targetDate">{tF('targetDateLabel')}</Label>
                <DatePicker
                  id="targetDate"
                  value={parseDateOnly(targetDate)}
                  onChange={(date) => {
                    setTargetTouched(true);
                    setTargetDate(date ? formatDateOnly(date) : '');
                  }}
                />
                {targetPreview?.suggestedEta && (
                  <EtaSuggestionHint
                    supplierCode={targetPreview.supplierCode}
                    totalDays={targetPreview.totalDays}
                    suggestedEta={targetPreview.suggestedEta}
                    hintKey="targetHint"
                    onUseDate={() => {
                      setTargetTouched(true);
                      setTargetDate(formatDateOnly(targetPreview.suggestedEta));
                    }}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>{tF('poRefLabel')}</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: tF('none') },
                    ...purchaseOrders.map((po) => ({ value: po.id, label: po.docNumber })),
                  ]}
                  value={poId || '__none__'}
                  onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
                  placeholder={tF('none')}
                  disabled={isLoadingPOs}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{tWO('notes')}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tF('notesPlaceholder')}
                rows={2}
              />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>{tF('stepsLabel')}</Label>
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
                  {tF('addStep')}
                </Button>
              </div>
              {steps.map((step, index) => (
                <div key={index} className="grid gap-2 rounded border p-2 sm:grid-cols-5">
                  <Input
                    placeholder={tF('stepNamePlaceholder')}
                    value={step.stepName}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, stepName: e.target.value } : s))
                      )
                    }
                  />
                  <SearchableCombobox
                    options={[
                      { value: '__none__', label: tF('selectSupplier') },
                      ...tailors.map((supplier) => ({ value: supplier.id, label: `${supplier.name} (${supplier.code})` })),
                    ]}
                    value={step.supplierId || '__none__'}
                    onValueChange={(v) =>
                      setSteps((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, supplierId: v === '__none__' ? '' : v } : s))
                      )
                    }
                    placeholder={tF('selectSupplier')}
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder={tF('servicePricePlaceholder')}
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
                      <SelectItem value="exclude">{tF('ppnExclude')}</SelectItem>
                      <SelectItem value="include">{tF('ppnInclude')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                  >
                    {tF('remove')}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {finishedGoodId && (
          <Card>
            <CardHeader>
              <CardTitle>{tF('materialPlanTitle')}</CardTitle>
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
                              <span className="text-muted-foreground">{tF('calculating')}</span>
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
                          {tF('loadingPlan')}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tWO('material')}</TableHead>
                                <TableHead className="text-right">
                                  {tWO('estimatedConsumptionPerPcs')} {tF('wasteSuffix')}
                                </TableHead>
                                <TableHead className="text-right">{tF('colAvailable')}</TableHead>
                                <TableHead className="text-right">{tF('colShortage')}</TableHead>
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
                                    {m.plannedQty.toLocaleString('id-ID')} {m.uomCode} (
                                    {m.wastePercent}%)
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.availableStock.toLocaleString('id-ID')} {m.uomCode}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.shortage > 0 ? (
                                      <span className="text-destructive font-medium">
                                        -{m.shortage.toLocaleString('id-ID')} {m.uomCode}
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
                                <TableHead>{tWO('detail.colRollRef')}</TableHead>
                                <TableHead className="text-right">{tF('colWholeRollQty')}</TableHead>
                                <TableHead>{tWO('notes')}</TableHead>
                                <TableHead className="w-12">
                                  <span className="sr-only">{tWO('detail.colActions')}</span>
                                </TableHead>
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
                                      placeholder={tF('optional')}
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
                                      aria-label={tF('removeRoll', { ref: row.rollRef })}
                                      title={tF('removeRoll', { ref: row.rollRef })}
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
                                label: tF('rollRemaining', {
                                  code: r.rollCode,
                                  qty: r.remainingLength.toLocaleString('id-ID'),
                                }),
                              }))}
                            value={addRollValue}
                            onValueChange={(value) => {
                              const roll = availableRolls.find((r) => r.rollId === value);
                              if (roll) {
                                addRollBySelection(roll);
                                setAddRollValue('');
                              }
                            }}
                            placeholder={tF('addRollPlaceholder')}
                            emptyMessage={tF('noMoreRolls')}
                            triggerClassName="w-[280px]"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSuggestRolls}
                            disabled={!consumptionMaterialId || isSuggestingRolls}
                          >
                            {isSuggestingRolls ? tF('suggesting') : tF('suggestBestFit')}
                          </Button>
                        </div>
                        {rollBreakdown.length > 0 && (
                          <p className="text-sm">
                            {tF(rollSum >= materialPlannedQtyForRolls - 1e-6 ? 'allocatedOver' : 'allocatedShort', {
                              total: `${rollSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}${consumptionResult ? ` ${consumptionResult.uomCode}` : ''}`,
                              diff: Math.abs(rollSum - materialPlannedQtyForRolls).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                            })}
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
            {isSubmitting ? tF('updating') : tF('updateWO')}
          </Button>
          <Link href={`/backoffice/work-orders/${id}`}>
            <Button type="button" variant="outline">
              {tF('cancel')}
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
