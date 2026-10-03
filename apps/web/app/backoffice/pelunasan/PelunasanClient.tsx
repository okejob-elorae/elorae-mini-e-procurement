'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeCheck, Landmark, Plus, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
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
import { dinamis } from '@/lib/i18n/dinamis';
import type { StatusGiro } from '@/lib/receivables/giro';
import { TombolGiro } from './giro/TombolGiro';

export type BarisKlaim = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  claimedTransferAt: string;
  invoiceAmount: number;
  deductionTotal: number;
  receivedAmount: number;
  deductionCount: number;
  status: string;
  verifyNote: string | null;
  nilaiTertahan: number;
  /** Rincian bilyet kalau dibayar dengan giro. Tanggal sudah diformat di server. */
  giro: { nomor: string; efektif: string; status: StatusGiro; kedaluwarsa: boolean } | null;
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<string, StatusTone> = {
  DIKIRIM: 'waiting',
  TERVERIFIKASI: 'settled',
  DITOLAK: 'inactive',
};

export function PelunasanClient({
  baris,
  giroMenunggu,
  bolehMemutuskan,
  bolehMengelola,
}: {
  baris: BarisKlaim[];
  /** Giro yang klaimnya masih menunggu cair — angka pada tautan Daftar giro. */
  giroMenunggu: number;
  bolehMemutuskan: boolean;
  bolehMengelola: boolean;
}) {
  const t = useTranslations('payments');
  const tGiro = dinamis(useTranslations('giro'));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tolakId, setTolakId] = useState<string | null>(null);
  const [alasan, setAlasan] = useState('');

  const menunggu = baris.filter((b) => b.status === 'DIKIRIM').length;

  const putuskan = (id: string, keputusan: 'TERVERIFIKASI' | 'DITOLAK', catatan?: string) => {
    startTransition(async () => {
      const hasil = await verifikasiKlaimAction(id, keputusan, catatan);
      if (hasil.ok) {
        toast.success(keputusan === 'TERVERIFIKASI' ? t('okVerified') : t('okRejected'));
        setTolakId(null);
        setAlasan('');
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
        meta={t('summary', { count: baris.length, pending: menunggu })}
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/backoffice/pelunasan/giro">
                <Landmark className="mr-1.5 h-4 w-4" />
                {t('giroListLink', { count: giroMenunggu })}
              </Link>
            </Button>
            {bolehMengelola && (
              <Button asChild>
                <Link href="/backoffice/pelunasan/baru">
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t('newClaim')}
                </Link>
              </Button>
            )}
          </span>
        }
      />

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState icon={Wallet} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead>{t('colClaimedAt')}</TableHead>
                    <TableHead className="text-right">{t('colInvoice')}</TableHead>
                    <TableHead className="text-right">{t('colReceived')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow
                      key={b.id}
                      /* Klaim yang menunggu keputusan diberi latar tipis: inilah
                         satu-satunya baris yang menuntut tindakan hari ini. */
                      className={cn(b.status === 'DIKIRIM' && 'bg-amber-500/[0.05]')}
                    >
                      <TableCell>
                        <Link
                          href={`/backoffice/pelunasan/${b.id}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {b.docNo}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal min-w-[9rem] max-w-[14rem]">
                        {b.storeName}
                        {b.salesmanName && (
                          <span className="block text-xs text-muted-foreground">
                            {b.salesmanName}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{tanggal(b.claimedTransferAt)}</TableCell>
                      <TableCell className="text-right text-muted-foreground whitespace-normal min-w-[7.5rem]">
                        {rupiah(b.invoiceAmount)}
                        {b.deductionCount > 0 && (
                          <span className="block text-xs">
                            {t('deductions', {
                              count: b.deductionCount,
                              value: rupiah(b.deductionTotal),
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {rupiah(b.receivedAmount)}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={NADA[b.status] ?? 'inactive'}
                          detail={
                            b.status === 'TERVERIFIKASI' && b.nilaiTertahan > 0
                              ? t('held', { value: rupiah(b.nilaiTertahan) })
                              : b.verifyNote
                          }
                        >
                          {t(`status${b.status}` as never)}
                        </StatusPill>
                        {b.giro && (
                          <span
                            className={cn(
                              'mt-1 block text-xs',
                              b.giro.kedaluwarsa ? 'text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            {t('giroLine', { no: b.giro.nomor, date: b.giro.efektif })}
                            {' · '}
                            {tGiro(`status_${b.giro.status}`)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card text-right">
                        {/* Giro yang menunggu tidak diverifikasi ke mutasi biasa:
                            yang diputuskan adalah bilyetnya — cair atau ditolak. */}
                        {b.status === 'DIKIRIM' && bolehMemutuskan && b.giro?.status === 'MENUNGGU' && (
                          <TombolGiro
                            claimId={b.id}
                            giroNo={b.giro.nomor}
                            nilai={rupiah(b.receivedAmount)}
                            susun
                          />
                        )}
                        {b.status === 'DIKIRIM' && bolehMemutuskan && b.giro?.status !== 'MENUNGGU' && (
                          // Stacked like kontrabon: side by side, the two
                          // buttons pushed the table past its card at 1280 px.
                          <span className="inline-flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => putuskan(b.id, 'TERVERIFIKASI')}
                            >
                              <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
                              {t('verify')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                setTolakId(b.id);
                                setAlasan('');
                              }}
                            >
                              {t('reject')}
                            </Button>
                          </span>
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

      <Dialog open={tolakId !== null} onOpenChange={(open) => !open && setTolakId(null)}>
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
              onClick={() => tolakId && putuskan(tolakId, 'DITOLAK', alasan)}
            >
              {t('reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
