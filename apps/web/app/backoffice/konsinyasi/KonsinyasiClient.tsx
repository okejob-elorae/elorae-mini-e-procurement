'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Handshake, PackagePlus, Plus, Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { BarisSiklus, TahapSiklusLengkap } from '@/lib/konsinyasi/queries';
import { bukaSiklusAction } from '@/app/actions/konsinyasi';
import { KartuSiklusPertama } from './KartuSiklusPertama';
import { NADA_TAHAP, URUT_TAHAP } from './tahap';
import { tulisRupiah } from "./[id]/jumlah-bayar";
import { TanggalInput } from '@/components/ui/tanggal-input';
import { KeteranganKirim } from '@/app/pwa/KeteranganKirim';
import type { SaringSiklus } from './saring';
import { KotakCari } from '../piutang/_daftar/KotakCari';
import { HalamanDaftar } from '../piutang/_daftar/HalamanDaftar';
import { denganParam } from '../piutang/_daftar/halaman';

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
  halaman,
  jumlah: hitung,
  saring = 'berjalan',
  cari = '',
  toko,
  bolehMengelola,
  bolehIsiUlang = false,
  siklusPertama,
  bolehMengunci = false,
}: {
  /** Satu halaman yang sudah disaring di server. */
  baris: BarisSiklus[];
  halaman: { halaman: number; totalHalaman: number; total: number; ukuran: number };
  /** Atas SEMUA siklus, bukan hanya halaman ini. */
  jumlah: { semua: number; berjalan: number; terlambat: number; perTahap: Record<TahapSiklusLengkap, number> };
  /** Dari `?tahap=`. */
  saring?: SaringSiklus;
  /** Dari `?cari=`. */
  cari?: string;
  toko: { id: string; name: string }[];
  bolehMengelola: boolean;
  /** Bulan siklus pertama konsinyasi (P59); null = belum diatur. */
  siklusPertama?: string | null;
  /** Mengatur bulan siklus pertama — `consignment:lock`. */
  bolehMengunci?: boolean;
  /** Boleh membuka Isi ulang toko konsinyasi (stores:view). */
  bolehIsiUlang?: boolean;
}) {
  const t = useTranslations('konsinyasi');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Saringan hidup di alamat; kata kuncinya ikut, halaman kembali ke 1.
  const hrefSaring = (x: SaringSiklus) =>
    denganParam('/backoffice/konsinyasi', { cari }, { tahap: x === 'berjalan' ? null : x });

  const [siklusTerbuka, setSiklusTerbuka] = useState(false);
  const [storeId, setStoreId] = useState('');
  const now = new Date();
  const [tahun, setTahun] = useState(String(now.getFullYear()));
  const [bulan, setBulan] = useState(String(now.getMonth() + 1));
  const [tenggat, setTenggat] = useState(hariIniWib(10));

  // "Kirim titipan" dihentikan (keputusan 2026-10-29 #3): barang ke toko konsi berangkat lewat
  // Dorong konsi + dokumen pengiriman gudang→toko. Dialog ini hanya memilih tokonya.
  const [kirimTerbuka, setKirimTerbuka] = useState(false);
  const [tokoKirim, setTokoKirim] = useState('');

  const jumlah = (x: TahapSiklusLengkap) => hitung.perTahap[x] ?? 0;
  const tampil = baris;
  const terlambat = hitung.terlambat;
  // Tombol "Simpan" di dialog Buka siklus menyebut kekurangan pertamanya.
  const belumBuka = !storeId
    ? t('whyCycleStore')
    : !(Number(bulan) >= 1 && Number(bulan) <= 12)
      ? t('whyCycleMonth')
      : null;

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
        meta={t('summary', { count: hitung.semua, late: terlambat })}
        actions={
          bolehMengelola || bolehIsiUlang ? (
            <span className="inline-flex flex-wrap gap-2">
              {bolehIsiUlang && (
                <Button variant="outline" asChild>
                  <Link href="/backoffice/konsinyasi/isi-ulang">
                    <PackagePlus className="mr-1.5 h-4 w-4" />
                    {t('refillLink')}
                  </Link>
                </Button>
              )}
              {bolehMengelola && (
              <>
              <Button variant="outline" onClick={() => setKirimTerbuka(true)} disabled={toko.length === 0}>
                <Truck className="mr-1.5 h-4 w-4" />
                {t('ship')}
              </Button>
              <Button onClick={() => setSiklusTerbuka(true)} disabled={toko.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('openCycle')}
              </Button>
              </>
              )}
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

      <KartuSiklusPertama bulan={siklusPertama ?? null} bolehMengatur={bolehMengunci} />

      {hitung.semua > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <KotakCari nilai={cari} placeholder={t('searchPlaceholder')} label={t('searchPlaceholder')} />
          <div className="anim-stagger flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
            <Link
              href={hrefSaring('berjalan')}
              replace
              aria-current={saring === 'berjalan' ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                saring === 'berjalan' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {t('filterRunning')}
              <span className="ml-2 tabular-nums text-muted-foreground">{hitung.berjalan}</span>
            </Link>
            {URUT_TAHAP.filter((x) => jumlah(x) > 0 || saring === x).map((x) => (
              <Link
                key={x}
                href={hrefSaring(saring === x ? 'berjalan' : x)}
                replace
                aria-current={saring === x ? 'true' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  saring === x ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                <StatusPill tone={NADA_TAHAP[x]}>{td(`stage_${x}`)}</StatusPill>
                <span className="ml-2 tabular-nums text-muted-foreground">{jumlah(x)}</span>
              </Link>
            ))}
            <Link
              href={hrefSaring('semua')}
              replace
              aria-current={saring === 'semua' ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                saring === 'semua' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {t('filterAll')}
              <span className="ml-2 tabular-nums text-muted-foreground">{hitung.semua}</span>
            </Link>
          </div>
        </div>
      )}

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            hitung.semua > 0 ? (
              <EmptyState icon={Handshake} title={t('emptyFilteredTitle')} />
            ) : (
              <EmptyState icon={Handshake} title={t('emptyTitle')} description={t('emptyBody')} />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCycle')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead className="text-right">{t('colSold')}</TableHead>
                    {/* Buku stok toko vs laporan, hanya siklus yang belum dikunci. */}
                    <TableHead title={t("matchHint")} className="whitespace-normal">{t("colMatch")}</TableHead>
                    {/* Tiga nomor berdampingan — inilah yang dulu tersimpan di
                        kepala tiga orang berbeda. */}
                    {/* Nomor nota dan faktur pajak TIDAK dipatahkan — "NP-202608-" /
                        "0058" terbaca sebagai dua nomor. Yang turun baris kolom Tahap. */}
                    <TableHead className="whitespace-normal">{t('colNota')}</TableHead>
                    <TableHead className="whitespace-normal">{t('colTax')}</TableHead>
                    <TableHead>{t('colStage')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow key={b.id} className={cn(b.gajiTerlambat && 'bg-destructive/[0.06]')}>
                      <TableCell>
                        <Link
                          href={`/backoffice/konsinyasi/${b.id}`}
                          className="whitespace-nowrap font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
                        >
                          {b.noKonsi}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.periode}</span>
                      </TableCell>
                      <TableCell className="whitespace-normal min-w-[7rem] max-w-[12rem]">{b.storeName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.nilaiTerjual > 0 ? rupiah(b.nilaiTerjual) : '—'}
                        {b.sisaTagihan !== null && b.sisaTagihan > 0 && (
                          <span className="block text-xs text-amber-700 dark:text-amber-400">
                            {t("tagihan.remainingShort", { value: tulisRupiah(b.sisaTagihan) })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {b.penandaCocok === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : b.penandaCocok.berselisih === 0 ? (
                          <StatusPill tone="settled">{t("matchOk")}</StatusPill>
                        ) : (
                          <StatusPill tone="attention">{t("matchDiff", { count: b.penandaCocok.berselisih })}</StatusPill>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{b.noNota ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{b.noFakturPajak ?? '—'}</TableCell>
                      {/* Sel tabel bawaan tidak turun baris (components/ui/table.tsx);
                          kalimat tahap dulu meluberkan tabel jauh ke kanan. */}
                      <TableCell className="whitespace-normal min-w-[10rem] max-w-[18rem]">
                        <div className="space-y-1">
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
          <HalamanDaftar {...halaman} />
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
              <TanggalInput id="k-tenggat" value={tenggat} onChange={(e) => setTenggat(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('spgDueHint')}</p>
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-end">
            <Button
              disabled={pending || belumBuka !== null}
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
            <KeteranganKirim teks={belumBuka} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kirimTerbuka} onOpenChange={setKirimTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shipTitle')}</DialogTitle>
            <DialogDescription>{t('shipViaPush')}</DialogDescription>
          </DialogHeader>
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
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-end">
            {tokoKirim ? (
              <Button asChild>
                <Link href={`/backoffice/stores/${tokoKirim}/konsi-push`}>{t('shipOpenPush')}</Link>
              </Button>
            ) : (
              <>
                <Button disabled>{t('shipOpenPush')}</Button>
                <KeteranganKirim teks={t('whyCycleStore')} />
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
