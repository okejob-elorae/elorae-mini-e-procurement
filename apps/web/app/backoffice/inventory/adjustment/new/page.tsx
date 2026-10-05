'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { createStockAdjustment } from '@/app/actions/inventory';
import { getCurrentStockSummary, getItemVariantOptions } from '@/app/actions/stock-card';
import { getInventoryValue } from '@/app/actions/nilai-persediaan';
import { getItemUomAndConversions } from '@/app/actions/uom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';

export default function NewAdjustmentPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('inventory.adjNew');
  const tToasts = useTranslations('toasts');
  const [itemId, setItemId] = useState('');
  const [variantSku, setVariantSku] = useState('');
  const [variantOptions, setVariantOptions] = useState<string[]>([]);
  const [type, setType] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    itemId?: string;
    variantSku?: string;
    qty?: string;
    reason?: string;
    evidence?: string;
  }>({});
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getCurrentStockSummary>>>([]);
  const [currentStock, setCurrentStock] = useState<{
    qtyOnHand: number;
    avgCost: number;
    totalValue: number;
  } | null>(null);
  const [uomData, setUomData] = useState<Awaited<ReturnType<typeof getItemUomAndConversions>>>(null);
  const [selectedUomId, setSelectedUomId] = useState<string>('');

  useEffect(() => {
    getCurrentStockSummary().then(setSummary);
  }, []);

  useEffect(() => {
    if (!itemId) {
      setCurrentStock(null);
      setUomData(null);
      setSelectedUomId('');
      setVariantOptions([]);
      setVariantSku('');
      return;
    }
    getItemVariantOptions(itemId).then(setVariantOptions);
  }, [itemId]);

  useEffect(() => {
    if (!itemId) return;
    const needsVariant = variantOptions.length > 0;
    const effectiveVariant = needsVariant ? (variantSku || undefined) : undefined;
    if (needsVariant && !variantSku) {
      setCurrentStock(null);
      setUomData(null);
      setSelectedUomId('');
      return;
    }
    Promise.all([
      getInventoryValue(itemId, effectiveVariant ?? null),
      getItemUomAndConversions(itemId),
    ]).then(([v, uom]) => {
      if (v)
        setCurrentStock({
          qtyOnHand: Number(v.qtyOnHand),
          avgCost: Number(v.avgCost),
          totalValue: Number(v.totalValue),
        });
      else setCurrentStock(null);
      setUomData(uom ?? null);
      setSelectedUomId(uom?.baseUom?.id ?? '');
    });
  }, [itemId, variantSku, variantOptions.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!session?.user?.id) {
      toast.error(tToasts('youMustBeLoggedIn'));
      return;
    }
    const nextErrors: typeof errors = {};
    if (!itemId) nextErrors.itemId = t('errSelectItem');
    if (variantOptions.length > 0 && !variantSku) nextErrors.variantSku = t('errSelectVariant');
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) nextErrors.qty = t('errQty');
    if (reason.trim().length < 5) nextErrors.reason = t('errReason');
    if (type === 'NEGATIVE' && !evidenceFile) nextErrors.evidence = t('errEvidence');
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error(tToasts('pleaseFixErrorsBelow'));
      return;
    }
    setPinOpen(true);
  };

  const handlePinConfirm = async (pin: string) => {
    if (!session?.user?.id) return;
    const qtyNum = parseFloat(qty);
    let evidenceUrl: string | undefined;
    if (evidenceFile) {
      try {
        const formData = new FormData();
        formData.append('files', evidenceFile);
        const res = await fetch('/api/upload/grn-photo', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          evidenceUrl = data.urls?.[0];
        }
      } catch {
        toast.error(tToasts('photoUploadFailed'));
        throw new Error(tToasts('photoUploadFailed'));
      }
    }
    if (type === 'NEGATIVE' && !evidenceUrl) {
      throw new Error(t('errEvidence'));
    }
    setSubmitting(true);
    try {
      const adjustment = await createStockAdjustment(
        {
          itemId,
          variantSku: variantSku || undefined,
          type,
          qty: qtyNum,
          uomId: selectedUomId || undefined,
          reason: reason.trim(),
          evidenceUrl,
        },
        pin,
        session.user.id
      );
      toast.success(tToasts('adjustmentCreated'));
      router.push(`/backoffice/inventory/adjustment/${adjustment.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory" aria-label={t('backToInventory')} title={t('backToInventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="itemId">{t('item')} *</Label>
              <SearchableCombobox
                id="itemId"
                options={summary.map((s) => ({
                  value: s.itemId,
                  label: `${s.item?.sku ?? '-'} – ${s.item?.nameId ?? '-'}`,
                }))}
                value={itemId}
                onValueChange={(v) => { setItemId(v); setErrors((e) => ({ ...e, itemId: undefined })); }}
                placeholder={t('selectItem')}
                aria-invalid={!!errors.itemId}
                className={errors.itemId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                triggerClassName="min-h-[44px]"
              />
              {errors.itemId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.itemId}
                </p>
              )}
            </div>

            {variantOptions.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="variantSku">{t('variant')} *</Label>
                <Select
                  value={variantSku}
                  onValueChange={(v) => { setVariantSku(v); setErrors((e) => ({ ...e, variantSku: undefined })); }}
                >
                  <SelectTrigger id="variantSku" className={`min-h-[44px] ${errors.variantSku ? 'border-destructive' : ''}`}>
                    <SelectValue placeholder={t('selectVariant')} />
                  </SelectTrigger>
                  <SelectContent>
                    {variantOptions.map((sku) => (
                      <SelectItem key={sku} value={sku}>
                        {sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.variantSku && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.variantSku}
                  </p>
                )}
              </div>
            )}

            {currentStock != null && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{t('currentStock')}</p>
                <p>
                  {t('currentStockLine', {
                    qty: currentStock.qtyOnHand.toLocaleString('id-ID'),
                    avgCost: currentStock.avgCost.toLocaleString('id-ID'),
                    value: currentStock.totalValue.toLocaleString('id-ID'),
                  })}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="type">{t('type')} *</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as 'POSITIVE' | 'NEGATIVE')}
              >
                <SelectTrigger id="type" className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POSITIVE">{t('typePositive')}</SelectItem>
                  <SelectItem value="NEGATIVE">{t('typeNegative')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {uomData && (
              <div className="space-y-2">
                <Label htmlFor="uomId">{t('uomLabel')}</Label>
                <SearchableCombobox
                  id="uomId"
                  options={[
                    {
                      value: uomData.baseUom.id,
                      label: `${uomData.baseUom.code} (${uomData.baseUom.nameId}) — ${t('base')}`,
                    },
                    ...uomData.conversions.map((c) => {
                      const other = c.fromUomId === uomData.baseUom.id ? c.toUom : c.fromUom;
                      const isToBase = c.toUomId === uomData.baseUom.id;
                      return {
                        value: other.id,
                        label: `${other.code} (${other.nameId}) — 1 = ${isToBase ? c.factor : (1 / c.factor).toFixed(4)} ${t('base')}`,
                      };
                    }),
                  ]}
                  value={selectedUomId}
                  onValueChange={setSelectedUomId}
                  placeholder={t('uomPlaceholder')}
                  triggerClassName="min-h-[44px]"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="qty">{t('qtyLabel')}</Label>
              <Input
                id="qty"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className={`min-h-[44px] ${errors.qty ? 'border-destructive focus-visible:ring-destructive/20' : ''}`}
                aria-invalid={!!errors.qty}
                value={qty}
                onChange={(e) => { setQty(e.target.value); setErrors((err) => ({ ...err, qty: undefined })); }}
                placeholder="0"
              />
              {uomData && selectedUomId && selectedUomId !== uomData.baseUom.id && qty.trim() && !isNaN(parseFloat(qty)) && (
                <p className="text-sm text-muted-foreground">
                  = {(() => {
                    const conv = uomData.conversions.find(
                      (c) =>
                        (c.fromUomId === selectedUomId && c.toUomId === uomData.baseUom.id) ||
                        (c.toUomId === selectedUomId && c.fromUomId === uomData.baseUom.id)
                    );
                    if (!conv) return '—';
                    const q = parseFloat(qty);
                    const toBase = conv.toUomId === uomData.baseUom.id ? q * conv.factor : q / conv.factor;
                    return `${toBase.toLocaleString('id-ID', { maximumFractionDigits: 4 })} ${uomData.baseUom.code} (${t('base')})`;
                  })()}
                </p>
              )}
              {errors.qty && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.qty}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">{t('reasonLabel')}</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); setErrors((err) => ({ ...err, reason: undefined })); }}
                placeholder={t('reasonPlaceholder')}
                className={`min-h-[44px] ${errors.reason ? 'border-destructive focus-visible:ring-destructive/20' : ''}`}
                aria-invalid={!!errors.reason}
              />
              {errors.reason && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.reason}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="evidence">{t('evidenceLabel')} {type === 'NEGATIVE' && '*'}</Label>
              <Input
                id="evidence"
                type="file"
                accept="image/*"
                className={`min-h-[44px] ${errors.evidence ? 'border-destructive focus-visible:ring-destructive/20' : ''}`}
                aria-invalid={!!errors.evidence}
                onChange={(e) => { setEvidenceFile(e.target.files?.[0] ?? null); setErrors((err) => ({ ...err, evidence: undefined })); }}
              />
              {errors.evidence && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.evidence}
                </p>
              )}
            </div>

            <Button type="submit" className="min-h-[44px]" disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('confirmButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PinAuthModal
        isOpen={pinOpen}
        onClose={() => setPinOpen(false)}
        onConfirm={handlePinConfirm}
        action={t('pinAction')}
      />
    </div>
  );
}
