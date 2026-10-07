'use client';

import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DateRange } from 'react-day-picker';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDateOnly, parseDateOnly } from '@/lib/date-only';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ambilTrenPenjualanRentang } from '@/app/actions/dashboard';
import {
  bacaFilterSaluran,
  bandingkanPeriode,
  kalimatBanding,
  MAKS_HARI_RENTANG,
  nilaiTitik,
  rentangTren,
  SALURAN_LAPANGAN,
  SALURAN_MARKETPLACE,
  seriFilter,
  type FilterSaluran,
  type KunciSeri,
  type TitikTren,
} from '@/lib/dashboard/tren';
import { AngkaNaik } from '@/components/gerak/AngkaNaik';

/**
 * Tren penjualan beranda: marketplace dan lapangan, dua garis sendiri-sendiri,
 * per hari WIB.
 *
 * Satu-satunya hal di beranda yang benar-benar butuh garis waktu — pertanyaan
 * tiap pagi adalah "naik atau turun?", dan angka hari ini saja tidak
 * menjawabnya. Karena itu totalnya selalu disandingkan dengan periode
 * sebelumnya yang sama panjang.
 *
 * Data datang dari server untuk 180 hari; rentang 7/30/90 dipotong di sini,
 * supaya berganti rentang tidak menunggu jaringan dan grafiknya bisa berubah
 * bentuk dengan mulus. Rentang PILIHAN (tanggal bebas, maks. setahun) diambil
 * dari server beserta periode pembandingnya.
 *
 * Saluran bisa dilihat terpisah (`?saluran=` di URL, jadi tautannya bisa
 * dibagikan): semua = dua garis marketplace vs lapangan; satu kelompok = garis
 * per salurannya (Shopee/TikTok/Tokopedia, putus/van/SPG); satu saluran = satu
 * garis. Angka besar, perbandingan, dan keadaan kosong mengikuti pilihan itu.
 * Data sudah memuat rinciannya, jadi berganti saluran tidak menunggu jaringan.
 */

/**
 * Warna tetap per saluran, sama di setiap pilihan — Shopee selalu jingga,
 * di mana pun ia muncul. Warna yang dipakai dua kali tidak pernah tampil
 * bersamaan (kelompok vs salurannya ada di pilihan yang berbeda).
 */
const WARNA: Record<KunciSeri, string> = {
  marketplace: 'var(--viz-1)',
  lapangan: 'var(--viz-3)',
  shopee: 'var(--viz-2)',
  tiktok: 'var(--viz-5)',
  tokopedia: 'var(--viz-6)',
  mpLain: 'var(--muted-foreground)',
  putus: 'var(--viz-3)',
  van: 'var(--viz-4)',
  spg: 'var(--viz-1)',
};

type Pilihan = { mulai: string; akhir: string; panjang: number; tren: TitikTren[] };

const RENTANG = [7, 30, 90] as const;
type Rentang = (typeof RENTANG)[number];

