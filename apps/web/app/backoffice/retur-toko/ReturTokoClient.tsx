'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRightLeft, Camera, EyeOff, Link2, PackageOpen, Plus, Scale } from 'lucide-react';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  catatHitunganGudangAction,
  catatReturTokoAction,
  jodohkanReturAction,
  pindahkanNriAction,
} from '@/app/actions/store-returns';
import type { RingkasanKerjaRetur } from '@/lib/receivables/return-queries';
import type { LangkahRetur } from '@/lib/receivables/rules';
import { pelaporNota, type BarisReturTampil, type SaringRetur } from './buta';
import { KotakCari } from '../piutang/_daftar/KotakCari';
import { HalamanDaftar } from '../piutang/_daftar/HalamanDaftar';
import { denganParam } from '../piutang/_daftar/halaman';
import type { BarisBarang } from '@/lib/receivables/return-writer';
import { NADA_LANGKAH } from './langkah';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { BarisBarangEditor, type PilihanBarang } from './BarisBarangEditor';
import { BacaNota } from '@/components/ocr/BacaNota';
import { formatDisplayDate } from '@/lib/date-only';
import { TanggalInput } from '@/components/ui/tanggal-input';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const KIRIM = ['SALES', 'TOKO', 'EKSPEDISI'] as const;

export type CalonPasangan = {
  id: string;
  noNrt: string;
  storeId: string;
  storeName: string;
  /** `null` = nota belum dihitung dan penonton ini boleh menghitungnya (buta). */
  nilaiKlaim: number | null;
  tanggal: string;
};

const JALUR = '/backoffice/retur-toko';

