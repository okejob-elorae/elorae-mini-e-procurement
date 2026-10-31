'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeCheck, CalendarRange, Landmark, Plus, Wallet, X } from 'lucide-react';
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
import { formatDisplayDate, parseDateOnly } from '@/lib/date-only';
import { useSorotBaris } from '@/components/gerak/useSorotBaris';
import { verifikasiKlaimAction } from '@/app/actions/receivables';
import { dinamis } from '@/lib/i18n/dinamis';
import type { StatusGiro } from '@/lib/receivables/giro';
import { TombolGiro } from './giro/TombolGiro';
import { kunciGalatPutusan } from './[id]/putusan-klaim';
import { KotakCari } from '../piutang/_daftar/KotakCari';
import { HalamanDaftar } from '../piutang/_daftar/HalamanDaftar';
import { denganParam } from '../piutang/_daftar/halaman';
import { URUT_STATUS_KLAIM, type JumlahKlaim, type StatusKlaim } from './saring';

export type { StatusKlaim, JumlahKlaim };

/** Saringan dari alamat (`?status=`, `?koreksi=1`, `?cari=`, `?dari=`/`?sampai=`) — diterapkan di server. */
export type SaringKlaim = {
  status: StatusKlaim | null;
  koreksi: boolean;
  cari?: string;
  /** YYYY-MM-DD (hari WIB), sudah disahkan server; `null` = tanpa ujung itu. */
  dari?: string | null;
  sampai?: string | null;
};

export type BarisKlaim = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  claimedTransferAt: string;
  /** ISO; `null` = belum diverifikasi. */
  verifiedAt: string | null;
  invoiceAmount: number;
  deductionTotal: number;
  receivedAmount: number;
  deductionCount: number;
  status: string;
  verifyNote: string | null;
  /** Sales meminta koreksi dan kantor belum menindaklanjutinya. */
  mintaKoreksi: boolean;
  /** Penonton yang melaporkan/mencatatkan BKM ini — tidak boleh memutuskannya. */
  pemeriksaSama: boolean;
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
  DIBATALKAN: 'inactive',
};

