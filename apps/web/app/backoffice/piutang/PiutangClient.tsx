'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { FileSpreadsheet, PenLine, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FakturManualDialog, type PilihanBarang } from './FakturManualDialog';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { CategoryBadge } from '@/components/ui/category-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/lib/date-only';
import type { BarisPiutang, RingkasanPiutang } from '@/lib/receivables/queries';
import type { KeadaanPiutang } from '@/lib/receivables/rules';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Nada per keadaan. `lewat` dan `tertahan` merah karena keduanya berarti uang
 * berhenti bergerak; `klaim` biru karena ada yang sudah dikerjakan dan sedang
 * menunggu orang lain — bukan kesalahan sales.
 */
const NADA: Record<KeadaanPiutang, StatusTone> = {
  lunas: 'settled',
  klaim: 'progress',
  tertahan: 'attention',
  lewat: 'attention',
  tt: 'waiting',
  belum: 'inactive',
};

const URUT: KeadaanPiutang[] = ['lewat', 'tertahan', 'klaim', 'tt', 'belum', 'lunas'];

export function PiutangClient({
  baris,
  ringkasan,
  toko,
  katalog,
  bolehMengelola,
  saringAwal = null,
}: {
  baris: BarisPiutang[];
  ringkasan: RingkasanPiutang;
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
  bolehMengelola: boolean;
  /** Dari `?keadaan=` — supaya tautan beranda mendarat di daftar yang tersaring. */
  saringAwal?: KeadaanPiutang | null;
}) {
  const t = useTranslations('receivables');
  const tTugas = useTranslations('tugasTagih');
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [saring, setSaringState] = useState<KeadaanPiutang | null>(saringAwal);
  // Saringan ditulis balik ke URL (replace): tautannya bisa dibagikan, dan
  // "Kembali" tidak berjalan mundur melewati setiap pilihan.
  const setSaring = (k: KeadaanPiutang | null) => {
    setSaringState(k);
    const params = new URLSearchParams(searchParams.toString());
    if (k) params.set('keadaan', k);
    else params.delete('keadaan');
    const qs = params.toString();
    // `history.replaceState`, bukan `router.replace`: Next menyelaraskannya
    // dengan useSearchParams tanpa memuat ulang halaman server — saringan ini
    // bekerja di klien, jadi perjalanan ke server hanya membuang waktu.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  };
  const [manualTerbuka, setManualTerbuka] = useState(false);

  const label = (k: KeadaanPiutang) =>
    t(`state${k.charAt(0).toUpperCase()}${k.slice(1)}` as never);

  /** Kalimat alasan — inti programnya. Tanpa ini halaman ini cuma tabel angka. */
  const alasan = (b: BarisPiutang): string => {
    switch (b.keadaan) {
      case 'lunas':
        return t('reasonLunas');
      case 'klaim':
        return t('reasonKlaim', { no: b.alasan.noKlaim ?? '—' });
      case 'tertahan':
        return t('reasonTertahan', { nilai: rupiah(b.alasan.nilaiTertahan ?? 0) });
      case 'lewat':
        return t('reasonLewat', {
          tgl: b.alasan.janjiBayar ? tanggal(b.alasan.janjiBayar) : '—',
          hari: b.alasan.hariTerlambat ?? 0,
        });
      case 'tt':
        return t('reasonTt', {
          no: b.alasan.noKontrabon ?? '—',
          tgl: b.alasan.janjiBayar ? tanggal(b.alasan.janjiBayar) : '—',
        });
      default:
        return t('reasonBelum');
    }
  };

  const tampil = useMemo(
    () => (saring ? baris.filter((b) => b.keadaan === saring) : baris),
    [baris, saring],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        meta={t('summary', {
          count: ringkasan.jumlahPiutang,
          value: rupiah(ringkasan.total),
        })}
        actions={
          bolehMengelola ? (
            <span className="inline-flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/backoffice/piutang/impor">
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  {t('import')}
                </Link>
              </Button>
              <Button onClick={() => setManualTerbuka(true)}>
                <PenLine className="mr-1.5 h-4 w-4" />
                {t('manual')}
              </Button>
            </span>
          ) : undefined
        }
      />

      {bolehMengelola && (
        <FakturManualDialog
          terbuka={manualTerbuka}
          onOpenChange={setManualTerbuka}
          toko={toko}
          katalog={katalog}
        />
      )}

      {baris.length > 0 && (
        <div className="anim-stagger flex flex-wrap gap-2">
          {/* Saringan aktif tetap tampil walau kosong — tanpa itu tautan
              `?keadaan=` ke keadaan yang sudah habis tidak bisa dilepas. */}
          {URUT.filter((k) => ringkasan.perKeadaan[k].jumlah > 0 || k === saring).map((k) => {
            const aktif = saring === k;
            const d = ringkasan.perKeadaan[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSaring(aktif ? null : k)}
                aria-pressed={aktif}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  aktif ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:bg-muted/60',
                )}
              >
                <span className="flex items-center gap-2">
                  <StatusPill tone={NADA[k]}>{label(k)}</StatusPill>
                  <span className="text-sm font-semibold tabular-nums">{d.jumlah}</span>
                </span>
                <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                  {rupiah(d.nilai)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState icon={Receipt} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colInvoice')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead>{t('colDue')}</TableHead>
                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                    <TableHead className="text-right">{t('colOutstanding')}</TableHead>
                    <TableHead className="min-w-[16rem]">{t('colState')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow
                      key={b.id}
                      /* Baris yang menuntut tindakan diberi latar tipis, supaya
                         pekerjaan ditemukan tanpa membaca kolom keadaan. */
                      className={cn(
                        (b.keadaan === 'lewat' || b.keadaan === 'tertahan') &&
                          'bg-destructive/[0.04]',
                      )}
                    >
                      <TableCell className="font-medium">
                        {b.invoiceNo}
                        <span className="mt-0.5 block">
                          <CategoryBadge label={b.source}>
                            {t(`source${b.source}` as never)}
                          </CategoryBadge>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal min-w-[140px] max-w-[220px]">
                        {b.storeName}
                        {b.salesmanName && (
                          <span className="block text-xs text-muted-foreground">
                            {b.salesmanName}
                          </span>
                        )}
                        {/* Tugaskan faktur toko ini ke orang lapangan — formulirnya
                            membuka toko yang sama, fakturnya dipilih di sana. */}
                        {bolehMengelola && b.keadaan !== 'lunas' && (
                          <Link
                            href={`/backoffice/tugas-tagih/baru?toko=${encodeURIComponent(b.storeId)}`}
                            className="block text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {tTugas('buatUntukToko')}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{tanggal(b.dueDate)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {rupiah(b.amount)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {rupiah(b.outstanding)}
                      </TableCell>
                      <TableCell className="whitespace-normal min-w-[16rem] max-w-[26rem]">
                        <StatusPill tone={NADA[b.keadaan]}>{label(b.keadaan)}</StatusPill>
                        <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                          {alasan(b)}
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
    </div>
  );
}
