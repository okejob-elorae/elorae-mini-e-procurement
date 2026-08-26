'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, ImageOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { verifikasiKlaimAction } from '@/app/actions/receivables';
import type { RincianKlaim } from '@/lib/receivables/claim-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<RincianKlaim['status'], StatusTone> = {
  DIKIRIM: 'waiting',
  TERVERIFIKASI: 'settled',
  DITOLAK: 'inactive',
};

export function RincianKlaimClient({
  data,
  bolehMemutuskan,
}: {
  data: RincianKlaim;
  bolehMemutuskan: boolean;
}) {
  const t = useTranslations('payments');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tolakTerbuka, setTolakTerbuka] = useState(false);
  const [alasan, setAlasan] = useState('');

  const putuskan = (keputusan: 'TERVERIFIKASI' | 'DITOLAK', catatan?: string) => {
    startTransition(async () => {
      const hasil = await verifikasiKlaimAction(data.id, keputusan, catatan);
      if (hasil.ok) {
        toast.success(keputusan === 'TERVERIFIKASI' ? t('okVerified') : t('okRejected'));
        setTolakTerbuka(false);
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/pelunasan">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={data.docNo}
        description={[
          data.storeName,
          data.salesmanName,
          t(`method_${data.method}` as never),
          t('claimedOn', { date: tanggal(data.claimedTransferAt) }),
        ]
          .filter(Boolean)
          .join(' · ')}
        meta={<StatusPill tone={NADA[data.status]}>{t(`status${data.status}` as never)}</StatusPill>}
        actions={
          data.status === 'DIKIRIM' && bolehMemutuskan ? (
            <span className="inline-flex gap-2">
              <Button disabled={pending} onClick={() => putuskan('TERVERIFIKASI')}>
                <BadgeCheck className="mr-1.5 h-4 w-4" />
                {t('verify')}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setTolakTerbuka(true);
                  setAlasan('');
                }}
              >
                {t('reject')}
              </Button>
            </span>
          ) : undefined
        }
      />

      {/* Dua bukti berdampingan — inilah yang dicocokkan admin dengan mutasi. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('sectionProof')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('proofHint')}</p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Bukti label={t('transferPhoto')} url={data.fotoTransfer} kosong={t('noPhotoTransfer')} />
          <Bukti label={t('breakdownPhoto')} url={data.fotoRincian} kosong={t('noPhotoBreakdown')} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionInvoices')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colInvoiceNo')}</TableHead>
                  <TableHead className="text-right">{t('colInvoiceValue')}</TableHead>
                  <TableHead className="text-right">{t('colSettled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.faktur.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.invoiceNo}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rupiah(f.nilaiFaktur)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {rupiah(f.nilaiDilunasi)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionDeductions')}</CardTitle>
          </CardHeader>
          <CardContent className={data.potongan.length === 0 ? undefined : 'px-0'}>
            {data.potongan.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDeductions')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('deductionName')}</TableHead>
                    <TableHead className="text-right">{t('deductionAmount')}</TableHead>
                    <TableHead className="text-right">{t('colHeld')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.potongan.map((p, i) => (
                    <TableRow key={i} className={cn(p.tertahan > 0 && 'bg-destructive/[0.06]')}>
                      <TableCell>
                        <span className="font-medium">{p.nama}</span>
                        {p.noNrt && (
                          <Link
                            href={`/backoffice/retur-toko/${p.storeReturnId}`}
                            className="block text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {p.noNrt}
                          </Link>
                        )}
                        {p.catatan && (
                          <span className="block text-xs text-muted-foreground">{p.catatan}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(p.nilai)}</TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          p.tertahan > 0 && 'font-semibold text-destructive',
                        )}
                      >
                        {p.tertahan > 0 ? rupiah(p.tertahan) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card
        className={cn(
          data.status === 'TERVERIFIKASI' && data.nilaiTertahan > 0 && 'border-destructive/40',
        )}
      >
        <CardContent className="space-y-2 py-4">
          <Baris label={t('totalInvoice')} value={rupiah(data.nilaiFaktur)} />
          <Baris label={t('totalDeduction')} value={`− ${rupiah(data.totalPotongan)}`} />
          <div className="flex items-baseline justify-between border-t pt-2">
            <span className="font-medium">{t('totalReceived')}</span>
            <span className="text-lg font-semibold tabular-nums">{rupiah(data.nilaiDiterima)}</span>
          </div>

          {data.status === 'DIKIRIM' && (
            <p className="text-xs text-muted-foreground">{t('claimNotSettled')}</p>
          )}
          {data.status === 'TERVERIFIKASI' && data.nilaiTertahan > 0 && (
            <p className="text-sm text-destructive">
              {t('heldExplain', { value: rupiah(data.nilaiTertahan) })}
            </p>
          )}
          {data.status !== 'DIKIRIM' && data.verifikatorNama && (
            <p className="text-xs text-muted-foreground">
              {t('decidedBy', {
                name: data.verifikatorNama,
                date: data.verifikasiPada ? tanggal(data.verifikasiPada) : '—',
              })}
            </p>
          )}
          {data.catatanVerifikasi && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.catatanVerifikasi}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={tolakTerbuka} onOpenChange={setTolakTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectTitle')}</DialogTitle>
            <DialogDescription>{t('rejectBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-tolak">{t('rejectReason')}</Label>
            <Textarea
              id="alasan-tolak"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('rejectPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasan.trim().length === 0}
              onClick={() => putuskan('DITOLAK', alasan)}
            >
              {t('reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bukti({ label, url, kosong }: { label: string; url: string | null; kosong: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="max-h-96 w-full rounded-lg border object-contain transition-opacity hover:opacity-90"
          />
        </a>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <ImageOff className="h-4 w-4 shrink-0" />
          {kosong}
        </div>
      )}
    </div>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
