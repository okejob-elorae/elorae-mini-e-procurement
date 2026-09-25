'use client';

import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { signIn } from 'next-auth/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useTranslations } from 'next-intl';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tulisanDiAtas, warnaMerekDiGelap } from '@/lib/theme/warna-merek';

/**
 * Pintu depan.
 *
 * Sebelumnya: kartu abu-abu di tengah layar dengan IKON PABRIK dan tulisan
 * "Manajemen Pengadaan & Produksi". Keduanya salah menyebut apa ini. Elorae
 * adalah merek fesyen — yang membuka layar ini tiap pagi termasuk art director
 * yang menyusun feed Instagram, dan pabrik bukan bahasanya. Aplikasinya sendiri
 * juga sudah jauh melampaui pengadaan: penjualan, piutang, konsinyasi, kreatif.
 *
 * MENGIKUTI WARNA TEMA. Ganti temanya jadi kuning, pintu depannya ikut kuning.
 * Yang TIDAK diikuti hanya panel tinta dan krem-nya: keduanya panggung tempat
 * warna itu berdiri, dan panggung yang ikut berganti warna membuat tidak ada
 * lagi yang bisa dikontraskan.
 *
 * Warnanya dinaikkan terangnya kalau perlu — lihat `warnaMerekDiGelap`. Warna
 * tema bebas, dan sebagian besar warna yang masuk akal untuk tombol tidak
 * terbaca sebagai tulisan besar di atas panel hampir hitam.
 */

/* Diambil dari fotografi mereka sendiri: hitam hangat studio, krem, dan aksen
   lime yang memang sudah dipakai di aplikasinya. */
const INK = '#12120F';
const PANEL = '#1B1B15';
const BONE = '#F2F1E8';
const SMOKE = '#8E8E82';

/**
 * Dipakai sebelum tema pengguna terbaca, dan kalau tidak ada tema tersimpan.
 *
 * Lime yang memang sudah jadi warna Elorae — bukan abu-abu netral, supaya
 * kedipan pertama pun sudah terasa merek ini dan bukan halaman yang belum jadi.
 */
const LIME_BAWAAN = '#C8F04A';

/**
 * Staggered entrance: wordmark first, then its line, then the form — the eye
 * lands on the brand before it is asked to type. Uses the shared `anim-rise`
 * (260 ms, off under reduced motion); only the delay differs per element.
 */
const tunda = (ms: number) => ({ '--anim-delay': `${ms}ms` }) as CSSProperties;

/** Yang benar-benar dikerjakan di dalam, dipakai sebagai teks berjalan. */
const LINGKUP = [
  'Katalog & Stok',
  'Pesanan Lapangan',
  'Piutang & Pelunasan',
  'Konsinyasi',
  'Creative Marketing',
  'Buku Besar',
];

