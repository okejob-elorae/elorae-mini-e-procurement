'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import type { BarisPiutang } from '@/lib/receivables/queries';
import type { KeadaanPiutang } from '@/lib/receivables/rules';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

const NADA: Record<KeadaanPiutang, string> = {
  lewat: 'bg-destructive/10 text-destructive',
  tertahan: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  klaim: 'bg-primary/10 text-primary',
  tt: 'bg-muted text-muted-foreground',
  belum: 'bg-primary/10 text-primary',
  lunas: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

export function FakturTokoClient({
  storeName,
  baris,
}: {
  storeName: string;
  baris: BarisPiutang[];
}) {
  const t = useTranslations('pwaPiutang');
  const td = dinamis(t);
  const sisa = baris.reduce((s, b) => s + b.outstanding, 0);

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/pwa/piutang">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('back')}
        </Link>
      </Button>

      <header className="space-y-1">
        <h1 className="text-xl font-bold leading-tight">{storeName}</h1>
        <p className="text-sm text-muted-foreground">
          {t('summaryStore', { count: baris.length, value: rupiah(sisa) })}
        </p>
      </header>

      <div className="anim-stagger space-y-3">
        {baris.map((b) => (
          <Card key={b.id}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{b.invoiceNo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('due', { date: tanggal(b.dueDate) })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums">{rupiah(b.outstanding)}</span>
                  {b.outstanding !== b.amount && (
                    <span className="block text-xs text-muted-foreground line-through tabular-nums">
                      {rupiah(b.amount)}
                    </span>
                  )}
                </span>
              </div>
              <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[b.keadaan])}>
                {td(`why_${b.keadaan}`, {
                  value: rupiah(b.alasan.nilaiTertahan ?? 0),
                  doc: b.alasan.noKlaim ?? b.alasan.noKontrabon ?? '—',
                  date: tanggal(b.alasan.janjiBayar),
                  days: b.alasan.hariTerlambat ?? 0,
                })}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
