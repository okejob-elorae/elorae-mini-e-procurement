'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createWorkOrder, getMaterialPlan, computePlannedQtyFromConsumption } from '@/app/actions/production';
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

export default function NewWorkOrderPage() {
  const t = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const router = useRouter();
  const { data: session } = useSession();
  const [tailors, setTailors] = useState<TailorSupplier[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [materialPlan, setMaterialPlan] = useState<MaterialPlanRow[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isLoadingFG, setIsLoadingFG] = useState(true);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const DEBOUNCE_MS = 400;
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rollBreakdown, setRollBreakdown] = useState<Array<{ rollRef: string; qty: number; notes?: string }>>([]);
  const [poId, setPoId] = useState('');
  const [purchaseOrders, setPurchaseOrders] = useState<Array<{ id: string; docNumber: string }>>([]);
  const [isLoadingPOs, setIsLoadingPOs] = useState(true);
  const [selectedVariantSku, setSelectedVariantSku] = useState('');
  const [selectedVariantAttributes, setSelectedVariantAttributes] = useState<Record<string, string> | null>(null);
  const [finishedGoodVariants, setFinishedGoodVariants] = useState<Array<{ sku?: string; attributes: Record<string, string> }>>([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);

  const plannedNum = consumptionResult?.plannedQty ?? 0;

  useEffect(() => {
    const load = async () => {
      try {
        const [suppliersRes, fgList, posResult] = await Promise.all([
          fetch('/api/suppliers'),
          getItemsByType(ItemType.FINISHED_GOOD),
          getPOs({ statusIn: ['SUBMITTED', 'PARTIAL'] }, { page: 1, pageSize: 200 }),
        ]);
        if (suppliersRes.ok) {
          const data = await suppliersRes.json();
          setTailors(
            (data as TailorSupplier[]).filter((s: TailorSupplier) => s.type?.code === 'TAILOR')
          );
        }
        setFinishedGoods((fgList as FinishedGood[]) || []);
        const pos = (posResult as { items?: Array<{ id: string; docNumber: string }> })?.items ?? [];
        setPurchaseOrders(pos);
      } catch (e) {
        toast.error(t('failedToLoadData'));
      } finally {
        setIsLoadingSuppliers(false);
        setIsLoadingFG(false);
        setIsLoadingPOs(false);
      }
    };
    load();
  }, []);

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
        if (!cancelled) {
          setConsumptionResult(null);
          toast.error(t('failedToLoadMaterialPlan'));
        }
      })
      .finally(() => {
        if (!cancelled) setIsComputingConsumption(false);
      });
    return () => {
      cancelled = true;
    };
  }, [finishedGoodId, consumptionMaterialId, consumptionInputDebounced, t]);

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
        setSelectedVariantSku('');
        setSelectedVariantAttributes(null);
      })
      .catch(() => setFinishedGoodVariants([]))
      .finally(() => setIsLoadingVariants(false));
  }, [finishedGoodId, outputMode]);

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
        if (!cancelled) {
          setMaterialPlan([]);
          toast.error(t('failedToLoadMaterialPlan'));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [finishedGoodId, plannedNum, t]);

  const hasShortage = materialPlan.some((m) => m.shortage > 0);
  const rollSum = rollBreakdown.reduce((s, r) => s + r.qty, 0);
  const rollValid = rollBreakdown.length === 0 || Math.abs(rollSum - plannedNum) < 1e-6;
  const skuVariantValid = outputMode !== 'SKU' || (outputMode === 'SKU' && selectedVariantSku.length > 0);
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

  const addRollRow = () => {
    setRollBreakdown((prev) => [...prev, { rollRef: `Roll ${prev.length + 1}`, qty: 0 }]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !session?.user?.id) return;
    setIsSubmitting(true);
    try {
      const wo = await createWorkOrder(
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
            outputMode === 'SKU' && selectedVariantSku
              ? { variantSku: selectedVariantSku, attributes: selectedVariantAttributes ?? undefined }
              : undefined,
        },
        session.user.id
      );
      toast.success(t('workOrderCreated'));
      router.push(`/backoffice/work-orders/${wo.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('failedToCreateWO'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/work-orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Work Order</h1>
          <p className="text-muted-foreground">
            Create a work order for production
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
                <Select
                  value={vendorId}
                  onValueChange={setVendorId}
                  disabled={isLoadingSuppliers}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {tailors.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Finished Good</Label>
                <Select
                  value={finishedGoodId}
                  onValueChange={setFinishedGoodId}
                  disabled={isLoadingFG}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select finished good" />
                  </SelectTrigger>
                  <SelectContent>
                    {finishedGoods.map((fg) => (
                      <SelectItem key={fg.id} value={fg.id}>
                        {fg.nameId} ({fg.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              {outputMode === 'SKU' && (
                <div className="space-y-2">
                  <Label>{tWO('variantSku')}</Label>
                  <Select
                    value={selectedVariantSku}
                    onValueChange={(val) => {
                      const v = finishedGoodVariants.find((x, i) => {
                        const valueForVariant = x.sku ?? `variant-${i}`;
                        return valueForVariant === val;
                      });
                      if (v) {
                        setSelectedVariantSku(v.sku ?? `variant-${finishedGoodVariants.indexOf(v)}`);
                        setSelectedVariantAttributes(v.attributes ?? null);
                      }
                    }}
                    disabled={isLoadingVariants || finishedGoodVariants.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={noVariantsForSku ? tWO('noVariantsDefineFirst') : tWO('selectVariant')} />
                    </SelectTrigger>
                    <SelectContent>
                      {finishedGoodVariants.map((v, idx) => {
                        const label = v.sku ? `${v.sku} (${Object.entries(v.attributes ?? {}).map(([k, val]) => `${k}: ${val}`).join(', ')})` : Object.entries(v.attributes ?? {}).map(([k, val]) => `${k}: ${val}`).join(', ');
                        const value = v.sku ?? `variant-${idx}`;
                        return (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {noVariantsForSku && (
                    <p className="text-xs text-muted-foreground">{tWO('noVariantsDefineFirst')}</p>
                  )}
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
                <Select
                  value={poId || '__none__'}
                  onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
                  disabled={isLoadingPOs}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {purchaseOrders.map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.docNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Link this WO to a purchase order for vendor return tracking</p>
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
                      <Select
                        value={consumptionMaterialId}
                        onValueChange={(v) => {
                          setConsumptionMaterialId(v);
                          setConsumptionInput('');
                          setConsumptionInputDebounced('');
                          setConsumptionResult(null);
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={tWO('selectMaterial')} />
                        </SelectTrigger>
                        <SelectContent>
                          {consumptionRules.map((r) => (
                            <SelectItem key={r.materialId} value={r.materialId}>
                              {r.materialName} ({r.uomCode})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                    {consumptionMaterialId && consumptionInput && !consumptionResult && plannedNum === 0 && Number(consumptionInput) > 0 && !isComputingConsumption && (
                      <p className="sm:col-span-2 text-sm text-destructive">{tWO('increaseConsumptionOrMaterial')}</p>
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
                          Total qty per roll harus sama dengan Planned Qty ({plannedNum}).
                        </p>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Roll / Ref</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead>Notes</TableHead>
                                <TableHead className="w-12" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rollBreakdown.map((row, i) => (
                                <TableRow key={i}>
                                  <TableCell>
                                    <Input
                                      value={row.rollRef}
                                      onChange={(e) => updateRollRow(i, 'rollRef', e.target.value)}
                                      placeholder="Roll 1"
                                      className="h-8"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={row.qty || ''}
                                      onChange={(e) => updateRollRow(i, 'qty', Number(e.target.value) || 0)}
                                      className="h-8 text-right"
                                    />
                                  </TableCell>
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
                        <Button type="button" variant="outline" size="sm" onClick={addRollRow}>
                          + Tambah roll
                        </Button>
                        {rollBreakdown.length > 0 && !rollValid && (
                          <p className="text-sm text-destructive">
                            Total roll ({rollSum}) harus sama dengan Planned Qty ({plannedNum}).
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
            {isSubmitting ? 'Creating...' : 'Create Work Order'}
          </Button>
          <Link href="/backoffice/work-orders">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
