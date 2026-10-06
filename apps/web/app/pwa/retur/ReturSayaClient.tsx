'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, Plus, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import type { ReturSaya } from '@/lib/receivables/pwa-queries';
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

const NADA: Record<string, string> = {
  cek: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  keputusan: 'bg-destructive/10 text-destructive',
  jodoh: 'bg-primary/15 text-foreground',
  beres: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  batal: 'bg-muted text-muted-foreground',
};

export type ReturSayaTampil = ReturSaya & {
  /** Nomor nota pengganti, kalau nota batal ini sudah dicatat ulang. */
  digantiOleh: string | null;
  /** Permintaan koreksi yang masih menunggu kantor. */
  koreksi: { pada: string; alasan: string } | null;
};

export function ReturSayaClient({ baris }: { baris: ReturSayaTampil[] }) {
  const t = useTranslations('pwaRetur');
  const td = dinamis(t);
  const tTarik = useTranslations('pwaTarik');

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
            <TombolBantuanHp judul={t('pageTitle')} />
          </div>
          <p className="text-sm text-muted-foreground">{t('summary', { count: baris.length })}</p>
        </div>
        <Button asChild size="sm">
          <Link href="/pwa/retur/baru">
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
                    <span className="block font-semibold">{b.noNrt}</span>
                    {/* Nota SPG di toko yang Anda pegang — hanya untuk dilihat. */}
                    {!b.milikSaya && (
                      <Badge variant="secondary" className="mt-1 max-w-full whitespace-normal text-left">
                        {b.pelapor ? t('dariSpgOleh', { nama: b.pelapor }) : t('dariSpg')}
                      </Badge>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName} · {tanggal(b.tanggal)}
                      {b.adaFoto && (
                        <Camera className="ml-1 inline h-3 w-3 align-[-1px]" />
                      )}
                    </span>
                  </span>
                  {/* Nilai toko KONSI tidak pernah sampai ke HP — yang tampil jumlah potongnya. */}
                  <span className="shrink-0 font-bold tabular-nums">
                    {b.nilaiKlaim !== null ? rupiah(b.nilaiKlaim) : t("jumlahPotong", { count: b.jumlahBarang })}
                  </span>
                </div>
                <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[b.langkah])}>
                  {td(`why_${b.langkah}`)}
                </p>
                {/* Belum dihitung gudang: pelapornya sendiri boleh menarik notanya
                    (salah toko, salah nomor). Sesudah dihitung, kantor yang membetulkan. */}
                {b.milikSaya && b.langkah === 'cek' && <TombolTarikLaporan jenis="retur" id={b.id} nomor={b.noNrt} />}
                {/* Sudah dihitung gudang: barangnya sudah masuk — kantor yang membetulkan. */}
                {b.milikSaya &&
                  b.langkah !== 'cek' &&
                  b.langkah !== 'batal' &&
                  (b.koreksi ? (
                    <KoreksiTerkirim pada={b.koreksi.pada} alasan={b.koreksi.alasan} />
                  ) : (
                    <TombolTarikLaporan jenis="retur" id={b.id} nomor={b.noNrt} mode="koreksi" />
                  ))}
                {b.milikSaya &&
                  b.langkah === 'batal' &&
                  (b.digantiOleh ? (
                    <p className="text-sm text-muted-foreground">{tTarik('digantiOleh', { nomor: b.digantiOleh })}</p>
                  ) : (
                    <Button asChild variant="outline" className="w-full">
                      <Link href={`/pwa/retur/baru?salin=${b.id}`}>
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
