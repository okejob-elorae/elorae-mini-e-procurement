'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Scale } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { tandaiBebanLunasAction } from '@/app/actions/store-returns';
import type { BarisBeban } from '@/lib/receivables/dashboard-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string | null) =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      });

const NADA: Record<BarisBeban['status'], StatusTone> = {
  TERBUKA: 'attention',
  DITETAPKAN: 'progress',
  LUNAS: 'settled',
};

const URUT: BarisBeban['status'][] = ['TERBUKA', 'DITETAPKAN', 'LUNAS'];

export function BebanClient({
  baris,
  bolehMengelola,
}: {
  baris: BarisBeban[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('bebanSelisih');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saring, setSaring] = useState<BarisBeban['status'] | null>(null);

  const tampil = saring ? baris.filter((b) => b.status === saring) : baris;
  const jumlah = (s: BarisBeban['status']) => baris.filter((b) => b.status === s).length;
  const nilaiTerbuka = baris
    .filter((b) => b.status === 'TERBUKA')
    .reduce((s, b) => s + b.nilai, 0);

  const lunaskan = (id: string) => {
    startTransition(async () => {
      const hasil = await tandaiBebanLunasAction(id);
      if (hasil.ok) {
        toast.success(t('okSettled'));
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        meta={t('summary', { count: jumlah('TERBUKA'), value: rupiah(nilaiTerbuka) })}
      />

      <div className="anim-stagger flex flex-wrap gap-2">
        {URUT.filter((s) => jumlah(s) > 0).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSaring(saring === s ? null : s)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              saring === s ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            <StatusPill tone={NADA[s]}>{t(`status${s}` as never)}</StatusPill>
            <span className="ml-2 tabular-nums text-muted-foreground">{jumlah(s)}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            <EmptyState icon={Scale} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colNote')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                    <TableHead>{t('colBearer')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow
                      key={b.id}
                      /* Hanya yang belum ditanggung diberi latar merah: itulah
                         yang masih menahan faktur tetap terbuka. */
                      className={cn(b.status === 'TERBUKA' && 'bg-destructive/[0.06]')}
                    >
                      <TableCell>
                        {b.storeReturnId ? (
                          <Link
                            href={`/backoffice/retur-toko/${b.storeReturnId}`}
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {b.noNrt ?? '—'}
                          </Link>
                        ) : (
                          <span className="font-medium">{b.noNrt ?? '—'}</span>
                        )}
                      </TableCell>
                      <TableCell>{b.storeName ?? '—'}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {rupiah(b.nilai)}
                      </TableCell>
                      <TableCell>
                        {b.penanggung ? (
                          <>
                            {t(`bearer${b.penanggung}` as never)}
                            {b.penanggungNama && (
                              <span className="block text-xs text-muted-foreground">
                                {b.penanggungNama}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t('notAssigned')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={NADA[b.status]}
                          detail={
                            b.status === 'LUNAS'
                              ? t('settledOn', { date: tanggal(b.dilunasiPada) })
                              : b.diputuskanOleh
                                ? t('decidedBy', {
                                    name: b.diputuskanOleh,
                                    date: tanggal(b.diputuskanPada),
                                  })
                                : undefined
                          }
                        >
                          {t(`status${b.status}` as never)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status === 'TERBUKA' && b.storeReturnId && (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/backoffice/retur-toko/${b.storeReturnId}`}>
                              {t('decide')}
                            </Link>
                          </Button>
                        )}
                        {b.status === 'DITETAPKAN' && bolehMengelola && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => lunaskan(b.id)}
                          >
                            {t('markSettled')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="py-4 text-sm leading-relaxed">{t('explain')}</CardContent>
      </Card>
    </div>
  );
}
