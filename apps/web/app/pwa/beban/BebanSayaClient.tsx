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
import { BebanReturPembeliBagian, type BebanReturPembeliTampil } from './BebanReturPembeliBagian';
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
  bebanReturPembeli = [],
  maksPotongPersen,
  hilangPenuh = false,
  cadangan,
}: {
  baris: BebanSaya[];
  hilang: BebanHilangSaya[];
  /** SPG: beban retur pembeli yang ditolak padahal uangnya sudah dikembalikan kasir (P13a). */
  bebanReturPembeli?: BebanReturPembeliTampil[];
  maksPotongPersen: number;
  /** SPG: beban barang hilang dipotong penuh di pembayaran berikutnya (P11a). */
  hilangPenuh?: boolean;
  cadangan: string;
}) {
  const t = useTranslations('pwaBeban');
  const tHilang = useTranslations('bebanHilangSaya');
  // Selisih retur dipotong dari komisi sales (P87): ringkasannya hanya yang MASIH akan dipotong.
  const belumDiganti = baris.filter((b) => b.sisa > 0);
  const total = belumDiganti.reduce((s, b) => s + b.sisa, 0);

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

      {baris.length === 0 && hilang.length === 0 && bebanReturPembeli.length === 0 ? (
        <Card className="py-0">
          <CardContent className="space-y-2 py-10 text-center">
            <Scale className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{tHilang('kosongSemua')}</p>
          </CardContent>
        </Card>
      ) : null}

      {hilang.length > 0 ? <BebanHilangBagian hilang={hilang} maksPotongPersen={maksPotongPersen} penuh={hilangPenuh} /> : null}

      {bebanReturPembeli.length > 0 ? <BebanReturPembeliBagian beban={bebanReturPembeli} /> : null}

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
            {baris.map((b) => {
              const terbuka = b.sisa > 0;
              return (
                <Card key={b.id} className={cn('py-0', terbuka && 'border-destructive/40')}>
                  <CardContent className="space-y-3 py-4">
                    <span className="block min-w-0">
                      <span className="block font-semibold">{b.noNrt ?? '—'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.storeName ?? '—'} · {tanggal(b.diputuskanPada)}
                      </span>
                    </span>
                    {/* Beban, yang sudah dipotong dari komisi, dan sisanya — angka uang tidak pernah dipotong layar. */}
                    <dl className="space-y-1 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{t('beban')}</dt>
                        <dd className="font-semibold tabular-nums">{rupiah(b.nilai)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{t('sudahDipotong')}</dt>
                        <dd className="tabular-nums">{rupiah(b.sudahDipotong)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{t('sisa')}</dt>
                        <dd className={cn('font-bold tabular-nums', terbuka ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400')}>
                          {rupiah(b.sisa)}
                        </dd>
                      </div>
                    </dl>
                    <p
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm leading-relaxed',
                        terbuka ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                      )}
                    >
                      {b.pulih ? t('pulih') : terbuka ? t('dipotongKomisi') : t('whySettled')}
                      {b.kelebihan > 0 && (
                        <span className="mt-1 block font-medium">{t('kelebihan', { value: rupiah(b.kelebihan) })}</span>
                      )}
                      {b.catatan && <span className="mt-1 block font-medium">{b.catatan}</span>}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