const langgananGerak = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function TrenPenjualan({ tren, formatIdr }: { tren: TitikTren[]; formatIdr: (n: number) => string }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  // Dibaca langsung dari URL, bukan disalin ke state: history.replaceState
  // memperbarui useSearchParams tanpa memuat ulang data beranda dari server.
  const filter = bacaFilterSaluran(useSearchParams().get('saluran'));
  const gantiFilter = (f: FilterSaluran) => {
    const url = new URL(window.location.href);
    if (f === 'semua') url.searchParams.delete('saluran');
    else url.searchParams.set('saluran', f);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const [rentang, setRentang] = useState<Rentang | 'pilih'>(30);
  const [pilihan, setPilihan] = useState<Pilihan | null>(null);
  const [memuat, mulaiMuat] = useTransition();
  const kurangiGerak = useSyncExternalStore(
    langgananGerak,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );

  const aktif = rentang === 'pilih' ? pilihan : null;
  const sumber = aktif ? aktif.tren : tren;
  const panjang = aktif ? aktif.panjang : rentang === 'pilih' ? 30 : rentang;
  const data = useMemo(() => sumber.slice(-panjang), [sumber, panjang]);
  const banding = useMemo(() => bandingkanPeriode(sumber, panjang, filter), [sumber, panjang, filter]);
  const kalimat = kalimatBanding(banding);
  // Untuk grafik kosong: kalau 90 hari terakhir ada penjualan, tawarkan
  // melihatnya, bukan hanya bilang "kosong".
  const ada90 = useMemo(() => tren.slice(-90).some((x) => nilaiTitik(x, filter) !== 0), [tren, filter]);
  // Garis yang digambar beserta jumlahnya di periode ini. "Jubelio lain"
  // hampir selalu nol — ia hanya muncul kalau memang ada isinya atau dipilih
  // sendiri. Yang terbesar digambar dulu supaya yang kecil tidak tertimbun.
  const seri = useMemo(() => {
    const semua = seriFilter(filter).map((k) => ({ k, total: data.reduce((s, x) => s + x[k], 0) }));
    return semua.filter((x) => x.k !== 'mpLain' || x.total !== 0 || filter === 'mpLain');
  }, [filter, data]);
  const urutGambar = useMemo(() => [...seri].sort((a, b) => b.total - a.total), [seri]);
  const labelSeri = (k: KunciSeri) => t(`trendChannel.${k}` as never);
  const labelFilter = (f: FilterSaluran) =>
    f === 'semua' || f === 'marketplace' || f === 'lapangan' ? t(`trendFilter.${f}` as never) : labelSeri(f);
  const kelompok: 'marketplace' | 'lapangan' | null =
    filter === 'marketplace' || (SALURAN_MARKETPLACE as readonly string[]).includes(filter)
      ? 'marketplace'
      : filter === 'lapangan' || (SALURAN_LAPANGAN as readonly string[]).includes(filter)
        ? 'lapangan'
        : null;

  const pilihRentang = (r: DateRange | undefined) => {
    if (!r?.from || !r?.to) return;
    const mulai = formatDateOnly(r.from);
    const akhir = formatDateOnly(r.to);
    const cek = rentangTren(mulai, akhir);
    if (!cek) {
      toast.error(t('trendRangeInvalid', { max: MAKS_HARI_RENTANG }));
      return;
    }
    mulaiMuat(async () => {
      const hasil = await ambilTrenPenjualanRentang(mulai, akhir);
      if (!hasil.ok) {
        toast.error(
          hasil.code === 'INVALID_RANGE' ? t('trendRangeInvalid', { max: MAKS_HARI_RENTANG }) : t('trendLoadFailed'),
        );
        return;
      }
      setPilihan({ mulai, akhir, panjang: cek.panjang, tren: hasil.tren });
      setRentang('pilih');
    });
  };
  const labelTanggal = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
    [locale],
  );
  const fmtTanggal = (iso: string) => labelTanggal.format(new Date(`${iso}T00:00:00Z`));
  const ringkas = (n: number) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(1)} M` : n >= 1e6 ? `${Math.round(n / 1e6)} jt` : n >= 1e3 ? `${Math.round(n / 1e3)} rb` : `${n}`;

  return (
    <section className="viz beranda-kartu">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="beranda-judul">
            {filter === 'semua' ? t('trendTitle') : t('trendTitleFor', { saluran: labelSeri(filter) })}
          </h3>
          {/* Angka terbesar di beranda — satu-satunya ukuran ini. Kepala kartu
              lain `text-xl`, angka di daftar `text-sm`: tiga ukuran, tidak lebih. */}
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
            <AngkaNaik nilai={banding.sekarang} format={formatIdr} />
          </p>
          {/* Persen SELALU disertai nilai pembandingnya — "▼ 100%" saja tidak
              mengatakan dari berapa. Alas nol tidak diberi persen sama sekali. */}
          <p
            className={cn(
              'text-xs',
              kalimat.jenis !== 'persen' || kalimat.arah === 'sama'
                ? 'text-muted-foreground'
                : kalimat.arah === 'naik'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-destructive',
            )}
          >
            {kalimat.jenis === 'persen'
              ? t('trendVsPrevious', {
                  arrow: kalimat.arah === 'naik' ? '▲' : kalimat.arah === 'turun' ? '▼' : '=',
                  pct: kalimat.persen,
                  days: panjang,
                  base: formatIdr(kalimat.sebelumnya),
                })
              : kalimat.jenis === 'dariNol'
                ? t('trendFromZero', { days: panjang })
                : t('trendNoBaseline', { days: panjang })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Lihat terpisah: semua, satu kelompok, atau satu saluran. Saluran di
              bawah kelompoknya, menjorok, dengan titik warnanya di grafik. */}
          <Select value={filter} onValueChange={(v) => gantiFilter(bacaFilterSaluran(v))}>
            <SelectTrigger
              size="sm"
              aria-label={t('trendChannelPick')}
              className={cn(
                'h-8 min-w-40 text-xs font-medium',
                filter !== 'semua' &&
                  'border-primary bg-primary/15 hover:bg-primary/25 dark:border-primary dark:bg-primary/10 dark:hover:bg-primary/20',
              )}
            >
              <SelectValue />
            </SelectTrigger>
            {/* `viz` membawa token warna grafik ke menu, yang dirender di luar kartu. */}
            <SelectContent align="end" className="viz">
              <SelectItem value="semua">{t('trendFilter.semua')}</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t('trendMarketplace')}</SelectLabel>
                <SelectItem value="marketplace">{t('trendFilter.marketplace')}</SelectItem>
                {SALURAN_MARKETPLACE.map((k) => (
                  <SelectItem key={k} value={k} className="pl-5">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: WARNA[k] }} />
                    {labelSeri(k)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t('trendField')}</SelectLabel>
                <SelectItem value="lapangan">{t('trendFilter.lapangan')}</SelectItem>
                {SALURAN_LAPANGAN.map((k) => (
                  <SelectItem key={k} value={k} className="pl-5">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: WARNA[k] }} />
                    {labelSeri(k)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div role="group" aria-label={t('trendRange')} className="flex rounded-lg border bg-background/60 p-0.5">
            {RENTANG.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={r === rentang}
                onClick={() => setRentang(r)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  r === rentang
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t('trendDays', { days: r })}
              </button>
            ))}
          </div>
          {/* Rentang bebas. Tampil menonjol saat dipakai, supaya jelas grafik
              sedang menunjukkan tanggal pilihan, bukan 7/30/90 hari. */}
          <DateRangePicker
            value={
              pilihan ? { from: parseDateOnly(pilihan.mulai), to: parseDateOnly(pilihan.akhir) } : undefined
            }
            onChange={pilihRentang}
            placeholder={t('trendPickDates')}
            disabled={memuat}
            maxDays={MAKS_HARI_RENTANG}
            // Bawaan pemilih tanggal meredupkan tulisan saat kosong — di sini itu
            // terbaca sebagai tombol mati, padahal ia ajakan untuk diklik. Warna
            // tema tipis saat belum dipakai, penuh saat sedang dipakai. Varian
            // `dark:` wajib ditulis ulang: tombol outline memaksa latar dan garis
            // abu-abu di mode gelap, dan tanpa itu limau di atas tak pernah muncul.
            triggerClassName={cn(
              'h-8 w-auto gap-2 text-xs font-medium',
              rentang === 'pilih'
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:border-primary dark:bg-primary dark:hover:bg-primary/90'
                : 'border-primary/60 bg-primary/15 hover:bg-primary/30 hover:text-foreground data-[kosong=true]:text-foreground dark:border-primary dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/20 dark:hover:text-primary dark:data-[kosong=true]:text-primary',
            )}
          />
        </div>
      </div>

      {/* Keterangan garis beserta jumlahnya di periode ini — sekaligus jalan
          pintas: klik Marketplace untuk memecahnya per marketplace, klik
          Shopee untuk melihat Shopee saja. */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {seri.map(({ k, total }) => {
          const tujuan: FilterSaluran | null = k === filter ? null : k;
          const isi = (
            <>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: WARNA[k] }} />
              <span className="text-muted-foreground">{labelSeri(k)}</span>
              <span className={cn('font-medium tabular-nums', total === 0 && 'text-muted-foreground')}>
                {formatIdr(total)}
              </span>
            </>
          );
          return (
            <li key={k}>
              {tujuan ? (
                <button
                  type="button"
                  onClick={() => gantiFilter(tujuan)}
                  title={t('trendShowOnly', { saluran: labelSeri(k) })}
                  className="flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-muted"
                >
                  {isi}
                </button>
              ) : (
                <span className="flex items-center gap-1.5">{isi}</span>
              )}
            </li>
          );
        })}
        {filter !== 'semua' ? (
          <li className="ml-auto">
            <button
              type="button"
              onClick={() => gantiFilter(kelompok && filter !== kelompok ? kelompok : 'semua')}
              className="rounded-md px-1.5 py-0.5 text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {t('trendBackTo', { saluran: labelFilter(kelompok && filter !== kelompok ? kelompok : 'semua') })}
            </button>
          </li>
        ) : null}
      </ul>

      <div
        className={cn('relative mt-2 h-44 transition-opacity', memuat && 'opacity-40')}
        aria-busy={memuat}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              {seri.map(({ k }) => (
                <linearGradient key={k} id={`tren-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={WARNA[k]} stopOpacity={seri.length > 2 ? 0.22 : 0.35} />
                  <stop offset="100%" stopColor={WARNA[k]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="tanggal"
              tickFormatter={fmtTanggal}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            {/* Disembunyikan saat kosong: tanpa data recharts mengarang skala
                0–4 yang tidak berarti apa-apa. */}
            <YAxis
              hide={banding.sekarang === 0}
              allowDecimals={false}
              tickFormatter={ringkas}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium">{fmtTanggal(String(label))}</p>
                    {seri.map(({ k }) => {
                      const p = payload.find((x) => x.dataKey === k);
                      return (
                        <p key={k} className="flex items-center gap-2 tabular-nums">
                          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: WARNA[k] }} />
                          <span className="text-muted-foreground">{labelSeri(k)}</span>
                          <span className="ml-auto pl-3 font-medium">{formatIdr(Number(p?.value ?? 0))}</span>
                        </p>
                      );
                    })}
                    {seri.length > 1 ? (
                      <p className="mt-1 flex items-center gap-2 border-t pt-1 tabular-nums">
                        <span className="text-muted-foreground">{t('trendTooltipTotal')}</span>
                        <span className="ml-auto pl-3 font-semibold">
                          {formatIdr(seri.reduce((s, { k }) => s + Number(payload.find((x) => x.dataKey === k)?.value ?? 0), 0))}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : null
              }
            />
            {/* Ditumpuk berdampingan, bukan disusun: pada tumpukan, garis seri
                teratas menelusuri TOTAL, jadi hari yang hanya berisi satu
                saluran tergambar dengan warna saluran lain. Total ada di angka
                besar di atas dan di baris "Jumlah" pada keterangan. */}
            {urutGambar.map(({ k }) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={WARNA[k]}
                strokeWidth={2}
                fill={`url(#tren-${k})`}
                isAnimationActive={!kurangiGerak}
                animationDuration={900}
                animationEasing="ease-out"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        {banding.sekarang === 0 ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                {filter === 'semua'
                  ? aktif
                    ? t('trendEmptyRange')
                    : t('trendEmpty', { days: panjang })
                  : aktif
                    ? t('trendEmptyRangeFor', { saluran: labelSeri(filter) })
                    : t('trendEmptyFor', { saluran: labelSeri(filter), days: panjang })}
              </p>
              {rentang !== 'pilih' && rentang < 90 && ada90 ? (
                <Button size="sm" onClick={() => setRentang(90)}>
                  {t('trendShow90')}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{t('trendTryRange')}</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
