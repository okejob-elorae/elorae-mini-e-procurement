'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { greetingKey } from '@/lib/auth/login-message';

/**
 * Baris pembuka beranda: salam, tanggal, dan kapan angkanya terakhir dimuat.
 *
 * Menggantikan tiga benda yang mengulang: judul "Beranda" (sudah ada di bilah
 * atas), kalimat sambutan umum, dan lencana peran (sudah ada di menu
 * pengguna). Yang tersisa hanya yang baru: siapa, hari apa, dan seberapa segar
 * angkanya — plus cara memperbaruinya tanpa memuat ulang seluruh halaman.
 */
export function SalamBeranda({
  nama,
  dimuatPada,
  tindakan,
}: {
  nama: string;
  dimuatPada: string;
  /** Tombol "perlu ditindaklanjuti", di kanan sebelum "Diperbarui". */
  tindakan?: ReactNode;
}) {
  const tAuth = useTranslations('auth');
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [memuat, mulai] = useTransition();
  const [sekarang, setSekarang] = useState(() => Date.parse(dimuatPada));

  useEffect(() => {
    const id = window.setInterval(() => setSekarang(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const bahasa = locale === 'en' ? 'en-GB' : 'id-ID';
  const tanggal = new Intl.DateTimeFormat(bahasa, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(dimuatPada));
  const detik = Math.max(0, Math.round((sekarang - Date.parse(dimuatPada)) / 1000));
  const rtf = new Intl.RelativeTimeFormat(bahasa, { numeric: 'auto' });
  const segar =
    detik < 60
      ? t('updatedJustNow')
      : t('updatedAgo', {
          when: detik < 3600 ? rtf.format(-Math.floor(detik / 60), 'minute') : rtf.format(-Math.floor(detik / 3600), 'hour'),
        });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight" suppressHydrationWarning>
          {tAuth(`greeting.${greetingKey()}`)}, {nama}
        </h1>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {tanggal}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tindakan}
        <button
          type="button"
          onClick={() => mulai(() => router.refresh())}
          disabled={memuat}
          className="inline-flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-70"
        >
          <RefreshCw aria-hidden className={cn('h-3.5 w-3.5', memuat && 'animate-spin')} />
          <span suppressHydrationWarning>{memuat ? t('updating') : segar}</span>
        </button>
      </div>
    </div>
  );
}
