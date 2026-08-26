'use client';

import { useTranslations } from 'next-intl';
import { Scale } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BebanSaya } from '@/lib/receivables/pwa-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

export function BebanSayaClient({ baris }: { baris: BebanSaya[] }) {
  const t = useTranslations('pwaBeban');
  const belumDiganti = baris.filter((b) => b.status === 'DITETAPKAN');
  const total = belumDiganti.reduce((s, b) => s + b.nilai, 0);

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('summary', { count: belumDiganti.length, value: rupiah(total) })}
        </p>
      </header>

      {baris.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <Scale className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {baris.map((b) => (
            <Card
              key={b.id}
              className={cn(b.status === 'DITETAPKAN' && 'border-destructive/40')}
            >
              <CardContent className="space-y-2 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{b.noNrt ?? '—'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName ?? '—'} · {tanggal(b.diputuskanPada)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-bold tabular-nums',
                      b.status === 'DITETAPKAN' && 'text-destructive',
                    )}
                  >
                    {rupiah(b.nilai)}
                  </span>
                </div>
                <p
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm leading-relaxed',
                    b.status === 'DITETAPKAN'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                  )}
                >
                  {b.status === 'DITETAPKAN' ? t('whyOpen') : t('whySettled')}
                  {b.catatan && <span className="mt-1 block font-medium">{b.catatan}</span>}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