export default function LoginPage() {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [merek, setMerek] = useState(LIME_BAWAAN);

  /*
   * Warna tema dipasang ke `--primary` oleh skrip tema sebelum React jalan, jadi
   * ia sudah ada saat ini dibaca.
   *
   * `useLayoutEffect`, bukan `useEffect`: ia berjalan SEBELUM peramban melukis,
   * jadi tidak ada satu bingkai pun yang menampakkan warna bawaan lalu berganti.
   * Kedipan warna di layar pertama yang dilihat orang tiap pagi terlihat seperti
   * aplikasi yang rusak.
   */
  useLayoutEffect(() => {
    const nilai = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim();
    if (nilai) setMerek(nilai);
  }, []);

  const merekDiGelap = warnaMerekDiGelap(merek);
  const tulisanTombol = tulisanDiAtas(merek, INK, BONE);

  const loginSchema = z.object({
    email: z.string().email(tValidation('email')),
    password: z.string().min(6, tValidation('passwordMinLength')),
  });
  type LoginForm = z.infer<typeof loginSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (result?.error) setError(t('invalidCredentials'));
      else window.location.href = '/login/redirect';
    } catch {
      setError(t('errorOccurred'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]"
      style={{ background: BONE, color: INK }}
    >
      {/* ── Panel merek ──────────────────────────────────────────────────────
          Di layar sempit ia menyusut jadi bilah tipis di atas, bukan hilang:
          nama mereknya justru yang paling perlu tetap terlihat. */}
      <section
        className="relative flex flex-col justify-between overflow-hidden p-8 lg:p-14"
        style={{ background: INK, color: BONE }}
      >
        {/* Kisi tipis di latar — mengingatkan pada kisi feed Instagram yang
            disusun di dalam, tanpa menjadi gambar yang menuntut perhatian. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `linear-gradient(${merekDiGelap} 1px, transparent 1px), linear-gradient(90deg, ${merekDiGelap} 1px, transparent 1px)`,
            backgroundSize: '96px 96px',
          }}
        />

        <div className="anim-rise relative" style={tunda(0)}>
          <p
            className="text-[11px] font-medium uppercase tracking-[0.3em]"
            style={{ color: SMOKE }}
          >
            {t('brandEyebrow')}
          </p>
        </div>

        <div className="relative py-10 lg:py-0">
          {/*
            Wordmark: huruf besar berjarak lebar — idiom merek fesyen, dan
            menggantikan ikon pabrik yang tidak menyebut apa pun tentang Elorae.
            Aksen é-nya dibiarkan lime supaya ia jadi tanda mereknya.

            Ukurannya `clamp` supaya ia besar tanpa pernah membungkus baris:
            pada 1440 ia jatuh di 112px dan huruf-hurufnya mengisi 68% lebar
            panel — cukup untuk berkuasa, masih jauh dari tepi.
          */}
          {/* SATU warna utuh. Sempat É-nya dibedakan sebagai aksen — dan itu
              memecah wordmark jadi dua benda: sebuah kata, lalu sebuah huruf
              yang tampak salah warna. */}
          <h1
            className="anim-rise select-none text-[clamp(2.75rem,8vw,7rem)] font-extrabold leading-[0.92] tracking-[0.12em]"
            style={{ color: merekDiGelap, ...tunda(80) }}
          >
            ELORAÉ
          </h1>
          <p
            className="anim-rise mt-5 max-w-sm text-base leading-relaxed lg:text-lg"
            style={{ color: SMOKE, ...tunda(160) }}
          >
            {t('brandLine')}
          </p>
        </div>

        {/* Teks berjalan berisi modul yang benar-benar ada di dalam — bukan
            kalimat pemasaran. Ia sekaligus memberi tahu ini aplikasi apa. */}
        {/* Tepinya dilembutkan dengan mask, bukan dipotong keras: potongan tajam
            terbaca sebagai teks yang terpangkas, bukan teks yang terus berjalan. */}
        <div
          className="relative overflow-hidden"
          aria-hidden
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
          }}
        >
          {/* `pr-3` equals the gap: the list is doubled and slides by exactly
              50 %, and without it that half-width is one gap short of a full
              cycle — the chips visibly jumped 6 px back every 26 seconds. */}
          <div className="marquee flex w-max gap-3 whitespace-nowrap pr-3">
            {[...LINGKUP, ...LINGKUP].map((x, i) => (
              <span
                key={i}
                className="rounded-full border px-3.5 py-1.5 text-xs font-medium"
                style={{ borderColor: '#37372E', color: SMOKE }}
              >
                {x}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Formulir ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col justify-center px-6 py-14 lg:px-14">
        <div className="anim-rise mx-auto w-full max-w-sm" style={tunda(240)}>
          <h2 className="text-3xl font-bold tracking-tight">{t('welcomeTitle')}</h2>
          <p className="mt-2 text-sm" style={{ color: '#6F6F63' }}>
            {t('welcomeBody')}
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-9 space-y-7">
            {error && (
              <p
                role="alert"
                className="rounded-lg px-3.5 py-2.5 text-sm"
                style={{ background: '#FBE3E1', color: '#8C1D18' }}
              >
                {error}
              </p>
            )}

            {/* Input bergaris bawah, bukan berkotak. Lebih dekat ke lembar
                editorial daripada ke panel admin — dan pada dua kolom saja,
                kotak justru menambah bising tanpa menambah kejelasan. */}
            <Kolom label={t('email')} galat={errors.email?.message}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
                disabled={isLoading}
                {...register('email')}
                className="w-full bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#8A8A7C] disabled:opacity-60"
              />
            </Kolom>

            <Kolom label={t('password')} galat={errors.password?.message}>
              <div className="flex items-center gap-2">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('passwordPlaceholder')}
                  disabled={isLoading}
                  {...register('password')}
                  className="w-full bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#8A8A7C] disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  disabled={isLoading}
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  className="mb-2 shrink-0 rounded-md p-1 transition-colors hover:bg-black/5"
                  style={{ color: SMOKE }}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Kolom>

            <button
              type="submit"
              disabled={isLoading}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-transform active:scale-[0.985] disabled:opacity-70"
              style={{ background: merek, color: tulisanTombol }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('signingIn')}
                </>
              ) : (
                <>
                  {t('signIn')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Jangkar bawah. Tanpa ini formulirnya mengambang sendirian di
              tengah krem, dan kolom kanannya terbaca sebagai ruang kosong yang
              kebetulan berisi sesuatu. */}
          <div
            className="mt-14 flex items-center justify-between border-t pt-5 text-[11px]"
            style={{ borderColor: '#DEDDCF', color: '#8A8A7C' }}
          >
            <span className="font-medium uppercase tracking-[0.16em]">Elorae</span>
            <span className="tabular-nums">v1.0.0</span>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Satu kolom isian bergaris bawah.
 *
 * Garisnya menebal saat difokus lewat `focus-within`, jadi keyboard dan tetikus
 * mendapat penanda yang sama — kolom tanpa kotak mudah kehilangan penanda fokus,
 * dan itu membuatnya tidak bisa dipakai tanpa melihat.
 */
function Kolom({
  label,
  galat,
  children,
}: {
  label: string;
  galat?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: '#6F6F63' }}
      >
        {label}
      </label>
      <div
        className={cn(
          'border-b transition-colors focus-within:border-b-2',
          galat ? 'border-[#B3261E]' : 'border-[#D6D5C7] focus-within:border-[#12120F]',
        )}
      >
        {children}
      </div>
      {galat && <p className="mt-1.5 text-xs text-[#B3261E]">{galat}</p>}
    </div>
  );
}
