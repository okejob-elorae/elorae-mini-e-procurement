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
  onSaved: () => void;
}

export function ForecastConfigModal({
  open,
  onOpenChange,
  year,
  initial,
  onSaved,
}: ForecastConfigModalProps) {
  const t = useTranslations('forecast.config');
  const [growth, setGrowth] = useState(String(initial?.growthFactorPercent ?? 0));
  const [lookback, setLookback] = useState(String(initial?.lookbackMonths ?? 12));
  const [decay, setDecay] = useState(String(initial?.weightDecay ?? 0.9));
  const [notes, setNotes] = useState(initial?.notes ?? '');
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
      });
      if (!result.success) {
        toast.error(result.error ?? 'Failed to save config');
        return;
      }
      toast.success('Config saved');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editConfig')} — {year}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="growth">{t('growth')}</Label>
            <Input id="growth" type="number" value={growth} onChange={(e) => setGrowth(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('growthHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lookback">{t('lookback')}</Label>
            <Input id="lookback" type="number" value={lookback} onChange={(e) => setLookback(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('lookbackHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decay">{t('decay')}</Label>
            <Input id="decay" type="number" step="0.01" value={decay} onChange={(e) => setDecay(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('decayHint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
