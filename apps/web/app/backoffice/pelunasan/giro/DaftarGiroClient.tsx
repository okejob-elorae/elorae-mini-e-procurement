'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, CalendarClock, History, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { dinamis } from '@/lib/i18n/dinamis';
import { formatIDR } from '@/lib/sales-orders/format';
import type { KelompokGiro, StatusGiro } from '@/lib/receivables/giro';
import { TombolGiro } from './TombolGiro';

export type GiroTampil = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  giroNo: string;
  giroBank: string;
  terbit: string;
  efektif: string;
  nilai: number;
  status: StatusGiro;
  kedaluwarsa: boolean;
  diputuskanPada: string | null;
  catatan: string | null;
};

export type KelompokTampil = {
  kelompok: KelompokGiro;
  jumlah: number;
  nilai: number;
  baris: GiroTampil[];
};

const NADA_STATUS: Record<StatusGiro, StatusTone> = {
  MENUNGGU: 'waiting',
  CAIR: 'settled',
  DITOLAK: 'attention',
};

/** Kelompok yang menuntut tindakan hari ini diberi warna; yang lain tenang. */
const NADA_KELOMPOK: Record<KelompokGiro, string> = {
  LEWAT: 'text-destructive',
  HARI_INI: 'text-amber-700 dark:text-amber-400',
  PEKAN_INI: 'text-foreground',
  NANTI: 'text-muted-foreground',
};

export function DaftarGiroClient({
  kelompok,
  baruSaja,
  bolehMemutuskan,
}: {
  kelompok: KelompokTampil[];
  baruSaja: GiroTampil[];
  bolehMemutuskan: boolean;
}) {
  const t = useTranslations('giro');
  const td = dinamis(t);
  const totalJumlah = kelompok.reduce((s, k) => s + k.jumlah, 0);
  const totalNilai = kelompok.reduce((s, k) => s + k.nilai, 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/pelunasan">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToClaims')}
        </Link>
      </Button>

      <PageHeader
        title={t('pageTitle')}
        meta={t('summary', { count: totalJumlah, value: formatIDR(totalNilai) })}
      />

      {/* Ringkasan per kelompok — angka yang dibaca pertama kali di pagi hari. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kelompok.map((k) => (
          <Card key={k.kelompok}>
            <CardContent className="space-y-1 py-4">
              <p className="text-sm text-muted-foreground">{td(`group_${k.kelompok}`)}</p>
              <p className={cn('text-xl font-semibold tabular-nums', k.jumlah > 0 && NADA_KELOMPOK[k.kelompok])}>
                {formatIDR(k.nilai)}
              </p>
              <p className="text-xs text-muted-foreground">{t('groupCount', { count: k.jumlah })}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalJumlah === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={Landmark} title={t('emptyTitle')} description={t('emptyBody')} />
          </CardContent>
        </Card>
      ) : (
        kelompok
          .filter((k) => k.baris.length > 0)
          .map((k) => (
            <Card key={k.kelompok}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <CalendarClock className={cn('h-5 w-5', NADA_KELOMPOK[k.kelompok])} />
                  {td(`group_${k.kelompok}`)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {t('groupTotal', { count: k.jumlah, value: formatIDR(k.nilai) })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <TabelGiro baris={k.baris} bolehMemutuskan={bolehMemutuskan} menunggu />
              </CardContent>
            </Card>
          ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('recentTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className={baruSaja.length === 0 ? undefined : 'px-0'}>
          {baruSaja.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('recentEmpty')}</p>
          ) : (
            <TabelGiro baris={baruSaja} bolehMemutuskan={false} menunggu={false} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TabelGiro({
  baris,
  bolehMemutuskan,
  menunggu,
}: {
  baris: GiroTampil[];
  bolehMemutuskan: boolean;
  menunggu: boolean;
}) {
  const t = useTranslations('giro');
  const td = dinamis(t);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colGiro')}</TableHead>
            <TableHead>{t('colStore')}</TableHead>
            <TableHead>{menunggu ? t('colEffective') : t('colDecided')}</TableHead>
            <TableHead className="text-right">{t('colAmount')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
            {menunggu && bolehMemutuskan && (
              <TableHead className="sticky right-0 bg-card text-right">{t('colAction')}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {baris.map((g) => (
            <TableRow key={g.id}>
              <TableCell className="whitespace-normal min-w-[9rem]">
                <span className="block font-medium">{g.giroNo}</span>
                <span className="block text-xs text-muted-foreground">{g.giroBank}</span>
                <Link
                  href={`/backoffice/pelunasan/${g.id}`}
                  className="block text-xs text-primary underline-offset-2 hover:underline"
                >
                  {g.docNo}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal min-w-[9rem] max-w-[14rem]">
                {g.storeName}
                {g.salesmanName && (
                  <span className="block text-xs text-muted-foreground">{g.salesmanName}</span>
                )}
              </TableCell>
              <TableCell>
                {menunggu ? g.efektif : (g.diputuskanPada ?? '—')}
                <span className="block text-xs text-muted-foreground">
                  {menunggu ? t('issuedOn', { date: g.terbit }) : t('effectiveOn', { date: g.efektif })}
                </span>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatIDR(g.nilai)}</TableCell>
              <TableCell className="whitespace-normal min-w-[9rem]">
                <StatusPill
                  tone={g.kedaluwarsa ? 'attention' : NADA_STATUS[g.status]}
                  detail={g.status === 'DITOLAK' ? g.catatan : null}
                >
                  {td(`status_${g.status}`)}
                </StatusPill>
                {g.kedaluwarsa && (
                  <span className="mt-1 flex items-start gap-1 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {t('expired')}
                  </span>
                )}
              </TableCell>
              {menunggu && bolehMemutuskan && (
                <TableCell className="sticky right-0 bg-card text-right">
                  <TombolGiro claimId={g.id} giroNo={g.giroNo} nilai={formatIDR(g.nilai)} susun />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
