'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Store } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { TokoLapangan } from '@/lib/receivables/pwa-queries';
import type { KeadaanPiutang } from '@/lib/receivables/rules';
import { dinamis } from '@/lib/i18n/dinamis';
import { TugasTagihKantor, type TugasTagihHp } from './TugasTagihKantor';
import { TombolBantuanHp } from '@/app/pwa/TombolBantuanHp';

/** Nominal disingkat: layar HP tidak muat "Rp 13.300.000" berulang kali. */
const singkat = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} jt`
    : n >= 1_000
      ? `${Math.round(n / 1_000)} rb`
      : String(Math.round(n));

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

/*
 * Warna kalimatnya, bukan warna lencana. Sales membaca kalimat ini sambil
 * berdiri di depan toko — yang harus menonjol adalah kalimatnya sendiri.
 */
const NADA: Record<KeadaanPiutang, string> = {
  lewat: 'bg-destructive/10 text-red-800 dark:text-red-300',
  tertahan: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  klaim: 'bg-primary/15 text-foreground',
  tt: 'bg-muted text-muted-foreground',
  belum: 'bg-primary/15 text-foreground',
  lunas: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

export function PiutangLapanganClient({
  toko,
  tugas = [],
}: {
  toko: TokoLapangan[];
  /** Tugas tagih dari kantor — tampil paling atas, di atas daftar toko. */
  tugas?: TugasTagihHp[];
}) {
  const t = useTranslations('pwaPiutang');
  const td = dinamis(t);
  const belumBeres = toko.filter((s) => s.sisa > 0);
  const total = belumBeres.reduce((s, x) => s + x.sisa, 0);

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
          <TombolBantuanHp judul={t('pageTitle')} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('summary', { count: belumBeres.length, value: rupiah(total) })}
        </p>
      </header>

      <TugasTagihKantor tugas={tugas} />

      {toko.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {toko.map((s) => (
            <Link key={s.storeId} href={`/pwa/piutang/${s.storeId}`} className="block">
              <Card className="transition-colors active:bg-muted/50 py-0">
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Store className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-tight">{s.storeName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('invoiceCount', { count: s.jumlahFaktur })}
                        {s.doc && ` · ${s.doc}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-lg font-bold tabular-nums">
                        {singkat(s.sisa)}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>

                  {/* Kalimat alasan. Inilah yang membedakan layar ini dari
                      daftar angka: ia menyebut sebabnya dan apa berikutnya. */}
                  <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[s.keadaan])}>
                    {td(`why_${s.keadaan}`, {
                      value: rupiah(s.alasan.nilaiTertahan ?? 0),
                      doc: s.alasan.noKlaim ?? s.alasan.noKontrabon ?? '—',
                      date: tanggal(s.alasan.janjiBayar),
                      days: s.alasan.hariTerlambat ?? 0,
                    })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
