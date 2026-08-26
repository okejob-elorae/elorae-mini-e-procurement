'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Camera, Link2, PackageOpen, Plus, Scale } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
} from '@/app/actions/store-returns';
import type {
  BarisKerjaRetur,
  RingkasanKerjaRetur,
} from '@/lib/receivables/return-queries';
import type { LangkahRetur } from '@/lib/receivables/rules';
import type { BarisBarang } from '@/lib/receivables/return-writer';
import { NADA_LANGKAH, URUT_LANGKAH } from './langkah';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { BarisBarangEditor, type PilihanBarang } from './BarisBarangEditor';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const KIRIM = ['SALES', 'TOKO', 'EKSPEDISI'] as const;

export type CalonPasangan = {
  id: string;
  noNrt: string;
  storeId: string;
  storeName: string;
  nilaiKlaim: number;
  tanggal: string;
};

export function ReturTokoClient({
  baris,
  ringkasan,
  toko,
  katalog,
  calonPasangan,
  bolehMengelola,
  bolehMenghitung,
}: {
  baris: BarisKerjaRetur[];
  ringkasan: RingkasanKerjaRetur;
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
  calonPasangan: CalonPasangan[];
  bolehMengelola: boolean;
  bolehMenghitung: boolean;
}) {
  const t = useTranslations('storeReturns');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saring, setSaring] = useState<LangkahRetur | 'kerja' | null>('kerja');

  const [buatTerbuka, setBuatTerbuka] = useState(false);
  const [noNrt, setNoNrt] = useState('');
  const [storeId, setStoreId] = useState('');
  const [claimDate, setClaimDate] = useState(hariIniWib());
  const [caraKirim, setCaraKirim] = useState<(typeof KIRIM)[number]>('SALES');
  const [nilaiKlaim, setNilaiKlaim] = useState('');
  const [barangKlaim, setBarangKlaim] = useState<BarisBarang[]>([]);
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState('');

  const [hitungBaris, setHitungBaris] = useState<BarisKerjaRetur | null>(null);
  const [terimaTerbuka, setTerimaTerbuka] = useState(false);
  const [nilaiFisik, setNilaiFisik] = useState('');
  const [catatanHitung, setCatatanHitung] = useState('');
  const [barangFisik, setBarangFisik] = useState<BarisBarang[]>([]);
  const [kirimFisik, setKirimFisik] = useState<(typeof KIRIM)[number]>('EKSPEDISI');

  const [jodohBaris, setJodohBaris] = useState<BarisKerjaRetur | null>(null);
  const [pasanganId, setPasanganId] = useState('');

  const label = (k: LangkahRetur) => t(`step${k.charAt(0).toUpperCase()}${k.slice(1)}` as never);

  const tampil =
    saring === 'kerja'
      ? baris.filter((b) => b.langkah !== 'beres' && b.langkah !== 'batal')
      : saring
        ? baris.filter((b) => b.langkah === saring)
        : baris;

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

  /* Kartu-kartu langkah. Angkanya besar, tapi yang penting kalimat di bawahnya:
     ia menyebut AKIBAT langkah itu, bukan sekadar namanya lagi. */
  const KARTU: { langkah: LangkahRetur; nada: string }[] = [
    { langkah: 'keputusan', nada: 'text-destructive' },
    { langkah: 'cek', nada: 'text-amber-600 dark:text-amber-500' },
    { langkah: 'jodoh', nada: 'text-primary' },
    { langkah: 'beres', nada: 'text-emerald-600 dark:text-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
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

      {/* Tiga langkah alurnya, supaya orang baru tahu ia sedang di mana. */}
      <div className="anim-stagger grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <Card key={n} className="bg-muted/40">
            <CardContent className="flex gap-3 py-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {n}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">{t(`flow${n}Title` as never)}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(`flow${n}Body` as never)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="anim-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KARTU.map(({ langkah, nada }) => (
          <Card key={langkah}>
            <CardContent className="space-y-1 py-4">
              <p className="text-sm text-muted-foreground">{label(langkah)}</p>
              <p className={cn('text-2xl font-semibold tabular-nums', nada)}>
                {ringkasan.perLangkah[langkah]}
              </p>
              <p className="text-xs text-muted-foreground">{t(`effect${langkah.charAt(0).toUpperCase()}${langkah.slice(1)}` as never)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="anim-stagger flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSaring('kerja')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm transition-colors',
            saring === 'kerja' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
          )}
        >
          {t('filterWork', { count: ringkasan.perluDikerjakan })}
        </button>
        {URUT_LANGKAH.filter((k) => ringkasan.perLangkah[k] > 0).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSaring(saring === k ? null : k)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              saring === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            <StatusPill tone={NADA_LANGKAH[k]}>{label(k)}</StatusPill>
            <span className="ml-2 tabular-nums text-muted-foreground">
              {ringkasan.perLangkah[k]}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className={tampil.length === 0 ? 'p-0' : 'px-0'}>
          {tampil.length === 0 ? (
            <EmptyState icon={PackageOpen} title={t('emptyTitle')} description={t('emptyBody')} />
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
                    <TableHead className="text-right">{t('colAction')}</TableHead>
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
                      <TableCell className="align-top">
                        <span className="font-medium">{b.nomor}</span>
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
                      <TableCell className="align-top">
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
                        {b.nilaiKlaim === null ? '—' : rupiah(b.nilaiKlaim)}
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
                      <TableCell className="align-top">
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
                      <TableCell className="align-top text-right">
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          {b.langkah === 'cek' && bolehMenghitung && (
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
                <Input
                  id="nrt-tanggal"
                  type="date"
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
              {hitungBaris
                ? t('countBody', {
                    doc: hitungBaris.nomor,
                    claimed: rupiah(hitungBaris.nilaiKlaim ?? 0),
                  })
                : t('receiveOrphanBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <BarisBarangEditor
              rows={barangFisik}
              onChange={setBarangFisik}
              qtyLabel={t('colQtyPhysical')}
              katalog={katalog}
              jelaskanStok
            />
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
                (barangFisik.length === 0
                  ? nilaiFisik === '' || !(Number(nilaiFisik) >= 0)
                  : !barangFisik.every((b) => b.itemName.trim() && b.qty >= 0))
              }
              onClick={() =>
                jalankan(
                  () =>
                    catatHitunganGudangAction({
                      storeReturnId: hitungBaris?.id ?? null,
                      receivedAt: hariIniWib(),
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
                      {c.noNrt} · {c.storeName} · {rupiah(c.nilaiKlaim)}
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
