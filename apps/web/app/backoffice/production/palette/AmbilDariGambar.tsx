'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ImageUp, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ambilWarnaTitik, warnaDominan } from '@/lib/production-colors/palet/gambar';
import { bacaProfilWarna, buangProfilWarna, type ProfilWarna } from '@/lib/production-colors/palet/profil-gambar';
import { pantoneTerdekat, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { cn } from '@/lib/utils';

/** Sisi terpanjang kanvas analisis. Screenshot 5K diperkecil dulu; warnanya tidak berubah, hitungannya jauh lebih ringan. */
const SISI_MAKS = 1400;
/** Jari-jari jendela rata-rata saat mengklik: 5×5 piksel kanvas. */
const JARI_TITIK = 2;
const UKURAN_LUP = 132;
const PIKSEL_LUP = 13;

type Terambil = { id: string; hex: string; bagian?: number; sumber: 'titik' | 'tebak' };

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
  onSalin,
}: {
  berkain: boolean;
  labelTerpilih: string;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
  onJadikanKain: (hex: string) => void;
  onPakaiUntukTerpilih: (hex: string) => void;
  onIsiPalet: (warna: { hex: string; bagian?: number }[]) => void;
  onSalin: (teks: string) => void;
}) {
  const t = useTranslations('productionPalette');
  const locale = useLocale();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const lupRef = useRef<HTMLCanvasElement>(null);
  const berkasRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<ImageData | null>(null);
  const sumberRef = useRef<Sumber | null>(null);
  /** Membaca berkas itu asinkron: yang selesai belakangan tidak boleh menimpa berkas yang dipilih sesudahnya. */
  const muatKeRef = useRef(0);

  const [url, setUrl] = useState<string | null>(null);
  const [profil, setProfil] = useState<ProfilWarna | null>(null);
  const [ikutiProfil, setIkutiProfil] = useState(false);
  const [siap, setSiap] = useState(false);
  const [seret, setSeret] = useState(false);
  const [lup, setLup] = useState<{ x: number; y: number; hex: string; lebar: number } | null>(null);
  const [terambil, setTerambil] = useState<Terambil[]>([]);
  const [jumlahTebak, setJumlahTebak] = useState(berkain ? 4 : 5);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  /*
   * Secara bawaan profil warna di berkas dilepas sebelum gambar dibaca. Browser
   * menerjemahkan gambar ber-profil, dan screenshot sering membawa profil
   * MONITOR pembuatnya: sebuah JPG berprofil "S24R35xFZ" menulis #CAC1B0 tetapi
   * tampil dan terambil sebagai #D0C8B7. Tanpa profil, angka di berkas yang
   * dipakai — sama dengan yang dibaca aplikasi desain.
   */
  const muatBerkas = useCallback(
    (berkas: File | null | undefined) => {
      if (!berkas || !berkas.type.startsWith('image/')) return;
      const ke = ++muatKeRef.current;
      setSiap(false);
      setTerambil([]);
      setLup(null);
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
          setIkutiProfil(false);
          setUrl(URL.createObjectURL(sumberRef.current.tanpaProfil));
        },
        () => {
          if (ke !== muatKeRef.current) return;
          // Tidak terbaca sebagai bita: tetap tampilkan apa adanya.
          sumberRef.current = { asli: berkas, tanpaProfil: berkas };
          setProfil(null);
          setIkutiProfil(false);
          setUrl(URL.createObjectURL(berkas));
        },
      );
    },
    [],
  );

  function gantiIkutiProfil(nyala: boolean) {
    const sumber = sumberRef.current;
    if (!sumber) return;
    setIkutiProfil(nyala);
    // Warna yang sudah diambil berasal dari tafsiran yang lain — jangan dicampur.
    setSiap(false);
    setTerambil([]);
    setLup(null);
    dataRef.current = null;
    setUrl(URL.createObjectURL(nyala ? sumber.asli : sumber.tanpaProfil));
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
    setSiap(true);
  }

  function titikKanvas(e: PointerEvent<HTMLCanvasElement>) {
    const kanvas = e.currentTarget;
    const kotak = kanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - kotak.left) * kanvas.width) / kotak.width,
      y: ((e.clientY - kotak.top) * kanvas.height) / kotak.height,
      cssX: e.clientX - kotak.left,
      cssY: e.clientY - kotak.top,
      lebar: kotak.width,
    };
  }

  function gerak(e: PointerEvent<HTMLCanvasElement>) {
    const data = dataRef.current;
    if (!data || e.pointerType === 'touch') return;
    const p = titikKanvas(e);
    const hex = ambilWarnaTitik(data.data, data.width, data.height, p.x, p.y, JARI_TITIK);
    // Lebar kanvas diukur di sini, di event — bukan dibaca dari ref saat render.
    setLup({ x: p.cssX, y: p.cssY, hex, lebar: p.lebar });
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
    const hasil = warnaDominan(data.data, { jumlah: jumlahTebak });
    setTerambil((daftar) => [
      ...hasil.map((w) => ({ id: idBaru(), hex: w.hex, bagian: w.bagian, sumber: 'tebak' as const })),
      ...daftar.filter((w) => w.sumber === 'titik' && !hasil.some((h) => h.hex === w.hex)),
    ]);
  }

  function lepasGambar() {
    muatKeRef.current += 1;
    sumberRef.current = null;
    setProfil(null);
    setIkutiProfil(false);
    setUrl(null);
    setSiap(false);
    setTerambil([]);
    setLup(null);
    dataRef.current = null;
  }

  const kurangLima = !berkain && terambil.length < 5;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('imageTitle')}</CardTitle>
        <CardDescription>{t('imageDescription')}</CardDescription>
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
              <div className="relative w-fit max-w-full overflow-hidden rounded-md border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
                <canvas
                  ref={kanvasRef}
                  onPointerMove={gerak}
                  onPointerLeave={() => setLup(null)}
                  onPointerUp={klik}
                  // Lebar dan tinggi otomatis dengan batas maksimum: rasio gambar terjaga
                  // dan kotak elemen = isi kanvas, jadi posisi klik terpetakan persis.
                  // (object-contain akan menambah pita kosong yang tidak ikut dihitung.)
                  className="block h-auto max-h-[28rem] w-auto max-w-full cursor-crosshair touch-manipulation"
                  aria-label={t('imageHint')}
                />
                {lup && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-10 overflow-hidden rounded-full border-4 border-white shadow-xl ring-1 ring-black/30"
                    style={{
                      width: UKURAN_LUP,
                      height: UKURAN_LUP,
                      left: Math.max(4, Math.min(lup.x + 18, lup.lebar - UKURAN_LUP - 4)),
                      top: Math.max(4, lup.y - UKURAN_LUP - 18),
                    }}
                  >
                    <canvas ref={lupRef} width={UKURAN_LUP} height={UKURAN_LUP} className="block" />
                    <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white ring-1 ring-black/60" />
                    <span
                      className="absolute right-0 bottom-0 left-0 py-0.5 text-center font-mono text-[10px] font-semibold uppercase"
                      style={{ background: lup.hex, color: '#fff', textShadow: '0 0 2px #000, 0 0 2px #000' }}
                    >
                      {lup.hex}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('imageHint')}</p>
              {profil?.adaProfil && (
                <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-2.5">
                  <Switch id="ikuti-profil" checked={ikutiProfil} onCheckedChange={gantiIkutiProfil} className="mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor="ikuti-profil" className="text-xs font-medium">
                      {t('imageProfileFollow')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {profil.nama ? t('imageProfileFound', { name: profil.nama }) : t('imageProfileUnnamed')}{' '}
                      {ikutiProfil ? t('imageProfileFollowHelp') : t('imageProfileRawHelp')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="jumlah-tebak" className="text-xs">
                    {t('guessCount')}
                  </Label>
                  <Select value={String(jumlahTebak)} onValueChange={(v) => setJumlahTebak(Number(v))}>
                    <SelectTrigger id="jumlah-tebak" className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={tebak} disabled={!siap}>
                  <Sparkles className="h-4 w-4" />
                  {t('guess')}
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">{t('pickedTitle')}</p>
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
                              {w.bagian !== undefined && (
                                <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                                  {t('share', { percent: Math.round(w.bagian * 100) })}
                                </span>
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
                            <Button type="button" variant="outline" size="xs" onClick={() => onPakaiUntukTerpilih(w.hex)}>
                              {t('useForSelected', { label: labelTerpilih })}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {terambil.length > 0 && (
                <div className="space-y-1">
                  <Button type="button" className="w-full" disabled={kurangLima} onClick={() => onIsiPalet(terambil)}>
                    {berkain ? t('fillInks') : t('fillPalette')}
                  </Button>
                  {kurangLima && <p className="text-xs text-muted-foreground">{t('needFive', { count: terambil.length })}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{t('imagePrivacy')}</p>
          <p>{t('imageAccuracy')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
