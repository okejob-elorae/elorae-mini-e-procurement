'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getPpnRatePercent, setPpnRatePercent } from '@/app/actions/settings/ppn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TaxSettingsPage() {
  const t = useTranslations('tax');
  const tToasts = useTranslations('toasts');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [rate, setRate] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    getPpnRatePercent()
      .then((v) => setRate(String(v)))
      .catch(() => toast.error(t('loadError')))
      .finally(() => setIsLoading(false));
  }, [status, router]);

  const handleSave = async () => {
    const num = Number.parseFloat(rate);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      toast.error('Enter a percentage between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      await setPpnRatePercent(num);
      toast.success(tToasts('saved'));
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-muted-foreground">{t('pageDescription')}</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>PPN rate</CardTitle>
          <CardDescription>
            When a PO line is marked &quot;Exclude PPN&quot;, this rate is applied to the line price for work order material cost.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ppn-rate">{t('ppnRateLabel')}</Label>
            <Input
              id="ppn-rate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="11"
              className="max-w-[120px]"
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
