'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Handshake, Plus, Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
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
import { BarisBarangEditor, type PilihanBarang } from '../retur-toko/BarisBarangEditor';
import type { BarisBarang } from '@/lib/receivables/return-writer';
import type { BarisSiklus } from '@/lib/konsinyasi/queries';
import type { TahapSiklus } from '@/lib/konsinyasi/aturan';
import { bukaSiklusAction, kirimTitipanAction } from '@/app/actions/konsinyasi';
import { NADA_TAHAP, URUT_TAHAP } from './tahap';

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

function hariIniWib(tambah = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
    new Date(Date.now() + tambah * 86_400_000),
  );
}

export function KonsinyasiClient({
  baris,
  toko,
  katalog,
  bolehMengelola,
}: {
  baris: BarisSiklus[];
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('konsinyasi');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saring, setSaring] = useState<TahapSiklus | null>(null);

  const [siklusTerbuka, setSiklusTerbuka] = useState(false);
  const [storeId, setStoreId] = useState('');
  const now = new Date();
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [bulan, setBulan] = useState(String(now.getMonth() + 1));
  const [tenggat, setTenggat] = useState(hariIniWib(10));

  const [kirimTerbuka, setKirimTerbuka] = useState(false);
  const [tokoKirim, setTokoKirim] = useState('');
  const [tglKirim, setTglKirim] = useState(hariIniWib());
  const [barang, setBarang] = useState<BarisBarang[]>([]);
  const [catatanKirim, setCatatanKirim] = useState('');

  const jumlah = (x: TahapSiklus) => baris.filter((b) => b.tahap === x).length;
  const tampil = saring ? baris.filter((b) => b.tahap === saring) : baris;
  const terlambat = baris.filter((b) => b.gajiTerlambat).length;

  const jalankan = (
    fn: () => Promise<{ ok: boolean; kode?: string }>,
    pesan: string,
    bersih: () => void,
  ) => {
    startTransition(async () => {
      const hasil = await fn();
      if (hasil.ok) {
        toast.success(pesan);
        bersih();
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        meta={t('summary', { count: baris.length, late: terlambat })}
        actions={
          bolehMengelola ? (
            <span className="inline-flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setKirimTerbuka(true)} disabled={toko.length === 0}>
                <Truck className="mr-1.5 h-4 w-4" />
                {t('ship')}
              </Button>
              <Button onClick={() => setSiklusTerbuka(true)} disabled={toko.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('openCycle')}
              </Button>
            </span>
          ) : undefined
        }
      />

      {terlambat > 0 && (
        <Card className="border-destructive/40 bg-destructive/[0.05]">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{t('lateWarning', { count: terlambat })}</span>
          </CardContent>
        </Card>
      )}

      <div className="anim-stagger flex flex-wrap gap-2">
        {URUT_TAHAP.filter((x) => jumlah(x) > 0).map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setSaring(saring === x ? null : x)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              saring === x ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            <StatusPill tone={NADA_TAHAP[x]}>{td(`stage_${x}`)}</StatusPill>
            <span className="ml-2 tabular-nums text-muted-foreground">{jumlah(x)}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            <EmptyState icon={Handshake} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCycle')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead className="text-right">{t('colSold')}</TableHead>
                    {/* Tiga nomor berdampingan — inilah yang dulu tersimpan di
                        kepala tiga orang berbeda. */}
                    <TableHead>{t('colNota')}</TableHead>
                    <TableHead>{t('colTax')}</TableHead>
                    <TableHead>{t('colStage')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow key={b.id} className={cn(b.gajiTerlambat && 'bg-destructive/[0.06]')}>
                      <TableCell>
                        <Link
                          href={`/backoffice/konsinyasi/${b.id}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {b.noKonsi}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.periode}</span>
                      </TableCell>
                      <TableCell>{b.storeName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.nilaiTerjual > 0 ? rupiah(b.nilaiTerjual) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.noNota ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{b.noFakturPajak ?? '—'}</TableCell>
                      <TableCell>
                        <div className="max-w-xs space-y-1">
                          <StatusPill tone={NADA_TAHAP[b.tahap]}>{td(`stage_${b.tahap}`)}</StatusPill>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {b.giliran !== 'tidak_ada' && (
                              <span className="font-medium text-foreground">
                                {t('turnOf', { who: td(`who_${b.giliran}`) })}{' '}
                              </span>
                            )}
                            {td(`why_${b.tahap}`)}
                          </p>
                          {b.gajiTerlambat && (
                            <p className="text-xs font-medium text-destructive">
                              {t('salaryLate', { date: tanggal(b.tenggatSpg) })}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={siklusTerbuka} onOpenChange={setSiklusTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('openCycleTitle')}</DialogTitle>
            <DialogDescription>{t('openCycleBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="k-toko">{t('store')}</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger id="k-toko">
                  <SelectValue placeholder={t('storePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {toko.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="k-bulan">{t('month')}</Label>
                <Input id="k-bulan" type="number" min={1} max={12} value={bulan} onChange={(e) => setBulan(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="k-tahun">{t('year')}</Label>
                <Input id="k-tahun" type="number" min={2000} value={tahun} onChange={(e) => setTahun(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="k-tenggat">{t('spgDue')}</Label>
              <Input id="k-tenggat" type="date" value={tenggat} onChange={(e) => setTenggat(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('spgDueHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !storeId || !(Number(bulan) >= 1 && Number(bulan) <= 12)}
              onClick={() =>
                jalankan(
                  () =>
                    bukaSiklusAction({
                      storeId,
                      periodYear: Number(tahun),
                      periodMonth: Number(bulan),
                      spgDueDate: tenggat,
                    }),
                  t('okCycleOpened'),
                  () => {
                    setSiklusTerbuka(false);
                    setStoreId('');
                  },
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kirimTerbuka} onOpenChange={setKirimTerbuka}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('shipTitle')}</DialogTitle>
            <DialogDescription>{t('shipBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kk-toko">{t('store')}</Label>
                <Select value={tokoKirim} onValueChange={setTokoKirim}>
                  <SelectTrigger id="kk-toko">
                    <SelectValue placeholder={t('storePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {toko.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="kk-tgl">{t('shipDate')}</Label>
                <Input id="kk-tgl" type="date" value={tglKirim} onChange={(e) => setTglKirim(e.target.value)} />
              </div>
            </div>

            <BarisBarangEditor
              rows={barang}
              onChange={setBarang}
              qtyLabel={t('qty')}
              katalog={katalog}
            />

            <div className="space-y-2">
              <Label htmlFor="kk-catatan">{t('noteLabel')}</Label>
              <Textarea id="kk-catatan" value={catatanKirim} onChange={(e) => setCatatanKirim(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                !tokoKirim ||
                barang.length === 0 ||
                !barang.every((b) => b.itemName.trim() && b.qty > 0)
              }
              onClick={() =>
                jalankan(
                  () =>
                    kirimTitipanAction({
                      storeId: tokoKirim,
                      shippedAt: tglKirim,
                      items: barang,
                      note: catatanKirim,
                    }),
                  t('okShipped'),
                  () => {
                    setKirimTerbuka(false);
                    setTokoKirim('');
                    setBarang([]);
                    setCatatanKirim('');
                  },
                )
              }
            >
              {t('saveShip')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
