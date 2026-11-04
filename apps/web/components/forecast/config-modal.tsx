'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateForecastConfig } from '@/app/actions/forecast';

interface ForecastConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  initial: {
    growthFactorPercent: number;
    lookbackMonths: number;
    weightDecay: number;
    notes: string | null;
  } | null;
  payoutDelayDays: { SHOPEE: number; TIKTOK: number } | null;
  onSaved: () => void;
}

export function ForecastConfigModal({
  open,
  onOpenChange,
  year,
  initial,
  payoutDelayDays,
  onSaved,
}: ForecastConfigModalProps) {
  const t = useTranslations('forecast.config');
  const [growth, setGrowth] = useState(String(initial?.growthFactorPercent ?? 0));
  const [lookback, setLookback] = useState(String(initial?.lookbackMonths ?? 12));
  const [decay, setDecay] = useState(String(initial?.weightDecay ?? 0.9));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [shopeeDelay, setShopeeDelay] = useState(String(payoutDelayDays?.SHOPEE ?? 14));
  const [tiktokDelay, setTiktokDelay] = useState(String(payoutDelayDays?.TIKTOK ?? 14));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateForecastConfig({
        year,
        growthFactorPercent: Number(growth),
        lookbackMonths: Number(lookback),
        weightDecay: Number(decay),
        notes: notes || undefined,
        payoutDelayDays: { SHOPEE: Number(shopeeDelay), TIKTOK: Number(tiktokDelay) },
      });
      if (!result.success) {
        toast.error(result.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('saved'));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ubahKonfigurasi')} — {year}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="growth">{t('faktorPertumbuhan')}</Label>
            <Input id="growth" type="number" value={growth} onChange={(e) => setGrowth(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('growthHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lookback">{t('lookback')}</Label>
            <Input id="lookback" type="number" value={lookback} onChange={(e) => setLookback(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('lookbackHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decay">{t('peluruhanBobot')}</Label>
            <Input id="decay" type="number" step="0.01" value={decay} onChange={(e) => setDecay(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('decayHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label>{t('payoutDelay')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="payout-delay-shopee" className="text-xs font-normal text-muted-foreground">
                  Shopee
                </Label>
                <Input
                  id="payout-delay-shopee"
                  type="number"
                  min={0}
                  step={1}
                  value={shopeeDelay}
                  onChange={(e) => setShopeeDelay(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="payout-delay-tiktok" className="text-xs font-normal text-muted-foreground">
                  TikTok
                </Label>
                <Input
                  id="payout-delay-tiktok"
                  type="number"
                  min={0}
                  step={1}
                  value={tiktokDelay}
                  onChange={(e) => setTiktokDelay(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('payoutDelayHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '...' : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
