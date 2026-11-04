'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRightLeft, Camera, EyeOff, Link2, MessageSquareWarning, PackageSearch, Printer, Scale, Unlink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
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
  batalkanReturAction,
  jadikanSusulanAction,
  pindahkanReturAction,
  lepasPasanganAction,
  lepasSusulanAction,
  putuskanBebanAction,
  tandaiBebanLunasAction,
} from '@/app/actions/store-returns';
import type { RincianRetur } from '@/lib/receivables/return-queries';
import type { CekSelisih } from '@/lib/receivables/rules';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { RiwayatDokumen } from '@/components/receivables/RiwayatDokumen';
import type { BarisRiwayat } from '@/lib/receivables/koreksi';
import { NADA_LANGKAH } from '../langkah';
import { formatDisplayDate } from '@/lib/date-only';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const BEBAN = ['TOKO', 'SALES', 'GUDANG', 'PERUSAHAAN'] as const;

type Kondisi = "LAYAK" | "RUSAK" | "EXPIRED";

/** Baris nota dan hitungan gudang per barang + varian + kondisi (dibaca halaman). */
export type RincianBarangRetur = {
  /** Nota dilaporkan SPG dari toko tetapnya. */
  dariSpg: boolean;
  /** Nota sudah menggerakkan buku stok toko — tidak bisa dipindah toko. */
  adaBukuToko: boolean;
  klaim: { itemId: string | null; variantSku: string; itemName: string; qty: number; amount: number; condition: Kondisi }[];
  fisik: { itemId: string | null; variantSku: string; itemName: string; qtyClaim: number; qty: number; amount: number; condition: Kondisi }[];
};

/**
 * Tindak lanjut selisih nota ini, dibaca halaman: hasil cek salesman pemegang toko,
 * hitungan barang susulan, dan keadaan bebannya. `null` kalau notanya tidak berselisih —
 * atau penonton ini akan menghitung susulannya (hitungan buta).
 */
export type TindakLanjutSelisih = {
  chargeId: string;
  status: 'TERBUKA' | 'DITETAPKAN' | 'LUNAS';
  bearer: (typeof BEBAN)[number] | null;
  cek: CekSelisih;
  cekCatatan: string | null;
  cekOleh: string | null;
  /** ISO. */
  cekPada: string | null;
  pemegangSekarang: string | null;
  /** Pemegang toko pada tanggal nota retur — saran orang yang menanggung (P85); kantor yang memilih. */
  pemegangSaatRetur: { id: string; nama: string } | null;
  spgToko: string[];
  /** Toko konsinyasi tidak bisa menanggung selisih: tidak ada nota asal yang menahannya. */
  tokoKonsi: boolean;
  kurang: { itemName: string; variantSku: string | null; qtyKurang: number }[];
  susulan: { id: string; noNri: string; tanggal: string; nilai: number; oleh: string | null }[];
  /** Selisihnya masih bisa menerima barang susulan (belum ada yang dibayar penanggungnya). */
  bisaSusulan: boolean;
  sudahDipotong: number;
  penanggungNama: string | null;
  /** Beban TOKO: yang tidak dikreditkan ke toko (`tertahan`) dan yang masih harus ditagih (`tampil`). */
  tokoDiNota: { tertahan: number; tampil: number } | null;
  /** Penerimaan gudang tanpa nota yang bisa dijadikan barang susulan nota ini. */
  calonYatim: { id: string; noNri: string; tanggal: string; nilai: number }[];
};

type BarisBanding = {
  nama: string;
  varian: string;
  qtyKlaim: number;
  nilaiKlaim: number;
  qtyFisik: number | null;
  nilaiFisik: number | null;
  kondisiKlaim: Partial<Record<Kondisi, number>>;
  kondisiFisik: Partial<Record<Kondisi, number>>;
};

/**
 * Sandingkan per barang + varian (baris tanpa barang katalog: per nama). Kondisi
 * tidak ikut kunci: gudang boleh menilai barang "layak" di nota sebagai rusak,
 * dan barisnya tetap satu.
 */
function bandingkanPerVarian(r: RincianBarangRetur): BarisBanding[] {
  const kunci = (i: { itemId: string | null; variantSku: string; itemName: string }) =>
    i.itemId ? `${i.itemId}::${i.variantSku}` : `nama::${i.itemName}`;
  const peta = new Map<string, BarisBanding>();
  const ambil = (i: { itemId: string | null; variantSku: string; itemName: string }) => {
    const k = kunci(i);
    let b = peta.get(k);
    if (!b) {
      b = { nama: i.itemName, varian: i.variantSku, qtyKlaim: 0, nilaiKlaim: 0, qtyFisik: null, nilaiFisik: null, kondisiKlaim: {}, kondisiFisik: {} };
      peta.set(k, b);
    }
    return b;
  };
  for (const i of r.klaim) {
    const b = ambil(i);
    b.qtyKlaim += i.qty;
    b.nilaiKlaim += i.amount;
    b.kondisiKlaim[i.condition] = (b.kondisiKlaim[i.condition] ?? 0) + i.qty;
  }
  for (const i of r.fisik) {
    const b = ambil(i);
    b.qtyFisik = (b.qtyFisik ?? 0) + i.qty;
    b.nilaiFisik = (b.nilaiFisik ?? 0) + i.amount;
    b.kondisiFisik[i.condition] = (b.kondisiFisik[i.condition] ?? 0) + i.qty;
    if (r.klaim.length === 0) b.qtyKlaim += i.qtyClaim;
  }
  return [...peta.values()];
}

