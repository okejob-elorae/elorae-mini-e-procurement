'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Lock, LockOpen, Plus, Printer, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
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
import type { RincianSiklus } from '@/lib/konsinyasi/queries';
import type { PilihanBarang } from '../../retur-toko/BarisBarangEditor';
import {
  bayarKomisiAction,
  bukaKunciAction,
  catatLaporanAction,
  catatNomorDokumenAction,
  kunciAngkaAction,
} from '@/app/actions/konsinyasi';
import { NADA_TAHAP } from '../tahap';

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

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

type BarisResmi = { itemId: string | null; itemName: string; qty: number; price: number };

export function RincianSiklusClient({
  data,
  katalog,
  bolehMengelola,
}: {
  data: RincianSiklus;
  katalog: PilihanBarang[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('konsinyasi');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [laporanTerbuka, setLaporanTerbuka] = useState<'SPG' | 'TOKO' | null>(null);
  const [barisLaporan, setBarisLaporan] = useState<{ itemName: string; qty: number }[]>([]);

  const [kunciTerbuka, setKunciTerbuka] = useState(false);
  const [resmi, setResmi] = useState<BarisResmi[]>([]);
  const [gajiPokok, setGajiPokok] = useState('0');

  const [nomorTerbuka, setNomorTerbuka] = useState<'NOTA' | 'PAJAK' | null>(null);
  const [nomor, setNomor] = useState('');

  const b = data.baris;

  /* Angka resmi dimulai dari laporan SPG, bukan kosong: itulah yang paling
     sering benar, dan admin membetulkan selisihnya alih-alih mengetik ulang. */
  const bukaKunciDialog = () => {
    setResmi(
      data.banding.map((x) => ({
        itemId: null,
        itemName: x.itemName,
        qty: x.qtySpg ?? x.qtyToko ?? 0,
        price: 0,
      })),
    );
    setGajiPokok('0');
    setKunciTerbuka(true);
  };

  const totalResmi = useMemo(
    () => resmi.reduce((s, r) => s + (r.qty || 0) * (r.price || 0), 0),
    [resmi],
  );

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
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/konsinyasi">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('back')}
        </Link>
      </Button>

      <PageHeader
        title={b.noKonsi}
        description={`${b.storeName} · ${b.periode}`}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={NADA_TAHAP[b.tahap]}>{td(`stage_${b.tahap}`)}</StatusPill>
            {b.giliran !== 'tidak_ada' && (
              <span className="text-sm text-muted-foreground">
                {t('turnOf', { who: td(`who_${b.giliran}`) })}
              </span>
            )}
          </span>
        }
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={`/print/konsi/${b.id}`} target="_blank" rel="noreferrer">
                <Printer className="mr-1.5 h-4 w-4" />
                {t('print')}
              </a>
            </Button>
            {bolehMengelola ? (
            data.terkunci ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  jalankan(() => bukaKunciAction(b.id), t('okUnlocked'), () => {})
                }
              >
                <LockOpen className="mr-1.5 h-4 w-4" />
                {t('unlock')}
              </Button>
            ) : (
              <Button disabled={pending} onClick={bukaKunciDialog}>
                <Lock className="mr-1.5 h-4 w-4" />
                {t('lock')}
              </Button>
            )
          ) : null}
          </span>
        }
      />

      {/* Tiga nomor berdampingan. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('threeNumbers')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('threeNumbersHint')}</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Nomor label={t('numKonsi')} nilai={b.noKonsi} milik={t('ownerUs')} />
          <Nomor
            label={t('numNota')}
            nilai={b.noNota}
            milik={t('ownerSales')}
            aksi={
              bolehMengelola && data.terkunci && !b.noNota ? (
                <Button size="sm" variant="outline" onClick={() => { setNomorTerbuka('NOTA'); setNomor(''); }}>
                  {t('record')}
                </Button>
              ) : undefined
            }
          />
          <Nomor
            label={t('numTax')}
            nilai={b.noFakturPajak}
            milik={t('ownerTax')}
            aksi={
              bolehMengelola && data.terkunci && !b.noFakturPajak ? (
                <Button size="sm" variant="outline" onClick={() => { setNomorTerbuka('PAJAK'); setNomor(''); }}>
                  {t('record')}
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>

      {/* Dua laporan disandingkan per barang. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('compareTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('compareHint')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['SPG', 'TOKO'] as const).map((s) => {
              const ada = s === 'SPG' ? data.laporanSpg : data.laporanToko;
              return (
                <span key={s} className="inline-flex items-center gap-2">
                  <StatusPill tone={ada ? 'settled' : 'waiting'}>
                    {td(`report${s}`)}
                  </StatusPill>
                  {bolehMengelola && !data.terkunci && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setLaporanTerbuka(s);
                        setBarisLaporan(ada ? ada.map((i) => ({ ...i })) : []);
                      }}
                    >
                      {ada ? t('editReport') : t('addReport')}
                    </Button>
                  )}
                </span>
              );
            })}
          </div>

          {data.banding.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noReports')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="text-right">{t('colSpg')}</TableHead>
                    <TableHead className="text-right">{t('colToko')}</TableHead>
                    <TableHead className="text-right">{t('colGap')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.banding.map((x) => {
                    const beda = x.selisih !== null && x.selisih > 0;
                    const sepihak = x.selisih === null;
                    return (
                      <TableRow
                        key={x.itemName}
                        className={cn((beda || sepihak) && 'bg-destructive/[0.06]')}
                      >
                        <TableCell className="font-medium">{x.itemName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {x.qtySpg ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {x.qtyToko ?? '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            beda && 'font-semibold text-destructive',
                          )}
                        >
                          {x.selisih === null ? t('oneSided') : x.selisih === 0 ? '0' : x.selisih}
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

      {data.terkunci && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('officialTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('lockedBy', {
                name: data.dikunciOleh ?? '—',
                date: tanggal(data.dikunciPada),
              })}
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colItem')}</TableHead>
                  <TableHead className="text-right">{t('qty')}</TableHead>
                  <TableHead className="text-right">{t('price')}</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                  <TableHead className="text-right">{t('commissionRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.resmi.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(r.price)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {rupiah(r.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.komisiPerPcs > 0 ? rupiah(r.komisiPerPcs) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.komisi.length > 0 && (
        <Card className={cn(b.gajiTerlambat && 'border-destructive/40')}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('salaryTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {b.tenggatSpg ? t('salaryDue', { date: tanggal(b.tenggatSpg) }) : t('salaryNoDue')}
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colSpgName')}</TableHead>
                  <TableHead className="text-right">{t('colBase')}</TableHead>
                  <TableHead className="text-right">{t('colCommission')}</TableHead>
                  <TableHead className="text-right">{t('colTotal')}</TableHead>
                  <TableHead className="text-right">{t('colAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.komisi.map((k) => (
                  <TableRow key={k.id} className={cn(!k.dibayarPada && b.gajiTerlambat && 'bg-destructive/[0.06]')}>
                    <TableCell className="font-medium">{k.spgNama ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(k.gajiPokok)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(k.komisi)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {rupiah(k.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {k.dibayarPada ? (
                        <StatusPill tone="settled">
                          {t('paidOn', { date: tanggal(k.dibayarPada) })}
                        </StatusPill>
                      ) : bolehMengelola ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            jalankan(() => bayarKomisiAction(k.id), t('okPaid'), () => {})
                          }
                        >
                          {t('markPaid')}
                        </Button>
                      ) : (
                        <StatusPill tone="attention">{t('unpaid')}</StatusPill>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('stockTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('stockHint')}</p>
        </CardHeader>
        <CardContent className={data.titipan.length === 0 ? undefined : 'px-0'}>
          {data.titipan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('stockEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colItem')}</TableHead>
                  <TableHead className="text-right">{t('colShipped')}</TableHead>
                  <TableHead className="text-right">{t('colSoldQty')}</TableHead>
                  <TableHead className="text-right">{t('colLeft')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.titipan.map((x) => (
                  <TableRow key={x.itemName} className={cn(x.sisa < 0 && 'bg-destructive/[0.06]')}>
                    <TableCell className="font-medium">{x.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.dikirim}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.terjual}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        x.sisa < 0 && 'text-destructive',
                      )}
                    >
                      {x.sisa}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog laporan */}
      <Dialog open={laporanTerbuka !== null} onOpenChange={(o) => !o && setLaporanTerbuka(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {laporanTerbuka && t('reportTitle', { source: td(`report${laporanTerbuka}`) })}
            </DialogTitle>
            <DialogDescription>{t('reportBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('reportItems')}</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setBarisLaporan((l) => [...l, { itemName: '', qty: 0 }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addRow')}
              </Button>
            </div>
            {barisLaporan.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.itemName}
                  placeholder={t('itemName')}
                  onChange={(e) =>
                    setBarisLaporan((l) =>
                      l.map((x, n) => (n === i ? { ...x, itemName: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={r.qty}
                  onChange={(e) =>
                    setBarisLaporan((l) =>
                      l.map((x, n) => (n === i ? { ...x, qty: Number(e.target.value) } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('removeRow')}
                  onClick={() => setBarisLaporan((l) => l.filter((_, n) => n !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={pending || barisLaporan.length === 0 || !barisLaporan.every((r) => r.itemName.trim())}
              onClick={() =>
                laporanTerbuka &&
                jalankan(
                  () =>
                    catatLaporanAction({
                      cycleId: b.id,
                      source: laporanTerbuka,
                      reportedAt: hariIniWib(),
                      items: barisLaporan,
                    }),
                  t('okReport'),
                  () => setLaporanTerbuka(null),
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog kunci angka */}
      <Dialog open={kunciTerbuka} onOpenChange={setKunciTerbuka}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('lockTitle')}</DialogTitle>
            <DialogDescription>{t('lockBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {resmi.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1 space-y-1">
                  {i === 0 && <span className="text-xs text-muted-foreground">{t('colItem')}</span>}
                  <div className="flex gap-2">
                    <SearchableCombobox
                      options={katalog}
                      value={r.itemId ?? ''}
                      onValueChange={(v) => {
                        const dipilih = katalog.find((k) => k.value === v);
                        setResmi((l) =>
                          l.map((x, n) =>
                            n === i
                              ? { ...x, itemId: v || null, itemName: dipilih ? dipilih.nama : x.itemName }
                              : x,
                          ),
                        );
                      }}
                      placeholder={t('pickItem')}
                      triggerClassName="w-full min-w-0 flex-1"
                    />
                    <Input
                      value={r.itemName}
                      className="min-w-0 flex-1"
                      onChange={(e) =>
                        setResmi((l) =>
                          l.map((x, n) => (n === i ? { ...x, itemName: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                </div>
                <div className="w-20 space-y-1">
                  {i === 0 && <span className="text-xs text-muted-foreground">{t('qty')}</span>}
                  <Input
                    type="number"
                    min={0}
                    value={r.qty}
                    onChange={(e) =>
                      setResmi((l) => l.map((x, n) => (n === i ? { ...x, qty: Number(e.target.value) } : x)))
                    }
                  />
                </div>
                <div className="w-32 space-y-1">
                  {i === 0 && <span className="text-xs text-muted-foreground">{t('price')}</span>}
                  <Input
                    type="number"
                    min={0}
                    value={r.price}
                    onChange={(e) =>
                      setResmi((l) => l.map((x, n) => (n === i ? { ...x, price: Number(e.target.value) } : x)))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('removeRow')}
                  onClick={() => setResmi((l) => l.filter((_, n) => n !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
              <div className="w-48 space-y-1">
                <Label htmlFor="k-pokok">{t('baseSalary')}</Label>
                <Input
                  id="k-pokok"
                  type="number"
                  min={0}
                  value={gajiPokok}
                  onChange={(e) => setGajiPokok(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('baseSalaryHint')}</p>
              </div>
              <p className="text-sm">{t('officialTotal', { value: rupiah(totalResmi) })}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t('commissionFromMaster')}</p>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || resmi.length === 0 || !resmi.every((r) => r.itemName.trim())}
              onClick={() =>
                jalankan(
                  () =>
                    kunciAngkaAction(
                      b.id,
                      resmi.map((r) => ({
                        itemId: r.itemId,
                        itemName: r.itemName,
                        qty: r.qty,
                        price: r.price,
                      })),
                      Number(gajiPokok) || 0,
                    ),
                  t('okLocked'),
                  () => setKunciTerbuka(false),
                )
              }
            >
              {t('lockConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog nomor dokumen */}
      <Dialog open={nomorTerbuka !== null} onOpenChange={(o) => !o && setNomorTerbuka(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nomorTerbuka === 'NOTA' ? t('recordNotaTitle') : t('recordTaxTitle')}
            </DialogTitle>
            <DialogDescription>
              {nomorTerbuka === 'NOTA' ? t('recordNotaBody') : t('recordTaxBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="k-nomor">{t('documentNumber')}</Label>
            <Input
              id="k-nomor"
              value={nomor}
              onChange={(e) => setNomor(e.target.value)}
              placeholder={nomorTerbuka === 'NOTA' ? 'NP-202607-0058' : '010.000-26.00000871'}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={pending || nomor.trim() === ''}
              onClick={() =>
                nomorTerbuka &&
                jalankan(
                  () => catatNomorDokumenAction(b.id, nomorTerbuka, nomor),
                  t('okNumber'),
                  () => setNomorTerbuka(null),
                )
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

function Nomor({
  label,
  nilai,
  milik,
  aksi,
}: {
  label: string;
  nilai: string | null;
  milik: string;
  aksi?: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-mono text-sm', !nilai && 'text-muted-foreground')}>
        {nilai ?? '—'}
      </p>
      <p className="text-xs text-muted-foreground">{milik}</p>
      {aksi}
    </div>
  );
}
