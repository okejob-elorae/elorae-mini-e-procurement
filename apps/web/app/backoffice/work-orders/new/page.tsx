'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft } from 'lucide-react';
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
import { itemHasSkuVariants } from '@/lib/items/variants';
import { createWorkOrder } from '@/app/actions/production';
import { previewChainDays } from '@/app/actions/lead-time';
import { EtaSuggestionHint } from '@/components/lead-time/eta-suggestion-hint';
import { getItemsByType, getItemById } from '@/app/actions/items';
import { getPOs } from '@/app/actions/purchase-orders';
import { ItemType } from '@/lib/constants/enums';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { alasanSimpanWo } from '@/lib/production/rencana-wo';
import { usePakaiRencanaBahan } from '../pakai-rencana-bahan';
import { KeteranganSimpanWo, RencanaBahanWo } from '../RencanaBahanWo';

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

interface WorkOrderStepForm {
  sequence: number;
  supplierId: string;
  stepName: string;
  servicePrice: number;
  servicePpnIncluded: boolean;
  qty: number;
  notes?: string;
}

export default function NewWorkOrderPage() {
  const t = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const tF = useTranslations('workOrders.form');
  const tR = useTranslations('workOrders.formulir');
  const router = useRouter();
  const { data: session } = useSession();
  const [tailors, setTailors] = useState<TailorSupplier[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isLoadingFG, setIsLoadingFG] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [vendorId, setVendorId] = useState('');
  const [finishedGoodId, setFinishedGoodId] = useState('');
  const [outputMode, setOutputMode] = useState<'GENERIC' | 'SKU'>('GENERIC');
  /** Kartu "Rencana bahan" — logika dan tampilan yang sama dengan formulir ubah. */
  const r = usePakaiRencanaBahan(finishedGoodId, null);
  const plannedNum = r.plannedNum;

  const [targetDate, setTargetDate] = useState('');
  const [targetTouched, setTargetTouched] = useState(false);
  const [targetPreview, setTargetPreview] = useState<{
    totalDays: number;
    suggestedEta: Date;
    supplierCode: string;
  } | null>(null);
  const [notes, setNotes] = useState('');
  const [poId, setPoId] = useState('');
  const [purchaseOrders, setPurchaseOrders] = useState<Array<{ id: string; docNumber: string }>>([]);
  const [isLoadingPOs, setIsLoadingPOs] = useState(true);
  const [selectedVariantSku, setSelectedVariantSku] = useState('');
  const [selectedVariantAttributes, setSelectedVariantAttributes] = useState<Record<string, string> | null>(null);
  const [variantRatios, setVariantRatios] = useState<Array<{ variantSku: string; ratioPercent: number }>>([]);
  const [finishedGoodVariants, setFinishedGoodVariants] = useState<Array<{ sku?: string; attributes: Record<string, string> }>>([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);
  const [steps, setSteps] = useState<WorkOrderStepForm[]>([]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Barang jadi bervarian → bawaan "SKU (per varian)": stok hasil produksi
  // masuk per ukuran, bukan ke baris gabungan yang tidak terlihat per ukuran.
  const pilihBarangJadi = (id: string) => {
    setFinishedGoodId(id);
    const fg = finishedGoods.find((f) => f.id === id);
    setOutputMode(fg && itemHasSkuVariants(fg.variants) ? 'SKU' : 'GENERIC');
  };

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
        if (variants.length > 1) {
          const equal = Math.floor(100 / variants.length);
          const remainder = 100 - equal * variants.length;
          setVariantRatios(
            variants.map((v, i) => ({
              variantSku: v.sku ?? `variant-${i}`,
              ratioPercent: i === 0 ? equal + remainder : equal,
            }))
          );
        } else {
          setVariantRatios([]);
        }
      })
      .catch(() => setFinishedGoodVariants([]))
      .finally(() => setIsLoadingVariants(false));
  }, [finishedGoodId, outputMode]);

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

  const variantRatioSum = variantRatios.reduce((s, x) => s + x.ratioPercent, 0);
  const noVariantsForSku = outputMode === 'SKU' && !!finishedGoodId && !isLoadingVariants && finishedGoodVariants.length === 0;
  // Satu aturan untuk tombol simpan dan kalimat di bawahnya (lib/production/rencana-wo.ts).
  const alasan = alasanSimpanWo({
    vendor: !!vendorId,
    barangJadi: !!finishedGoodId,
    modeSku: outputMode === 'SKU',
    tanpaVarian: noVariantsForSku,
    pakaiRasio: variantRatios.length > 1,
    totalRasio: variantRatioSum,
    varianTerpilih: selectedVariantSku.length > 0,
    adaBom: r.aturanTermuat ? r.consumptionRules.length > 0 : true,
    bahanUtama: !!r.consumptionMaterialId,
    caraIsi: r.caraIsi,
    pcs: r.pcsDiketik,
    jumlahBahan: Number(r.consumptionInput) || 0,
    menghitung: r.isComputingConsumption,
    adaHasil: r.consumptionResult != null,
    jumlahRencana: plannedNum,
    stokKurang: r.hasShortage,
    rollCukup: r.rollValid,
  });
  const canSubmit = !!session?.user?.id && !isSubmitting && alasan === null;

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
          expectedConsumption: r.expectedConsumptionUntukSimpan,
          consumptionMaterialId: r.consumptionMaterialId || undefined,
          targetDate: parseDateOnly(targetDate),
          poId: poId.trim() || undefined,
          notes: notes.trim() || undefined,
          rollBreakdown: r.rollBreakdown.length > 0 ? r.rollBreakdown : undefined,
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
        <Button asChild variant="ghost" size="icon">
          <Link href="/backoffice/work-orders" aria-label={tWO('detail.backToList')} title={tWO('detail.backToList')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{tR('judulBaru')}</h1>
          <TombolBantuan judul={tR('judulBaru')} />
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
                <Label>{tR('labelVendor')}</Label>
                <SearchableCombobox
                  options={tailors.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder={tF('selectVendor')}
                  disabled={isLoadingSuppliers}
                />
              </div>
              <div className="space-y-2">
                <Label>{tR('labelBarangJadi')}</Label>
                <SearchableCombobox
                  options={finishedGoods.map((fg) => ({ value: fg.id, label: `${fg.nameId} (${fg.sku})` }))}
                  value={finishedGoodId}
                  onValueChange={pilihBarangJadi}
                  placeholder={tF('selectFinishedGood')}
                  disabled={isLoadingFG}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tR('labelModeHasil')}</Label>
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
                        setSelectedVariantSku(v.sku ?? `variant-${finishedGoodVariants.indexOf(v)}`);
                        setSelectedVariantAttributes(v.attributes ?? null);
                      }
                    }}
                    placeholder={noVariantsForSku ? tWO('noVariantsDefineFirst') : tWO('selectVariant')}
                    disabled={isLoadingVariants || finishedGoodVariants.length === 0}
                  />
                  {noVariantsForSku && (
                    <p className="text-xs text-muted-foreground">{tWO('noVariantsDefineFirst')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="targetDate">{tR('labelTanggalTarget')}</Label>
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
                <p className="text-xs text-muted-foreground">{tF('poRefHint')}</p>
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
                <Label>{tR('labelTahap')}</Label>
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
            <CardContent>
              <RencanaBahanWo r={r} />
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          <div className="flex gap-4">
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? tF('creating') : tR('tombolBuat')}
            </Button>
            <Button asChild variant="outline">
              <Link href="/backoffice/work-orders">{tF('cancel')}</Link>
            </Button>
          </div>
          {/* Tombol mati menyebut kekurangan pertamanya. */}
          <KeteranganSimpanWo alasan={isSubmitting ? null : alasan} />
        </div>
      </form>
    </div>
  );
}
