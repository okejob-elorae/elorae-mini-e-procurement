'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { getCurrentStockSummary } from '@/app/actions/stock-card';
import { getInventoryValue } from '@/lib/inventory/costing';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

export default function NewAdjustmentPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getCurrentStockSummary>>>([]);
  const [currentStock, setCurrentStock] = useState<{
    qtyOnHand: number;
    avgCost: number;
    totalValue: number;
  } | null>(null);

  useEffect(() => {
    getCurrentStockSummary().then(setSummary);
  }, []);

  useEffect(() => {
    if (!itemId) {
      setCurrentStock(null);
      return;
    }
    getInventoryValue(itemId).then((v) => {
      if (v)
        setCurrentStock({
          qtyOnHand: Number(v.qtyOnHand),
          avgCost: Number(v.avgCost),
          totalValue: Number(v.totalValue),
        });
      else setCurrentStock(null);
    });
  }, [itemId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      toast.error('You must be logged in');
      return;
    }
    if (!itemId) {
      toast.error('Select an item');
      return;
    }
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error('Enter a valid quantity');
      return;
    }
    if (reason.trim().length < 5) {
      toast.error('Alasan minimal 5 karakter');
      return;
    }
    if (type === 'NEGATIVE' && !evidenceFile) {
      toast.error('Photo evidence is required for negative adjustments');
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
      await createStockAdjustment(
        {
          itemId,
          type,
          qty: qtyNum,
          reason: reason.trim(),
          evidenceUrl,
        },
        pin,
        session.user.id
      );
      toast.success('Adjustment created');
      router.push('/backoffice/inventory');
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
              <Label>Item *</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {summary.map((s) => (
                    <SelectItem key={s.itemId} value={s.itemId}>
                      {s.item?.sku ?? '-'} – {s.item?.nameId ?? '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
              <Label>Type *</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as 'POSITIVE' | 'NEGATIVE')}
              >
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POSITIVE">Penambahan (Stok lebih)</SelectItem>
                  <SelectItem value="NEGATIVE">Pengurangan (Stok hilang/rusak)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quantity *</Label>
              <Input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className="min-h-[44px]"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label>Reason * (min 5 characters)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan penyesuaian"
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label>Photo evidence {type === 'NEGATIVE' && '*'}</Label>
              <Input
                type="file"
                accept="image/*"
                className="min-h-[44px]"
                onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
              />
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
