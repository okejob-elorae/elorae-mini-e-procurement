'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import { pasangFotoKontrabonAction } from '@/app/actions/collections';
import type { RincianKontrabon } from '@/lib/receivables/collection-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<RincianKontrabon['baris']['status'], StatusTone> = {
  BERJALAN: 'waiting',
  SELESAI: 'settled',
  BATAL: 'inactive',
};

export function RincianKontrabonClient({
  data,
  bolehMengelola,
}: {
  data: RincianKontrabon;
  bolehMengelola: boolean;
}) {
  const t = useTranslations('collections');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [foto, setFoto] = useState<NilaiFoto>(
    data.fotoUrl ? { url: data.fotoUrl, nama: data.baris.docNo } : null,
  );

  const b = data.baris;
  const terlambat = b.status === 'BERJALAN' && (b.sisaHari ?? 0) < 0;
  const sudahDibayar = b.nilaiSerah - b.sisaSekarang;

  const simpanFoto = (nilai: NilaiFoto) => {
    setFoto(nilai);
    if (!nilai) return;
    startTransition(async () => {
      const hasil = await pasangFotoKontrabonAction(b.id, nilai.url);
      if (hasil.ok) {
        toast.success(t('okPhoto'));
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/kontrabon">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={b.docNo}
        description={[
          b.storeName,
          b.salesmanName,
          b.receivedBy && t('receivedBy', { name: b.receivedBy }),
        ]
          .filter(Boolean)
          .join(' · ')}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={NADA[b.status]}>{td(`status${b.status}`)}</StatusPill>
            <span className={cn('text-sm', terlambat ? 'text-destructive' : 'text-muted-foreground')}>
              {t('promisedOn', { date: tanggal(b.promisedDate) })}
              {b.sisaHari !== null &&
                ` · ${
                  terlambat
                    ? t('lateBy', { days: Math.abs(b.sisaHari) })
                    : t('dueIn', { days: b.sisaHari })
                }`}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('invoicesTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('invoicesHint')}</p>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colInvoice')}</TableHead>
                  <TableHead className="text-right">{t('colAtHandover')}</TableHead>
                  <TableHead className="text-right">{t('colNow')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.faktur.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.invoiceNo}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rupiah(f.nilaiSerah)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        f.sisaSekarang === 0 && 'text-emerald-600 dark:text-emerald-500',
                      )}
                    >
                      {rupiah(f.sisaSekarang)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">{t('total')}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {rupiah(b.nilaiSerah)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {rupiah(b.sisaSekarang)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {sudahDibayar > 0 && (
              <p className="px-6 pt-3 text-sm text-muted-foreground">
                {t('paidSince', { value: rupiah(sudahDibayar) })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('photoTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {bolehMengelola ? (
              <UnggahFoto
                label={t('photoLabel')}
                petunjuk={t('photoHint')}
                nilai={foto}
                onChange={simpanFoto}
                disabled={pending}
              />
            ) : foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto.url} alt={b.docNo} className="w-full rounded-lg border object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground">{t('noPhoto')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('claimsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={data.klaim.length === 0 ? undefined : 'px-0'}>
          {data.klaim.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('claimsEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colClaim')}</TableHead>
                  <TableHead className="text-right">{t('colReceived')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.klaim.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>
                      <Link
                        href={`/backoffice/pelunasan/${k.id}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {k.docNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupiah(k.nilaiDiterima)}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={k.status === 'TERVERIFIKASI' ? 'settled' : 'waiting'}>
                        {k.status}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.catatan && (
        <Card>
          <CardContent className="py-4 text-sm whitespace-pre-line">{data.catatan}</CardContent>
        </Card>
      )}
    </div>
  );
}
