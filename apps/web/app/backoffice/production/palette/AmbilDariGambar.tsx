'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ImageUp, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ambilWarnaTitik, warnaDominan } from '@/lib/production-colors/palet/gambar';
import { bacaProfilWarna, buangProfilWarna, type ProfilWarna } from '@/lib/production-colors/palet/profil-gambar';
import { pantoneTerdekat, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { bacaKomposisiDesain, type PeranKomposisi } from '@/lib/production-colors/sablon/komposisi';
import { HURUF_SABLON, JUMLAH_SABLON_MAKS } from '@/lib/production-colors/sablon/saran';
import { cn } from '@/lib/utils';

/** Sisi terpanjang kanvas analisis. Screenshot 5K diperkecil dulu; warnanya tidak berubah, hitungannya jauh lebih ringan. */
const SISI_MAKS = 1400;
/** Jari-jari jendela rata-rata saat mengklik: 5×5 piksel kanvas. */
const JARI_TITIK = 2;
const UKURAN_LUP = 132;
const PIKSEL_LUP = 13;

/**
 * Warna yang diambil. Dari "Tebak komposisi" (palet berkain) setiap warna
 * membawa perannya: kain gambar, atau tinta dengan porsinya di area cetak.
 */
type Terambil = {
  id: string;
  hex: string;
  bagian?: number;
  sumber: 'titik' | 'tebak';
  peran?: 'KAIN' | PeranKomposisi;
  porsi?: number;
};

/** Berkas yang dimuat dalam dua rupa: apa adanya, dan tanpa profil warna. */
type Sumber = { asli: Blob; tanpaProfil: Blob };

let nomor = 0;
const idBaru = () => `w${Date.now().toString(36)}${(nomor++).toString(36)}`;

/**
 * Mengambil warna dari gambar: klik untuk satu titik, atau tebak warna
 * dominan. Gambar dibaca ke kanvas di peramban dan tidak pernah dikirim ke
 * server — URL objeknya dilepas saat diganti atau halaman ditutup.
 */
export function AmbilDariGambar({
  berkain,
  labelTerpilih,
  katalogC,
  katalogTcx,
  onJadikanKain,
  onPakaiUntukTerpilih,
  onIsiPalet,
  onAnalisis,
  onSalin,
}: {
  berkain: boolean;
  labelTerpilih: string;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
  onJadikanKain: (hex: string) => void;
  onPakaiUntukTerpilih: (hex: string) => void;
  onIsiPalet: (warna: { hex: string; bagian?: number }[]) => void;
  /** Warna dominan gambar, dibaca otomatis tiap gambar dimuat (`null` saat gambar dilepas) — untuk membaca komposisi desainnya. */
  onAnalisis?: (warna: { hex: string; bagian: number }[] | null) => void;
  onSalin: (teks: string) => void;
}) {
  const t = useTranslations('productionPalette');
  const locale = useLocale();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const lupRef = useRef<HTMLCanvasElement>(null);
  const lupKotakRef = useRef<HTMLDivElement>(null);
  const lupTeksRef = useRef<HTMLSpanElement>(null);
  const berkasRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<ImageData | null>(null);
  const sumberRef = useRef<Sumber | null>(null);
  /** Membaca berkas itu asinkron: yang selesai belakangan tidak boleh menimpa berkas yang dipilih sesudahnya. */
  const muatKeRef = useRef(0);

  const [url, setUrl] = useState<string | null>(null);
  const [profil, setProfil] = useState<ProfilWarna | null>(null);
  const [abaikanProfil, setAbaikanProfil] = useState(false);
  const [siap, setSiap] = useState(false);
  const [seret, setSeret] = useState(false);
  const [lupTampil, setLupTampil] = useState(false);
  /** Ukuran kanvas analisis, untuk menampilkan gambar kecil lebih besar dengan rasio yang sama. */
  const [ukuran, setUkuran] = useState<{ w: number; h: number } | null>(null);
  const [terambil, setTerambil] = useState<Terambil[]>([]);
  const [jumlahTebak, setJumlahTebak] = useState(berkain ? 4 : 5);
  /** Berkain: jumlah tinta (1–6). Palet bebas: jumlah warna (2–8). */
  const pilihanJumlah = berkain ? Array.from({ length: JUMLAH_SABLON_MAKS }, (_, i) => i + 1) : [2, 3, 4, 5, 6, 7, 8];
  const jumlahDipakai = Math.min(pilihanJumlah[pilihanJumlah.length - 1], Math.max(pilihanJumlah[0], jumlahTebak));

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  /*
   * Secara bawaan gambar dibaca DENGAN profil warnanya, seperti Preview dan
   * Finder: pemilik mencocokkan warna dengan yang tampil di Mac-nya. Sebuah JPG
   * berprofil "S24R35xFZ" menulis #CAC1B0; macOS menampilkannya #CFC8B6 dan
   * halaman ini mengambil #D0C8B7. Versi tanpa profil (angka mentah berkas)
   * disiapkan untuk saklar, bagi yang tahu kode HEX asli dari pembuatnya.
   */
  const muatBerkas = useCallback(
    (berkas: File | null | undefined) => {
      if (!berkas || !berkas.type.startsWith('image/')) return;
      const ke = ++muatKeRef.current;
      setSiap(false);
      setTerambil([]);
      setLupTampil(false);
      dataRef.current = null;
      berkas.arrayBuffer().then(
        (isi) => {
          if (ke !== muatKeRef.current) return;
          const bita = new Uint8Array(isi);
          const tanpa = buangProfilWarna(bita);
          sumberRef.current = {
            asli: berkas,
            tanpaProfil: tanpa === bita ? berkas : new Blob([tanpa as Uint8Array<ArrayBuffer>], { type: berkas.type }),
          };
          setProfil(bacaProfilWarna(bita));
          setAbaikanProfil(false);
          setUrl(URL.createObjectURL(berkas));
        },
        () => {
          if (ke !== muatKeRef.current) return;
          // Tidak terbaca sebagai bita: tetap tampilkan apa adanya.
          sumberRef.current = { asli: berkas, tanpaProfil: berkas };
          setProfil(null);
          setAbaikanProfil(false);
          setUrl(URL.createObjectURL(berkas));
        },
      );
    },
    [],
  );

  function gantiAbaikanProfil(nyala: boolean) {
    const sumber = sumberRef.current;
    if (!sumber) return;
    setAbaikanProfil(nyala);
    // Warna yang sudah diambil berasal dari tafsiran yang lain — jangan dicampur.
    setSiap(false);
    setTerambil([]);
    setLupTampil(false);
    dataRef.current = null;
    setUrl(URL.createObjectURL(nyala ? sumber.tanpaProfil : sumber.asli));
  }

  // Tempel screenshot langsung (⌘V). Hanya bereaksi pada berkas gambar, jadi
  // menempel teks ke kolom HEX di halaman yang sama tidak terganggu.
  useEffect(() => {
    function tempel(e: ClipboardEvent) {
      const berkas = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
      if (berkas) {
        e.preventDefault();
        muatBerkas(berkas);
      }
    }
    window.addEventListener('paste', tempel);
    return () => window.removeEventListener('paste', tempel);
  }, [muatBerkas]);

  function gambarDimuat(img: HTMLImageElement) {
    const kanvas = kanvasRef.current;
    if (!kanvas) return;
    const skala = Math.min(1, SISI_MAKS / Math.max(img.naturalWidth, img.naturalHeight));
    kanvas.width = Math.max(1, Math.round(img.naturalWidth * skala));
    kanvas.height = Math.max(1, Math.round(img.naturalHeight * skala));
    const ctx = kanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, kanvas.width, kanvas.height);
    dataRef.current = ctx.getImageData(0, 0, kanvas.width, kanvas.height);
    setUkuran({ w: kanvas.width, h: kanvas.height });
    setSiap(true);
    // Komposisi desain dibaca langsung, tanpa menunggu orang menekan Tebak.
    onAnalisis?.(warnaDominan(dataRef.current.data, { jumlah: 8 }).map((w) => ({ hex: w.hex, bagian: w.bagian })));
  }

  function titikKanvas(e: PointerEvent<HTMLCanvasElement>) {
    const kanvas = e.currentTarget;
    const kotak = kanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - kotak.left) * kanvas.width) / kotak.width,
      y: ((e.clientY - kotak.top) * kanvas.height) / kotak.height,
      cssX: e.clientX - kotak.left,
      cssY: e.clientY - kotak.top,
    };
  }

  /*
   * Kaca pembesar berpusat tepat di kursor, seperti pipet di Figma atau macOS.
   * Posisinya ditulis langsung ke DOM, bukan lewat state: gerakan mouse datang
   * puluhan kali per detik, dan me-render ulang kartu setiap kali membuatnya
   * tertinggal. Dulu ia diletakkan di kanan atas kursor dan dijepit ke tepi
   * gambar, jadi di gambar kecil ia berhenti mengikuti di sebagian besar area.
   */
  function gerak(e: PointerEvent<HTMLCanvasElement>) {
    const data = dataRef.current;
    const kotakLup = lupKotakRef.current;
    const teks = lupTeksRef.current;
    if (!data || !kotakLup || !teks || e.pointerType === 'touch') return;
    const p = titikKanvas(e);
    const hex = ambilWarnaTitik(data.data, data.width, data.height, p.x, p.y, JARI_TITIK);
    // Di jendela sempit kaca pembesar bisa keluar dari tepi kanan halaman dan
    // memunculkan gulir samping. Di situ ia ditahan di dalam layar, dan kursor
    // biasa ditampilkan lagi karena titik tengahnya tidak lagi menandai kursor.
    const kiriLayar = e.clientX - UKURAN_LUP / 2;
    const kiriAman = Math.min(Math.max(4, kiriLayar), document.documentElement.clientWidth - UKURAN_LUP - 4);
    e.currentTarget.style.cursor = kiriAman === kiriLayar ? '' : 'crosshair';
    kotakLup.style.transform = `translate(${p.cssX + (kiriAman - kiriLayar) - UKURAN_LUP / 2}px, ${p.cssY - UKURAN_LUP / 2}px)`;
    teks.textContent = hex;
    teks.style.background = hex;
    if (!lupTampil) setLupTampil(true);
    const lupKanvas = lupRef.current;
    const ctx = lupKanvas?.getContext('2d');
    if (lupKanvas && ctx && kanvasRef.current) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, UKURAN_LUP, UKURAN_LUP);
      const setengah = Math.floor(PIKSEL_LUP / 2);
      ctx.drawImage(
        kanvasRef.current,
        Math.round(p.x) - setengah,
        Math.round(p.y) - setengah,
        PIKSEL_LUP,
        PIKSEL_LUP,
        0,
        0,
        UKURAN_LUP,
        UKURAN_LUP,
      );
    }
  }

  function klik(e: PointerEvent<HTMLCanvasElement>) {
    const data = dataRef.current;
    if (!data) return;
    const p = titikKanvas(e);
    const hex = ambilWarnaTitik(data.data, data.width, data.height, p.x, p.y, JARI_TITIK);
    setTerambil((daftar) => (daftar.some((w) => w.hex === hex) ? daftar : [...daftar, { id: idBaru(), hex, sumber: 'titik' }]));
  }

  function tebak() {
    const data = dataRef.current;
    if (!data) return;
    /*
     * Palet berkain: bukan sekadar warna terbanyak, tetapi komposisi desain —
     * kain dipisahkan, tepian huruf digabung ke tintanya, dan tiap tinta diberi
     * porsinya di area cetak. Jumlahnya berarti jumlah TINTA, bukan warna.
     */
    const analisis = berkain
      ? bacaKomposisiDesain(
          warnaDominan(data.data, { jumlah: 8 }).map((w) => ({ hex: w.hex, bagian: w.bagian })),
          jumlahDipakai,
        )
      : null;
    if (analisis) {
      const hasil: Terambil[] = [
        { id: idBaru(), hex: analisis.kain.hex, bagian: analisis.kain.bagian, sumber: 'tebak', peran: 'KAIN' },
        ...analisis.tinta.map((x) => ({ id: idBaru(), hex: x.hex, bagian: x.bagian, sumber: 'tebak' as const, peran: x.peran, porsi: x.porsi })),
      ];
      setTerambil((daftar) => [...hasil, ...daftar.filter((w) => w.sumber === 'titik' && !hasil.some((h) => h.hex === w.hex))]);
      return;
    }
    const hasil = warnaDominan(data.data, { jumlah: jumlahDipakai });
    setTerambil((daftar) => [
      ...hasil.map((w) => ({ id: idBaru(), hex: w.hex, bagian: w.bagian, sumber: 'tebak' as const })),
      ...daftar.filter((w) => w.sumber === 'titik' && !hasil.some((h) => h.hex === w.hex)),
    ]);
  }

  function lepasGambar() {
    onAnalisis?.(null);
    muatKeRef.current += 1;
    sumberRef.current = null;
    setProfil(null);
    setAbaikanProfil(false);
    setUrl(null);
    setSiap(false);
    setTerambil([]);
    setLupTampil(false);
    dataRef.current = null;
  }

  const kurangLima = !berkain && terambil.length < 5;
  // Di palet berkain kain gambar bukan tinta: yang dikirim ke tinta sablon hanya sisanya.
  const untukTinta = berkain ? terambil.filter((w) => w.peran !== 'KAIN') : terambil;
  const hurufTinta = new Map(terambil.filter((w) => w.porsi !== undefined).map((w, i) => [w.id, HURUF_SABLON[i]]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('imageTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={berkasRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            muatBerkas(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {!url ? (
          <div
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setSeret(true);
            }}
            onDragLeave={() => setSeret(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setSeret(false);
              muatBerkas(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-10 text-center',
              seret ? 'border-primary bg-primary/5' : 'border-border',
            )}
          >
            <ImageUp className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">{t('imageDrop')}</p>
            <Button type="button" variant="outline" onClick={() => berkasRef.current?.click()}>
              {t('imageChoose')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              {/* Di badan kartu, bukan di kepala: di HP dua tombol ini harus bisa turun baris. */}
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => berkasRef.current?.click()}>
                  <ImageUp className="h-3.5 w-3.5" />
                  {t('imageReplace')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={lepasGambar}>
                  {t('imageRemove')}
                </Button>
              </div>
              {/* Gambar asli dimuat tersembunyi hanya untuk dibaca ke kanvas. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- URL objek lokal, bukan aset yang dioptimalkan */}
              <img src={url} alt="" className="hidden" onLoad={(e) => gambarDimuat(e.currentTarget)} onError={lepasGambar} />
              {/*
               * Tanpa overflow-hidden: kaca pembesar boleh keluar dari tepi gambar.
               * Gambar kecil ditampilkan selebar kolom (paling tinggi 28rem) dengan
               * rasio aslinya, jadi kotak kanvas = isinya dan posisi klik tetap persis.
               */}
              <div
                className="relative max-w-full rounded-md border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
                style={{ width: ukuran ? `min(100%, ${((28 * ukuran.w) / ukuran.h).toFixed(3)}rem)` : '100%' }}
              >
                <canvas
                  ref={kanvasRef}
                  onPointerMove={gerak}
                  onPointerLeave={() => setLupTampil(false)}
                  onPointerUp={klik}
                  className={cn(
                    'block h-auto w-full touch-manipulation rounded-[calc(var(--radius-md)-1px)]',
                    lupTampil ? 'cursor-none' : 'cursor-crosshair',
                  )}
                  aria-label={t('imageHint')}
                />
                <div
                  ref={lupKotakRef}
                  aria-hidden
                  hidden={!lupTampil}
                  className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden rounded-full border-4 border-white bg-background shadow-xl ring-1 ring-black/30"
                  style={{ width: UKURAN_LUP, height: UKURAN_LUP }}
                >
                  <canvas ref={lupRef} width={UKURAN_LUP} height={UKURAN_LUP} className="block" />
                  <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white ring-1 ring-black/60" />
                  <span
                    ref={lupTeksRef}
                    className="absolute right-0 bottom-0 left-0 py-0.5 text-center font-mono text-[10px] font-semibold uppercase"
                    style={{ color: '#fff', textShadow: '0 0 2px #000, 0 0 2px #000' }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('imageHint')}</p>
              {profil?.adaProfil && (
                <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-2.5">
                  <Switch id="abaikan-profil" checked={abaikanProfil} onCheckedChange={gantiAbaikanProfil} className="mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor="abaikan-profil" className="text-xs font-medium">
                      {t('imageProfileIgnore')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {profil.nama ? t('imageProfileFound', { name: profil.nama }) : t('imageProfileUnnamed')}{' '}
                      {abaikanProfil ? t('imageProfileRawHelp') : t('imageProfileManagedHelp')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="jumlah-tebak" className="text-xs">
                    {berkain ? t('guessInkCount') : t('guessCount')}
                  </Label>
                  <Select value={String(jumlahDipakai)} onValueChange={(v) => setJumlahTebak(Number(v))}>
                    <SelectTrigger id="jumlah-tebak" className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {pilihanJumlah.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={tebak} disabled={!siap}>
                  <Sparkles className="h-4 w-4" />
                  {berkain ? t('guessComposition') : t('guess')}
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">{t('pickedTitle')}</p>
                {hurufTinta.size > 0 && <p className="text-xs text-muted-foreground">{t('compositionHint')}</p>}
                {terambil.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('pickedEmpty')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {terambil.map((w) => {
                      const c = pantoneTerdekat(katalogC, w.hex);
                      const tcx = pantoneTerdekat(katalogTcx, w.hex);
                      return (
                        <li key={w.id} className="space-y-1.5 p-2">
                          <div className="flex items-center gap-2">
                            <span aria-hidden className="size-8 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: w.hex }} />
                            <div className="min-w-0 flex-1 leading-tight">
                              <button
                                type="button"
                                onClick={() => onSalin(w.hex.toUpperCase())}
                                className="font-mono text-sm uppercase hover:underline"
                              >
                                {w.hex}
                              </button>
                              {w.peran === 'KAIN' ? (
                                <span className="ml-2 text-xs font-medium">
                                  {t('fabricLabel')}{' '}
                                  <span className="font-normal tabular-nums text-muted-foreground">
                                    · {t('share', { percent: Math.round((w.bagian ?? 0) * 100) })}
                                  </span>
                                </span>
                              ) : w.porsi !== undefined && w.peran ? (
                                <span className="ml-2 text-xs font-medium">
                                  {t('inkShare', { letter: hurufTinta.get(w.id) ?? '?', role: t(`inkRoles.${w.peran}`), percent: w.porsi })}{' '}
                                  <span className="font-normal tabular-nums text-muted-foreground">
                                    · {t('share', { percent: Math.round((w.bagian ?? 0) * 100) })}
                                  </span>
                                </span>
                              ) : (
                                w.bagian !== undefined && (
                                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                                    {t('share', { percent: Math.round(w.bagian * 100) })}
                                  </span>
                                )
                              )}
                              <p className="truncate text-[11px] text-muted-foreground">
                                {c && `C ${c.warna.kode} · ΔE ${desimal.format(c.deltaE)}`}
                                {tcx && ` — TCX ${tcx.warna.kode} ${tcx.warna.nama ?? ''} · ΔE ${desimal.format(tcx.deltaE)}`}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t('removePicked')}
                              onClick={() => setTerambil((d) => d.filter((x) => x.id !== w.id))}
                            >
                              <X />
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1.5 pl-10">
                            <Button type="button" variant="outline" size="xs" onClick={() => onJadikanKain(w.hex)}>
                              {t('useAsFabric')}
                            </Button>
                            {w.peran !== 'KAIN' && (
                              <Button type="button" variant="outline" size="xs" onClick={() => onPakaiUntukTerpilih(w.hex)}>
                                {t('useForSelected', { label: labelTerpilih })}
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {terambil.length > 0 && (
                <div className="space-y-1">
                  <Button type="button" className="w-full" disabled={kurangLima || untukTinta.length === 0} onClick={() => onIsiPalet(untukTinta)}>
                    {berkain ? t('fillInks') : t('fillPalette')}
                  </Button>
                  {kurangLima && <p className="text-xs text-muted-foreground">{t('needFive', { count: terambil.length })}</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
