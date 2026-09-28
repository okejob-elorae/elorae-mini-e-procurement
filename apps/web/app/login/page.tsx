'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { getSession, signIn } from 'next-auth/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tulisanDiAtas, warnaMerekDiGelap } from '@/lib/theme/warna-merek';
import { greetingKey, loginMessageKey, type LoginMessageKey } from '@/lib/auth/login-message';
import { namaDepan, simpanMasuk } from '@/lib/login/masuk';
import { LayarMasuk } from '@/components/login/LayarMasuk';
import gaya from './login.module.css';

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
 *
 * Pola yang diambil dari halaman masuk yang dikenal baik (Linear, Vercel,
 * Stripe, Supabase, Apple — dilihat September 2026): satu tombol utama, label
 * yang benar-benar tersambung ke kolomnya, "Lupa kata sandi?" di sebelah label
 * sandi, pesan gagal yang menyebut penyebab sebenarnya, formulir yang bergetar
 * saat ditolak, dan satu momen merek di belakang — di sini kain yang bergerak.
 */

/* Diambil dari fotografi mereka sendiri: hitam hangat studio, krem, dan aksen
   lime yang memang sudah dipakai di aplikasinya. */
const INK = '#12120F';
const BONE = '#F2F1E8';
const SMOKE = '#8E8E82';
/* Teks sekunder di atas krem. #8A8A7C yang dulu dipakai hanya ~3,3:1, dan
   #6F6F63 berhenti di 4,49:1 — keduanya di bawah batas WCAG AA 4,5:1 untuk teks
   kecil. Yang ini ~5:1. */
const SEKUNDER = '#66665A';

/**
 * Dipakai sebelum tema pengguna terbaca, dan kalau tidak ada tema tersimpan.
 *
 * Lime yang memang sudah jadi warna Elorae — bukan abu-abu netral, supaya
 * kedipan pertama pun sudah terasa merek ini dan bukan halaman yang belum jadi.
 */
const LIME_BAWAAN = '#C8F04A';

/** Email terakhir, disimpan hanya di peramban ini dan hanya kalau diminta. */
const KUNCI_EMAIL = 'elorae.login.email';

const VERSI = process.env.NEXT_PUBLIC_APP_VERSION;

/* Dimuat setelah formulir tampil: kain adalah hiasan, formulir yang utama. */
const KainBergerak = dynamic(() => import('@/components/login/KainBergerak'), { ssr: false });

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

type Tahap = 'siap' | 'memeriksa' | 'berhasil';

/**
 * Urutan kartu judul di halaman ini (lihat `layar-masuk.module.css`): memudar
 * ke hitam 0–700 ms, judul ditarik fokusnya 850–2250 ms. Pindah halaman
 * sesudah judulnya tajam, supaya bingkai yang ditahan peramban selama halaman
 * berikutnya dimuat adalah bingkai yang sudah tenang — persis sama dengan
 * bingkai pertama halaman tujuan.
 */
const PINDAH_MS = 2300;

