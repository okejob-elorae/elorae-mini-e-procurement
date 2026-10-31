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
import type { PilPiutang } from './saring';

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
  pil,
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
  /** Atas SEMUA faktur, bukan hanya halaman ini — untuk kepala halaman. */
  ringkasan: RingkasanPiutang;
  /** Angka pil saringan, mengikuti kotak cari (= baris yang muncul saat pil diklik). */
  pil: PilPiutang;
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
  const disaring = saring !== null || cari !== '';

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

  /** Baris yang menuntut tindakan diberi latar tipis — sama di tabel dan kartu HP. */
  const perluTindakan = (b: BarisPiutang) =>
    b.keadaanTampil === 'lewat' || b.keadaanTampil === 'jatuh_tempo' || b.keadaanTampil === 'tertahan';

  /**
   * Tugaskan faktur toko ini ke orang lapangan — formulirnya membuka toko yang
   * sama, fakturnya dipilih di sana.
   */
  const tautanTugas = (b: BarisPiutang) =>
    bolehMengelola && b.keadaan !== 'lunas' ? (
      <Link
        href={`/backoffice/tugas-tagih/baru?toko=${encodeURIComponent(b.storeId)}`}
        className="block text-xs font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
      >
        {tTugas('buatUntukToko')}
      </Link>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('judulHalaman')}
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
                <span className="text-sm font-semibold tabular-nums">{pil.semua.jumlah}</span>
              </span>
              <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{rupiah(pil.semua.nilai)}</span>
            </Link>
            {/* Saringan aktif tetap tampil walau kosong — tanpa itu tautan
                `?keadaan=` ke keadaan yang sudah habis tidak bisa dilepas. */}
            {URUT_KEADAAN_TAMPIL.filter((k) => pil.perKeadaan[k].jumlah > 0 || k === saring).map((k) => {
              const aktif = saring === k;
              const d = pil.perKeadaan[k];
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
          {cari !== '' && <p className="text-xs text-muted-foreground">{t('hitunganIkutCari', { cari })}</p>}
        </div>
      )}

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            adaFaktur ? (
              <EmptyState
                icon={Receipt}
                title={t('emptyFilteredTitle')}
                action={
                  disaring ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={JALUR} replace>
                        {t('hapusSaringan')}
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState icon={Receipt} title={t('emptyTitle')} description={t('emptyBody')} />
            )
          ) : (
            <>
              {/* HP: kartu bertumpuk. Tabelnya 840 px — di layar 390 px kolom
                  Sisa dan Keadaan hanya terlihat dengan menggeser. */}
              <ul className="divide-y md:hidden">
                {baris.map((b) => (
                  <li key={b.id} className={cn('space-y-2 px-4 py-3', perluTindakan(b) && 'bg-destructive/[0.04]')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{b.invoiceNo}</p>
                        <p className="text-sm">{b.storeName}</p>
                        <p className="text-xs text-muted-foreground">
                          {[b.salesmanName, t(`source${b.source}` as never)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="whitespace-nowrap font-semibold tabular-nums">{rupiah(b.outstanding)}</p>
                        <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {t('colAmount')} {rupiah(b.amount)}
                        </p>
                        <p className="whitespace-nowrap text-xs text-muted-foreground">
                          {t('kolomJatuhTempo')} {tanggal(b.dueDate)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <StatusPill tone={NADA[b.keadaanTampil]}>{label(b.keadaanTampil)}</StatusPill>
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">{alasan(b)}</p>
                    </div>
                    {tautanTugas(b)}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colInvoice')}</TableHead>
                      <TableHead>{t('colStore')}</TableHead>
                      <TableHead>{t('kolomJatuhTempo')}</TableHead>
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
                        className={cn(perluTindakan(b) && 'bg-destructive/[0.04]')}
                      >
                        <TableCell className="font-medium">
                          {b.invoiceNo}
                          {/* Asal faktur sebagai teks redup, bukan lencana warna: lencana
                              kategori di baris berlatar merah tipis turun ke ±4,3:1. */}
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            {t(`source${b.source}` as never)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[140px] max-w-[220px]">
                          {b.storeName}
                          {b.salesmanName && (
                            <span className="block text-xs text-muted-foreground">
                              {b.salesmanName}
                            </span>
                          )}
                          {tautanTugas(b)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{tanggal(b.dueDate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {rupiah(b.amount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
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
            </>
          )}
          <HalamanDaftar {...halaman} />
        </CardContent>
      </Card>
    </div>
  );
}
