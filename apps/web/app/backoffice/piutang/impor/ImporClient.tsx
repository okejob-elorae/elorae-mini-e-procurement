'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
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
import { bacaLembar, type BarisImpor } from '@/lib/receivables/impor/baris';
import { simpanImporAction, tinjauImporAction } from '@/app/actions/receivable-import';
import { mulaiProses, selesaiProses } from '@/lib/pulau/pulau';
import type { TinjauanImpor } from '@/lib/receivables/impor/writer';
import { CONTOH_BERKAS_IMPOR, NAMA_BERKAS_CONTOH } from './contoh';

/** Unduh contoh berkas — dirakit di peramban, tidak ada yang dikirim ke server. */
function unduhContoh() {
  const url = URL.createObjectURL(new Blob([CONTOH_BERKAS_IMPOR], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = NAMA_BERKAS_CONTOH;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Dilepas sesudah unduhan mulai — dilepas seketika, Safari dan Firefox bisa
  // membatalkan unduhannya.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export function ImporClient() {
  const t = useTranslations('imporPiutang');
  const tPulau = useTranslations('pulau.proses');
  const locale = useLocale();
  const tanggal = (d: Date | string | null) => formatDisplayDate(d, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [membaca, setMembaca] = useState(false);
  const [namaBerkas, setNamaBerkas] = useState<string | null>(null);
  const [baris, setBaris] = useState<BarisImpor[]>([]);
  const [adaKolomSisa, setAdaKolomSisa] = useState(false);
  const [tinjauan, setTinjauan] = useState<TinjauanImpor | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  /*
   * Berkasnya diurai DI BROWSER. Yang dikirim ke server hanya baris hasil urai
   * yang sudah dilihat pengguna — jadi berkas mentahnya tidak pernah keluar
   * dari mesinnya, dan yang tersimpan persis yang tampil di pratinjau.
   */
  const pilihBerkas = async (file: File) => {
    setGalat(null);
    setTinjauan(null);
    setMembaca(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      /*
       * `raw: true` mematikan tebakan tipe pada berkas berbasis teks (CSV).
       * Tanpanya SheetJS membaca "900.000" sebagai angka sembilan ratus —
       * titiknya dianggap pemisah desimal — dan nilai itu sampai ke pengurai
       * sudah rusak, seribu kali lebih kecil. Yang bertitik dua selamat hanya
       * karena ia bukan angka yang sah. Pada .xlsx pilihan ini tidak berpengaruh:
       * selnya sudah membawa tipenya sendiri.
       */
      const wb = XLSX.read(buf, { cellDates: true, raw: true });
      const lembar = wb.Sheets[wb.SheetNames[0]];
      if (!lembar) {
        setGalat(t('errLembarKosong'));
        return;
      }
      const sel = XLSX.utils.sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: '' });
      const hasil = bacaLembar(sel);
      if (hasil.barisJudul === -1) {
        setGalat(t('errJudulTidakKetemu'));
        return;
      }
      if (hasil.kolom.no_faktur === undefined || hasil.kolom.nilai === undefined) {
        setGalat(t('errKolomWajib'));
        return;
      }
      setNamaBerkas(file.name);
      setBaris(hasil.baris);
      setAdaKolomSisa(hasil.adaKolomSisa);

      startTransition(async () => {
        const tj = await tinjauImporAction(hasil.baris);
        if (tj.ok) setTinjauan(tj.tinjauan);
        else toast.error(t(`err${tj.kode}` as never));
      });
    } catch {
      setGalat(t('errBacaBerkas'));
    } finally {
      setMembaca(false);
    }
  };

  const simpan = () => {
    startTransition(async () => {
      // Pulau status: tanpa persen — satu aksi server, tidak ada kemajuan yang dilaporkan.
      mulaiProses('impor-piutang', tPulau('imporPiutang', { count: baris.length }));
      const hasil = await simpanImporAction(baris).finally(() => selesaiProses('impor-piutang'));
      if (!hasil.ok) {
        toast.error(t(`err${hasil.kode}` as never));
        return;
      }
      toast.success(
        t('okSaved', { masuk: hasil.hasil.masuk, lewat: hasil.hasil.dilewati.length }),
      );
      router.push('/backoffice/piutang');
    });
  };

  const alasanBaris = new Map(
    (tinjauan?.akanDilewati ?? []).map((d) => [d.baris, d.alasan] as const),
  );

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/piutang">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('back')}
        </Link>
      </Button>

      <PageHeader
        title={t('pageTitle')}
        actions={
          <Button variant="outline" onClick={unduhContoh}>
            <Download className="mr-1.5 h-4 w-4" />
            {t('downloadSample')}
          </Button>
        }
      />

      <Card>
        <CardContent className="py-6">
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center transition-colors hover:bg-muted/50',
              membaca && 'pointer-events-none opacity-60',
            )}
          >
            {membaca ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{namaBerkas ?? t('pickFile')}</span>
            <span className="text-xs text-muted-foreground">{t('pickFileHint')}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pilihBerkas(f);
                e.target.value = '';
              }}
            />
          </label>
          {/* Syarat kolom disebut SEBELUM mengunggah, bukan baru dari galatnya. */}
          <p className="mt-3 text-xs text-muted-foreground">{t('columnsRequired')}</p>
          {galat && <p className="mt-3 text-sm text-destructive">{galat}</p>}
        </CardContent>
      </Card>

      {baris.length > 0 && (
        <>
          <Card>
            <CardContent className="grid gap-4 py-4 sm:grid-cols-4">
              <Angka label={t('rowsRead')} value={String(baris.length)} />
              <Angka
                label={t('rowsReady')}
                value={tinjauan ? String(tinjauan.siap) : '…'}
                nada="text-emerald-600 dark:text-emerald-500"
              />
              <Angka
                label={t('rowsSkipped')}
                value={tinjauan ? String(tinjauan.akanDilewati.length) : '…'}
                nada={tinjauan && tinjauan.akanDilewati.length > 0 ? 'text-amber-600 dark:text-amber-500' : undefined}
              />
              <Angka
                label={t('totalOutstanding')}
                value={tinjauan ? rupiah(tinjauan.totalSisa) : '…'}
              />
            </CardContent>
          </Card>

          {!adaKolomSisa && (
            <Card className="border-amber-500/40 bg-amber-500/[0.05]">
              <CardContent className="py-3 text-sm">{t('noSisaColumn')}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('previewTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>{t('colRow')}</TableHead>
                      <TableHead>{t('colInvoice')}</TableHead>
                      <TableHead>{t('colStore')}</TableHead>
                      <TableHead>{t('colDue')}</TableHead>
                      <TableHead className="text-right">{t('colAmount')}</TableHead>
                      <TableHead className="text-right">{t('colOutstanding')}</TableHead>
                      <TableHead>{t('colVerdict')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {baris.map((b) => {
                      const alasan = alasanBaris.get(b.baris);
                      return (
                        <TableRow
                          key={b.baris}
                          className={cn(alasan && 'bg-amber-500/[0.06]')}
                        >
                          <TableCell className="tabular-nums text-muted-foreground">
                            {b.baris}
                          </TableCell>
                          <TableCell className="font-medium">{b.noFaktur || '—'}</TableCell>
                          <TableCell className="whitespace-normal min-w-[140px] max-w-[220px]">
                            {b.kodeToko ?? b.namaToko ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{tanggal(b.jatuhTempo)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {b.nilai === null ? '—' : rupiah(b.nilai)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {b.sisa === null ? '—' : rupiah(b.sisa)}
                            {b.sisaTertulis === 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {t('writtenZero')}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {alasan ? (
                              <StatusPill tone="attention" detail={t(`skip${alasan}` as never)}>
                                {t('willSkip')}
                              </StatusPill>
                            ) : tinjauan ? (
                              <StatusPill tone="settled">{t('willImport')}</StatusPill>
                            ) : (
                              <span className="text-xs text-muted-foreground">…</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              disabled={pending || !tinjauan || tinjauan.siap === 0}
              onClick={simpan}
            >
              {tinjauan ? t('save', { count: tinjauan.siap }) : t('saveWaiting')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Angka({ label, value, nada }: { label: string; value: string; nada?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', nada)}>{value}</p>
    </div>
  );
}
