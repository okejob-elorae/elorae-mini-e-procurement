'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PackageOpen, Plus, Scale } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  batalkanReturAction,
  catatHitunganGudangAction,
  catatReturTokoAction,
  putuskanBebanAction,
} from '@/app/actions/store-returns';
import type { BarisRetur, RingkasanRetur } from '@/lib/receivables/return-queries';
import type { KeadaanRetur } from '@/lib/receivables/rules';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/**
 * `menunggu` kuning karena bolanya ada di gudang; `selisih` merah karena uang
 * berhenti di situ dan tidak ada seorang pun yang merasa ditagih — keadaan yang
 * bisa bertahan berbulan-bulan justru karena tak ada yang merasa bertanggung jawab.
 */
const NADA: Record<KeadaanRetur, StatusTone> = {
  menunggu: 'waiting',
  selisih: 'attention',
  beres: 'settled',
  batal: 'inactive',
};

const URUT: KeadaanRetur[] = ['selisih', 'menunggu', 'beres', 'batal'];
const BEBAN = ['TOKO', 'SALES', 'PERUSAHAAN'] as const;

export function ReturTokoClient({
  baris,
  ringkasan,
  toko,
  bolehMengelola,
  bolehMenghitung,
}: {
  baris: BarisRetur[];
  ringkasan: RingkasanRetur;
  toko: { id: string; name: string }[];
  bolehMengelola: boolean;
  bolehMenghitung: boolean;
}) {
  const t = useTranslations('storeReturns');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saring, setSaring] = useState<KeadaanRetur | null>(null);

  const [buatTerbuka, setBuatTerbuka] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [claimDate, setClaimDate] = useState(hariIniWib());
  const [nilaiKlaim, setNilaiKlaim] = useState('');
  const [catatan, setCatatan] = useState('');

  const [hitungRetur, setHitungRetur] = useState<BarisRetur | null>(null);
  const [nilaiFisik, setNilaiFisik] = useState('');
  const [catatanHitung, setCatatanHitung] = useState('');

  const [bebanRetur, setBebanRetur] = useState<BarisRetur | null>(null);
  const [beban, setBeban] = useState<(typeof BEBAN)[number]>('TOKO');
  const [alasanBeban, setAlasanBeban] = useState('');

  const [batalRetur, setBatalRetur] = useState<BarisRetur | null>(null);
  const [alasanBatal, setAlasanBatal] = useState('');

  const label = (k: KeadaanRetur) => t(`state${k.charAt(0).toUpperCase()}${k.slice(1)}` as never);
  const tampil = saring ? baris.filter((b) => b.keadaan === saring) : baris;

  const jalankan = (fn: () => Promise<{ ok: boolean; kode?: string }>, pesanSukses: string, bersihkan: () => void) => {
    startTransition(async () => {
      const hasil = await fn();
      if (hasil.ok) {
        toast.success(pesanSukses);
        bersihkan();
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
        meta={t('summary', {
          count: ringkasan.jumlah,
          held: rupiah(ringkasan.nilaiTertahan),
        })}
        actions={
          bolehMengelola ? (
            <Button onClick={() => setBuatTerbuka(true)} disabled={toko.length === 0}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('create')}
            </Button>
          ) : undefined
        }
      />

      <div className="anim-stagger flex flex-wrap gap-2">
        {URUT.filter((k) => ringkasan.perKeadaan[k] > 0).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSaring(saring === k ? null : k)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              saring === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            <StatusPill tone={NADA[k]}>{label(k)}</StatusPill>
            <span className="ml-2 tabular-nums text-muted-foreground">{ringkasan.perKeadaan[k]}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            <EmptyState icon={PackageOpen} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="text-right">{t('colClaimed')}</TableHead>
                    <TableHead className="text-right">{t('colCounted')}</TableHead>
                    <TableHead className="text-right">{t('colGap')}</TableHead>
                    <TableHead>{t('colState')}</TableHead>
                    <TableHead className="text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow
                      key={b.id}
                      /* Hanya selisih yang belum ditanggung diberi latar merah:
                         itu satu-satunya baris yang menahan uang tanpa pemilik. */
                      className={cn(b.keadaan === 'selisih' && 'bg-destructive/[0.06]')}
                    >
                      <TableCell className="font-medium">{b.docNo}</TableCell>
                      <TableCell>
                        {b.storeName}
                        {b.salesmanName && (
                          <span className="block text-xs text-muted-foreground">{b.salesmanName}</span>
                        )}
                      </TableCell>
                      <TableCell>{tanggal(b.claimDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rupiah(b.nilaiKlaim)}
                        {b.jumlahPotongan > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {t('deducted', { value: rupiah(b.nilaiDipotong) })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {b.nilaiFisik === null ? '—' : rupiah(b.nilaiFisik)}
                        {b.countedByName && (
                          <span className="block text-xs">{b.countedByName}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular-nums',
                          b.keadaan === 'selisih' && 'text-destructive',
                        )}
                      >
                        {b.nilaiFisik === null ? '—' : b.selisih === 0 ? '0' : rupiah(b.selisih)}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={NADA[b.keadaan]}
                          detail={
                            b.bearer
                              ? t('borneBy', { who: t(`bearer${b.bearer}` as never) })
                              : undefined
                          }
                        >
                          {label(b.keadaan)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex gap-2">
                          {b.status === 'DIAJUKAN' && bolehMenghitung && (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setHitungRetur(b);
                                setNilaiFisik('');
                                setCatatanHitung('');
                              }}
                            >
                              <Scale className="mr-1.5 h-3.5 w-3.5" />
                              {t('count')}
                            </Button>
                          )}
                          {b.keadaan === 'selisih' && bolehMengelola && (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setBebanRetur(b);
                                setBeban('TOKO');
                                setAlasanBeban('');
                              }}
                            >
                              {t('assign')}
                            </Button>
                          )}
                          {b.status !== 'BATAL' && bolehMengelola && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                setBatalRetur(b);
                                setAlasanBatal('');
                              }}
                            >
                              {t('cancel')}
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NRT — klaim toko */}
      <Dialog open={buatTerbuka} onOpenChange={setBuatTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nrt-toko">{t('store')}</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger id="nrt-toko">
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
                <Label htmlFor="nrt-tanggal">{t('claimDate')}</Label>
                <Input
                  id="nrt-tanggal"
                  type="date"
                  value={claimDate}
                  onChange={(e) => setClaimDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nrt-nilai">{t('claimedAmount')}</Label>
                <Input
                  id="nrt-nilai"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={nilaiKlaim}
                  onChange={(e) => setNilaiKlaim(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nrt-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="nrt-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !storeId || !(Number(nilaiKlaim) > 0)}
              onClick={() =>
                jalankan(
                  () =>
                    catatReturTokoAction({
                      storeId,
                      claimDate,
                      claimedAmount: Number(nilaiKlaim),
                      note: catatan,
                    }),
                  t('okCreated'),
                  () => {
                    setBuatTerbuka(false);
                    setStoreId('');
                    setNilaiKlaim('');
                    setCatatan('');
                  },
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NRI — hitungan gudang */}
      <Dialog open={hitungRetur !== null} onOpenChange={(o) => !o && setHitungRetur(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('countTitle')}</DialogTitle>
            <DialogDescription>
              {hitungRetur &&
                t('countBody', {
                  doc: hitungRetur.docNo,
                  claimed: rupiah(hitungRetur.nilaiKlaim),
                })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nri-nilai">{t('countedAmount')}</Label>
              <Input
                id="nri-nilai"
                type="number"
                inputMode="numeric"
                min={0}
                value={nilaiFisik}
                onChange={(e) => setNilaiFisik(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('countHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nri-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="nri-catatan"
                value={catatanHitung}
                onChange={(e) => setCatatanHitung(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || nilaiFisik === '' || !(Number(nilaiFisik) >= 0)}
              onClick={() =>
                hitungRetur &&
                jalankan(
                  () =>
                    catatHitunganGudangAction(
                      hitungRetur.id,
                      Number(nilaiFisik),
                      catatanHitung,
                    ),
                  t('okCounted'),
                  () => setHitungRetur(null),
                )
              }
            >
              {t('saveCount')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Beban selisih */}
      <Dialog open={bebanRetur !== null} onOpenChange={(o) => !o && setBebanRetur(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignTitle')}</DialogTitle>
            <DialogDescription>
              {bebanRetur && t('assignBody', { gap: rupiah(bebanRetur.selisih) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="beban-siapa">{t('bearer')}</Label>
              <Select value={beban} onValueChange={(v) => setBeban(v as (typeof BEBAN)[number])}>
                <SelectTrigger id="beban-siapa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BEBAN.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`bearer${b}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="beban-alasan">{t('assignReason')}</Label>
              <Textarea
                id="beban-alasan"
                value={alasanBeban}
                onChange={(e) => setAlasanBeban(e.target.value)}
                placeholder={t('assignPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || alasanBeban.trim().length === 0}
              onClick={() =>
                bebanRetur &&
                jalankan(
                  () => putuskanBebanAction(bebanRetur.id, beban, alasanBeban),
                  t('okAssigned'),
                  () => setBebanRetur(null),
                )
              }
            >
              {t('saveAssign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batal */}
      <Dialog open={batalRetur !== null} onOpenChange={(o) => !o && setBatalRetur(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cancelTitle')}</DialogTitle>
            <DialogDescription>{t('cancelBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="retur-alasan">{t('cancelReason')}</Label>
            <Textarea
              id="retur-alasan"
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasanBatal.trim().length === 0}
              onClick={() =>
                batalRetur &&
                jalankan(
                  () => batalkanReturAction(batalRetur.id, alasanBatal),
                  t('okCancelled'),
                  () => setBatalRetur(null),
                )
              }
            >
              {t('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
