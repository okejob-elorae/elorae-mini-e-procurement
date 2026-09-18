'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, ChevronDown, Lock, LockOpen, Search, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { STATUS_TONE_CLASS, type StatusTone } from '@/components/ui/status-pill';
import { rasioKontras } from '@/lib/production-colors/palet/kontras';
import { cariPantone, hexKeLab, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { bagiGram, type ResepCampur } from '@/lib/production-colors/sablon/campur';
import {
  ATURAN_SABLON,
  keterbacaanSablon,
  type KeterbacaanSablon,
  type PeranSablon,
} from '@/lib/production-colors/sablon/saran';
import {
  KELUARGA_WARNA,
  OPSI_GANTI,
  batasKromaTinta,
  saranBerikutnya,
  saranYangDipakai,
  type OpsiGanti,
  type SaranPengganti,
} from '@/lib/production-colors/sablon/pengganti';
import type { TintaDasar } from '@/lib/production-colors/sablon/tinta-dasar';
import { cn } from '@/lib/utils';
import { IkonHarmoni } from './IkonHarmoni';

const NADA_BACA: Record<KeterbacaanSablon, StatusTone> = {
  KUAT: 'settled',
  CUKUP: 'progress',
  LEMBUT: 'waiting',
  SAMAR: 'attention',
};

/** Di bawah 2 praktis tak terlihat; di atas 5 sudah berbeda warna, bukan sekadar berbeda sampel. */
const DE_DEKAT = 2;
const DE_JAUH = 5;
/** Di bawah ini warna palet dianggap PERSIS kode Pantone-nya. */
const DE_PERSIS = 0.05;

export function tintaDi(hex: string): '#ffffff' | '#000000' {
  return rasioKontras(hex, '#ffffff') >= rasioKontras(hex, '#000000') ? '#ffffff' : '#000000';
}

function Pil({ nada, children }: { nada: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap',
        STATUS_TONE_CLASS[nada],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Satu warna sablon: kode, porsi, keterbacaan di kain, dan resep campurnya.
 *
 * Warna palet bisa digeser bebas di roda, jadi belum tentu tepat sebuah kode
 * Pantone. Judulnya jujur soal itu: kode ditulis sebagai PANTONE hanya kalau
 * persis; selain itu hex-nya yang menjadi judul, dengan kode terdekat dan
 * jaraknya di sampingnya.
 *
 * Tinta yang belum cocok diganti dari saran yang masuk dengan kain. Orang
 * memilih dulu mau diganti menjadi apa — kalem (kontras di bawah 2), kontras
 * kuat, satu jenis warna, atau semua jenis — lalu "Warna lain" berputar di
 * dalam pilihan itu, atau warnanya dipilih dari daftar. Setelah cocok, dikunci.
 * Tinta terkunci tidak bisa diganti dari sini sampai gemboknya dibuka.
 */
export function BarisSablon({
  huruf,
  hex,
  pantone,
  peran,
  porsi,
  kainHex,
  resep,
  tintaDasar,
  berat,
  katalogC,
  saran,
  terkunci,
  onKunci,
  onPorsi,
  onGanti,
}: {
  huruf: string;
  hex: string;
  pantone: { kode: string; deltaE: number } | null;
  peran: PeranSablon;
  porsi: number;
  kainHex: string;
  resep: ResepCampur | null;
  tintaDasar: readonly TintaDasar[];
  berat: number;
  katalogC: readonly WarnaPantone[];
  /** Pengganti yang masuk dengan kain, per pilihan "diganti menjadi apa". */
  saran: Readonly<Record<OpsiGanti, readonly SaranPengganti[]>>;
  terkunci: boolean;
  onKunci: () => void;
  onPorsi: (porsi: number) => void;
  onGanti: (hex: string) => void;
}) {
  const t = useTranslations('productionPrint');
  const tPalet = useTranslations('productionPalette');
  const locale = useLocale();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const persen = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const [cari, setCari] = useState<string | null>(null);
  const [opsi, setOpsi] = useState<OpsiGanti>('SEMUA');

  const rasio = rasioKontras(hex, kainHex);
  const baca = keterbacaanSablon(rasio);
  const hasilCari = cari ? cariPantone(katalogC, cari, 5) : [];
  const gram = resep ? bagiGram(berat, resep.bagian.map((b) => b.persen)) : [];
  const persis = pantone !== null && pantone.deltaE < DE_PERSIS;
  const daftar = saran[opsi];
  // Tinta besar di kain kalem yang terlalu pekat — aturan harmoni saja tidak menangkapnya.
  const batasKroma = batasKromaTinta(kainHex, porsi);
  const [, la, lb] = hexKeLab(hex);
  const terlaluMencolok = batasKroma !== null && Math.hypot(la, lb) > batasKroma;
  // Label warna sekarang: dari pilihan yang aktif dulu, lalu dari pilihan lain.
  const dipakai = saranYangDipakai(daftar, hex) ?? OPSI_GANTI.map((o) => saranYangDipakai(saran[o], hex)).find(Boolean) ?? null;
  const namaOpsi = (o: OpsiGanti) => t(`options.${o}`);
  // "Semua jenis" dikelompokkan per jenis warna; satu pilihan dikelompokkan per aturan.
  const kelompok =
    opsi === 'SEMUA'
      ? KELUARGA_WARNA.map((k) => ({ kunci: k as string, judul: t(`options.${k}`), petunjuk: t(`optionHints.${k}`), aturan: null, daftar: daftar.filter((x) => x.jenis === k) }))
      : ATURAN_SABLON.map((a) => ({ kunci: a as string, judul: tPalet(`rules.${a}.name`), petunjuk: null, aturan: a, daftar: daftar.filter((x) => x.aturan === a) }));
  const kelompokIsi = kelompok.filter((g) => g.daftar.length > 0);

  /** Memilih "diganti menjadi apa" langsung memasang warna pertamanya — hasilnya terlihat, lalu "Warna lain" berputar di dalamnya. */
  function pilihOpsi(o: OpsiGanti) {
    setOpsi(o);
    const pertama = saran[o][0];
    if (pertama && !saranYangDipakai(saran[o], hex)) onGanti(pertama.hex);
  }

  return (
    <li className="space-y-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md text-base font-semibold ring-1 ring-inset ring-black/10 dark:ring-white/15"
          style={{ background: hex, color: tintaDi(hex) }}
        >
          {huruf}
        </span>
        {/* Lebar dasar 10rem: di kolom sempit kontrol porsi turun ke baris sendiri, alih-alih memeras judul menjadi "P…". */}
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate font-medium">
            {persis ? (
              <>
                PANTONE {pantone.kode} <span className="font-mono text-xs uppercase text-muted-foreground">{hex}</span>
              </>
            ) : (
              <>
                <span className="font-mono uppercase">{hex}</span>
                {pantone && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {' '}
                    {t('nearestPantone', { code: pantone.kode, de: desimal.format(pantone.deltaE) })}
                  </span>
                )}
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pil nada="inactive">{t(`roles.${peran}`)}</Pil>
            <Pil nada={NADA_BACA[baca]}>
              {t(`readability.${baca}`)} · {desimal.format(rasio)}
            </Pil>
            {terlaluMencolok ? (
              <span title={t('tooLoudHint')}>
                <Pil nada="attention">{t('tooLoud', { percent: porsi })}</Pil>
              </span>
            ) : (
              dipakai && <Pil nada="inactive">{t('suggestionTag', { kind: namaOpsi(dipakai.jenis), rule: tPalet(`rules.${dipakai.aturan}.name`) })}</Pil>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={Number.isFinite(porsi) ? porsi : ''}
              onChange={(e) => onPorsi(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
              aria-label={t('portionLabel', { letter: huruf })}
              className="h-9 w-16 text-right tabular-nums"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <div className="flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-r-none"
              disabled={terkunci || daftar.length === 0}
              title={t('nextColourHint', { option: namaOpsi(opsi) })}
              onClick={() => {
                const berikut = saranBerikutnya(daftar, hex);
                if (berikut) onGanti(berikut.hex);
              }}
            >
              <Shuffle className="h-3.5 w-3.5" />
              {opsi === 'SEMUA' ? t('nextColour') : t('nextColourAs', { option: namaOpsi(opsi) })}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="rounded-l-none border-l-0"
                  disabled={terkunci}
                  aria-label={t('chooseOption', { letter: huruf })}
                  title={t('chooseOption', { letter: huruf })}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs">{t('replaceAs')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={opsi} onValueChange={(v) => pilihOpsi(v as OpsiGanti)}>
                  {OPSI_GANTI.map((o) => (
                    <DropdownMenuRadioItem key={o} value={o} disabled={saran[o].length === 0} className="items-start">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{namaOpsi(o)}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{saran[o].length}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{t(`optionHints.${o}`)}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={terkunci}
            onClick={() => setCari(cari === null ? '' : null)}
            aria-expanded={cari !== null && !terkunci}
          >
            <Search className="h-3.5 w-3.5" />
            {t('replace')}
          </Button>
          <Button
            type="button"
            variant={terkunci ? 'secondary' : 'outline'}
            size="icon-sm"
            aria-pressed={terkunci}
            aria-label={terkunci ? t('unlockInk', { letter: huruf }) : t('lockInk', { letter: huruf })}
            title={terkunci ? t('lockedHint') : t('lockInk', { letter: huruf })}
            onClick={() => {
              if (!terkunci) setCari(null);
              onKunci();
            }}
          >
            {terkunci ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {cari !== null && !terkunci && (
        <div className="space-y-3">
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium">{t('replaceAs')}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={t('replaceAs')}>
                {OPSI_GANTI.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="xs"
                    variant={opsi === o ? 'secondary' : 'outline'}
                    aria-pressed={opsi === o}
                    disabled={saran[o].length === 0}
                    title={t(`optionHints.${o}`)}
                    onClick={() => pilihOpsi(o)}
                  >
                    {namaOpsi(o)}
                    <span className="tabular-nums text-muted-foreground">{saran[o].length}</span>
                  </Button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t(`optionHints.${opsi}`)} {t('ruleSuggestionsHint')}
              </p>
              {batasKroma !== null && <p className="mt-1 text-xs text-muted-foreground">{t('loudCapNote', { percent: porsi })}</p>}
            </div>
            {kelompokIsi.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('optionEmpty', { option: namaOpsi(opsi) })}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {kelompokIsi.map((g) => (
                  <li key={g.kunci} className="space-y-1.5 rounded-md border p-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium">
                        {g.aturan && <IkonHarmoni aturan={g.aturan} className="size-4 shrink-0" />}
                        {g.judul}
                      </p>
                      {g.petunjuk && <p className="text-[11px] text-muted-foreground">{g.petunjuk}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.daftar.map((x) => {
                        const aktif = dipakai?.kode === x.kode;
                        const aturan = tPalet(`rules.${x.aturan}.name`);
                        const r = rasioKontras(x.hex, kainHex);
                        const bacaan = `${t(`readability.${keterbacaanSablon(r)}`)} · ${desimal.format(r)}`;
                        return (
                          <Button
                            key={x.kode}
                            type="button"
                            variant={aktif ? 'secondary' : 'outline'}
                            size="xs"
                            aria-pressed={aktif}
                            aria-label={`${x.kode}, ${aturan}, ${bacaan}`}
                            title={`${aturan} · ${bacaan}`}
                            onClick={() => onGanti(x.hex)}
                          >
                            <span aria-hidden className="size-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: x.hex }} />
                            {x.kode}
                            <span className="tabular-nums text-muted-foreground">{desimal.format(r)}</span>
                            {opsi === 'SEMUA' && <IkonHarmoni aturan={x.aturan} className="size-3 shrink-0 opacity-70" />}
                            {aktif && <Check aria-hidden />}
                          </Button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Input
            type="search"
            autoFocus
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hasilCari[0]) {
                e.preventDefault();
                onGanti(hasilCari[0].hex);
                setCari(null);
              }
              if (e.key === 'Escape') setCari(null);
            }}
            placeholder={t('searchC')}
            aria-label={t('searchC')}
            autoComplete="off"
            spellCheck={false}
          />
          {cari.trim() !== '' &&
            (hasilCari.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('searchEmpty', { q: cari.trim() })}</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-md border bg-background">
                {hasilCari.map((w) => {
                  const r = rasioKontras(w.hex, kainHex);
                  return (
                    <li key={w.kode}>
                      <button
                        type="button"
                        onClick={() => {
                          onGanti(w.hex);
                          setCari(null);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                      >
                        <span aria-hidden className="size-5 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: w.hex }} />
                        <span className="flex-1 font-medium">{w.kode}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {t(`readability.${keterbacaanSablon(r)}`)} · {desimal.format(r)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      )}

      <div className="space-y-2.5 rounded-md bg-muted/40 p-3">
        {tintaDasar.length === 0 || !resep ? (
          <p className="text-xs text-muted-foreground">{t('recipeNoInks')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">{t('recipeTitle', { grams: berat })}</p>
              <Pil nada={resep.deltaE < DE_DEKAT ? 'settled' : resep.deltaE < DE_JAUH ? 'waiting' : 'attention'}>
                ΔE {desimal.format(resep.deltaE)}
              </Pil>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10" aria-hidden>
              {resep.bagian.map((b) => (
                <div key={b.indeks} style={{ width: `${b.persen}%`, background: tintaDasar[b.indeks]?.hex }} />
              ))}
            </div>
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {resep.bagian.map((b, i) => (
                <li key={b.indeks} className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-black/15"
                    style={{ background: tintaDasar[b.indeks]?.hex }}
                  />
                  <span className="min-w-0 flex-1 truncate">{tintaDasar[b.indeks]?.nama}</span>
                  <span className="font-medium tabular-nums">{persen.format(b.persen)}%</span>
                  <span className="w-16 text-right tabular-nums text-muted-foreground">{gram[i]} g</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-4 rounded ring-1 ring-inset ring-black/15" style={{ background: hex }} />
                {t('target')}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-4 rounded ring-1 ring-inset ring-black/15" style={{ background: resep.hasilHex }} />
                {t('estimate')}
              </span>
            </div>
            {resep.deltaE >= DE_JAUH ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                {t('recipeFar')}
              </p>
            ) : resep.deltaE >= DE_DEKAT ? (
              <p className="text-xs text-muted-foreground">{t('recipeNear')}</p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