export function ReturTokoClient({
  baris,
  halaman,
  adaBaris,
  ringkasan,
  toko,
  katalog,
  calonPasangan,
  bolehMengelola,
  bolehMenghitung,
  penggunaId = '',
  dariSpg = [],
  jumlahKoreksi = 0,
  koreksiIds = [],
  saring = 'kerja',
  cari = '',
}: {
  /** Satu halaman yang sudah disaring di server; klaim baris buta sudah dibuang. */
  baris: BarisReturTampil[];
  halaman: { halaman: number; totalHalaman: number; total: number; ukuran: number };
  /** Ada nota sama sekali (sebelum disaring). */
  adaBaris: boolean;
  /** Atas SEMUA nota, bukan hanya halaman ini. */
  ringkasan: RingkasanKerjaRetur;
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
  calonPasangan: CalonPasangan[];
  bolehMengelola: boolean;
  bolehMenghitung: boolean;
  /** Pengguna yang membuka — pelapor nota tidak boleh menghitung notanya sendiri. */
  penggunaId?: string;
  /** Id nota retur yang dilaporkan SPG. */
  dariSpg?: string[];
  /** Nota yang koreksinya diminta sales dan belum ditangani kantor. */
  jumlahKoreksi?: number;
  koreksiIds?: string[];
  /** Dari `?langkah=` / `?koreksi=1`. */
  saring?: SaringRetur;
  /** Dari `?cari=`. */
  cari?: string;
}) {
  const t = useTranslations('storeReturns');
  const notaSpg = useMemo(() => new Set(dariSpg), [dariSpg]);
  const notaKoreksi = useMemo(() => new Set(koreksiIds), [koreksiIds]);
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Saringan hidup di alamat; kata kuncinya ikut, halamannya kembali ke 1.
  const hrefSaring = (x: SaringRetur) =>
    denganParam(JALUR, { cari }, { langkah: x === 'kerja' || x === 'koreksi' ? null : x, koreksi: x === 'koreksi' ? '1' : null });

  const [buatTerbuka, setBuatTerbuka] = useState(false);
  const [noNrt, setNoNrt] = useState('');
  const [storeId, setStoreId] = useState('');
  const [claimDate, setClaimDate] = useState(hariIniWib());
  const [caraKirim, setCaraKirim] = useState<(typeof KIRIM)[number]>('SALES');
  const [nilaiKlaim, setNilaiKlaim] = useState('');
  const [barangKlaim, setBarangKlaim] = useState<BarisBarang[]>([]);
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState('');

  const [hitungBaris, setHitungBaris] = useState<BarisReturTampil | null>(null);
  const [terimaTerbuka, setTerimaTerbuka] = useState(false);
  const [nilaiFisik, setNilaiFisik] = useState('');
  const [catatanHitung, setCatatanHitung] = useState('');
  const [barangFisik, setBarangFisik] = useState<BarisBarang[]>([]);
  const [kirimFisik, setKirimFisik] = useState<(typeof KIRIM)[number]>('EKSPEDISI');
  const [tanggalTerima, setTanggalTerima] = useState(hariIniWib());

  const [jodohBaris, setJodohBaris] = useState<BarisReturTampil | null>(null);
  // Hitungan gudang yatim yang dicatat ke toko yang salah (atau tanpa toko).
  const [pindahBaris, setPindahBaris] = useState<BarisReturTampil | null>(null);
  const [tokoPindahId, setTokoPindahId] = useState('');
  const [alasanPindah, setAlasanPindah] = useState('');
  const [siklusTerkunci, setSiklusTerkunci] = useState<string[] | null>(null);
  const [setujuSiklus, setSetujuSiklus] = useState(false);
  const [pasanganId, setPasanganId] = useState('');

  const label = (k: LangkahRetur) => t(`step${k.charAt(0).toUpperCase()}${k.slice(1)}` as never);

  const tampil = baris;

  const jalankan = (
    fn: () => Promise<{ ok: boolean; kode?: string }>,
    pesan: string,
    bersihkan: () => void,
  ) => {
    startTransition(async () => {
      const hasil = await fn();
      if (hasil.ok) {
        toast.success(pesan);
        bersihkan();
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  /* Kartu-kartu langkah, sekaligus saringannya — dulu angka yang sama diulang
     di pil tepat di bawahnya. Warna hanya kalau angkanya lebih dari nol: nol
     merah membaca seperti peringatan. */
  const KARTU: { langkah: LangkahRetur; nada: string }[] = [
    { langkah: 'keputusan', nada: 'text-destructive' },
    { langkah: 'cek', nada: 'text-amber-600 dark:text-amber-500' },
    { langkah: 'jodoh', nada: 'text-sky-700 dark:text-sky-400' },
    { langkah: 'beres', nada: 'text-emerald-600 dark:text-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        meta={t('summary', {
          count: ringkasan.perluDikerjakan,
          held: rupiah(ringkasan.nilaiTertahan),
        })}
        actions={
          <span className="inline-flex flex-wrap gap-2">
            {bolehMenghitung && (
              <Button
                variant="outline"
                onClick={() => {
                  setHitungBaris(null);
                  setNilaiFisik('');
                  setCatatanHitung('');
                  setKirimFisik('EKSPEDISI');
                  setTanggalTerima(hariIniWib());
                  setTerimaTerbuka(true);
                }}
              >
                <PackageOpen className="mr-1.5 h-4 w-4" />
                {t('receiveOrphan')}
              </Button>
            )}
            {bolehMengelola && (
              <Button onClick={() => setBuatTerbuka(true)} disabled={toko.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('create')}
              </Button>
            )}
          </span>
        }
      />

      <div className="anim-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KARTU.map(({ langkah, nada }) => {
          const n = ringkasan.perLangkah[langkah];
          const aktif = saring === langkah;
          return (
            <Link
              key={langkah}
              href={hrefSaring(aktif ? 'kerja' : langkah)}
              replace
              aria-current={aktif ? 'true' : undefined}
            >
              <Card
                className={cn(
                  'h-full transition-colors hover:bg-muted/40',
                  aktif && 'border-primary ring-1 ring-primary/40',
                )}
              >
                <CardContent className="space-y-1 py-4">
                  <p className="text-sm text-muted-foreground">{label(langkah)}</p>
                  <p className={cn('text-2xl font-semibold tabular-nums', n > 0 && nada)}>{n}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {adaBaris && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <KotakCari nilai={cari} placeholder={t('searchPlaceholder')} label={t('searchPlaceholder')} />
          <div className="anim-stagger flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
            {(
              [
                { x: 'kerja', teks: t('filterWork', { count: ringkasan.perluDikerjakan }), tampil: true },
                { x: 'koreksi', teks: `${t('filterKoreksi')} · ${jumlahKoreksi}`, tampil: jumlahKoreksi > 0 || saring === 'koreksi' },
                { x: 'batal', teks: `${label('batal')} · ${ringkasan.perLangkah.batal}`, tampil: ringkasan.perLangkah.batal > 0 || saring === 'batal' },
                { x: 'semua', teks: t('filterAll'), tampil: true },
              ] as { x: SaringRetur; teks: string; tampil: boolean }[]
            )
              .filter((p) => p.tampil)
              .map((p) => (
                <Link
                  key={p.x}
                  href={hrefSaring(p.x)}
                  replace
                  aria-current={saring === p.x ? 'true' : undefined}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    saring === p.x ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                  )}
                >
                  {p.teks}
                </Link>
              ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            cari || (saring !== 'kerja' && saring !== 'semua') ? (
              <EmptyState icon={PackageOpen} title={t('emptyFilteredTitle')} />
            ) : (
              <EmptyState icon={PackageOpen} title={t('emptyTitle')} description={t('emptyBody')} />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colStore')}</TableHead>
                    <TableHead className="text-right">{t('colClaimed')}</TableHead>
                    <TableHead className="text-right">{t('colCounted')}</TableHead>
                    <TableHead>{t('colNextStep')}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => (
                    <TableRow
                      key={`${b.jenis}-${b.id}`}
                      /* Hanya baris yang menahan uang tanpa pemilik diberi
                         latar merah tipis. */
                      className={cn(b.langkah === 'keputusan' && 'bg-destructive/[0.06]')}
                    >
                      <TableCell className="align-top whitespace-normal min-w-[9rem] max-w-[11rem]">
                        <span className="font-medium">{b.nomor}</span>
                        {b.jenis === "NRT" && notaSpg.has(b.id) && (
                          <Badge variant="secondary" className="ml-1.5 align-middle">
                            {t("fromSpg" as never)}
                          </Badge>
                        )}
                        {b.jenis === 'NRT' && notaKoreksi.has(b.id) && (
                          <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">
                            {t('filterKoreksi')}
                          </span>
                        )}
                        {b.nomorPasangan && (
                          <span className="block text-xs text-muted-foreground">
                            ↔ {b.nomorPasangan}
                          </span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {tanggal(b.tanggal)} · {t(`via${b.caraKirim}` as never)}
                        </span>
                        {b.adaFoto && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Camera className="h-3 w-3" />
                            {t('hasPhoto')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal min-w-[140px] max-w-[220px]">
                        {b.storeName ?? (
                          <span className="text-muted-foreground">{t('storeUnknown')}</span>
                        )}
                        {b.salesmanName && (
                          <span className="block text-xs text-muted-foreground">
                            {b.salesmanName}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right tabular-nums">
                        {b.klaimTersembunyi ? (
                          /* Hitungan gudang buta: klaimnya tidak sampai ke peramban
                             orang yang akan menghitung nota ini. */
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <EyeOff className="h-3.5 w-3.5" aria-hidden />
                            {t('claimHiddenBlind')}
                          </span>
                        ) : b.nilaiKlaim === null ? (
                          '—'
                        ) : (
                          rupiah(b.nilaiKlaim)
                        )}
                        {b.jumlahPotongan > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {t('deducted', { value: rupiah(b.nilaiDipotong) })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right tabular-nums">
                        {b.nilaiFisik === null ? (
                          <span className="text-muted-foreground">{t('notCounted')}</span>
                        ) : (
                          <>
                            <span className="font-semibold">{rupiah(b.nilaiFisik)}</span>
                            {b.selisih > 0 && (
                              <span className="block text-xs font-medium text-destructive">
                                {t('short', { value: rupiah(b.selisih) })}
                              </span>
                            )}
                          </>
                        )}
                      </TableCell>
                      {/* Inti halamannya: keadaan + giliran siapa + akibatnya.
                          Tanpa kalimat ini yang tersisa cuma tabel angka. */}
                      <TableCell className="align-top whitespace-normal min-w-[16rem]">
                        <div className="max-w-sm space-y-1">
                          <StatusPill tone={NADA_LANGKAH[b.langkah]}>
                            {label(b.langkah)}
                          </StatusPill>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {b.giliran !== 'tidak_ada' && (
                              <span className="font-medium text-foreground">
                                {t('turnOf', { who: t(`who_${b.giliran}` as never) })}{' '}
                              </span>
                            )}
                            {t(`why${b.langkah.charAt(0).toUpperCase()}${b.langkah.slice(1)}` as never)}
                          </p>
                          {b.penanggung && (
                            <p className="text-xs text-muted-foreground">
                              {t('borneBy', { who: t(`bearer${b.penanggung}` as never) })}
                              {b.bebanStatus === 'LUNAS' && ` · ${t('chargeSettled')}`}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card align-top text-right">
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          {b.langkah === 'cek' && bolehMenghitung && pelaporNota(b, penggunaId) && (
                            /* Penulis menolak pelapor menghitung notanya sendiri
                               (PENGHITUNG_SAMA_PELAPOR) — tombolnya mati sejak awal,
                               dengan alasannya, seperti di layar gudang. */
                            <span className="inline-flex max-w-[11rem] flex-col items-end gap-1">
                              <Button size="sm" disabled title={t('countOwnNote')}>
                                <Scale className="mr-1.5 h-3.5 w-3.5" />
                                {t('count')}
                              </Button>
                              <span className="whitespace-normal text-right text-xs text-muted-foreground">
                                {t('countOwnNote')}
                              </span>
                            </span>
                          )}
                          {b.langkah === 'cek' && bolehMenghitung && !pelaporNota(b, penggunaId) && (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setHitungBaris(b);
                                setNilaiFisik('');
                                setCatatanHitung('');
                                // Rincian gudang diisi ulang dari nol; nama
                                // barangnya harus sama persis dengan nota toko
                                // supaya bisa disandingkan per baris.
                                setBarangFisik([]);
                                setKirimFisik(b.caraKirim);
                                setTanggalTerima(hariIniWib());
                                setTerimaTerbuka(true);
                              }}
                            >
                              <Scale className="mr-1.5 h-3.5 w-3.5" />
                              {t('count')}
                            </Button>
                          )}
                          {b.langkah === 'jodoh' && bolehMengelola && (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setJodohBaris(b);
                                setPasanganId('');
                              }}
                            >
                              <Link2 className="mr-1.5 h-3.5 w-3.5" />
                              {t('pair')}
                            </Button>
                          )}
                          {b.jenis === 'GUDANG_YATIM' && bolehMengelola && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                setPindahBaris(b);
                                setTokoPindahId('');
                                setAlasanPindah('');
                                setSiklusTerkunci(null);
                                setSetujuSiklus(false);
                              }}
                            >
                              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                              {b.storeId ? t('moveStoreShort') : t('setStore')}
                            </Button>
                          )}
                          {b.jenis === 'NRT' && (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/backoffice/retur-toko/${b.id}`}>{t('open')}</Link>
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <HalamanDaftar {...halaman} />
        </CardContent>
      </Card>

      {/* NRT — klaim toko */}
      <Dialog open={buatTerbuka} onOpenChange={setBuatTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nrt-no">{t('noNrt')}</Label>
              <Input
                id="nrt-no"
                value={noNrt}
                onChange={(e) => setNoNrt(e.target.value)}
                placeholder={t('noNrtPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('noNrtHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nrt-toko">{t('store')}</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger id="nrt-toko">
                  <SelectValue placeholder={t('storePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {toko.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nrt-tanggal">{t('claimDate')}</Label>
                <TanggalInput
                  id="nrt-tanggal"
                  value={claimDate}
                  onChange={(e) => setClaimDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nrt-kirim">{t('deliveryMethod')}</Label>
                <Select value={caraKirim} onValueChange={(v) => setCaraKirim(v as never)}>
                  <SelectTrigger id="nrt-kirim">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIRIM.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`via${k}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <BarisBarangEditor
              rows={barangKlaim}
              onChange={setBarangKlaim}
              qtyLabel={t('colQtyClaim')}
              katalog={katalog}
            />
            {barangKlaim.length === 0 && (
              <div className="space-y-2">
                <Label htmlFor="nrt-nilai">{t('claimedAmount')}</Label>
                <Input
                  id="nrt-nilai"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={nilaiKlaim}
                  onChange={(e) => setNilaiKlaim(e.target.value)}
                />
              </div>
            )}
            <UnggahFoto
              label={t('photoLabel')}
              petunjuk={t('photoHint')}
              nilai={foto}
              onChange={setFoto}
              wajib
              disabled={pending}
            />

            {/* Membaca rincian dari fotonya. Nomor dan tanggal hanya diisikan
                kalau kolomnya masih kosong — menimpa apa yang sudah diketik
                orang adalah cara tercepat membuat fitur ini dimatikan. */}
            <BacaNota
              fotoUrl={foto?.url ?? null}
              adaBarisTerisi={barangKlaim.length > 0}
              disabled={pending}
              onTerapkan={(baris) => setBarangKlaim((lama) => [...lama, ...baris])}
              onNomor={(no) => setNoNrt((lama) => (lama.trim() === '' ? no : lama))}
              onTanggal={(tgl) => setClaimDate((lama) => (lama === hariIniWib() ? tgl : lama))}
            />

            <div className="space-y-2">
              <Label htmlFor="nrt-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="nrt-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              /* Foto wajib: arsipnya terbuat dari foto-foto ini, dan nota tanpa
                 foto hanya menyisakan angka yang tak bisa dibuktikan ke toko. */
              disabled={
                pending ||
                !noNrt.trim() ||
                !storeId ||
                !foto ||
                (barangKlaim.length === 0
                  ? !(Number(nilaiKlaim) > 0)
                  : !barangKlaim.every((b) => b.itemName.trim() && b.qty > 0))
              }
              onClick={() =>
                jalankan(
                  () =>
                    catatReturTokoAction({
                      noNrt,
                      storeId,
                      claimDate,
                      deliveryMethod: caraKirim,
                      claimedAmount: Number(nilaiKlaim),
                      items: barangKlaim,
                      photoUrl: foto?.url ?? null,
                      note: catatan,
                    }),
                  t('okCreated'),
                  () => {
                    setBuatTerbuka(false);
                    setNoNrt('');
                    setStoreId('');
                    setNilaiKlaim('');
                    setBarangKlaim([]);
                    setFoto(null);
                    setCatatan('');
                  },
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NRI — hitungan gudang, berpasangan atau yatim */}
      <Dialog open={terimaTerbuka} onOpenChange={setTerimaTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hitungBaris ? t('countTitle') : t('receiveOrphanTitle')}</DialogTitle>
            <DialogDescription>
              {/* Klaim toko sengaja tidak disebut: yang dihitung barangnya, bukan angka notanya. */}
              {hitungBaris ? t('countBodyButa', { doc: hitungBaris.nomor }) : t('receiveOrphanBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <BarisBarangEditor
              rows={barangFisik}
              onChange={setBarangFisik}
              qtyLabel={t('colQtyPhysical')}
              katalog={katalog}
              jelaskanStok
              qtyMulaiKosong
            />
            <div className="space-y-2">
              <Label htmlFor="nri-diterima">{t('receivedAtLabel')}</Label>
              <TanggalInput
                id="nri-diterima"
                value={tanggalTerima}
                max={hariIniWib()}
                required
                onChange={(e) => setTanggalTerima(e.target.value)}
              />
            </div>
            {barangFisik.length === 0 && (
              <div className="space-y-2">
                <Label htmlFor="nri-nilai">{t('countedAmount')}</Label>
                <Input
                  id="nri-nilai"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={nilaiFisik}
                  onChange={(e) => setNilaiFisik(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('countHint')}</p>
              </div>
            )}
            {!hitungBaris && (
              <div className="space-y-2">
                <Label htmlFor="nri-kirim">{t('deliveryMethod')}</Label>
                <Select value={kirimFisik} onValueChange={(v) => setKirimFisik(v as never)}>
                  <SelectTrigger id="nri-kirim">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIRIM.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`via${k}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="nri-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="nri-catatan"
                value={catatanHitung}
                onChange={(e) => setCatatanHitung(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                tanggalTerima === '' ||
                (barangFisik.length === 0
                  ? nilaiFisik === '' || !(Number(nilaiFisik) >= 0)
                  : // Kolom jumlah kosong (NaN) belum dihitung; nol sah kalau diketik.
                    !barangFisik.every((b) => b.itemName.trim() && Number.isInteger(b.qty) && b.qty >= 0))
              }
              onClick={() =>
                jalankan(
                  () =>
                    catatHitunganGudangAction({
                      storeReturnId: hitungBaris?.id ?? null,
                      receivedAt: tanggalTerima,
                      deliveryMethod: hitungBaris ? hitungBaris.caraKirim : kirimFisik,
                      physicalAmount: Number(nilaiFisik),
                      items: barangFisik,
                      note: catatanHitung,
                    }),
                  t('okCounted'),
                  () => {
                    setTerimaTerbuka(false);
                    setHitungBaris(null);
                    setBarangFisik([]);
                  },
                )
              }
            >
              {t('saveCount')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pindahkan / tetapkan toko hitungan gudang yatim */}
      <Dialog open={pindahBaris !== null} onOpenChange={(o) => !o && !pending && setPindahBaris(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pindahBaris && t('moveTitle', { doc: pindahBaris.nomor })}</DialogTitle>
            <DialogDescription>{t('moveCountBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nri-toko-tujuan">{t('moveTarget')}</Label>
              <SearchableCombobox
                id="nri-toko-tujuan"
                options={toko.filter((x) => x.id !== pindahBaris?.storeId).map((x) => ({ value: x.id, label: x.name }))}
                value={tokoPindahId}
                onValueChange={setTokoPindahId}
                placeholder={t('moveTargetPlaceholder')}
                searchPlaceholder={t('moveTargetSearch')}
                emptyMessage={t('moveTargetEmpty')}
                triggerClassName="w-full"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nri-alasan-pindah">{t('moveReason')}</Label>
              <Textarea
                id="nri-alasan-pindah"
                value={alasanPindah}
                onChange={(e) => setAlasanPindah(e.target.value)}
                placeholder={t('moveCountReasonPlaceholder')}
                rows={3}
                disabled={pending}
              />
            </div>
            {siklusTerkunci && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p>{t('lockedCycleBody', { cycles: siklusTerkunci.join(', ') })}</p>
                <label className="flex items-start gap-2">
                  <Checkbox checked={setujuSiklus} onCheckedChange={(v) => setSetujuSiklus(v === true)} />
                  <span>{t('lockedCycleConfirm')}</span>
                </label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                tokoPindahId === '' ||
                alasanPindah.trim().length === 0 ||
                (siklusTerkunci !== null && !setujuSiklus)
              }
              onClick={() =>
                pindahBaris &&
                startTransition(async () => {
                  const hasil = await pindahkanNriAction(pindahBaris.id, tokoPindahId, alasanPindah, setujuSiklus);
                  if (hasil.ok) {
                    toast.success(t('okMovedCount'));
                    setPindahBaris(null);
                    router.refresh();
                    return;
                  }
                  if (hasil.kode === 'SIKLUS_TERKUNCI' && 'noKonsi' in hasil) {
                    setSiklusTerkunci(hasil.noKonsi);
                    return;
                  }
                  toast.error(t(`err${hasil.kode}` as never));
                })
              }
            >
              <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              {t('moveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Jodohkan penerimaan yatim */}
      <Dialog open={jodohBaris !== null} onOpenChange={(o) => !o && setJodohBaris(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pairTitle')}</DialogTitle>
            <DialogDescription>
              {jodohBaris &&
                t('pairBody', {
                  doc: jodohBaris.nomor,
                  value: rupiah(jodohBaris.nilaiFisik ?? 0),
                })}
            </DialogDescription>
          </DialogHeader>
          {calonPasangan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pairNoCandidates')}</p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="jodoh-nrt">{t('pairPick')}</Label>
              <Select value={pasanganId} onValueChange={setPasanganId}>
                <SelectTrigger id="jodoh-nrt">
                  <SelectValue placeholder={t('pairPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {calonPasangan.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.noNrt} · {c.storeName} · {tanggal(c.tanggal)}
                      {c.nilaiKlaim !== null && ` · ${rupiah(c.nilaiKlaim)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={pending || !pasanganId}
              onClick={() =>
                jodohBaris &&
                jalankan(
                  () => jodohkanReturAction(jodohBaris.id, pasanganId),
                  t('okPaired'),
                  () => setJodohBaris(null),
                )
              }
            >
              {t('savePair')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