export default function LoginPage() {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const [galat, setGalat] = useState<LoginMessageKey | null>(null);
  const [tahap, setTahap] = useState<Tahap>('siap');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [lupaTerbuka, setLupaTerbuka] = useState(false);
  const [ingat, setIngat] = useState(false);
  const [emailTersimpan, setEmailTersimpan] = useState<string | null>(null);
  const [tirai, setTirai] = useState(false);
  const [merek, setMerek] = useState(LIME_BAWAAN);
  /* Naik tiap kali masuk ditolak; efek di bawah memutar getarannya ulang. */
  const [getaran, setGetaran] = useState(0);
  const [bergetar, setBergetar] = useState(false);
  /* Nama pengguna, diminta sejak masuk diterima — dipakai sapaan di halaman berikut. */
  const sesiRef = useRef<Promise<string | null> | null>(null);
  /* Pindah halaman hanya sekali, entah karena waktunya tiba atau karena dilewati. */
  const pergiRef = useRef(false);

  const loginSchema = z.object({
    email: z.string().email(tValidation('email')),
    password: z.string().min(6, tValidation('passwordMinLength')),
  });
  type LoginForm = z.infer<typeof loginSchema>;

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  /*
   * Warna tema dipasang ke `--primary` oleh skrip tema sebelum React jalan, jadi
   * ia sudah ada saat ini dibaca.
   *
   * `useLayoutEffect`, bukan `useEffect`: ia berjalan SEBELUM peramban melukis,
   * jadi tidak ada satu bingkai pun yang menampakkan warna bawaan lalu berganti.
   * Kedipan warna di layar pertama yang dilihat orang tiap pagi terlihat seperti
   * aplikasi yang rusak.
   *
   * Email yang diingat diisi di sini juga, lalu fokus langsung ke kata sandi:
   * orang yang kembali cukup mengetik sandinya.
   */
  useLayoutEffect(() => {
    const nilai = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim();
    if (nilai) setMerek(nilai);

    let tersimpan: string | null = null;
    try {
      tersimpan = window.localStorage.getItem(KUNCI_EMAIL);
    } catch {
      /* penyimpanan diblokir — cukup mulai kosong */
    }
    if (tersimpan) {
      setEmailTersimpan(tersimpan);
      setIngat(true);
      setValue('email', tersimpan);
      setFocus('password');
    } else {
      setFocus('email');
    }
  }, [setFocus, setValue]);

  const merekDiGelap = warnaMerekDiGelap(merek);
  const tulisanTombol = tulisanDiAtas(merek, INK, BONE);


  function simpanEmail(email: string) {
    try {
      if (ingat) window.localStorage.setItem(KUNCI_EMAIL, email);
      else window.localStorage.removeItem(KUNCI_EMAIL);
    } catch {
      /* diabaikan — hanya kenyamanan */
    }
  }

  function gantiAkun() {
    try {
      window.localStorage.removeItem(KUNCI_EMAIL);
    } catch {
      /* diabaikan */
    }
    setEmailTersimpan(null);
    setIngat(false);
    setValue('email', '');
    setFocus('email');
  }

  /**
   * Serahkan ke halaman berikutnya. Namanya ditunggu sebentar saja: sesi yang
   * lambat terbaca berarti sapaan tanpa nama, bukan pintu yang tertahan.
   */
  async function pergi() {
    if (pergiRef.current) return;
    pergiRef.current = true;
    const nama = await Promise.race([
      sesiRef.current ?? Promise.resolve(null),
      new Promise<null>((r) => window.setTimeout(() => r(null), 250)),
    ]);
    simpanMasuk({ nama, warna: merekDiGelap });
    window.location.href = '/login/redirect';
  }

  function masuk() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.location.href = '/login/redirect';
      return;
    }
    setTirai(true);
  }

  // Getaran dipasang di bingkai berikutnya, jadi ia berjalan setelah pesan
  // galatnya tampil. `onAnimationEnd` melepasnya lagi, sehingga penolakan
  // berikutnya bisa bergetar dari awal.
  //
  // Fokusnya dipindah di sini juga, bukan di `onSubmit`: saat itu kolomnya masih
  // nonaktif (sedang memeriksa), dan kolom nonaktif menolak fokus.
  useEffect(() => {
    if (getaran === 0 || !galat) return;
    setFocus(galat === 'invalidCredentials' ? 'password' : 'email');
    const id = requestAnimationFrame(() => setBergetar(true));
    return () => cancelAnimationFrame(id);
  }, [getaran, galat, setFocus]);

  // Berhasil masuk: biarkan centangnya terlihat sebentar, lalu kartu judul.
  const berangkat = useEffectEvent(masuk);
  useEffect(() => {
    if (tahap !== 'berhasil') return;
    sesiRef.current = getSession()
      .then((s) => namaDepan(s?.user?.name))
      .catch(() => null);
    const id = window.setTimeout(berangkat, 280);
    return () => window.clearTimeout(id);
  }, [tahap]);

  // Kartu judul berjalan sampai tajam lalu pindah halaman — atau lebih cepat,
  // kalau pengguna mengeklik atau menekan tombol apa pun.
  const lanjutkan = useEffectEvent(() => void pergi());
  useEffect(() => {
    if (!tirai) return;
    const id = window.setTimeout(lanjutkan, PINDAH_MS);
    window.addEventListener('keydown', lanjutkan);
    window.addEventListener('pointerdown', lanjutkan);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', lanjutkan);
      window.removeEventListener('pointerdown', lanjutkan);
    };
  }, [tirai]);

  // Tombol Kembali dari halaman berikutnya bisa memulihkan halaman ini utuh
  // dari bfcache — lengkap dengan tirai yang menutup layar. Kembalikan pintunya.
  useEffect(() => {
    const pulih = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      pergiRef.current = false;
      setTirai(false);
      setTahap('siap');
    };
    window.addEventListener('pageshow', pulih);
    return () => window.removeEventListener('pageshow', pulih);
  }, []);

  const onSubmit = async (data: LoginForm) => {
    setTahap('memeriksa');
    setGalat(null);
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      const kunci = loginMessageKey(result);
      if (kunci) {
        setGalat(kunci);
        setTahap('siap');
        setGetaran((n) => n + 1);
        return;
      }
      simpanEmail(data.email);
      setTahap('berhasil');
    } catch {
      // `signIn` hanya melempar kalau permintaannya sendiri gagal — jaringan
      // putus atau server mati — bukan karena kata sandinya salah.
      setGalat('serverUnavailable');
      setTahap('siap');
      setGetaran((n) => n + 1);
    }
  };

  const sibuk = tahap !== 'siap';
  const kolomSandi = register('password');
  const sapaan = t(`greeting.${greetingKey()}`);

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
        <KainBergerak ink={INK} tint={merekDiGelap} />

        {/* Kisi tipis di latar — mengingatkan pada kisi feed Instagram yang
            disusun di dalam, tanpa menjadi gambar yang menuntut perhatian. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
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
                style={{ borderColor: '#37372E', color: SMOKE, background: INK }}
              >
                {x}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Formulir ─────────────────────────────────────────────────────── */}
      {/* `colorScheme: light`: panel ini selalu krem, tapi aplikasi bertema gelap
          membuat kotak centang bawaan peramban ikut gelap di atas krem. */}
      <section className="flex flex-col justify-center px-6 py-14 lg:px-14" style={{ colorScheme: 'light' }}>
        <div className="anim-rise mx-auto w-full max-w-sm" style={tunda(240)}>
          {/* Getaran dipasang di pembungkus DALAM: animasi masuk `anim-rise` di
              luar dan getaran di dalam tidak saling menimpa properti `animation`. */}
          <div className={cn(bergetar && gaya.goyang)} onAnimationEnd={() => setBergetar(false)}>
          {/* Sapaan menurut jam WIB. Dihitung saat render di server maupun di
              peramban — jamnya sama, jadi hasilnya sama; di menit pergantian
              yang jarang terjadi, peringatan hidrasi diredam. */}
          <h2 className="text-3xl font-bold tracking-tight" suppressHydrationWarning>
            {sapaan}
          </h2>
          {emailTersimpan ? (
            <p className="mt-2 text-sm" style={{ color: SEKUNDER }}>
              {t('signingInAs', { email: emailTersimpan })}{' '}
              <button
                type="button"
                onClick={gantiAkun}
                className="font-medium underline underline-offset-2 hover:no-underline"
                style={{ color: INK }}
              >
                {t('switchAccount')}
              </button>
            </p>
          ) : (
            <p className="mt-2 text-sm" style={{ color: SEKUNDER }}>
              {t('welcomeBody')}
            </p>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-9 space-y-7" noValidate>
            {galat && (
              <p
                id="login-galat"
                role="alert"
                className="flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm"
                style={{ background: '#FBE3E1', color: '#8C1D18' }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {t(galat)}
              </p>
            )}

            {/* Input bergaris bawah, bukan berkotak. Lebih dekat ke lembar
                editorial daripada ke panel admin — dan pada dua kolom saja,
                kotak justru menambah bising tanpa menambah kejelasan. */}
            <Kolom id="email" label={t('email')} galat={errors.email?.message}>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder={t('emailPlaceholder')}
                disabled={sibuk}
                aria-invalid={Boolean(errors.email) || galat === 'invalidCredentials'}
                aria-describedby={galat ? 'login-galat' : errors.email ? 'email-galat' : undefined}
                {...register('email')}
                className="w-full bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#66665A] disabled:opacity-60"
              />
            </Kolom>

            <Kolom
              id="password"
              label={t('password')}
              galat={errors.password?.message}
              aksi={
                <button
                  type="button"
                  onClick={() => setLupaTerbuka((b) => !b)}
                  aria-expanded={lupaTerbuka}
                  aria-controls="lupa-sandi"
                  className="text-[11px] font-medium underline-offset-2 hover:underline"
                  style={{ color: SEKUNDER }}
                >
                  {t('forgotPassword')}
                </button>
              }
              bantuan={
                <>
                  {capsLock && (
                    <p className="mt-1.5 text-xs font-medium" style={{ color: '#8A5A00' }} aria-live="polite">
                      {t('capsLockOn')}
                    </p>
                  )}
                  {lupaTerbuka && (
                    <p id="lupa-sandi" className="mt-1.5 text-xs leading-relaxed" style={{ color: SEKUNDER }}>
                      {t('forgotPasswordHint')}
                    </p>
                  )}
                </>
              }
            >
              <div className="flex items-center gap-2">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('passwordPlaceholder')}
                  disabled={sibuk}
                  aria-invalid={Boolean(errors.password) || galat === 'invalidCredentials'}
                  aria-describedby={galat ? 'login-galat' : errors.password ? 'password-galat' : undefined}
                  {...kolomSandi}
                  onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  onBlur={(e) => {
                    setCapsLock(false);
                    void kolomSandi.onBlur(e);
                  }}
                  className="w-full bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#66665A] disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  disabled={sibuk}
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  aria-pressed={showPassword}
                  className="mb-2 shrink-0 rounded-md p-1 transition-colors hover:bg-black/5"
                  style={{ color: SEKUNDER }}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Kolom>

            <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm" style={{ color: SEKUNDER }}>
              <input
                type="checkbox"
                checked={ingat}
                onChange={(e) => setIngat(e.target.checked)}
                disabled={sibuk}
                className="h-4 w-4 rounded accent-[#12120F]"
              />
              {t('rememberEmail')}
            </label>

            {/* Tombol yang berubah bentuk: panah → pemutar → centang. Satu tempat
                untuk semua keadaan, jadi mata tidak perlu mencari kabarnya. */}
            <button
              type="submit"
              disabled={sibuk}
              aria-live="polite"
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-[transform,opacity] duration-150 active:scale-[0.985] disabled:cursor-default"
              style={{ background: merek, color: tulisanTombol }}
            >
              {tahap === 'memeriksa' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('signingIn')}
                </>
              ) : tahap === 'berhasil' ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  {t('signedIn')}
                </>
              ) : (
                <>
                  {t('signIn')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </>
              )}
            </button>
          </form>

          {/* Jangkar bawah. Tanpa ini formulirnya mengambang sendirian di
              tengah krem, dan kolom kanannya terbaca sebagai ruang kosong yang
              kebetulan berisi sesuatu. */}
          <div
            className="mt-14 flex items-center justify-between border-t pt-5 text-[11px]"
            style={{ borderColor: '#DEDDCF', color: SEKUNDER }}
          >
            <span className="font-medium uppercase tracking-[0.16em]">Elorae</span>
            {VERSI ? <span className="tabular-nums">{t('version', { version: VERSI })}</span> : null}
          </div>
          </div>
        </div>
      </section>

      {tirai ? <LayarMasuk tahap="datang" warna={merekDiGelap} /> : null}
    </div>
  );
}

