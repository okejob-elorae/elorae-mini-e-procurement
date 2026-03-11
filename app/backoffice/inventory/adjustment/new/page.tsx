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
import { getInventoryValue } from '@/lib/inventory/costing';
import { getItemUomAndConversions } from '@/app/actions/uom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

export default function NewAdjustmentPage() {
  const router = useRouter();
  const { data: session } = useSession();
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
      toast.error('You must be logged in');
      return;
    }
    const nextErrors: typeof errors = {};
    if (!itemId) nextErrors.itemId = 'Select an item';
    if (variantOptions.length > 0 && !variantSku) nextErrors.variantSku = 'Select a variant';
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) nextErrors.qty = 'Enter a valid quantity';
    if (reason.trim().length < 5) nextErrors.reason = 'Alasan minimal 5 karakter';
    if (type === 'NEGATIVE' && !evidenceFile) nextErrors.evidence = 'Photo evidence is required for negative adjustments';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error('Please fix the errors below');
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
        toast.error('Photo upload failed');
        throw new Error('Photo upload failed');
      }
    }
    if (type === 'NEGATIVE' && !evidenceUrl) {
      throw new Error('Photo evidence required');
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
      toast.success('Adjustment created');
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
          <Link href="/backoffice/inventory">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Adjustment</h1>
          <p className="text-muted-foreground">
            Adjust quantity with PIN confirmation (reason and photo for negative)
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New adjustment</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="itemId">Item *</Label>
              <SearchableCombobox
                id="itemId"
                options={summary.map((s) => ({
                  value: s.itemId,
                  label: `${s.item?.sku ?? '-'} – ${s.item?.nameId ?? '-'}`,
                }))}
                value={itemId}
                onValueChange={(v) => { setItemId(v); setErrors((e) => ({ ...e, itemId: undefined })); }}
                placeholder="Select item"
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
                <Label htmlFor="variantSku">Variant *</Label>
                <Select
                  value={variantSku}
                  onValueChange={(v) => { setVariantSku(v); setErrors((e) => ({ ...e, variantSku: undefined })); }}
                >
                  <SelectTrigger id="variantSku" className={`min-h-[44px] ${errors.variantSku ? 'border-destructive' : ''}`}>
                    <SelectValue placeholder="Select variant" />
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
                <p className="font-medium">Current stock</p>
                <p>
                  Qty: {currentStock.qtyOnHand.toLocaleString()} | Avg cost: Rp{' '}
                  {currentStock.avgCost.toLocaleString()} | Value: Rp{' '}
                  {currentStock.totalValue.toLocaleString()}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as 'POSITIVE' | 'NEGATIVE')}
              >
                <SelectTrigger id="type" className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POSITIVE">Penambahan (Stok lebih)</SelectItem>
                  <SelectItem value="NEGATIVE">Pengurangan (Stok hilang/rusak)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {uomData && (
              <div className="space-y-2">
                <Label htmlFor="uomId">UOM (quantity will be converted to base if different)</Label>
                <SearchableCombobox
                  id="uomId"
                  options={[
                    {
                      value: uomData.baseUom.id,
                      label: `${uomData.baseUom.code} (${uomData.baseUom.nameId}) — base`,
                    },
                    ...uomData.conversions.map((c) => {
                      const other = c.fromUomId === uomData.baseUom.id ? c.toUom : c.fromUom;
                      const isToBase = c.toUomId === uomData.baseUom.id;
                      return {
                        value: other.id,
                        label: `${other.code} (${other.nameId}) — 1 = ${isToBase ? c.factor : (1 / c.factor).toFixed(4)} base`,
                      };
                    }),
                  ]}
                  value={selectedUomId}
                  onValueChange={setSelectedUomId}
                  placeholder="UOM"
                  triggerClassName="min-h-[44px]"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="qty">Quantity * (in selected UOM)</Label>
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
                    return `${toBase.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${uomData.baseUom.code} (base)`;
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
              <Label htmlFor="reason">Reason * (min 5 characters)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); setErrors((err) => ({ ...err, reason: undefined })); }}
                placeholder="Alasan penyesuaian"
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
              <Label htmlFor="evidence">Photo evidence {type === 'NEGATIVE' && '*'}</Label>
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
              Confirm (PIN required)
            </Button>
          </form>
        </CardContent>
      </Card>

      <PinAuthModal
        isOpen={pinOpen}
        onClose={() => setPinOpen(false)}
        onConfirm={handlePinConfirm}
        action="konfirmasi penyesuaian stok"
      />
    </div>
  );
}
