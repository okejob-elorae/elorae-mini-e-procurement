'use client';

import { useTranslations } from 'next-intl';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BebanSaya } from '@/lib/receivables/pwa-queries';
import type { BebanHilangSaya } from '@/lib/spg/hilang-queries';
import { TautanKembali } from '../TautanKembali';
import { BebanHilangBagian } from './BebanHilangBagian';
import { TombolBantuanHp } from '@/app/pwa/TombolBantuanHp';

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

export function BebanSayaClient({
  baris,
  hilang,
  maksPotongPersen,
  cadangan,
}: {
  baris: BebanSaya[];
  hilang: BebanHilangSaya[];
  maksPotongPersen: number;
  cadangan: string;
}) {
  const t = useTranslations('pwaBeban');
  const tHilang = useTranslations('bebanHilangSaya');
  const belumDiganti = baris.filter((b) => b.status === 'DITETAPKAN');
  const total = belumDiganti.reduce((s, b) => s + b.nilai, 0);

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={cadangan} />
      </Button>
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
          <TombolBantuanHp judul={t('pageTitle')} />
        </div>
      </header>

      {baris.length === 0 && hilang.length === 0 ? (
        <Card className="py-0">
          <CardContent className="space-y-2 py-10 text-center">
            <Scale className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{tHilang('kosongSemua')}</p>
          </CardContent>
        </Card>
      ) : null}

      {hilang.length > 0 ? <BebanHilangBagian hilang={hilang} maksPotongPersen={maksPotongPersen} /> : null}

      {baris.length === 0 ? null : (
        <section className="space-y-3" aria-labelledby="judul-beban-retur">
          <div className="space-y-1">
            <h2 id="judul-beban-retur" className="text-lg font-semibold">
              {tHilang('judulRetur')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('summary', { count: belumDiganti.length, value: rupiah(total) })}
            </p>
          </div>
          <div className="anim-stagger space-y-3">
            {baris.map((b) => (
              <Card
                key={b.id}
                className={cn('py-0', b.status === 'DITETAPKAN' && 'border-destructive/40')}
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
        </section>
      )}
    </div>
  );
}
