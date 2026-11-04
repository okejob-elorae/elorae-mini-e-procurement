'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { cn } from '@/lib/utils';
import { tautanPiutang } from '@/lib/receivables/tindakan-dasbor';
import { formatDisplayDate } from '@/lib/date-only';
import { dinamis } from '@/lib/i18n/dinamis';
import { pasangFotoKontrabonAction } from '@/app/actions/collections';
import type { RincianKontrabon } from '@/lib/receivables/collection-queries';
import { LencanaAsal, TombolKonfirmasi } from '../KonfirmasiLapangan';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const NADA: Record<RincianKontrabon['baris']['status'], StatusTone> = {
  BERJALAN: 'waiting',
  SELESAI: 'settled',
  BATAL: 'inactive',
};

export function RincianKontrabonClient({
  data,
  bolehMengelola,
}: {
  data: RincianKontrabon;
  bolehMengelola: boolean;
}) {
  const t = useTranslations('collections');
  const td = dinamis(t);
  const tBkm = dinamis(useTranslations('payments'));
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [foto, setFoto] = useState<NilaiFoto>(
    data.fotoUrl ? { url: data.fotoUrl, nama: data.baris.docNo } : null,
  );

  const b = data.baris;
  const terlambat = b.status === 'BERJALAN' && (b.sisaHari ?? 0) < 0;
  const sudahDibayar = b.nilaiSerah - b.sisaSekarang;

  // Foto yang sudah tersimpan tidak bisa dihapus dari sini — × hanya membuka
  // pemilih untuk foto pengganti. Kalimat di bawahnya mengatakannya, supaya
  // tidak ada yang mengira fotonya sudah terhapus.
  const fotoTersimpan = data.fotoUrl ? { url: data.fotoUrl, nama: data.baris.docNo } : null;
  const simpanFoto = (nilai: NilaiFoto) => {
    setFoto(nilai);
    if (!nilai) return;
    startTransition(async () => {
      const hasil = await pasangFotoKontrabonAction(b.id, nilai.url);
      if (hasil.ok) {
        toast.success(t('okPhoto'));
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/kontrabon">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={b.docNo}
        meta={
          <>
            <span className="block">
              {[b.storeName, b.salesmanName, b.receivedBy && t('receivedBy', { name: b.receivedBy })]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="mt-1 inline-flex flex-wrap items-center gap-2">
              <StatusPill tone={NADA[b.status]}>{td(`status${b.status}`)}</StatusPill>
              <LencanaAsal dariLapangan={b.dariLapangan} dikonfirmasi={b.dikonfirmasi} />
              <span className={cn('text-sm', terlambat ? 'text-destructive' : 'text-muted-foreground')}>
                {t('promisedOn', { date: tanggal(b.promisedDate) })}
                {b.sisaHari !== null &&
                  ` · ${
                    terlambat
                      ? t('lateBy', { days: Math.abs(b.sisaHari) })
                      : t('dueIn', { days: b.sisaHari })
                  }`}
              </span>
            </span>
          </>
        }
        actions={
          b.status === 'BERJALAN' && !b.dikonfirmasi && bolehMengelola ? (
            <TombolKonfirmasi collectionNoteId={b.id} docNo={b.docNo} size="default" />
          ) : undefined
        }
      />

      {b.dariLapangan && (
        <Card className={cn(!b.dikonfirmasi && 'border-amber-500/40 bg-amber-500/[0.04]')}>
          <CardContent className="py-4 text-sm leading-relaxed">
            {data.konfirmasi
              ? t('confirmedBy', {
                  name: data.konfirmasi.oleh ?? '—',
                  date: tanggal(data.konfirmasi.pada),
                })
              : t('fieldUnconfirmedExplain')}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('invoicesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colInvoice')}</TableHead>
                  <TableHead className="text-right">{t('colAtHandover')}</TableHead>
                  <TableHead className="text-right">{t('colNow')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.faktur.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      {/* Ke daftar piutang yang tersaring pada faktur ini — keadaan
                          dan alasannya terbaca di sana tanpa mencari lagi. */}
                      <Link
                        href={tautanPiutang({ cari: f.invoiceNo })}
                        className="whitespace-nowrap font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
                      >
                        {f.invoiceNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rupiah(f.nilaiSerah)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        f.sisaSekarang === 0 && 'text-emerald-600 dark:text-emerald-500',
                      )}
                    >
                      {rupiah(f.sisaSekarang)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">{t('total')}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {rupiah(b.nilaiSerah)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {rupiah(b.sisaSekarang)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {sudahDibayar > 0 && (
              <p className="px-6 pt-3 text-sm text-muted-foreground">
                {t('paidSince', { value: rupiah(sudahDibayar) })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('photoTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {bolehMengelola ? (
              <>
                <UnggahFoto
                  label={t('photoLabel')}
                  petunjuk={t('photoHint')}
                  nilai={foto}
                  onChange={simpanFoto}
                  disabled={pending}
                  // × tidak menghapus foto yang tersimpan: ia hanya membuka
                  // pemilih untuk foto pengganti.
                  labelLepas={t('gantiFotoTt')}
                />
                {!foto && fotoTersimpan && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('photoKeptUntilReplaced')}{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-2"
                      onClick={() => setFoto(fotoTersimpan)}
                    >
                      {t('photoKeepOld')}
                    </button>
                  </p>
                )}
              </>
            ) : foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto.url} alt={b.docNo} className="w-full rounded-lg border object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground">{t('noPhoto')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('claimsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={data.klaim.length === 0 ? undefined : 'px-0'}>
          {data.klaim.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('claimsEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colClaim')}</TableHead>
                  <TableHead className="text-right">{t('colReceived')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.klaim.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>
                      <Link
                        href={`/backoffice/pelunasan/${k.id}`}
                        className="font-medium text-foreground underline decoration-primary underline-offset-2 hover:decoration-2"
                      >
                        {k.docNo}
                      </Link>
                      {/* BKM yang melunasi faktur di TT ini tanpa menunjuk TT-nya. */}
                      {!k.tertautTt && (
                        <span className="block text-xs text-muted-foreground">{t('claimNotLinked')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupiah(k.nilaiDiterima)}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        tone={
                          k.status === 'TERVERIFIKASI'
                            ? 'settled'
                            : k.status === 'DIKIRIM'
                              ? 'waiting'
                              : 'inactive'
                        }
                      >
                        {tBkm(`keadaan${k.status}`)}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.catatan && (
        <Card>
          <CardContent className="py-4 text-sm whitespace-pre-line">{data.catatan}</CardContent>
        </Card>
      )}
    </div>
  );
}