/**
 * Satu kolom isian bergaris bawah.
 *
 * Labelnya TERSAMBUNG ke kolomnya lewat `htmlFor`. Dulu tidak: pembaca layar
 * mengumumkan kolom tanpa nama, dan mengeklik tulisan "Email" tidak memindahkan
 * kursor ke kolomnya.
 *
 * Garisnya menebal saat difokus lewat `focus-within`, jadi keyboard dan tetikus
 * mendapat penanda yang sama — kolom tanpa kotak mudah kehilangan penanda fokus,
 * dan itu membuatnya tidak bisa dipakai tanpa melihat.
 */
function Kolom({
  id,
  label,
  galat,
  aksi,
  bantuan,
  children,
}: {
  id: string;
  label: string;
  galat?: string;
  aksi?: React.ReactNode;
  bantuan?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={gaya.kolom}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="block text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: SEKUNDER }}
        >
          {label}
        </label>
        {aksi}
      </div>
      <div
        className={cn(
          'border-b transition-colors focus-within:border-b-2',
          galat ? 'border-[#B3261E]' : 'border-[#D6D5C7] focus-within:border-[#12120F]',
        )}
      >
        {children}
      </div>
      {galat && (
        <p id={`${id}-galat`} className="mt-1.5 text-xs text-[#B3261E]">
          {galat}
        </p>
      )}
      {bantuan}
    </div>
  );
}
