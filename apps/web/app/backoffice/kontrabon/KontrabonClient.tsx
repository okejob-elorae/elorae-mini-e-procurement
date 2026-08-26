'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ClipboardList, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { buatKontrabonAction, tutupKontrabonAction } from '@/app/actions/collections';
import type { BarisKontrabon, TokoSiapKontrabon } from '@/lib/receivables/collection-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

/** Tanggal hari ini di WIB sebagai "YYYY-MM-DD" untuk nilai awal input. */
function hariIniWib(tambahHari = 0): string {
  const d = new Date(Date.now() + tambahHari * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

const NADA: Record<BarisKontrabon['status'], StatusTone> = {
  BERJALAN: 'waiting',
  SELESAI: 'settled',
  BATAL: 'inactive',
};

export function KontrabonClient({
  baris,
  kandidat,
  bolehMengelola,
}: {
  baris: BarisKontrabon[];
  kandidat: TokoSiapKontrabon[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('collections');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [buatTerbuka, setBuatTerbuka] = useState(false);
  const [tokoDipilih, setTokoDipilih] = useState<string | null>(null);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [serah, setSerah] = useState(hariIniWib());
  const [janji, setJanji] = useState(hariIniWib(14));
  const [penerima, setPenerima] = useState('');
  const [catatan, setCatatan] = useState('');
  const [tutupId, setTutupId] = useState<string | null>(null);
  const [alasanBatal, setAlasanBatal] = useState('');

  const lewat = baris.filter((b) => b.status === 'BERJALAN' && (b.sisaHari ?? 0) < 0).length;
  const berjalan = baris.filter((b) => b.status === 'BERJALAN').length;

  const toko = kandidat.find((k) => k.storeId === tokoDipilih) ?? null;
  const nilaiTerpilih = useMemo(
    () =>
      (toko?.piutang ?? [])
        .filter((p) => terpilih.has(p.id))
        .reduce((sum, p) => sum + p.outstanding, 0),
    [toko, terpilih],
  );

  const bukaBuat = () => {
    setTokoDipilih(null);
    setTerpilih(new Set());
    setSerah(hariIniWib());
    setJanji(hariIniWib(14));
    setPenerima('');
    setCatatan('');
    setBuatTerbuka(true);
  };

  const pilihToko = (storeId: string) => {
    // Berpindah toko mengosongkan pilihan: satu kontrabon hanya untuk satu toko,
    // dan membawa centang lintas toko akan ditolak penulis.
    setTokoDipilih(storeId);
    setTerpilih(new Set());
  };

  const alihkan = (id: string) => {
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });
  };

  const simpan = () => {
    startTransition(async () => {
      const hasil = await buatKontrabonAction({
        receivableIds: [...terpilih],
        handoverDate: serah,
        promisedDate: janji,
        receivedBy: penerima,
        note: catatan,
      });
      if (hasil.ok) {
        toast.success(t('okCreated'));
        setBuatTerbuka(false);
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  const tutup = (id: string, keputusan: 'SELESAI' | 'BATAL', alasan?: string) => {
    startTransition(async () => {
      const hasil = await tutupKontrabonAction(id, keputusan, alasan);
      if (hasil.ok) {
        toast.success(keputusan === 'SELESAI' ? t('okFinished') : t('okCancelled'));
        setTutupId(null);
        setAlasanBatal('');
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
        meta={t('summary', { running: berjalan, late: lewat })}
        actions={
          bolehMengelola ? (
            <Button onClick={bukaBuat} disabled={kandidat.length === 0}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('create')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead>{t('colHandover')}</TableHead>
                    <TableHead>{t('colPromised')}</TableHead>
                    <TableHead className="text-right">{t('colHandoverValue')}</TableHead>
                    <TableHead className="text-right">{t('colRemaining')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => {
                    const terlambat = b.status === 'BERJALAN' && (b.sisaHari ?? 0) < 0;
                    return (
                      <TableRow
                        key={b.id}
                        /* Hanya kontrabon yang sudah lewat janji diberi latar
                           merah tipis — sisanya belum menuntut tindakan apa pun. */
                        className={cn(terlambat && 'bg-destructive/[0.06]')}
                      >
                        <TableCell>
                        <Link
                          href={`/backoffice/kontrabon/${b.id}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {b.docNo}
                        </Link>
                      </TableCell>
                        <TableCell>
                          {b.storeName}
                          <span className="block text-xs text-muted-foreground">
                            {[
                              b.salesmanName,
                              b.receivedBy && t('receivedBy', { name: b.receivedBy }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </TableCell>
                        <TableCell>{tanggal(b.handoverDate)}</TableCell>
                        <TableCell>
                          {tanggal(b.promisedDate)}
                          {b.sisaHari !== null && (
                            <span
                              className={cn(
                                'block text-xs',
                                terlambat ? 'text-destructive' : 'text-muted-foreground',
                              )}
                            >
                              {terlambat
                                ? t('lateBy', { days: Math.abs(b.sisaHari) })
                                : t('dueIn', { days: b.sisaHari })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {rupiah(b.nilaiSerah)}
                          <span className="block text-xs">
                            {t('invoiceCount', { count: b.jumlahFaktur })}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {rupiah(b.sisaSekarang)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={NADA[b.status]}>
                            {t(`status${b.status}` as never)}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          {b.status === 'BERJALAN' && bolehMengelola && (
                            <span className="inline-flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || b.sisaSekarang > 0}
                                /* Menandai selesai hanya masuk akal kalau
                                   uangnya sudah masuk — penulis menolaknya juga,
                                   tombolnya dimatikan supaya alasannya terbaca. */
                                title={b.sisaSekarang > 0 ? t('finishBlocked') : undefined}
                                onClick={() => tutup(b.id, 'SELESAI')}
                              >
                                {t('finish')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => {
                                  setTutupId(b.id);
                                  setAlasanBatal('');
                                }}
                              >
                                {t('cancel')}
                              </Button>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={buatTerbuka} onOpenChange={setBuatTerbuka}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createBody')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('pickStore')}</Label>
              <div className="anim-stagger flex flex-wrap gap-2">
                {kandidat.map((k) => (
                  <button
                    key={k.storeId}
                    type="button"
                    onClick={() => pilihToko(k.storeId)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      k.storeId === tokoDipilih
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    {k.storeName}
                    <span className="ml-1.5 opacity-70">{rupiah(k.total)}</span>
                  </button>
                ))}
              </div>
            </div>

            {toko && (
              <div className="space-y-2">
                <Label>{t('pickInvoices')}</Label>
                <div className="rounded-md border">
                  {toko.piutang.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={terpilih.has(p.id)}
                        onCheckedChange={() => alihkan(p.id)}
                      />
                      <span className="flex-1 text-sm font-medium">{p.invoiceNo}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('dueOn', { date: tanggal(p.dueDate) })}
                      </span>
                      <span className="w-32 text-right text-sm tabular-nums">
                        {rupiah(p.outstanding)}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-right text-sm">
                  {t('selectedTotal', {
                    count: terpilih.size,
                    value: rupiah(nilaiTerpilih),
                  })}
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tt-serah">{t('handoverDate')}</Label>
                <Input
                  id="tt-serah"
                  type="date"
                  value={serah}
                  onChange={(e) => setSerah(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tt-janji">{t('promisedDate')}</Label>
                <Input
                  id="tt-janji"
                  type="date"
                  value={janji}
                  onChange={(e) => setJanji(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tt-penerima">{t('receivedByLabel')}</Label>
              <Input
                id="tt-penerima"
                value={penerima}
                onChange={(e) => setPenerima(e.target.value)}
                placeholder={t('receivedByPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tt-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="tt-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button disabled={pending || terpilih.size === 0} onClick={simpan}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tutupId !== null} onOpenChange={(open) => !open && setTutupId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cancelTitle')}</DialogTitle>
            <DialogDescription>{t('cancelBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tt-alasan">{t('cancelReason')}</Label>
            <Textarea
              id="tt-alasan"
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              placeholder={t('cancelPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasanBatal.trim().length === 0}
              onClick={() => tutupId && tutup(tutupId, 'BATAL', alasanBatal)}
            >
              {t('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