export function RincianReturClient({
  data,
  kandidat,
  bolehMengelola,
  bolehPutuskanBeban = false,
  tokoTujuan = [],
  digantiOleh = null,
  menggantikan = null,
  koreksi = null,
  riwayat = [],
  rincianBarang = null,
  klaimTersembunyi = false,
  selisihTersembunyi = false,
  bolehMenghitung = false,
  tindakLanjut = null,
}: {
  data: RincianRetur;
  /** Penonton akan menghitung nota ini (atau barang susulannya): klaimnya sudah dibuang di server. */
  klaimTersembunyi?: boolean;
  /** Penonton akan menghitung barang susulan nota ini: selisih dan barang yang kurang dibuang di server. */
  selisihTersembunyi?: boolean;
  /** `inventory_opname:count` — tautan ke layar hitung gudang. */
  bolehMenghitung?: boolean;
  tindakLanjut?: TindakLanjutSelisih | null;
  kandidat: { id: string; name: string }[];
  bolehMengelola: boolean;
  /** Menetapkan siapa menanggung selisih retur — `store_returns:decide_shortfall`, bukan `receivables:manage`. */
  bolehPutuskanBeban?: boolean;
  /** Toko aktif untuk "Pindahkan ke toko lain" — hanya dimuat untuk yang boleh mengelola. */
  tokoTujuan?: { id: string; name: string }[];
  digantiOleh?: { id: string; nomor: string } | null;
  menggantikan?: { id: string; nomor: string } | null;
  /** Permintaan koreksi dari sales yang belum ditangani. */
  koreksi?: { pada: string; alasan: string } | null;
  riwayat?: BarisRiwayat[];
  rincianBarang?: RincianBarangRetur | null;
}) {
  const t = useTranslations('storeReturns');
  const tSpg = useTranslations("spgRetur");
  const locale = useLocale();
  const tanggal = (iso: string) => formatDisplayDate(iso, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bebanTerbuka, setBebanTerbuka] = useState<(typeof BEBAN)[number] | null>(null);
  const [alasan, setAlasan] = useState('');
  /* Beban ke sales harus melekat pada ORANG. Dimulai dari yang mencatat
     notanya — biasanya benar — tapi bisa diganti: yang mencatat tidak selalu
     yang keliru. */
  const [penanggungId, setPenanggungId] = useState<string>('');
  const [batalTerbuka, setBatalTerbuka] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState('');
  const [pindahTerbuka, setPindahTerbuka] = useState(false);
  const [tokoPindahId, setTokoPindahId] = useState('');
  const [alasanPindah, setAlasanPindah] = useState('');
  // Siklus konsinyasi terkunci yang tersentuh pemindahan: diisi saat server
  // memintanya, dan pemindahan baru jalan sesudah orangnya mencentang setuju.
  const [siklusTerkunci, setSiklusTerkunci] = useState<string[] | null>(null);
  const [setujuSiklus, setSetujuSiklus] = useState(false);
  const [susulanTerbuka, setSusulanTerbuka] = useState(false);
  const [yatimId, setYatimId] = useState('');
  // Sama untuk penerimaan tanpa toko yang dijadikan susulan: ia mendapat toko nota ini.
  const [siklusSusulan, setSiklusSusulan] = useState<string[] | null>(null);
  const [setujuSiklusSusulan, setSetujuSiklusSusulan] = useState(false);

  const b = data.baris;
  /* Orang penanggung saran: pemegang toko pada tanggal nota retur (P85) — kalau ia
     ada di daftar calon. Kantor tetap yang memilih. */
  const saranId = tindakLanjut?.pemegangSaatRetur?.id ?? null;
  const saranPenanggung = saranId && kandidat.some((u) => u.id === saranId) ? saranId : (data.baris.salesmanId ?? '');
  /* Barang tidak ketemu → sales tetap bawaan penanggungnya (P22, P84): tombolnya
     didahulukan dan ditonjolkan. Toko, gudang, dan perusahaan tetap bisa dipilih. */
  const bawaanSales = tindakLanjut?.cek === 'TIDAK_DITEMUKAN';
  const urutanBeban: readonly (typeof BEBAN)[number][] = bawaanSales ? ['SALES', 'TOKO', 'GUDANG', 'PERUSAHAAN'] : BEBAN;

  /*
   * Barang disandingkan menurut namanya, bukan menurut urutan barisnya. Gudang
   * mencatat apa yang sampai — urutannya tidak akan sama dengan nota toko, dan
   * barang yang TIDAK sampai sama sekali hanya muncul di sisi klaim.
   */
  const perbandingan = useMemo(() => {
    const peta = new Map<
      string,
      { nama: string; qtyKlaim: number; nilaiKlaim: number; qtyFisik: number | null; nilaiFisik: number | null }
    >();
    for (const i of data.barangKlaim) {
      peta.set(i.itemName, {
        nama: i.itemName,
        qtyKlaim: i.qty,
        nilaiKlaim: i.amount,
        qtyFisik: null,
        nilaiFisik: null,
      });
    }
    // Dijumlahkan, bukan ditimpa: sisi gudang memuat hitungan asli DAN barang
    // susulannya, jadi satu barang bisa muncul di lebih dari satu baris.
    for (const i of data.barangFisik) {
      const ada = peta.get(i.itemName);
      if (ada) {
        ada.qtyFisik = (ada.qtyFisik ?? 0) + i.qty;
        ada.nilaiFisik = (ada.nilaiFisik ?? 0) + i.amount;
      } else {
        peta.set(i.itemName, {
          nama: i.itemName,
          qtyKlaim: i.qtyClaim,
          nilaiKlaim: 0,
          qtyFisik: i.qty,
          nilaiFisik: i.amount,
        });
      }
    }
    return [...peta.values()];
  }, [data.barangKlaim, data.barangFisik]);

  const adaRincian = perbandingan.length > 0;
  // Baris yang membawa varian atau kondisi (nota SPG, hitungan per baris): sandingkan
  // per varian, dengan kondisinya — penyandingan per nama menimpa baris kembar.
  const perVarian = useMemo(() => {
    if (!rincianBarang) return null;
    const semua = [...rincianBarang.klaim, ...rincianBarang.fisik];
    const berVarian = semua.some((i) => i.variantSku || i.condition !== "LAYAK") || rincianBarang.dariSpg;
    return berVarian && semua.length > 0 ? bandingkanPerVarian(rincianBarang) : null;
  }, [rincianBarang]);
  const kunciBuku = rincianBarang?.adaBukuToko ?? false;
  const teksKondisi = (k: Partial<Record<Kondisi, number>>) =>
    (Object.entries(k) as [Kondisi, number][])
      .map(([kondisi, qty]) => `${qty} ${tSpg(`kondisi${kondisi}` as never).toLowerCase()}`)
      .join(", ") || "—";

  const jalankan = (
    fn: () => Promise<{ ok: boolean; kode?: string; docNo?: string[] }>,
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
        // `docNo` hanya ada pada DIPAKAI_DI_BKM: pesannya menyebut BKM mana yang dibetulkan dulu.
        toast.error(t(`err${hasil.kode}` as never, { docNo: hasil.docNo?.join(', ') ?? '' } as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/retur-toko">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={b.nomor}
        meta={
          <>
            <span className="block">
              {[
                b.storeName,
                t(`via${b.caraKirim}` as never),
                b.salesmanName && t('photographedBy', { name: b.salesmanName }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="mt-1 inline-flex flex-wrap items-center gap-2">
              <StatusPill tone={NADA_LANGKAH[b.langkah]}>
                {t(`step${b.langkah.charAt(0).toUpperCase()}${b.langkah.slice(1)}` as never)}
              </StatusPill>
              {rincianBarang?.dariSpg && <StatusPill tone="progress">{t("fromSpg" as never)}</StatusPill>}
            </span>
          </>
        }
        actions={
          <span className="inline-flex flex-wrap gap-2">
            {/* Lembar cetaknya memuat klaim — tidak ditawarkan selama hitungannya buta. */}
            {!klaimTersembunyi && (
              <Button variant="outline" asChild>
                <a href={`/print/retur/${b.id}`} target="_blank" rel="noreferrer">
                  <Printer className="mr-1.5 h-4 w-4" />
                  {t('print')}
                </a>
              </Button>
            )}
            {bolehMengelola && b.langkah !== 'batal' && (
              <>
              {data.gudang && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    data.gudang &&
                    jalankan(
                      // Aksinya melepas dari sisi GUDANG — id yang dikirim
                      // harus id NRI, bukan id nota tokonya.
                      () => lepasPasanganAction(data.gudang!.id),
                      t('okUnpaired'),
                      () => {},
                    )
                  }
                >
                  <Unlink className="mr-1.5 h-4 w-4" />
                  {t('unpair')}
                </Button>
              )}
                <Button
                  variant="outline"
                  disabled={pending || kunciBuku}
                  title={kunciBuku ? t("moveStoreBookLocked" as never) : undefined}
                  onClick={() => setPindahTerbuka(true)}
                >
                  <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                  {t('moveStore')}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setBatalTerbuka(true)}>
                  {t('cancel')}
                </Button>
              </>
            )}
          </span>
        }
      />

      {kunciBuku && bolehMengelola && b.langkah !== 'batal' && (
        <p className="text-sm text-muted-foreground">{t("moveStoreBookLocked" as never)}</p>
      )}

      {koreksi && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="block font-medium">{t('correctionRequested', { date: koreksi.pada })}</span>
            <span className="block">{koreksi.alasan}</span>
          </span>
        </p>
      )}
      {(menggantikan || digantiOleh) && (
        <p className="text-sm">
          {menggantikan && (
            <span className="block">
              {t('replaces')}{' '}
              <Link href={`/backoffice/retur-toko/${menggantikan.id}`} className="font-medium underline underline-offset-4">
                {menggantikan.nomor}
              </Link>
            </span>
          )}
          {digantiOleh && (
            <span className="block">
              {t('replacedBy')}{' '}
              <Link href={`/backoffice/retur-toko/${digantiOleh.id}`} className="font-medium underline underline-offset-4">
                {digantiOleh.nomor}
              </Link>
            </span>
          )}
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            {t('compareTitle')}
            {b.selisih > 0 && (
              <StatusPill tone="attention">{t('short', { value: rupiah(b.selisih) })}</StatusPill>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          {/* Sisi toko */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('sisiToko')}</h3>
              <StatusPill tone="progress">{t('sideStoreTag')}</StatusPill>
            </div>
            <p className="text-xs text-muted-foreground">
              {b.nomor} · {tanggal(b.tanggal)}
            </p>
            {klaimTersembunyi ? (
              <div className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <span className="block font-medium">{t('claimHiddenTitle')}</span>
                  <span className="block text-muted-foreground">{t('claimHiddenBody')}</span>
                </span>
              </div>
            ) : data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.photoUrl}
                alt={b.nomor}
                className="w-full rounded-lg border object-contain"
              />
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Camera className="h-4 w-4 shrink-0" />
                {t('noPhoto')}
              </div>
            )}
            {!klaimTersembunyi && (
              <Ringkas
                label={t('totalClaimed')}
                value={rupiah(b.nilaiKlaim ?? 0)}
                qty={data.barangKlaim.reduce((s, i) => s + i.qty, 0)}
                adaRincian={adaRincian}
              />
            )}
          </div>

          {/* Sisi gudang */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('sisiGudang')}</h3>
              <StatusPill tone={data.gudang ? 'settled' : 'waiting'}>
                {data.gudang ? t('sideWarehouseTag') : t('notCounted')}
              </StatusPill>
            </div>
            {data.gudang ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {data.gudang.noNri} ·{' '}
                  {t('countedBy', {
                    name: data.gudang.olehNama ?? '—',
                    date: tanggal(data.gudang.diterimaPada),
                  })}
                </p>
                {data.gudang.catatan && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.gudang.catatan}</p>
                )}
                <Ringkas
                  label={t('totalCounted')}
                  value={rupiah(b.nilaiFisik ?? 0)}
                  qty={data.barangFisik.reduce((s, i) => s + i.qty, 0)}
                  adaRincian={adaRincian}
                />
              </>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t('warehousePending')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {perVarian && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('perItemTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead>{t("colVariant" as never)}</TableHead>
                    <TableHead className="text-right">{t('colQtyClaim')}</TableHead>
                    <TableHead className="text-right">{t('colQtyPhysical')}</TableHead>
                    <TableHead>{t("colCondition" as never)}</TableHead>
                    <TableHead className="text-right">{t('colValueClaim')}</TableHead>
                    <TableHead className="text-right">{t('colValuePhysical')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perVarian.map((p, i) => {
                    const kurang = p.qtyFisik !== null && p.qtyFisik < p.qtyKlaim;
                    const belum = p.qtyFisik === null;
                    return (
                      <TableRow key={`${p.nama}-${p.varian}-${i}`} className={cn(kurang && 'bg-destructive/[0.06]')}>
                        <TableCell className="font-medium whitespace-normal min-w-[160px]">{p.nama}</TableCell>
                        <TableCell className="font-mono text-xs">{p.varian || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qtyKlaim}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', kurang && 'text-destructive')}>
                          {belum ? '—' : p.qtyFisik}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground min-w-[140px]">
                          {t("conditionPair" as never, { klaim: teksKondisi(p.kondisiKlaim), fisik: belum ? '—' : teksKondisi(p.kondisiFisik) } as never)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{rupiah(p.nilaiKlaim)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', kurang && 'font-semibold text-destructive')}>
                          {belum ? '—' : rupiah(p.nilaiFisik ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {adaRincian && !perVarian && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('perItemTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="text-right">{t('colQtyClaim')}</TableHead>
                    <TableHead className="text-right">{t('colQtyPhysical')}</TableHead>
                    <TableHead className="text-right">{t('colValueClaim')}</TableHead>
                    <TableHead className="text-right">{t('colValuePhysical')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perbandingan.map((p) => {
                    const kurang = p.qtyFisik !== null && p.qtyFisik < p.qtyKlaim;
                    const belum = p.qtyFisik === null;
                    return (
                      <TableRow key={p.nama} className={cn(kurang && 'bg-destructive/[0.06]')}>
                        <TableCell className="font-medium whitespace-normal min-w-[160px]">{p.nama}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qtyKlaim}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold tabular-nums',
                            kurang && 'text-destructive',
                          )}
                        >
                          {belum ? '—' : p.qtyFisik}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {rupiah(p.nilaiKlaim)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            kurang && 'font-semibold text-destructive',
                          )}
                        >
                          {belum ? '—' : rupiah(p.nilaiFisik ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Beban selisih */}
      {data.beban && (
        <Card
          className={cn(
            data.beban.status === 'TERBUKA' && 'border-destructive/40 bg-destructive/[0.04]',
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {t('chargeTitle', { value: rupiah(data.beban.amount) })}
              <StatusPill
                tone={
                  data.beban.status === 'TERBUKA'
                    ? 'attention'
                    : data.beban.status === 'LUNAS'
                      ? 'settled'
                      : 'progress'
                }
              >
                {t(`charge${data.beban.status}` as never)}
              </StatusPill>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.beban.status === 'TERBUKA' ? (
              <>
                <p className="text-sm leading-relaxed">
                  {t('chargeOpenBody', {
                    claimed: rupiah(b.nilaiKlaim ?? 0),
                    counted: rupiah(b.nilaiFisik ?? 0),
                  })}
                </p>
                {bolehPutuskanBeban && bawaanSales && (
                  <p className="text-xs text-muted-foreground">{t('assignSalesDefault')}</p>
                )}
                {bolehPutuskanBeban && (
                  <div className="flex flex-wrap gap-2">
                    {urutanBeban.map((k) => (
                      <Button
                        key={k}
                        variant={bawaanSales && k === 'SALES' ? 'default' : 'outline'}
                        size="sm"
                        // Toko konsinyasi tidak punya nota asal untuk menahan selisihnya.
                        disabled={pending || (k === 'TOKO' && tindakLanjut?.tokoKonsi === true)}
                        title={k === 'TOKO' && tindakLanjut?.tokoKonsi ? t('assignTokoKonsi') : undefined}
                        onClick={() => {
                          setBebanTerbuka(k);
                          setAlasan('');
                          setPenanggungId(saranPenanggung);
                        }}
                      >
                        {t(`assign${k}` as never)}
                      </Button>
                    ))}
                  </div>
                )}
                {bolehPutuskanBeban && tindakLanjut?.tokoKonsi && (
                  <p className="text-xs text-muted-foreground">{t('assignTokoKonsi')}</p>
                )}
                <p className="text-xs text-muted-foreground">{t('chargeCompanyHint')}</p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  {t('borneBy', {
                    who: t(`bearer${data.beban.penanggung ?? 'TOKO'}` as never),
                  })}
                  {data.beban.diputuskanOleh &&
                    ` · ${t('decidedBy', {
                      name: data.beban.diputuskanOleh,
                      date: data.beban.diputuskanPada
                        ? tanggal(data.beban.diputuskanPada)
                        : '—',
                    })}`}
                </p>
                {data.beban.catatan && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.beban.catatan}</p>
                )}
                {/* Barang susulannya menutup seluruh selisih: keputusan dan potongannya tetap terbaca. */}
                {!(data.beban.amount > 0) && <p className="text-sm text-muted-foreground">{t('bebanPulih')}</p>}
                {/* Ditanggung toko: selisihnya tetap terbuka di nota asal (keputusan 1,
                    2026-10-29) dan dibayar lewat BKM berikutnya — tidak ditandai lunas. */}
                {data.beban.penanggung === 'TOKO' && tindakLanjut?.tokoDiNota && (
                  <p className="text-sm">
                    {tindakLanjut.tokoDiNota.tertahan <= 0
                      ? t('bebanTokoBelumDipotong')
                      : tindakLanjut.tokoDiNota.tampil > 0
                        ? t('bebanTokoTerbuka', { value: rupiah(tindakLanjut.tokoDiNota.tampil) })
                        : t('bebanTokoDibayar')}
                  </p>
                )}
                {/* Ditanggung sales: dipotong dari komisinya di Laporan → Komisi salesman. */}
                {data.beban.penanggung === 'SALES' && (
                  <p className="text-sm">
                    {t('bebanSalesKomisi', {
                      name: tindakLanjut?.penanggungNama ?? '—',
                      cut: rupiah(tindakLanjut?.sudahDipotong ?? 0),
                    })}
                  </p>
                )}
                {data.beban.status === 'DITETAPKAN' &&
                  bolehMengelola &&
                  (data.beban.penanggung === 'GUDANG' || data.beban.penanggung === 'PERUSAHAAN') && (
                    <div className="space-y-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !(data.beban.amount > 0)}
                        onClick={() =>
                          data.beban &&
                          jalankan(
                            () => tandaiBebanLunasAction(data.beban!.id),
                            t('okChargeSettled'),
                            () => {},
                          )
                        }
                      >
                        {t('markSettled')}
                      </Button>
                      <p className="text-xs text-muted-foreground">{t('markSettledHint')}</p>
                    </div>
                  )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hitungan barang susulan buta: penghitungnya tidak melihat selisih atau barang yang kurang. */}
      {selisihTersembunyi && (
        <Card>
          <CardContent className="flex items-start gap-2 py-4 text-sm">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="space-y-2">
              <span className="block font-medium">{t('tindakLanjut.butaJudul')}</span>
              <span className="block text-muted-foreground">{t('tindakLanjut.butaIsi')}</span>
              {bolehMenghitung && (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/gudang-retur">
                    <Scale className="mr-1.5 h-3.5 w-3.5" />
                    {t('tindakLanjut.hitungSusulan')}
                  </Link>
                </Button>
              )}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Tindak lanjut selisih: salesman pemegang toko menanyakan ke toko dan SPG (P22),
          barang yang ketemu dikirim balik dan dihitung gudang sebagai susulan (P22a). */}
      {tindakLanjut && !klaimTersembunyi && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <PackageSearch className="h-4 w-4" aria-hidden />
              {t('tindakLanjut.judul')}
              <StatusPill
                tone={tindakLanjut.cek === 'TIDAK_DITEMUKAN' ? 'attention' : tindakLanjut.cek === 'DITEMUKAN' ? 'progress' : 'waiting'}
              >
                {t(`tindakLanjut.cek${tindakLanjut.cek}` as never)}
              </StatusPill>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('tindakLanjut.pemegangSekarang')}</dt>
                <dd>{tindakLanjut.pemegangSekarang ?? t('tindakLanjut.tanpaPemegang')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('tindakLanjut.pemegangSaatRetur')}</dt>
                <dd>{tindakLanjut.pemegangSaatRetur?.nama ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('tindakLanjut.spgToko')}</dt>
                <dd>{tindakLanjut.spgToko.length > 0 ? tindakLanjut.spgToko.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('tindakLanjut.laporan')}</dt>
                <dd>
                  {tindakLanjut.cekPada
                    ? t('tindakLanjut.dilaporkan', { name: tindakLanjut.cekOleh ?? '—', date: tanggal(tindakLanjut.cekPada) })
                    : t('tindakLanjut.belumDilaporkan')}
                </dd>
              </div>
            </dl>
            {tindakLanjut.cekCatatan && (
              <p className="rounded-lg bg-muted/50 p-3">{tindakLanjut.cekCatatan}</p>
            )}
            {tindakLanjut.kurang.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t('tindakLanjut.barangKurang')}</p>
                <ul className="space-y-1">
                  {tindakLanjut.kurang.map((x, i) => (
                    <li key={`${x.itemName}-${x.variantSku ?? ''}-${i}`} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {x.itemName}
                        {x.variantSku && <span className="ml-1 font-mono text-xs text-muted-foreground">{x.variantSku}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums">{t('tindakLanjut.pcs', { qty: x.qtyKurang })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t('tindakLanjut.susulanJudul')}</p>
              {tindakLanjut.susulan.length === 0 ? (
                <p className="text-muted-foreground">{t('tindakLanjut.susulanKosong')}</p>
              ) : (
                <ul className="space-y-2">
                  {tindakLanjut.susulan.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{x.noNri}</span>
                        <span className="block text-xs text-muted-foreground">
                          {tanggal(x.tanggal)} · {x.oleh ?? '—'} · {rupiah(x.nilai)}
                        </span>
                      </span>
                      {/* Lepas susulan hanya selama selisihnya belum diputuskan (penulis menolaknya sesudahnya). */}
                      {bolehMengelola && tindakLanjut.status === 'TERBUKA' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => jalankan(() => lepasSusulanAction(x.id), t('tindakLanjut.okDilepas'), () => {})}
                        >
                          <Unlink className="mr-1.5 h-3.5 w-3.5" />
                          {t('tindakLanjut.lepasSusulan')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {tindakLanjut.bisaSusulan ? (
                <div className="flex flex-wrap gap-2">
                  {bolehMenghitung && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/gudang-retur">
                        <Scale className="mr-1.5 h-3.5 w-3.5" />
                        {t('tindakLanjut.hitungSusulan')}
                      </Link>
                    </Button>
                  )}
                  {bolehMengelola && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || tindakLanjut.calonYatim.length === 0}
                      title={tindakLanjut.calonYatim.length === 0 ? t('tindakLanjut.tanpaCalonYatim') : undefined}
                      onClick={() => {
                        setYatimId('');
                        setSiklusSusulan(null);
                        setSetujuSiklusSusulan(false);
                        setSusulanTerbuka(true);
                      }}
                    >
                      <Link2 className="mr-1.5 h-3.5 w-3.5" />
                      {t('tindakLanjut.jadikanSusulan')}
                    </Button>
                  )}
                </div>
              ) : (
                (tindakLanjut.status === 'LUNAS' || tindakLanjut.sudahDipotong > 0) && (
                  <p className="text-xs text-muted-foreground">{t('tindakLanjut.susulanDitutup')}</p>
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dipakai sebagai potongan di BKM. Tidak tampil selama hitungannya buta:
          potongannya sudah dibuang di server, dan kartu kosong akan berbohong
          "belum menahan apa-apa". */}
      {!klaimTersembunyi && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('usedInClaims')}</CardTitle>
        </CardHeader>
        <CardContent className={data.potongan.length === 0 ? undefined : 'px-0'}>
          {data.potongan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('usedInClaimsEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colClaimDoc')}</TableHead>
                  <TableHead className="text-right">{t('colDeducted')}</TableHead>
                  <TableHead>{t('colClaimState')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.potongan.map((p) => (
                  <TableRow key={p.docNo}>
                    <TableCell className="font-medium">{p.docNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(p.amount)}</TableCell>
                    <TableCell>
                      <StatusPill tone={p.status === 'TERVERIFIKASI' ? 'settled' : 'waiting'}>
                        {p.status}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      <RiwayatDokumen baris={riwayat} />

      <Dialog open={bebanTerbuka !== null} onOpenChange={(o) => !o && setBebanTerbuka(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignTitle')}</DialogTitle>
            <DialogDescription>
              {bebanTerbuka &&
                t('assignBody', {
                  who: t(`bearer${bebanTerbuka}` as never),
                  gap: rupiah(data.beban?.amount ?? 0),
                })}
            </DialogDescription>
          </DialogHeader>
          {bebanTerbuka === 'TOKO' && <p className="text-sm text-muted-foreground">{t('bebanToko')}</p>}
          {bebanTerbuka === 'SALES' && (
            <div className="space-y-2">
              <Label htmlFor="beban-orang">{t('bearerPerson')}</Label>
              <Select value={penanggungId} onValueChange={setPenanggungId}>
                <SelectTrigger id="beban-orang">
                  <SelectValue placeholder={t('bearerPersonPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {kandidat.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('bearerPersonHint')}</p>
              {tindakLanjut?.pemegangSaatRetur && (
                <p className="text-xs text-muted-foreground">
                  {t('bearerPersonSuggestion', { name: tindakLanjut.pemegangSaatRetur.nama })}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="beban-alasan">{t('assignReason')}</Label>
            <Textarea
              id="beban-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('assignPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={
                pending ||
                alasan.trim().length === 0 ||
                // Beban ke sales tanpa orangnya adalah tuduhan tanpa alamat:
                // ia tidak akan muncul di layar siapa pun.
                (bebanTerbuka === 'SALES' && penanggungId === '')
              }
              onClick={() =>
                bebanTerbuka &&
                data.beban &&
                jalankan(
                  () =>
                    putuskanBebanAction(
                      data.beban!.id,
                      bebanTerbuka,
                      alasan,
                      bebanTerbuka === 'SALES' ? penanggungId : null,
                    ),
                  t('okAssigned'),
                  () => setBebanTerbuka(null),
                )
              }
            >
              {t('saveAssign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={susulanTerbuka} onOpenChange={(o) => !pending && setSusulanTerbuka(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tindakLanjut.jadikanJudul', { doc: b.nomor })}</DialogTitle>
            <DialogDescription>{t('tindakLanjut.jadikanIsi')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="susulan-yatim">{t('tindakLanjut.jadikanPilih')}</Label>
            <Select
              value={yatimId}
              onValueChange={(v) => {
                // Penerimaan lain bisa jatuh di bulan lain: konfirmasi siklusnya diminta ulang.
                setYatimId(v);
                setSiklusSusulan(null);
                setSetujuSiklusSusulan(false);
              }}
            >
              <SelectTrigger id="susulan-yatim">
                <SelectValue placeholder={t('tindakLanjut.jadikanPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(tindakLanjut?.calonYatim ?? []).map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.noNri} · {tanggal(n.tanggal)} · {rupiah(n.nilai)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {siklusSusulan && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p>{t('tindakLanjut.jadikanSiklusTerkunci', { cycles: siklusSusulan.join(', ') })}</p>
                <label className="flex items-start gap-2">
                  <Checkbox checked={setujuSiklusSusulan} onCheckedChange={(v) => setSetujuSiklusSusulan(v === true)} />
                  <span>{t('tindakLanjut.jadikanSiklusSetuju')}</span>
                </label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={pending || yatimId === '' || (siklusSusulan !== null && !setujuSiklusSusulan)}
              onClick={() =>
                startTransition(async () => {
                  const hasil = await jadikanSusulanAction(yatimId, b.id, setujuSiklusSusulan);
                  if (hasil.ok) {
                    toast.success(t('tindakLanjut.okDijadikan'));
                    setSusulanTerbuka(false);
                    setSiklusSusulan(null);
                    setSetujuSiklusSusulan(false);
                    router.refresh();
                    return;
                  }
                  if (hasil.kode === 'SIKLUS_TERKUNCI' && hasil.noKonsi) {
                    setSiklusSusulan(hasil.noKonsi);
                    return;
                  }
                  toast.error(t(`err${hasil.kode}` as never, { docNo: '' } as never));
                })
              }
            >
              <Link2 className="mr-1.5 h-4 w-4" />
              {t('tindakLanjut.jadikanSimpan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batalTerbuka} onOpenChange={setBatalTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cancelTitle')}</DialogTitle>
            <DialogDescription>{data.gudang ? t('cancelCounted') : t('cancelBody')}</DialogDescription>
          </DialogHeader>
          {/* Nota yang sudah dihitung gudang tidak dibatalkan begitu saja: barangnya
              sudah masuk dan stoknya bertambah. Salah toko → pindahkan; hitungan
              salah → lepas pasangan dulu. */}
          {data.gudang ? (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={kunciBuku}
                onClick={() => {
                  setBatalTerbuka(false);
                  setPindahTerbuka(true);
                }}
              >
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                {t('moveStore')}
              </Button>
            </DialogFooter>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="retur-alasan">{t('cancelReason')}</Label>
                <Textarea
                  id="retur-alasan"
                  value={alasanBatal}
                  onChange={(e) => setAlasanBatal(e.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={pending || alasanBatal.trim().length === 0}
                  onClick={() =>
                    jalankan(
                      () => batalkanReturAction(b.id, alasanBatal),
                      t('okCancelled'),
                      () => setBatalTerbuka(false),
                    )
                  }
                >
                  {t('cancel')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={pindahTerbuka}
        onOpenChange={(o) => {
          if (pending) return;
          setPindahTerbuka(o);
          if (!o) {
            setSiklusTerkunci(null);
            setSetujuSiklus(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('moveTitle', { doc: b.nomor })}</DialogTitle>
            <DialogDescription>{t('moveBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="retur-toko-tujuan">{t('moveTarget')}</Label>
              <SearchableCombobox
                id="retur-toko-tujuan"
                options={tokoTujuan.filter((x) => x.id !== b.storeId).map((x) => ({ value: x.id, label: x.name }))}
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
              <Label htmlFor="retur-alasan-pindah">{t('moveReason')}</Label>
              <Textarea
                id="retur-alasan-pindah"
                value={alasanPindah}
                onChange={(e) => setAlasanPindah(e.target.value)}
                placeholder={t('moveReasonPlaceholder')}
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
                startTransition(async () => {
                  const hasil = await pindahkanReturAction(b.id, tokoPindahId, alasanPindah, setujuSiklus);
                  if (hasil.ok) {
                    toast.success(t('okMoved'));
                    setPindahTerbuka(false);
                    setTokoPindahId('');
                    setAlasanPindah('');
                    setSiklusTerkunci(null);
                    setSetujuSiklus(false);
                    router.refresh();
                    return;
                  }
                  if (hasil.kode === 'SIKLUS_TERKUNCI' && 'noKonsi' in hasil) {
                    setSiklusTerkunci(hasil.noKonsi);
                    return;
                  }
                  toast.error(
                    t(`err${hasil.kode}` as never, { docNo: 'docNo' in hasil ? hasil.docNo.join(', ') : '' } as never),
                  );
                })
              }
            >
              <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              {t('moveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Ringkas({
  label,
  value,
  qty,
  adaRincian,
}: {
  label: string;
  value: string;
  qty: number;
  adaRincian: boolean;
}) {
  const t = useTranslations('storeReturns');
  return (
    <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-right">
        <span className="text-base font-semibold tabular-nums">{value}</span>
        {/* Kuantitas diberi kata satuannya. Angka telanjang di sebelah nominal
            rupiah terbaca sebagai bagian dari nominal itu. */}
        {adaRincian && (
          <span className="ml-2 text-xs text-muted-foreground">{t('qtyItems', { qty })}</span>
        )}
      </span>
    </div>
  );
}
