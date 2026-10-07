'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { URUT_KEADAAN_TAMPIL, type KeadaanTampil } from '@/lib/receivables/jatuh-tempo';
import { KotakCari } from './_daftar/KotakCari';
import { HalamanDaftar } from './_daftar/HalamanDaftar';
import { denganParam } from './_daftar/halaman';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Nada per keadaan. `lewat`, `jatuh_tempo`, dan `tertahan` merah karena
 * ketiganya berarti uang berhenti bergerak; `klaim` biru karena ada yang sudah
 * dikerjakan dan sedang menunggu orang lain — bukan kesalahan sales.
 */
const NADA: Record<KeadaanTampil, StatusTone> = {
  lunas: 'settled',
  klaim: 'progress',
  tertahan: 'attention',
  lewat: 'attention',
  jatuh_tempo: 'attention',
  tt: 'waiting',
  belum: 'inactive',
};

/** Satu set nama keadaan untuk semua layar kantor (`receivables.state*`). */
const KUNCI_LABEL: Record<KeadaanTampil, string> = {
  lunas: 'stateLunas',
  klaim: 'stateKlaim',
  tertahan: 'stateTertahan',
  lewat: 'stateLewat',
  jatuh_tempo: 'stateJatuhTempo',
  tt: 'stateTt',
  belum: 'stateBelum',
};

const JALUR = '/backoffice/piutang';

export function PiutangClient({
  baris,
  halaman,
  adaFaktur,
  ringkasan,
  toko,
  katalog,
  bolehMengelola,
  saring = null,
  cari = '',
}: {
  /** Satu halaman yang sudah disaring di server. */
  baris: BarisPiutang[];
  halaman: { halaman: number; totalHalaman: number; total: number; ukuran: number };
  /** Ada faktur sama sekali (sebelum disaring) — membedakan "kosong" dari "tidak cocok". */
  adaFaktur: boolean;
  /** Atas SEMUA faktur, bukan hanya halaman ini. */
  ringkasan: RingkasanPiutang;
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
  bolehMengelola: boolean;
  /** Dari `?keadaan=`; `null` = semua yang belum lunas. */
  saring?: KeadaanTampil | null;
  /** Dari `?cari=`. */
  cari?: string;
}) {
  const t = useTranslations('receivables');
  const tTugas = useTranslations('tugasTagih');
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const [manualTerbuka, setManualTerbuka] = useState(false);

  const label = (k: KeadaanTampil) => t(KUNCI_LABEL[k] as never);
  // Saringan menulis ke alamat (replace) dan membawa kata kuncinya; halaman
  // kembali ke 1 karena isi daftarnya berganti.
  const hrefSaring = (k: KeadaanTampil | null) => denganParam(JALUR, { cari }, { keadaan: k });
  const nOpen = URUT_KEADAAN_TAMPIL.filter((k) => k !== 'lunas').reduce(
    (n, k) => n + ringkasan.perKeadaanTampil[k].jumlah,
    0,
  );
  const nilaiOpen = URUT_KEADAAN_TAMPIL.filter((k) => k !== 'lunas').reduce(
    (n, k) => n + ringkasan.perKeadaanTampil[k].nilai,
    0,
  );

  /** Kalimat alasan — inti programnya. Tanpa ini halaman ini cuma tabel angka. */
  const alasan = (b: BarisPiutang): string => {
    switch (b.keadaanTampil) {
      case 'lunas':
        return t('reasonLunas');
      case 'klaim':
        // Kantor membaca laporan orang lain: kalimatnya menyebut pelapornya,
        // bukan "Anda melapor" seperti di layar sales.
        return b.alasan.pelaporKlaim
          ? t('reasonKlaimKantor', {
              pelapor: b.alasan.pelaporKlaim,
              no: (b.alasan.klaimMenunggu ?? [b.alasan.noKlaim ?? '—']).join(', '),
            })
          : t('reasonKlaim', { no: b.alasan.noKlaim ?? '—' });
      case 'jatuh_tempo':
        return t('reasonJatuhTempo', {
          tgl: tanggal(b.dueDate),
          hari: b.alasan.hariLewatJatuhTempo ?? 0,
        });
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


  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
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

      {adaFaktur && (
        <div className="space-y-3">
          <KotakCari nilai={cari} placeholder={t('searchPlaceholder')} label={t('searchPlaceholder')} />
          <div className="anim-stagger flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
            <Link
              href={hrefSaring(null)}
              replace
              aria-current={saring === null ? 'true' : undefined}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                saring === null ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:bg-muted/60',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{t('filterOpen')}</span>
                <span className="text-sm font-semibold tabular-nums">{nOpen}</span>
              </span>
              <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{rupiah(nilaiOpen)}</span>
            </Link>
            {/* Saringan aktif tetap tampil walau kosong — tanpa itu tautan
                `?keadaan=` ke keadaan yang sudah habis tidak bisa dilepas. */}
            {URUT_KEADAAN_TAMPIL.filter((k) => ringkasan.perKeadaanTampil[k].jumlah > 0 || k === saring).map((k) => {
              const aktif = saring === k;
              const d = ringkasan.perKeadaanTampil[k];
              return (
                <Link
                  key={k}
                  href={hrefSaring(aktif ? null : k)}
                  replace
                  aria-current={aktif ? 'true' : undefined}
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
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            adaFaktur ? (
              <EmptyState icon={Receipt} title={t('emptyFilteredTitle')} />
            ) : (
              <EmptyState icon={Receipt} title={t('emptyTitle')} description={t('emptyBody')} />
            )
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
                  {baris.map((b) => (
                    <TableRow
                      key={b.id}
                      /* Baris yang menuntut tindakan diberi latar tipis, supaya
                         pekerjaan ditemukan tanpa membaca kolom keadaan. */
                      className={cn(
                        (b.keadaanTampil === 'lewat' ||
                          b.keadaanTampil === 'jatuh_tempo' ||
                          b.keadaanTampil === 'tertahan') &&
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
                            className="block text-xs font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
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
                        <StatusPill tone={NADA[b.keadaanTampil]}>{label(b.keadaanTampil)}</StatusPill>
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
          <HalamanDaftar {...halaman} />
        </CardContent>
      </Card>
    </div>
  );
}
