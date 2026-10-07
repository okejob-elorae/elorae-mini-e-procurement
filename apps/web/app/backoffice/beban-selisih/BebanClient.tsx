'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Scale } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { dinamis } from '@/lib/i18n/dinamis';
import { alihkanBebanAction, tandaiBebanLunasAction } from '@/app/actions/store-returns';
import type { BarisBeban } from '@/lib/receivables/dashboard-queries';
import type { FakturBebanRingkas } from '@/lib/receivables/return-queries';

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

const PENANGGUNG = ['TOKO', 'SALES', 'GUDANG', 'PERUSAHAAN'] as const;

export function BebanClient({
  baris,
  kandidat,
  bolehMengelola,
  faktur = {},
  tagihanToko = {},
}: {
  baris: BarisBeban[];
  kandidat: { id: string; name: string }[];
  bolehMengelola: boolean;
  /** Faktur beban toko per id beban. */
  faktur?: Record<string, FakturBebanRingkas>;
  /** Yang ditagihkan ke toko saat beban TOKO terakhir ditetapkan (`tagihanBebanTokoTercatat`). */
  tagihanToko?: Record<string, number>;
}) {
  const t = useTranslations('bebanSelisih');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saring, setSaring] = useState<BarisBeban['status'] | null>(null);
  const [alih, setAlih] = useState<BarisBeban | null>(null);
  const [penanggung, setPenanggung] = useState<(typeof PENANGGUNG)[number]>('SALES');
  const [orangId, setOrangId] = useState('');
  const [alasan, setAlasan] = useState('');

  const yatim = baris.filter((b) => b.tanpaAlamat).length;

  const tampil = saring ? baris.filter((b) => b.status === saring) : baris;
  const jumlah = (s: BarisBeban['status']) => baris.filter((b) => b.status === s).length;
  const nilaiTerbuka = baris
    .filter((b) => b.status === 'TERBUKA')
    .reduce((s, b) => s + b.nilai, 0);

  // Beban TOKO yang ditagih 0: tidak ada faktur dan tidak ada yang bisa "diganti".
  const tanpaTagihan = (b: BarisBeban) => b.penanggung === 'TOKO' && !faktur[b.id] && tagihanToko[b.id] === 0;

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
        meta={t('summary', { count: jumlah('TERBUKA'), value: rupiah(nilaiTerbuka) })}
      />

      {yatim > 0 && (
        <Card className="border-destructive/40 bg-destructive/[0.05]">
          <CardContent className="flex items-start gap-3 py-4 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{t('orphanWarning', { count: yatim })}</span>
          </CardContent>
        </Card>
      )}

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
                            {b.tanpaAlamat && (
                              <span className="block text-xs font-medium text-destructive">
                                {t('orphanRow')}
                              </span>
                            )}
                            {faktur[b.id] && (
                              <span className="block text-xs text-muted-foreground">
                                {t('invoiceRow', {
                                  no: faktur[b.id].invoiceNo,
                                  sisa: rupiah(faktur[b.id].outstanding),
                                })}
                              </span>
                            )}
                            {b.penanggung === 'TOKO' && !faktur[b.id] && tagihanToko[b.id] !== undefined && (
                              <span className="block text-xs text-muted-foreground">
                                {t('tokoBilledRow', { value: rupiah(tagihanToko[b.id]) })}
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
                          <span className="inline-flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                setAlih(b);
                                setPenanggung(b.penanggung ?? 'SALES');
                                setOrangId('');
                                setAlasan('');
                              }}
                            >
                              {t('reassign')}
                            </Button>
                            {/* Beban toko lunas lewat BKM atas fakturnya, bukan ditandai di sini. */}
                            {!faktur[b.id] && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || tanpaTagihan(b)}
                                onClick={() => lunaskan(b.id)}
                              >
                                {t('markSettled')}
                              </Button>
                            )}
                          </span>
                        )}
                        {b.status === 'DITETAPKAN' && bolehMengelola && tanpaTagihan(b) && (
                          <span className="mt-1 block text-xs text-muted-foreground">{t('markSettledNothingBilled')}</span>
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

      <Dialog open={alih !== null} onOpenChange={(o) => !o && setAlih(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reassignTitle')}</DialogTitle>
            <DialogDescription>{t('reassignBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="alih-siapa">{t('colBearer')}</Label>
              <Select value={penanggung} onValueChange={(v) => setPenanggung(v as never)}>
                <SelectTrigger id="alih-siapa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PENANGGUNG.map((k) => (
                    <SelectItem key={k} value={k}>
                      {td(`bearer${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Faktur beban mengikuti keputusannya — katakan sebelum disimpan. */}
            {alih && penanggung === 'TOKO' && !faktur[alih.id] && (
              <p className="text-xs text-muted-foreground">{t('reassignToTokoHint', { value: rupiah(alih.nilai) })}</p>
            )}
            {alih && penanggung !== 'TOKO' && faktur[alih.id] && (
              <p className="text-xs text-muted-foreground">
                {t('reassignFromTokoHint', { no: faktur[alih.id].invoiceNo })}
              </p>
            )}
            {penanggung === 'SALES' && (
              <div className="space-y-2">
                <Label htmlFor="alih-orang">{t('bearerPerson')}</Label>
                <Select value={orangId} onValueChange={setOrangId}>
                  <SelectTrigger id="alih-orang">
                    <SelectValue placeholder={t('bearerPersonPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {kandidat.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="alih-alasan">{t('reassignReason')}</Label>
              <Textarea
                id="alih-alasan"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                alasan.trim().length === 0 ||
                (penanggung === 'SALES' && orangId === '')
              }
              onClick={() =>
                alih &&
                startTransition(async () => {
                  const hasil = await alihkanBebanAction(
                    alih.id,
                    penanggung,
                    alasan,
                    penanggung === 'SALES' ? orangId : null,
                  );
                  if (hasil.ok) {
                    toast.success(t('okReassigned'));
                    setAlih(null);
                    router.refresh();
                  } else {
                    toast.error(td(`err${hasil.kode}`));
                  }
                })
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
