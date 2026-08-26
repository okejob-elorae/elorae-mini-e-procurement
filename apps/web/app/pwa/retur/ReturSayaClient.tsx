'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import type { ReturSaya } from '@/lib/receivables/pwa-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<string, string> = {
  cek: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  keputusan: 'bg-destructive/10 text-destructive',
  jodoh: 'bg-primary/10 text-primary',
  beres: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  batal: 'bg-muted text-muted-foreground',
};

export function ReturSayaClient({ baris }: { baris: ReturSaya[] }) {
  const t = useTranslations('pwaRetur');
  const td = dinamis(t);

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('summary', { count: baris.length })}</p>
        </div>
        <Button asChild size="sm">
          <Link href="/pwa/retur/baru">
            <Plus className="mr-1 h-4 w-4" />
            {t('new')}
          </Link>
        </Button>
      </header>

      {baris.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {baris.map((b) => (
            <Card key={b.id}>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{b.noNrt}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName} · {tanggal(b.tanggal)}
                      {b.adaFoto && (
                        <Camera className="ml-1 inline h-3 w-3 align-[-1px]" />
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{rupiah(b.nilaiKlaim)}</span>
                </div>
                <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[b.langkah])}>
                  {td(`why_${b.langkah}`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
