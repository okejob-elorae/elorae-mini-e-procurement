'use client';

import { useMemo, useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Palette, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { hapusPaletAction, simpanPaletAction } from '@/app/actions/creative';
import {
  ATURAN_HARMONI,
  INDEKS_DASAR,
  gantiHexWarna,
  geserPegangan,
  keadaanDariHex,
  susunHarmoni,
  ubahKecerahan,
  type AturanHarmoni,
  type KeadaanPalet,
} from '@/lib/creative/palet/harmoni';
import { rasioKontras } from '@/lib/creative/palet/kontras';
import type { BarisPalet } from '@/lib/creative/palet/queries';
import { BATAS_NAMA_PALET } from '@/lib/creative/palet/validasi';
import { hexKeHsb, hexKeRgb, hsbKeHex, normalisasiHex } from '@/lib/creative/palet/warna';
import { salinTeks } from '@/lib/ui/salin-teks';
import { cn } from '@/lib/utils';
import { KisiKontras } from './KisiKontras';
import { RodaWarna } from './RodaWarna';

/** Titik mulai kalau warna tema terlalu pudar atau gelap untuk menjadi dasar. */
const WARNA_AWAL = '#e8553d';

/*
 * Roda mulai dari warna tema pengguna, kalau ia memilih satu. ThemeColorProvider
 * memasang warna tema di elemen akar sebagai hex; warna bawaan aplikasi tidak,
 * dan itu yang membedakan "belum memilih" dari "memilih".
 *
 * Dibaca sebagai sumber luar (`useSyncExternalStore`), bukan di efek: server
 * tidak punya dokumen, dan mengisi state dari efek merender halaman dua kali.
 */
function bacaWarnaTema(): string | null {
  return normalisasiHex(document.documentElement.style.getPropertyValue('--primary'));
}

function pantauWarnaTema(beritahu: () => void): () => void {
  const pengamat = new MutationObserver(beritahu);
  pengamat.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  return () => pengamat.disconnect();
}

function keadaanAwal(warnaTema: string | null): KeadaanPalet {
  const tema = warnaTema ? hexKeHsb(warnaTema) : null;
  // Tema yang terlalu pudar atau gelap menghasilkan lima warna kusam yang
  // nyaris sama — titik mulai yang buruk untuk memperkenalkan roda.
  const dasar = tema && tema.s >= 0.25 && tema.b >= 0.35 ? tema : hexKeHsb(WARNA_AWAL);
  return { aturan: 'ANALOGOUS', warna: susunHarmoni('ANALOGOUS', dasar, []) };
}

function tintaDi(hex: string): '#ffffff' | '#000000' {
  return rasioKontras(hex, '#ffffff') >= rasioKontras(hex, '#000000') ? '#ffffff' : '#000000';
}

export function PaletClient({ palet, bolehMengelola }: { palet: BarisPalet[]; bolehMengelola: boolean }) {
  const t = useTranslations('creative.palette');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const warnaTema = useSyncExternalStore(pantauWarnaTema, bacaWarnaTema, () => null);
  const awal = useMemo(() => keadaanAwal(warnaTema), [warnaTema]);
  // `null` = belum disentuh: roda masih mengikuti warna tema. Sentuhan pertama
  // menyalin keadaan itu menjadi milik orangnya, dan sejak itu tema tidak lagi
  // boleh menimpanya.
  const [keadaanSendiri, setKeadaanSendiri] = useState<KeadaanPalet | null>(null);
  const keadaan = keadaanSendiri ?? awal;
  const [terpilih, setTerpilih] = useState(INDEKS_DASAR);
  const [ketikHex, setKetikHex] = useState<string | null>(null);
  const [nama, setNama] = useState('');
  const [akanDihapus, setAkanDihapus] = useState<BarisPalet | null>(null);

  function ubah(berikut: (k: KeadaanPalet) => KeadaanPalet) {
    setKeadaanSendiri((k) => berikut(k ?? awal));
  }

  const hex = keadaan.warna.map(hsbKeHex);
  const warnaTerpilih = keadaan.warna[terpilih];
  const hexTerpilih = hex[terpilih];
  const rgbTerpilih = hexKeRgb(hexTerpilih);
  const hexTidakSah =
    ketikHex !== null && normalisasiHex(ketikHex) === null && ketikHex.replace(/^#/, '').length >= 6;

  async function salin(teks: string, pesan: string) {
    if (await salinTeks(teks)) toast.success(pesan);
    else toast.error(t('copyFailed'));
  }

  function pilihAturan(aturan: AturanHarmoni) {
    ubah((k) => ({ aturan, warna: susunHarmoni(aturan, k.warna[INDEKS_DASAR], k.warna) }));
  }

  function ketik(nilai: string) {
    setKetikHex(nilai);
    // Diterapkan langsung hanya saat enam digit lengkap: tiga digit bisa jadi
    // awal dari enam yang sedang diketik, dan melompatkan warnanya di tengah
    // ketikan terasa seperti roda yang bergerak sendiri.
    if (/^#?[0-9a-fA-F]{6}$/.test(nilai.trim())) {
      ubah((k) => gantiHexWarna(k, terpilih, nilai));
    }
  }

  function selesaiKetik() {
    if (ketikHex !== null && normalisasiHex(ketikHex)) {
      ubah((k) => gantiHexWarna(k, terpilih, ketikHex));
    }
    setKetikHex(null);
  }

  function simpan(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const h = await simpanPaletAction({ nama, aturan: keadaan.aturan, warna: hex });
      if (h.ok) {
        toast.success(t('saved', { name: nama.trim() }));
        setNama('');
        router.refresh();
      } else {
        toast.error(t(`errors.${h.kode}`));
      }
    });
  }

  function muat(p: BarisPalet) {
    setKeadaanSendiri(keadaanDariHex(p.aturan, p.warna));
    setTerpilih(INDEKS_DASAR);
    setKetikHex(null);
    toast.success(t('loaded', { name: p.nama }));
    const hemat = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('roda-warna')?.scrollIntoView({ behavior: hemat ? 'auto' : 'smooth', block: 'start' });
  }

  const tanggal = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        meta={t('meta', { count: palet.length })}
        actions={
          <Button
            variant="outline"
            onClick={() => salin(hex.map((h) => h.toUpperCase()).join(', '), t('copiedAll'))}
          >
            <Copy className="mr-1.5 h-4 w-4" />
            {t('copyAll')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <Card id="roda-warna" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>{t('wheelTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t('ruleLabel')}</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ruleLabel')}>
                {ATURAN_HARMONI.map((aturan) => (
                  <Button
                    key={aturan}
                    type="button"
                    size="xs"
                    variant={keadaan.aturan === aturan ? 'default' : 'outline'}
                    aria-pressed={keadaan.aturan === aturan}
                    className="rounded-full px-2.5"
                    onClick={() => pilihAturan(aturan)}
                  >
                    {t(`rules.${aturan}.name`)}
                  </Button>
                ))}
              </div>
              <p className="min-h-[2.5rem] text-sm text-muted-foreground">{t(`rules.${keadaan.aturan}.hint`)}</p>
            </div>

            <RodaWarna
              warna={keadaan.warna}
              terpilih={terpilih}
              onPilih={(i) => {
                setTerpilih(i);
                setKetikHex(null);
              }}
              onGeser={(i, h, s) => ubah((k) => geserPegangan(k, i, h, s))}
              labelPegangan={(i, kode) =>
                i === INDEKS_DASAR ? t('handleLabelBase', { hex: kode }) : t('handleLabel', { n: i + 1, hex: kode })
              }
            />

            <p className="text-center text-xs text-muted-foreground">
              {keadaan.aturan === 'CUSTOM' ? t('customHint') : t('dragHint')}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="kecerahan-warna">{t('brightness')}</Label>
                <span className="tabular-nums text-muted-foreground">{Math.round(warnaTerpilih.b * 100)}%</span>
              </div>
              <input
                id="kecerahan-warna"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(warnaTerpilih.b * 100)}
                onChange={(e) => ubah((k) => ubahKecerahan(k, terpilih, Number(e.target.value) / 100))}
                className={cn(
                  'h-3 w-full cursor-pointer appearance-none rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10',
                  'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
                  // `appearance-none` menghapus kenop bawaan WebKit; tanpa gaya ini
                  // penggesernya tidak punya pegangan yang terlihat.
                  '[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
                  '[&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--kenop)]',
                  '[&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_2px_6px_rgba(0,0,0,0.35)]',
                  '[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px]',
                  '[&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--kenop)]',
                  '[&::-moz-range-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_2px_6px_rgba(0,0,0,0.35)]',
                )}
                style={
                  {
                    background: `linear-gradient(to right, #000000, ${hsbKeHex({ ...warnaTerpilih, b: 1 })})`,
                    '--kenop': hexTerpilih,
                  } as CSSProperties
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('swatchesTitle')}</CardTitle>
            <CardDescription>{t('swatchesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {hex.map((kode, i) => {
                const aktif = i === terpilih;
                const tinta = tintaDi(kode);
                return (
                  <div key={i} className="flex min-w-0 flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTerpilih(i);
                        setKetikHex(null);
                      }}
                      aria-pressed={aktif}
                      aria-label={`${i === INDEKS_DASAR ? t('base') : t('swatchLabel', { n: i + 1 })}, ${kode.toUpperCase()}`}
                      className={cn(
                        'flex h-24 w-full items-end justify-center rounded-lg pb-2 outline-none sm:h-36',
                        'motion-safe:transition-[transform,box-shadow] motion-safe:duration-200',
                        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        aktif
                          ? 'shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-card motion-safe:-translate-y-1'
                          : 'ring-1 ring-inset ring-black/10 hover:shadow-md dark:ring-white/10 motion-safe:hover:-translate-y-0.5',
                      )}
                      style={{ background: kode }}
                    >
                      {i === INDEKS_DASAR && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{
                            color: tinta,
                            background: tinta === '#ffffff' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.5)',
                          }}
                        >
                          {t('base')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => salin(kode.toUpperCase(), t('copied', { hex: kode.toUpperCase() }))}
                      title={t('copyHex', { hex: kode.toUpperCase() })}
                      className="max-w-full truncate rounded px-1 font-mono text-[10px] uppercase text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-xs"
                    >
                      {kode}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-start">
              <div
                aria-hidden
                className="h-16 w-full shrink-0 rounded-md ring-1 ring-inset ring-black/10 sm:w-16 dark:ring-white/10"
                style={{ background: hexTerpilih }}
              />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="hex-terpilih">
                      {terpilih === INDEKS_DASAR ? t('base') : t('swatchLabel', { n: terpilih + 1 })} · HEX
                    </Label>
                    <Input
                      id="hex-terpilih"
                      value={ketikHex ?? hexTerpilih.toUpperCase()}
                      onChange={(e) => ketik(e.target.value)}
                      onBlur={selesaiKetik}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      aria-invalid={hexTidakSah || undefined}
                      aria-describedby={hexTidakSah ? 'hex-salah' : undefined}
                      maxLength={7}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-32 font-mono uppercase"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mb-0.5"
                    onClick={() => salin(hexTerpilih.toUpperCase(), t('copied', { hex: hexTerpilih.toUpperCase() }))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('copyHex', { hex: hexTerpilih.toUpperCase() })}
                  </Button>
                </div>
                {hexTidakSah && (
                  <p id="hex-salah" className="text-xs text-destructive">
                    {t('hexInvalid')}
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">RGB</dt>
                    <dd className="font-mono tabular-nums">
                      {rgbTerpilih.r}, {rgbTerpilih.g}, {rgbTerpilih.b}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('hue')}</dt>
                    <dd className="tabular-nums">{Math.round(warnaTerpilih.h)}°</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('saturation')}</dt>
                    <dd className="tabular-nums">{Math.round(warnaTerpilih.s * 100)}%</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('brightness')}</dt>
                    <dd className="tabular-nums">{Math.round(warnaTerpilih.b * 100)}%</dd>
                  </div>
                </dl>
              </div>
            </div>

            {bolehMengelola && (
              <form onSubmit={simpan} className="flex flex-col gap-2 border-t pt-5 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="nama-palet">{t('saveLabel')}</Label>
                  <Input
                    id="nama-palet"
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    maxLength={BATAS_NAMA_PALET}
                  />
                </div>
                <Button type="submit" disabled={pending || !nama.trim()}>
                  {pending ? t('saving') : t('save')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('contrastTitle')}</CardTitle>
          <CardDescription>{t('contrastDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <KisiKontras warna={hex} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('savedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={palet.length === 0 ? 'p-0' : undefined}>
          {palet.length === 0 ? (
            <EmptyState
              icon={Palette}
              title={t('emptyTitle')}
              description={bolehMengelola ? t('emptyBody') : t('emptyBodyViewOnly')}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {palet.map((p) => (
                <li key={p.id} className="min-w-0 space-y-3 rounded-lg border p-3">
                  <div className="flex h-14 overflow-hidden rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10">
                    {p.warna.map((w, i) => (
                      <div key={i} className="flex-1" style={{ background: w }} title={w.toUpperCase()} />
                    ))}
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.nama}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[t(`rules.${p.aturan}.name`), p.dibuatOleh, tanggal.format(new Date(p.dibuatPada))]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => muat(p)}>
                        {t('use')}
                      </Button>
                      {bolehMengelola && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`${t('delete')} ${p.nama}`}
                          onClick={() => setAkanDihapus(p)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={akanDihapus !== null} onOpenChange={(o) => !o && setAkanDihapus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: akanDihapus?.nama ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                const target = akanDihapus;
                if (!target) return;
                // Dialog tetap terbuka sampai server menjawab; kegagalan
                // dilaporkan di tempat orang masih melihat.
                e.preventDefault();
                startTransition(async () => {
                  const h = await hapusPaletAction(target.id);
                  if (h.ok) {
                    toast.success(t('deleted'));
                    setAkanDihapus(null);
                    router.refresh();
                  } else {
                    toast.error(t(`errors.${h.kode}`));
                    if (h.kode === 'TIDAK_DITEMUKAN') {
                      setAkanDihapus(null);
                      router.refresh();
                    }
                  }
                });
              }}
            >
              {pending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