export function PelunasanClient({
  baris,
  halaman,
  saring,
  jumlah,
  ringkas,
  giroMenunggu,
  bolehMemutuskan,
  bolehMengelola,
}: {
  /** Satu halaman yang sudah disaring di server. */
  baris: BarisKlaim[];
  halaman: { halaman: number; totalHalaman: number; total: number; ukuran: number };
  saring: SaringKlaim;
  /** Jumlah per tab atas BKM yang cocok dengan kotak cari (semua bila tanpa cari). */
  jumlah: JumlahKlaim;
  /** Untuk kepala halaman: SEMUA BKM, tanpa saringan apa pun. */
  ringkas: { semua: number; menunggu: number };
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
  // BKM yang baru diverifikasi/ditolak menyala sebentar lalu tampil dengan status barunya.
  const { sorot, tandai } = useSorotBaris(
    'pelunasan',
    baris.map((b) => ({ id: b.id, tanda: `${b.status}|${b.giro?.status ?? ''}` })),
  );

  const cari = saring.cari ?? '';
  const dari = saring.dari ?? null;
  const sampai = saring.sampai ?? null;
  const adaPeriode = dari !== null || sampai !== null;
  const disaring = saring.status !== null || saring.koreksi || cari !== '' || adaPeriode;
  const tglPeriode = (x: string) => formatDisplayDate(parseDateOnly(x));
  // Keping saringan tanggal: dasar tanggalnya ikut tab, jadi kepingnya menyebutnya.
  const rentang =
    dari && sampai
      ? dari === sampai
        ? tglPeriode(dari)
        : t('rentangDariSampai', { dari: tglPeriode(dari), sampai: tglPeriode(sampai) })
      : dari
        ? t('rentangSejak', { dari: tglPeriode(dari) })
        : sampai
          ? t('rentangSampai', { sampai: tglPeriode(sampai) })
          : '';
  const labelPeriode =
    saring.status === 'TERVERIFIKASI' && !saring.koreksi
      ? t('periodeVerifikasi', { rentang })
      : t('periodeTransfer', { rentang });
  // Pil saringan membawa kata kuncinya; halamannya kembali ke 1.
  const dgnCari = (href: string) => {
    const [jalur, qs = ''] = href.split('?');
    return denganParam(jalur, new URLSearchParams(qs), { cari, dari, sampai });
  };
  // Satu saringan aktif pada satu waktu; `replace` supaya "Kembali" tidak
  // berjalan mundur melewati setiap pilihan.
  const pilihan: { kunci: string; label: string; n: number; href: string; aktif: boolean }[] = [
    { kunci: 'semua', label: t('filterAll'), n: jumlah.semua, href: '/backoffice/pelunasan', aktif: saring.status === null && !saring.koreksi },
    // Satu nama keadaan untuk tab, badge baris, dan Beranda ("Menunggu verifikasi").
    ...URUT_STATUS_KLAIM.map((s) => ({
      kunci: s,
      label: t(`keadaan${s}` as never),
      n: jumlah[s],
      href: `/backoffice/pelunasan?status=${s}`,
      aktif: saring.status === s && !saring.koreksi,
    })),
    ...(jumlah.koreksi > 0 || saring.koreksi
      ? [
          {
            kunci: 'koreksi',
            label: t('filterKoreksi'),
            n: jumlah.koreksi,
            href: '/backoffice/pelunasan?koreksi=1',
            aktif: saring.koreksi,
          },
        ]
      : []),
  ];

  const putuskan = (id: string, keputusan: 'TERVERIFIKASI' | 'DITOLAK', catatan?: string) => {
    startTransition(async () => {
      const hasil = await verifikasiKlaimAction(id, keputusan, catatan);
      if (hasil.ok) {
        toast.success(keputusan === 'TERVERIFIKASI' ? t('okVerified') : t('okRejected'));
        tandai(id);
        setTolakId(null);
        setAlasan('');
        router.refresh();
      } else {
        toast.error(t(kunciGalatPutusan(hasil.kode, keputusan) as never));
      }
    });
  };

  /** Keadaan BKM — sama di tabel dan di kartu HP. */
  const keadaan = (b: BarisKlaim) => (
    <div>
      <StatusPill
        tone={NADA[b.status] ?? 'inactive'}
        detail={
          b.status === 'TERVERIFIKASI' && b.nilaiTertahan > 0
            ? t('held', { value: rupiah(b.nilaiTertahan) })
            : b.verifyNote
        }
      >
        {t(`keadaan${b.status}` as never)}
      </StatusPill>
      {b.status === 'TERVERIFIKASI' && b.verifiedAt && (
        <span className="mt-1 block text-xs text-muted-foreground">
          {t('diverifikasiPada', { tanggal: tanggal(b.verifiedAt) })}
        </span>
      )}
      {b.mintaKoreksi && (
        <span className="mt-1 block text-xs font-medium text-amber-800 dark:text-amber-300">
          {t('filterKoreksi')}
        </span>
      )}
      {b.giro && (
        <span
          className={cn(
            'mt-1 block text-xs',
            b.giro.kedaluwarsa ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
          )}
        >
          {t('giroLine', { no: b.giro.nomor, date: b.giro.efektif })}
          {' · '}
          {tGiro(`status_${b.giro.status}`)}
        </span>
      )}
    </div>
  );

  /**
   * Tombol keputusan. `tumpuk` = kolom tabel yang menempel di kanan: dua tombol
   * berdampingan dulu mendorong tabel keluar kartunya di 1280 px. Di kartu HP
   * keduanya berdampingan.
   */
  const aksi = (b: BarisKlaim, tumpuk: boolean) => {
    if (b.status !== 'DIKIRIM' || !bolehMemutuskan) return null;
    // Giro yang menunggu tidak diverifikasi ke mutasi biasa: yang diputuskan
    // adalah bilyetnya — cair atau ditolak.
    if (b.giro?.status === 'MENUNGGU') {
      return (
        <TombolGiro
          claimId={b.id}
          giroNo={b.giro.nomor}
          nilai={rupiah(b.receivedAmount)}
          susun={tumpuk}
          pemeriksaSama={b.pemeriksaSama}
        />
      );
    }
    return (
      <span className={cn('inline-flex gap-1', tumpuk ? 'flex-col items-end' : 'flex-wrap items-center')}>
        <Button
          size="sm"
          disabled={pending || b.pemeriksaSama}
          title={b.pemeriksaSama ? t('errPEMERIKSA_SAMA') : undefined}
          onClick={() => putuskan(b.id, 'TERVERIFIKASI')}
        >
          <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
          {t('verify')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || b.pemeriksaSama}
          title={b.pemeriksaSama ? t('errPEMERIKSA_SAMA') : undefined}
          onClick={() => {
            setTolakId(b.id);
            setAlasan('');
          }}
        >
          {t('reject')}
        </Button>
        {b.pemeriksaSama && (
          <span
            className={cn(
              'whitespace-normal text-xs text-muted-foreground',
              tumpuk ? 'max-w-[10rem]' : 'basis-full',
            )}
          >
            {t('pemeriksaSamaSingkat')}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('judulHalaman')}
        meta={t('ringkasBkm', { count: ringkas.semua, pending: ringkas.menunggu })}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <KotakCari nilai={cari} placeholder={t('searchPlaceholder')} label={t('searchPlaceholder')} />
        {adaPeriode && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary bg-primary/10 py-1 pl-3 pr-1 text-sm">
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {labelPeriode}
            <Link
              href={denganParam('/backoffice/pelunasan', { status: saring.status ?? undefined, koreksi: saring.koreksi ? '1' : undefined, cari }, {})}
              replace
              aria-label={t('hapusPeriode')}
              title={t('hapusPeriode')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" aria-hidden />
            </Link>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
        {pilihan.map((p) => (
          <Link
            key={p.kunci}
            href={dgnCari(p.href)}
            replace
            aria-current={p.aktif ? 'true' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              p.aktif ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {p.label}
            <span className="ml-2 tabular-nums text-muted-foreground">{p.n}</span>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            disaring ? (
              <EmptyState
                icon={Wallet}
                title={t('emptyFilteredTitle')}
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/backoffice/pelunasan" replace>
                      {t('hapusSaringan')}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={Wallet} title={t('emptyTitle')} description={t('emptyBody')} />
            )
          ) : (
            <>
              {/* HP: kartu bertumpuk. Tabelnya 930 px — di layar 390 px kolom
                  Diterima dan Keadaan hanya terlihat dengan menggeser. */}
              <ul className="divide-y md:hidden">
                {baris.map((b) => (
                  <li
                    key={b.id}
                    {...sorot(b.id)}
                    className={cn('space-y-2 px-4 py-3', b.status === 'DIKIRIM' && 'bg-amber-500/[0.05]')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/backoffice/pelunasan/${b.id}`}
                          className="font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
                        >
                          {b.docNo}
                        </Link>
                        <p className="text-sm">{b.storeName}</p>
                        <p className="text-xs text-muted-foreground">
                          {[b.salesmanName, tanggal(b.claimedTransferAt)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="whitespace-nowrap font-semibold tabular-nums">{rupiah(b.receivedAmount)}</p>
                        {b.deductionCount > 0 && (
                          <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            {t('deductionsCount', { count: b.deductionCount })} − {rupiah(b.deductionTotal)}
                          </p>
                        )}
                      </div>
                    </div>
                    {keadaan(b)}
                    {aksi(b, false)}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('kolomNoBkm')}</TableHead>
                      <TableHead>{t('colStore')}</TableHead>
                      {/* Kepala dua baris: satu baris membuat tabel 50 px lebih lebar dari kartunya di 1280. */}
                      <TableHead className="whitespace-normal">{t('kolomTanggalTransfer')}</TableHead>
                      <TableHead className="text-right">{t('colInvoiceValue')}</TableHead>
                      <TableHead className="text-right">{t('colReceived')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead className="sticky right-0 bg-card text-right">{t('colAction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="baris-berurutan">
                    {baris.map((b) => (
                      <TableRow
                        key={b.id}
                        {...sorot(b.id)}
                        /* Klaim yang menunggu keputusan diberi latar tipis: inilah
                           satu-satunya baris yang menuntut tindakan hari ini. */
                        className={cn(b.status === 'DIKIRIM' && 'bg-amber-500/[0.05]')}
                      >
                        <TableCell>
                          <Link
                            href={`/backoffice/pelunasan/${b.id}`}
                            className="whitespace-nowrap font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
                          >
                            {b.docNo}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[8rem] max-w-[14rem]">
                          {b.storeName}
                          {b.salesmanName && (
                            <span className="block text-xs text-muted-foreground">
                              {b.salesmanName}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{tanggal(b.claimedTransferAt)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {rupiah(b.invoiceAmount)}
                          {/* Potongan di baris sendiri dan tidak dipatahkan: di 1280 px
                              "Rp" dan angkanya dulu terbelah ke dua baris. */}
                          {b.deductionCount > 0 && (
                            <>
                              <span className="block text-xs">{t('deductionsCount', { count: b.deductionCount })}</span>
                              <span className="block whitespace-nowrap text-xs">− {rupiah(b.deductionTotal)}</span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {rupiah(b.receivedAmount)}
                        </TableCell>
                        <TableCell>{keadaan(b)}</TableCell>
                        <TableCell className="sticky right-0 bg-card text-right">{aksi(b, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <HalamanDaftar {...halaman} />
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
