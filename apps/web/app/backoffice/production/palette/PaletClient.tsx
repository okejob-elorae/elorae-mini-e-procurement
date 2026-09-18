'use client';

import {
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type FormEvent,
} from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { hapusPaletAction, simpanPaletAction, simpanTintaDasarAction } from '@/app/actions/production-palette';
import { ATURAN_HARMONI, INDEKS_DASAR, susunHarmoni, type AturanHarmoni } from '@/lib/production-colors/palet/harmoni';
import {
  dariTersimpan,
  gantiHexPalet,
  geserPeganganPalet,
  hapusWarnaSablon,
  isiDariGambar,
  lepasKain,
  paletBebas,
  pasangKain,
  terapkanKomposisi,
  aturanSablonDari,
  pilihAturanPalet,
  sarankanDariKain,
  ubahJumlahSablon,
  ubahKecerahanPalet,
  ubahPorsiPalet,
  type Palet,
} from '@/lib/production-colors/palet/keadaan';
import { pantoneTerdekat, siapkanKatalog, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import dataPantoneC from '@/lib/production-colors/palet/pantone-c.json';
import type { BarisPalet } from '@/lib/production-colors/palet/queries';
import { svgKaos } from '@/lib/production-colors/palet/kaos-svg';
import { susunLembarPalet, type LembarPalet } from '@/lib/production-colors/palet/lembar';
import { BATAS_NAMA_PALET } from '@/lib/production-colors/palet/validasi';
import { buildPaletWarnaPrintHtml } from '@/lib/print/palet-warna-html';
import { hexKeHsb, hsbKeHex, normalisasiHex } from '@/lib/production-colors/palet/warna';
import { tiruKomposisi, type Komposisi } from '@/lib/production-colors/sablon/komposisi';
import { ATURAN_SABLON, JUMLAH_SABLON_MAKS } from '@/lib/production-colors/sablon/saran';
import type { TintaDasar } from '@/lib/production-colors/sablon/tinta-dasar';
import { salinTeks } from '@/lib/ui/salin-teks';
import { cn } from '@/lib/utils';
import { AmbilDariGambar } from './AmbilDariGambar';
import { DeretWarna } from './DeretWarna';
import { buatGambarPalet, cetakHtml, namaBerkas, unduh } from './ekspor-palet';
import { EditorWarna, type ModeMasukan } from './EditorWarna';
import { IkonHarmoni } from './IkonHarmoni';
import { KartuKain } from './KartuKain';
import { KartuRekomendasi } from './KartuRekomendasi';
import { HURUF_SABLON, KartuSablon } from './KartuSablon';
import { KartuTintaDasar } from './KartuTintaDasar';
import { KisiKontras } from './KisiKontras';
import { RodaWarna } from './RodaWarna';
import { TombolEkspor } from './TombolEkspor';

/** Titik mulai kalau warna tema terlalu pudar atau gelap untuk menjadi dasar. */
const WARNA_AWAL = '#e8553d';
/** Kain contoh saat saklar pertama kali dinyalakan — Blue Surf, dari permintaan tim sendiri. */
const KAIN_AWAL = '16-5106';
const KAIN_CADANGAN = '#90a8a4';

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

function paletAwal(warnaTema: string | null): Palet {
  const tema = warnaTema ? hexKeHsb(warnaTema) : null;
  // Tema yang terlalu pudar atau gelap menghasilkan lima warna kusam yang
  // nyaris sama — titik mulai yang buruk untuk memperkenalkan roda.
  const dasar = tema && tema.s >= 0.25 && tema.b >= 0.35 ? tema : hexKeHsb(WARNA_AWAL);
  return paletBebas('ANALOGOUS', susunHarmoni('ANALOGOUS', dasar, []));
}

/*
 * Katalog Coated C disiapkan sekali per muatan halaman, bukan per render: Lab
 * untuk 3.219 warna tidak berubah, dan menghitungnya ulang setiap pegangan
 * roda bergeser adalah kerja yang dibuang.
 */
let katalogCSiap: WarnaPantone[] | null = null;
function katalogC(): WarnaPantone[] {
  katalogCSiap ??= siapkanKatalog('C', dataPantoneC as [string, string][]);
  return katalogCSiap;
}

export function PaletClient({
  palet: daftar,
  tcx,
  tintaDasar,
  bolehMengelola,
}: {
  palet: BarisPalet[];
  /** `[kode, hex, nama]` dari tabel PantoneColor. */
  tcx: [string, string, string][];
  tintaDasar: TintaDasar[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('productionPalette');
  const tSablon = useTranslations('productionPrint');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [membuatGambar, setMembuatGambar] = useState(false);

  const warnaTema = useSyncExternalStore(pantauWarnaTema, bacaWarnaTema, () => null);
  const awal = useMemo(() => paletAwal(warnaTema), [warnaTema]);
  // `null` = belum disentuh: roda masih mengikuti warna tema. Sentuhan pertama
  // menyalin keadaan itu menjadi milik orangnya, dan sejak itu tema tidak lagi
  // boleh menimpanya.
  const [paletSendiri, setPaletSendiri] = useState<Palet | null>(null);
  const palet = paletSendiri ?? awal;
  const [terpilihMentah, setTerpilih] = useState(INDEKS_DASAR);
  const terpilih = Math.min(terpilihMentah, palet.warna.length - 1);
  // Mode isian ikut bertahan saat berpindah warna: orang yang memasukkan
  // lima kode CMYK tidak mau memilih tab CMYK lima kali.
  const [modeMasukan, setModeMasukan] = useState<ModeMasukan>('HEX');
  const [modeKain, setModeKain] = useState<ModeMasukan>('PANTONE_TCX');
  const [nama, setNama] = useState('');
  const [akanDihapus, setAkanDihapus] = useState<BarisPalet | null>(null);

  const katalogTcx = useMemo(() => siapkanKatalog('TCX', tcx), [tcx]);
  // Kain terakhir diingat selama halaman terbuka: mematikan lalu menyalakan
  // saklar lagi tidak memaksa orang mencari kodenya ulang.
  const [kainTerakhir, setKainTerakhir] = useState(
    () => tcx.find(([kode]) => kode === KAIN_AWAL)?.[1].toLowerCase() ?? KAIN_CADANGAN,
  );
  const [maksTinta, setMaksTinta] = useState(3);
  /** Warna yang wajib ada di setiap rekomendasi komposisi. */
  const [kunci, setKunci] = useState<string | null>(null);
  /** Warna dominan gambar referensi; komposisinya dihitung ulang tiap kali kain berganti. */
  const [warnaReferensi, setWarnaReferensi] = useState<{ hex: string; bagian: number }[] | null>(null);
  const [beratTeks, setBeratTeks] = useState('1000');
  const [tinta, setTinta] = useState<TintaDasar[]>(tintaDasar);
  const [tintaTersimpan, setTintaTersimpan] = useState<TintaDasar[]>(tintaDasar);
  const tintaTunda = useDeferredValue(tinta);

  function ubah(berikut: (p: Palet) => Palet) {
    setPaletSendiri((p) => berikut(p ?? awal));
  }

  const komposisiGambar = useMemo(
    () => (warnaReferensi && palet.kain ? tiruKomposisi({ gambar: warnaReferensi, kainHex: palet.kain, katalog: katalogC() }) : null),
    [warnaReferensi, palet.kain],
  );

  /** Memasang komposisi menimpa tinta yang ada — jadi selalu bisa diurungkan. */
  function pakaiKomposisi(k: Komposisi) {
    const sebelum = palet;
    setPaletSendiri(terapkanKomposisi(sebelum, k));
    setTerpilih(0);
    toast.success(t('recommend.applied', { name: t(`recommend.patterns.${k.pola}`) }), {
      action: { label: t('undo'), onClick: () => setPaletSendiri(sebelum) },
    });
  }

  function tiruDariGambar(warna: { hex: string; bagian: number }[]) {
    if (!palet.kain || !tiruKomposisi({ gambar: warna, kainHex: palet.kain, katalog: katalogC() })) {
      toast.error(t('recommend.fromImageFailed'));
      return;
    }
    setWarnaReferensi(warna);
    toast.success(t('recommend.fromImageAdded'));
    const hemat = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('rekomendasi')?.scrollIntoView({ behavior: hemat ? 'auto' : 'smooth', block: 'start' });
  }

  /** Memilih aturan menimpa warna sablon yang sudah disunting — jadi selalu bisa diurungkan. */
  function pilihAturan(aturan: AturanHarmoni) {
    const sebelum = palet;
    setPaletSendiri(pilihAturanPalet(sebelum, aturan, katalogC()));
    if (sebelum.kain !== null && !sebelum.saranUtuh) {
      toast.success(t('ruleReplacedInks', { rule: t(`rules.${aturanSablonDari(aturan)}.name`) }), {
        action: { label: t('undo'), onClick: () => setPaletSendiri(sebelum) },
      });
    }
  }

  const berkain = palet.kain !== null;
  const hex = palet.warna.map(hsbKeHex);
  const warnaTerpilih = palet.warna[terpilih];
  const hexTerpilih = hex[terpilih];
  const totalPorsi = palet.porsi?.reduce((s, x) => s + x, 0) ?? 100;

  function namaKainDari(kain: string): string {
    const terdekat = pantoneTerdekat(katalogTcx, kain);
    return terdekat && terdekat.deltaE < 0.05
      ? `PANTONE ${terdekat.warna.kode} TCX ${terdekat.warna.nama ?? ''}`.trim()
      : kain.toUpperCase();
  }
  const namaKain = palet.kain ? namaKainDari(palet.kain) : '';

  const labelWarna = (i: number) =>
    berkain ? t('inkLabel', { letter: HURUF_SABLON[i] }) : i === INDEKS_DASAR ? t('base') : t('swatchLabel', { n: i + 1 });

  async function salin(teks: string, pesan: string) {
    if (await salinTeks(teks)) toast.success(pesan);
    else toast.error(t('copyFailed'));
  }

  function nyalakanKain(nyala: boolean) {
    if (nyala) {
      ubah((p) => pasangKain(p, kainTerakhir, katalogC()));
      setTerpilih(0);
    } else {
      ubah(lepasKain);
      setTerpilih(INDEKS_DASAR);
    }
  }

  function simpan(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const h = await simpanPaletAction({ nama, aturan: palet.aturan, warna: hex, kain: palet.kain, porsi: palet.porsi });
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
    setPaletSendiri(dariTersimpan(p));
    if (p.kain) setKainTerakhir(p.kain);
    setTerpilih(p.kain ? 0 : INDEKS_DASAR);
    toast.success(t('loaded', { name: p.nama }));
    const hemat = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('roda-warna')?.scrollIntoView({ behavior: hemat ? 'auto' : 'smooth', block: 'start' });
  }

  function simpanTinta() {
    startTransition(async () => {
      const h = await simpanTintaDasarAction(tinta);
      if (h.ok) {
        setTinta(h.tinta);
        setTintaTersimpan(h.tinta);
        toast.success(tSablon('inksSaved'));
        router.refresh();
      } else {
        toast.error(tSablon(`errors.${h.kode}`));
      }
    });
  }

  const tanggal = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  type SumberEkspor = { nama: string; aturan: AturanHarmoni; warna: string[]; kain: string | null; porsi: number[] | null };
  type MetaEkspor = { tanggal: string | null; dibuatOleh: string | null };
  const satuDesimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** Resep di lembar memakai tinta dasar, batas tinta, dan berat adonan yang sedang dipakai di halaman. */
  function lembarUntuk(sumber: SumberEkspor): LembarPalet | null {
    const total = sumber.porsi?.reduce((a, b) => a + b, 0) ?? 100;
    if (sumber.kain && total !== 100) {
      toast.error(t('portionMustBe100', { total }));
      return null;
    }
    return susunLembarPalet({
      ...sumber,
      katalogC: katalogC(),
      katalogTcx,
      tintaDasar: tinta,
      maksTinta,
      berat: Math.round(Number(beratTeks)) > 0 ? Math.round(Number(beratTeks)) : 1000,
    });
  }

  function kaosUntuk(lembar: LembarPalet, id: string, lebar: number): string | null {
    if (!lembar.kain) return null;
    return svgKaos({
      kainHex: lembar.kain.hex,
      tinta: lembar.baris.map((b) => ({ huruf: b.label, hex: b.hex, porsi: b.porsi ?? 0 })),
      id,
      label: t('export.mockup'),
      lebar,
    });
  }

  function eksporPdf(sumber: SumberEkspor, meta: MetaEkspor) {
    const lembar = lembarUntuk(sumber);
    if (!lembar) return;
    const html = buildPaletWarnaPrintHtml({
      lembar,
      tanggal: meta.tanggal,
      dibuatOleh: meta.dibuatOleh,
      kaosSvg: kaosUntuk(lembar, 'kaos-cetak', 400),
      angka: (n) => satuDesimal.format(n),
      labels: {
        title: t('export.title'),
        untitled: t('export.untitled'),
        date: t('export.date'),
        rule: t('export.rule'),
        ruleName: t(`rules.${lembar.aturan}.name`),
        createdBy: t('export.createdBy'),
        fabric: t('export.fabric'),
        inks: t('export.inks'),
        swatches: t('export.swatches'),
        base: t('base'),
        codes: t('export.codes'),
        colColor: t('export.colColor'),
        colShare: t('export.colShare'),
        colReadability: t('export.colReadability'),
        role: (peran) => tSablon(`roles.${peran}`),
        readability: (k) => tSablon(`readability.${k}`),
        recipes: (grams, max) => t('export.recipes', { grams, max }),
        noRecipe: t('export.noRecipe'),
        estimate: t('export.estimate'),
        notes: [t('cmykNote'), t('pantoneNote'), ...(lembar.kain ? [tSablon('recipeNote')] : [])],
        printedFrom: t('export.printedFrom'),
        mockup: t('export.mockup'),
      },
    });
    cetakHtml(html, `${t('export.title')} — ${lembar.nama || t('export.untitled')}`);
  }

  async function eksporPng(sumber: SumberEkspor, meta: MetaEkspor) {
    const lembar = lembarUntuk(sumber);
    if (!lembar) return;
    setMembuatGambar(true);
    try {
      const blob = await buatGambarPalet(lembar, {
        kaosSvg: kaosUntuk(lembar, 'kaos-gambar', 560),
        angka: (n) => satuDesimal.format(n),
        labels: {
          title: t('export.title'),
          untitled: t('export.untitled'),
          sub: [
            lembar.kain ? t('savedFabric', { fabric: lembar.kain.nama ?? lembar.kain.hex }) : null,
            t(`rules.${lembar.aturan}.name`),
            tanggal.format(meta.tanggal ? new Date(meta.tanggal) : new Date()),
            meta.dibuatOleh,
          ]
            .filter(Boolean)
            .join(' · '),
          fabric: t('export.fabric'),
          base: t('base'),
          role: (peran) => tSablon(`roles.${peran}`),
          readability: (k) => tSablon(`readability.${k}`),
          note: t('export.pngNote'),
          footer: t('export.pngFooter'),
        },
      });
      const berkas = `${namaBerkas(lembar.nama, 'tanpa-nama')}.png`;
      unduh(blob, berkas);
      toast.success(t('export.pngDone', { file: berkas }));
    } catch {
      toast.error(t('export.pngFailed'));
    } finally {
      setMembuatGambar(false);
    }
  }

  const sumberLayar: SumberEkspor = { nama, aturan: palet.aturan, warna: hex, kain: palet.kain, porsi: palet.porsi };


  const pilihanAturan: readonly AturanHarmoni[] = berkain ? ATURAN_SABLON : ATURAN_HARMONI;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        meta={t('meta', { count: daftar.length })}
        actions={
          <>
            <Button variant="outline" onClick={() => salin(hex.map((h) => h.toUpperCase()).join(', '), t('copiedAll'))}>
              <Copy className="mr-1.5 h-4 w-4" />
              {t('copyAll')}
            </Button>
            <TombolEkspor
              label={t('export.button')}
              sibuk={membuatGambar}
              onPdf={() => eksporPdf(sumberLayar, { tanggal: null, dibuatOleh: null })}
              onPng={() => eksporPng(sumberLayar, { tanggal: null, dibuatOleh: null })}
            />
          </>
        }
      />

      {/* Selebar halaman, di atas roda: kain adalah titik berangkat palet sablon, dan di kolom sempit editornya bertumpuk setinggi roda. */}
      <KartuKain
        kain={palet.kain}
        namaKain={namaKain}
        mode={modeKain}
        onMode={setModeKain}
        onNyala={nyalakanKain}
        onGantiKain={(baru) => {
          setKainTerakhir(baru);
          ubah((p) => pasangKain(p, baru, katalogC()));
        }}
        onSalin={(teks) => salin(teks, t('copied', { hex: teks }))}
        katalogC={katalogC()}
        katalogTcx={katalogTcx}
      />

      {palet.kain && (
        <KartuRekomendasi
          kainHex={palet.kain}
          namaKain={namaKain}
          katalogC={katalogC()}
          hexTinta={hex}
          kunci={kunci}
          onKunci={setKunci}
          dariGambar={komposisiGambar}
          onBuangDariGambar={() => setWarnaReferensi(null)}
          onPakai={pakaiKomposisi}
        />
      )}

      <AmbilDariGambar
        berkain={berkain}
        onTiruKomposisi={berkain ? tiruDariGambar : undefined}
        labelTerpilih={labelWarna(terpilih)}
        katalogC={katalogC()}
        katalogTcx={katalogTcx}
        onSalin={(teks) => salin(teks, t('copied', { hex: teks }))}
        onJadikanKain={(hex) => {
          setKainTerakhir(hex);
          if (!berkain) setTerpilih(0);
          ubah((p) => pasangKain(p, hex, katalogC()));
          toast.success(t('fabricSet', { hex: hex.toUpperCase() }));
        }}
        onPakaiUntukTerpilih={(hex) => {
          ubah((p) => gantiHexPalet(p, terpilih, hex));
          toast.success(t('appliedTo', { hex: hex.toUpperCase(), label: labelWarna(terpilih) }));
        }}
        onIsiPalet={(warna) => {
          const baru = isiDariGambar(palet, warna);
          if (baru === palet) {
            toast.error(berkain ? t('allFabric') : t('needFive', { count: warna.length }));
            return;
          }
          setPaletSendiri(baru);
          setTerpilih(berkain ? 0 : INDEKS_DASAR);
          toast.success(berkain ? t('filledInks') : t('filledPalette'));
        }}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card id="roda-warna" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>{t('wheelTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="aturan-harmoni">{berkain ? t('ruleLabelFabric') : t('ruleLabel')}</Label>
                {/*
                 * Dropdown, bukan deretan tombol: sembilan nama dengan panjang
                 * yang sangat berbeda ("Triad" vs "Split Complementary") tidak
                 * pernah bisa berbaris rapi di kartu sesempit ini.
                 */}
                <Select value={palet.aturan} onValueChange={(v) => pilihAturan(v as AturanHarmoni)}>
                  <SelectTrigger id="aturan-harmoni" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {pilihanAturan.map((aturan) => (
                      <SelectItem key={aturan} value={aturan} className="py-2">
                        <IkonHarmoni aturan={aturan} className="size-5" />
                        {t(`rules.${aturan}.name`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Tiga baris = penjelasan terpanjang di lebar kartu desktop maupun HP, jadi roda di bawahnya tidak melompat saat aturan diganti. */}
                <p className="min-h-[3.75rem] text-sm text-muted-foreground">{t(`rules.${palet.aturan}.hint`)}</p>
              </div>

              <RodaWarna
                warna={palet.warna}
                terpilih={terpilih}
                onPilih={setTerpilih}
                onGeser={(i, h, s) => ubah((p) => geserPeganganPalet(p, i, h, s))}
                indeksDasar={berkain ? null : INDEKS_DASAR}
                kain={palet.kain ? { hex: palet.kain, label: t('fabricMarker', { hex: palet.kain.toUpperCase() }) } : null}
                labelPegangan={(i, kode) =>
                  berkain
                    ? t('handleLabelInk', { letter: HURUF_SABLON[i], hex: kode })
                    : i === INDEKS_DASAR
                      ? t('handleLabelBase', { hex: kode })
                      : t('handleLabel', { n: i + 1, hex: kode })
                }
              />

              <p className="text-center text-xs text-muted-foreground">
                {berkain ? t('inkDragHint') : palet.aturan === 'CUSTOM' ? t('customHint') : t('dragHint')}
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
                  onChange={(e) => ubah((p) => ubahKecerahanPalet(p, terpilih, Number(e.target.value) / 100))}
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
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>{berkain ? t('inksTitle') : t('swatchesTitle')}</CardTitle>
            <CardDescription>{berkain ? t('inksHint') : t('swatchesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <DeretWarna
              hex={hex}
              terpilih={terpilih}
              onPilih={setTerpilih}
              labelUbin={(i) => `${labelWarna(i)}, ${hex[i].toUpperCase()}`}
              tandaUbin={(i) => (berkain ? HURUF_SABLON[i] : i === INDEKS_DASAR ? t('base') : null)}
              onSalin={(kode) => salin(kode.toUpperCase(), t('copied', { hex: kode.toUpperCase() }))}
              judulSalin={(kode) => t('copyHex', { hex: kode.toUpperCase() })}
              onHapus={berkain ? (i) => ubah((p) => hapusWarnaSablon(p, i)) : undefined}
              labelHapus={(i) => t('removeInk', { letter: HURUF_SABLON[i] })}
              onTambah={
                berkain && palet.warna.length < JUMLAH_SABLON_MAKS
                  ? () => {
                      ubah((p) => ubahJumlahSablon(p, p.warna.length + 1, katalogC()));
                      setTerpilih(palet.warna.length);
                    }
                  : undefined
              }
              labelTambah={t('addInk')}
            />

            <EditorWarna
              key={`${berkain}-${terpilih}`}
              label={labelWarna(terpilih)}
              hex={hexTerpilih}
              hsb={warnaTerpilih}
              mode={modeMasukan}
              onMode={setModeMasukan}
              onGantiHex={(baru) => ubah((p) => gantiHexPalet(p, terpilih, baru))}
              onSalin={(teks) => salin(teks, t('copied', { hex: teks }))}
              katalogC={katalogC()}
              katalogTcx={katalogTcx}
            />

            {bolehMengelola && (
              <form onSubmit={simpan} className="space-y-2 border-t pt-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
                  <Button type="submit" disabled={pending || !nama.trim() || (berkain && totalPorsi !== 100)}>
                    {pending ? t('saving') : t('save')}
                  </Button>
                </div>
                {berkain && totalPorsi !== 100 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">{t('portionMustBe100', { total: totalPorsi })}</p>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {palet.kain && palet.porsi && (
        <KartuSablon
          kainHex={palet.kain}
          namaKain={namaKain}
          aturan={palet.aturan}
          hex={hex}
          porsi={palet.porsi}
          saranUtuh={palet.saranUtuh}
          tintaDasar={tintaTunda}
          maksTinta={maksTinta}
          onMaksTinta={setMaksTinta}
          beratTeks={beratTeks}
          onBeratTeks={setBeratTeks}
          katalogC={katalogC()}
          onPorsi={(i, n) => ubah((p) => ubahPorsiPalet(p, i, n))}
          onGanti={(i, baru) => ubah((p) => gantiHexPalet(p, i, baru))}
          onSarankanUlang={() => ubah((p) => sarankanDariKain(p, katalogC()))}
          onSalin={(teks) => salin(teks, tSablon('copied'))}
        />
      )}

      {berkain && (
        <KartuTintaDasar
          tinta={tinta}
          berubah={JSON.stringify(tinta) !== JSON.stringify(tintaTersimpan)}
          bolehMenyimpan={bolehMengelola}
          menyimpan={pending}
          katalogC={katalogC()}
          onUbah={setTinta}
          onSimpan={simpanTinta}
          onGalat={(pesan) => toast.error(pesan)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('contrastTitle')}</CardTitle>
          <CardDescription>{t('contrastDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <KisiKontras warna={hex} kain={palet.kain} labelWarna={labelWarna} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('savedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={daftar.length === 0 ? 'p-0' : undefined}>
          {daftar.length === 0 ? (
            <EmptyState icon={Palette} title={t('emptyTitle')} description={bolehMengelola ? t('emptyBody') : t('emptyBodyViewOnly')} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {daftar.map((p) => (
                <li key={p.id} className="min-w-0 space-y-3 rounded-lg border p-3">
                  <div className="flex h-14 gap-1.5">
                    {p.kain && (
                      <div
                        className="w-10 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                        style={{ background: p.kain }}
                        title={t('savedFabric', { fabric: p.kain.toUpperCase() })}
                      />
                    )}
                    <div className="flex min-w-0 flex-1 overflow-hidden rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10">
                      {p.warna.map((w, i) => (
                        // Palet berkain: lebar pita mengikuti porsinya di desain.
                        <div key={i} style={{ background: w, flexGrow: p.porsi?.[i] ?? 1, flexBasis: 0 }} title={w.toUpperCase()} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.nama}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          p.kain ? t('savedFabric', { fabric: namaKainDari(p.kain) }) : null,
                          t(`rules.${p.aturan}.name`),
                          p.dibuatOleh,
                          tanggal.format(new Date(p.dibuatPada)),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => muat(p)}>
                        {t('use')}
                      </Button>
                      <TombolEkspor
                        ikonSaja
                        label={t('export.buttonFor', { name: p.nama })}
                        sibuk={membuatGambar}
                        onPdf={() => eksporPdf(p, { tanggal: p.dibuatPada, dibuatOleh: p.dibuatOleh })}
                        onPng={() => eksporPng(p, { tanggal: p.dibuatPada, dibuatOleh: p.dibuatOleh })}
                      />
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
