'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Landmark, MessageCircle, Plus, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import type { KlaimSaya } from '@/lib/receivables/pwa-queries';
import type { TautanPesanKlaim } from '@/lib/receivables/tugas-tagih-queries';
import { TombolTarikLaporan } from '../TombolTarikLaporan';
import { KoreksiTerkirim } from '../KoreksiTerkirim';
import { TombolBantuanHp } from '@/app/pwa/TombolBantuanHp';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<KlaimSaya['status'], string> = {
  DIKIRIM: 'bg-primary/15 text-foreground',
  TERVERIFIKASI: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  DITOLAK: 'bg-destructive/10 text-destructive',
  DIBATALKAN: 'bg-muted text-muted-foreground',
};

/** Warna status giro: menunggu tenang, cair hijau, ditolak merah. */
const NADA_GIRO: Record<'MENUNGGU' | 'CAIR' | 'DITOLAK', string> = {
  MENUNGGU: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  CAIR: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  DITOLAK: 'border-destructive/40 bg-destructive/10 text-red-800 dark:text-red-300',
};

export type KlaimSayaTampil = KlaimSaya & {
  /** Tanggal efektif giro, sudah diformat di server. */
  giroEfektifTeks: string | null;
  /**
   * Pesan WhatsApp ke toko: tanda terima (belum diverifikasi, tidak menyebut
   * lunas) atau konfirmasi (sudah diverifikasi). `null` untuk yang ditolak/dibatalkan.
   */
  pesanToko: TautanPesanKlaim | null;
  /** Nomor BKM pengganti, kalau laporan yang ditolak/dibatalkan ini sudah dilaporkan ulang. */
  digantiOleh: string | null;
  /** Permintaan koreksi yang masih menunggu kantor (tanggal sudah diformat). */
  koreksi: { pada: string; alasan: string } | null;
  /** WhatsApp "tanda terima dibatalkan" — hanya untuk BKM yang dibatalkan. */
  pesanBatal: { url: string; adaNomor: boolean } | null;
};

export function KlaimSayaClient({ baris }: { baris: KlaimSayaTampil[] }) {
  const t = useTranslations('pwaBkm');
  const td = dinamis(t);
  const tPesan = useTranslations('pesanToko');
  const tTarik = useTranslations('pwaTarik');
  const menunggu = baris.filter((b) => b.status === 'DIKIRIM').length;

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
            <TombolBantuanHp judul={t('pageTitle')} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('summary', { count: baris.length, pending: menunggu })}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/pwa/bkm/baru">
            <Plus className="mr-1 h-4 w-4" />
            {t('new')}
          </Link>
        </Button>
      </header>

      {baris.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {baris.map((b) => (
            <Card key={b.id} className="py-0">
              <CardContent className="space-y-2 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{b.docNo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName} · {tanggal(b.tanggal)}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {rupiah(b.nilaiDiterima)}
                  </span>
                </div>
                {b.giro && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Landmark className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t('giroLine', {
                        no: b.giro.nomor ?? '—',
                        bank: b.giro.bank ?? '—',
                        date: b.giroEfektifTeks ?? '—',
                      })}
                    </span>
                    {b.giro.status && (
                      <Badge variant="outline" className={NADA_GIRO[b.giro.status]}>
                        {td(`giro_${b.giro.status}`)}
                      </Badge>
                    )}
                  </div>
                )}
                <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[b.status])}>
                  {/* Giro yang menunggu punya kalimatnya sendiri: yang ditunggu
                      bukan admin, melainkan bilyetnya cair di bank. */}
                  {b.status === 'DIKIRIM' && b.giro?.status === 'MENUNGGU'
                    ? t('why_giro_MENUNGGU')
                    : td(`why_${b.status}`)}
                  {(b.status === 'DITOLAK' || b.status === 'DIBATALKAN') && b.catatan && (
                    <span className="mt-1 block font-medium">{b.catatan}</span>
                  )}
                </p>
                {b.pesanToko && (
                  <div className="space-y-1">
                    {/* Hanya MEMBUKA WhatsApp dengan pesan terisi — sales sendiri yang menekan kirim. */}
                    <Button asChild variant="outline" className="w-full">
                      <a href={b.pesanToko.url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                        {b.pesanToko.jenis === 'KONFIRMASI'
                          ? tPesan('kirimKonfirmasi')
                          : tPesan('kirimTandaTerima')}
                      </a>
                    </Button>
                    {!b.pesanToko.adaNomor && (
                      <p className="text-xs text-muted-foreground">{tPesan('tanpaNomor')}</p>
                    )}
                  </div>
                )}
                {/* Salah toko atau salah faktur: selama keuangan belum memutuskan,
                    pelapornya sendiri boleh menarik laporannya. */}
                {b.status === 'DIKIRIM' && <TombolTarikLaporan jenis="bkm" id={b.id} nomor={b.docNo} />}
                {/* Sudah diverifikasi: tidak bisa ditarik lagi — kantor yang membetulkan. */}
                {b.status === 'TERVERIFIKASI' &&
                  (b.koreksi ? (
                    <KoreksiTerkirim pada={b.koreksi.pada} alasan={b.koreksi.alasan} />
                  ) : (
                    <TombolTarikLaporan jenis="bkm" id={b.id} nomor={b.docNo} mode="koreksi" />
                  ))}
                {/* Toko mungkin sudah memegang tanda terima nomor ini. */}
                {b.status === 'DIBATALKAN' && b.pesanBatal && (
                  <div className="space-y-1">
                    <Button asChild variant="outline" className="w-full">
                      <a href={b.pesanBatal.url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                        {tPesan('kirimPembatalan')}
                      </a>
                    </Button>
                    {!b.pesanBatal.adaNomor && (
                      <p className="text-xs text-muted-foreground">{tPesan('tanpaNomor')}</p>
                    )}
                  </div>
                )}
                {/* Yang ditolak atau dibatalkan dilaporkan ulang dari salinannya —
                    SEKALI: begitu ada penggantinya, tombolnya diganti keterangan. */}
                {(b.status === 'DITOLAK' || b.status === 'DIBATALKAN') &&
                  (b.digantiOleh ? (
                    <p className="text-sm text-muted-foreground">{tTarik('digantiOleh', { nomor: b.digantiOleh })}</p>
                  ) : (
                    <Button asChild variant="outline" className="w-full">
                      <Link href={`/pwa/bkm/baru?salin=${b.id}`}>
                        <RotateCcw className="h-4 w-4" aria-hidden />
                        {tTarik('laporUlang')}
                      </Link>
                    </Button>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
