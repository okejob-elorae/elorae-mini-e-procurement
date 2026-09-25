'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Camera, Printer, Unlink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  lepasPasanganAction,
  putuskanBebanAction,
  tandaiBebanLunasAction,
} from '@/app/actions/store-returns';
import type { RincianRetur } from '@/lib/receivables/return-queries';
import { NADA_LANGKAH } from '../langkah';
import { formatDisplayDate } from '@/lib/date-only';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const BEBAN = ['TOKO', 'SALES', 'GUDANG', 'PERUSAHAAN'] as const;

export function RincianReturClient({
  data,
  kandidat,
  bolehMengelola,
}: {
  data: RincianRetur;
  kandidat: { id: string; name: string }[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('storeReturns');
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bebanTerbuka, setBebanTerbuka] = useState<(typeof BEBAN)[number] | null>(null);
  const [alasan, setAlasan] = useState('');
  /* Beban ke sales harus melekat pada ORANG. Dimulai dari yang mencatat
     notanya — biasanya benar — tapi bisa diganti: yang mencatat tidak selalu
     yang keliru. */
  const [penanggungId, setPenanggungId] = useState<string>(data.baris.salesmanId ?? '');
  const [batalTerbuka, setBatalTerbuka] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState('');

  const b = data.baris;

  /*
   * Barang disandingkan menurut namanya, bukan menurut urutan barisnya. Gudang
   * mencatat apa yang sampai — urutannya tidak akan sama dengan nota toko, dan
   * barang yang TIDAK sampai sama sekali hanya muncul di sisi klaim.
   */
  const perbandingan = useMemo(() => {
    const peta = new Map<
      string,
      { nama: string; qtyKlaim: number; nilaiKlaim: number; qtyFisik: number | null; nilaiFisik: number | null }
    >();
    for (const i of data.barangKlaim) {
      peta.set(i.itemName, {
        nama: i.itemName,
        qtyKlaim: i.qty,
        nilaiKlaim: i.amount,
        qtyFisik: null,
        nilaiFisik: null,
      });
    }
    for (const i of data.barangFisik) {
      const ada = peta.get(i.itemName);
      if (ada) {
        ada.qtyFisik = i.qty;
        ada.nilaiFisik = i.amount;
      } else {
        peta.set(i.itemName, {
          nama: i.itemName,
          qtyKlaim: i.qtyClaim,
          nilaiKlaim: 0,
          qtyFisik: i.qty,
          nilaiFisik: i.amount,
        });
      }
    }
    return [...peta.values()];
  }, [data.barangKlaim, data.barangFisik]);

  const adaRincian = perbandingan.length > 0;

  const jalankan = (
    fn: () => Promise<{ ok: boolean; kode?: string }>,
    pesan: string,
    bersihkan: () => void,
  ) => {
    startTransition(async () => {
      const hasil = await fn();
      if (hasil.ok) {
        toast.success(pesan);
        bersihkan();
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/retur-toko">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={b.nomor}
        description={[
          b.storeName,
          t(`via${b.caraKirim}` as never),
          b.salesmanName && t('photographedBy', { name: b.salesmanName }),
        ]
          .filter(Boolean)
          .join(' · ')}
        meta={
          <StatusPill tone={NADA_LANGKAH[b.langkah]}>
            {t(`step${b.langkah.charAt(0).toUpperCase()}${b.langkah.slice(1)}` as never)}
          </StatusPill>
        }
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={`/print/retur/${b.id}`} target="_blank" rel="noreferrer">
                <Printer className="mr-1.5 h-4 w-4" />
                {t('print')}
              </a>
            </Button>
            {bolehMengelola && b.langkah !== 'batal' && (
              <>
              {data.gudang && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    data.gudang &&
                    jalankan(
                      // Aksinya melepas dari sisi GUDANG — id yang dikirim
                      // harus id NRI, bukan id nota tokonya.
                      () => lepasPasanganAction(data.gudang!.id),
                      t('okUnpaired'),
                      () => {},
                    )
                  }
                >
                  <Unlink className="mr-1.5 h-4 w-4" />
                  {t('unpair')}
                </Button>
              )}
                <Button variant="ghost" disabled={pending} onClick={() => setBatalTerbuka(true)}>
                  {t('cancel')}
                </Button>
              </>
            )}
          </span>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            {t('compareTitle')}
            {b.selisih > 0 && (
              <StatusPill tone="attention">{t('short', { value: rupiah(b.selisih) })}</StatusPill>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('compareHint')}</p>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          {/* Sisi toko */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('sideStore')}</h3>
              <StatusPill tone="progress">{t('sideStoreTag')}</StatusPill>
            </div>
            <p className="text-xs text-muted-foreground">
              {b.nomor} · {tanggal(b.tanggal)}
            </p>
            {data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.photoUrl}
                alt={b.nomor}
                className="w-full rounded-lg border object-contain"
              />
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Camera className="h-4 w-4 shrink-0" />
                {t('noPhoto')}
              </div>
            )}
            <Ringkas
              label={t('totalClaimed')}
              value={rupiah(b.nilaiKlaim ?? 0)}
              qty={data.barangKlaim.reduce((s, i) => s + i.qty, 0)}
              adaRincian={adaRincian}
            />
          </div>

          {/* Sisi gudang */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('sideWarehouse')}</h3>
              <StatusPill tone={data.gudang ? 'settled' : 'waiting'}>
                {data.gudang ? t('sideWarehouseTag') : t('notCounted')}
              </StatusPill>
            </div>
            {data.gudang ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {data.gudang.noNri} ·{' '}
                  {t('countedBy', {
                    name: data.gudang.olehNama ?? '—',
                    date: tanggal(data.gudang.diterimaPada),
                  })}
                </p>
                {data.gudang.catatan && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.gudang.catatan}</p>
                )}
                <Ringkas
                  label={t('totalCounted')}
                  value={rupiah(b.nilaiFisik ?? 0)}
                  qty={data.barangFisik.reduce((s, i) => s + i.qty, 0)}
                  adaRincian={adaRincian}
                />
              </>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t('warehousePending')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {adaRincian && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('perItemTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('perItemHint')}</p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="text-right">{t('colQtyClaim')}</TableHead>
                    <TableHead className="text-right">{t('colQtyPhysical')}</TableHead>
                    <TableHead className="text-right">{t('colValueClaim')}</TableHead>
                    <TableHead className="text-right">{t('colValuePhysical')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perbandingan.map((p) => {
                    const kurang = p.qtyFisik !== null && p.qtyFisik < p.qtyKlaim;
                    const belum = p.qtyFisik === null;
                    return (
                      <TableRow key={p.nama} className={cn(kurang && 'bg-destructive/[0.06]')}>
                        <TableCell className="font-medium whitespace-normal min-w-[160px]">{p.nama}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qtyKlaim}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold tabular-nums',
                            kurang && 'text-destructive',
                          )}
                        >
                          {belum ? '—' : p.qtyFisik}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {rupiah(p.nilaiKlaim)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            kurang && 'font-semibold text-destructive',
                          )}
                        >
                          {belum ? '—' : rupiah(p.nilaiFisik ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Beban selisih */}
      {data.beban && (
        <Card
          className={cn(
            data.beban.status === 'TERBUKA' && 'border-destructive/40 bg-destructive/[0.04]',
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {t('chargeTitle', { value: rupiah(data.beban.amount) })}
              <StatusPill
                tone={
                  data.beban.status === 'TERBUKA'
                    ? 'attention'
                    : data.beban.status === 'LUNAS'
                      ? 'settled'
                      : 'progress'
                }
              >
                {t(`charge${data.beban.status}` as never)}
              </StatusPill>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.beban.status === 'TERBUKA' ? (
              <>
                <p className="text-sm leading-relaxed">
                  {t('chargeOpenBody', {
                    claimed: rupiah(b.nilaiKlaim ?? 0),
                    counted: rupiah(b.nilaiFisik ?? 0),
                  })}
                </p>
                {bolehMengelola && (
                  <div className="flex flex-wrap gap-2">
                    {BEBAN.map((k) => (
                      <Button
                        key={k}
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setBebanTerbuka(k);
                          setAlasan('');
                          setPenanggungId(data.baris.salesmanId ?? '');
                        }}
                      >
                        {t(`assign${k}` as never)}
                      </Button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t('chargeCompanyHint')}</p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  {t('borneBy', {
                    who: t(`bearer${data.beban.penanggung ?? 'TOKO'}` as never),
                  })}
                  {data.beban.diputuskanOleh &&
                    ` · ${t('decidedBy', {
                      name: data.beban.diputuskanOleh,
                      date: data.beban.diputuskanPada
                        ? tanggal(data.beban.diputuskanPada)
                        : '—',
                    })}`}
                </p>
                {data.beban.catatan && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.beban.catatan}</p>
                )}
                {data.beban.status === 'DITETAPKAN' && bolehMengelola && (
                  <div className="space-y-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        data.beban &&
                        jalankan(
                          () => tandaiBebanLunasAction(data.beban!.id),
                          t('okChargeSettled'),
                          () => {},
                        )
                      }
                    >
                      {t('markSettled')}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t('markSettledHint')}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dipakai sebagai potongan di BKM */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('usedInClaims')}</CardTitle>
        </CardHeader>
        <CardContent className={data.potongan.length === 0 ? undefined : 'px-0'}>
          {data.potongan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('usedInClaimsEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colClaimDoc')}</TableHead>
                  <TableHead className="text-right">{t('colDeducted')}</TableHead>
                  <TableHead>{t('colClaimState')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.potongan.map((p) => (
                  <TableRow key={p.docNo}>
                    <TableCell className="font-medium">{p.docNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(p.amount)}</TableCell>
                    <TableCell>
                      <StatusPill tone={p.status === 'TERVERIFIKASI' ? 'settled' : 'waiting'}>
                        {p.status}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={bebanTerbuka !== null} onOpenChange={(o) => !o && setBebanTerbuka(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignTitle')}</DialogTitle>
            <DialogDescription>
              {bebanTerbuka &&
                t('assignBody', {
                  who: t(`bearer${bebanTerbuka}` as never),
                  gap: rupiah(data.beban?.amount ?? 0),
                })}
            </DialogDescription>
          </DialogHeader>
          {bebanTerbuka === 'SALES' && (
            <div className="space-y-2">
              <Label htmlFor="beban-orang">{t('bearerPerson')}</Label>
              <Select value={penanggungId} onValueChange={setPenanggungId}>
                <SelectTrigger id="beban-orang">
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
              <p className="text-xs text-muted-foreground">{t('bearerPersonHint')}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="beban-alasan">{t('assignReason')}</Label>
            <Textarea
              id="beban-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('assignPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                alasan.trim().length === 0 ||
                // Beban ke sales tanpa orangnya adalah tuduhan tanpa alamat:
                // ia tidak akan muncul di layar siapa pun.
                (bebanTerbuka === 'SALES' && penanggungId === '')
              }
              onClick={() =>
                bebanTerbuka &&
                data.beban &&
                jalankan(
                  () =>
                    putuskanBebanAction(
                      data.beban!.id,
                      bebanTerbuka,
                      alasan,
                      bebanTerbuka === 'SALES' ? penanggungId : null,
                    ),
                  t('okAssigned'),
                  () => setBebanTerbuka(null),
                )
              }
            >
              {t('saveAssign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batalTerbuka} onOpenChange={setBatalTerbuka}>
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
                jalankan(
                  () => batalkanReturAction(b.id, alasanBatal),
                  t('okCancelled'),
                  () => setBatalTerbuka(false),
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

function Ringkas({
  label,
  value,
  qty,
  adaRincian,
}: {
  label: string;
  value: string;
  qty: number;
  adaRincian: boolean;
}) {
  const t = useTranslations('storeReturns');
  return (
    <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-right">
        <span className="text-base font-semibold tabular-nums">{value}</span>
        {/* Kuantitas diberi kata satuannya. Angka telanjang di sebelah nominal
            rupiah terbaca sebagai bagian dari nominal itu. */}
        {adaRincian && (
          <span className="ml-2 text-xs text-muted-foreground">{t('qtyItems', { qty })}</span>
        )}
      </span>
    </div>
  );
}
