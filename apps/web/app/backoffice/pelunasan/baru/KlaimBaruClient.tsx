'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Copy, MessageCircle, Plus, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { cn } from '@/lib/utils';
import { buatKlaimAction } from '@/app/actions/receivables';
import { tautanPesanKlaimBaruAction } from '@/app/actions/tugas-tagih';
import type { TautanPesanKlaim } from '@/lib/receivables/tugas-tagih-queries';
import type { AwalKlaim, BahanKlaimBaru } from '@/lib/receivables/claim-queries';
import { unggahFoto } from '@/lib/foto/unggah';
import type { FotoTertunda } from '@/lib/pwa/offline/db';
import { nasibUnggah } from '@/lib/pwa/offline/laporan-classify';
import { antreKlaim } from '@/lib/pwa/offline/laporan-queue';
import { PERISTIWA_ANTREAN } from '@/lib/pwa/offline/hitung';
import { newLocalId } from '@/lib/pwa/offline/queue';
import { MASA_BERLAKU_GIRO_HARI, periksaGiro, tambahHari, tanggalWib } from '@/lib/receivables/giro';
import { TanggalInput } from '@/components/ui/tanggal-input';

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

const CARA = ['transfer', 'tunai', 'giro'] as const;

type Potongan = {
  nama: string;
  nilai: number;
  deductionTypeId: string;
  storeReturnId: string;
  catatan: string;
};

/** Foto formulir → bentuk antrean: berkas di HP bila belum naik, URL bila sudah. */
const keTertunda = (f: NilaiFoto): FotoTertunda | null =>
  f ? (f.berkas ? { nama: f.nama, blob: f.berkas } : { nama: f.nama, url: f.url }) : null;

/** URL foto untuk server; unggah dulu kalau masih berkas di HP. */
const naikkan = async (f: NilaiFoto): Promise<string | null> =>
  f ? (f.berkas ? unggahFoto(new File([f.berkas], f.nama, { type: f.berkas.type || 'image/jpeg' })) : f.url) : null;

export function KlaimBaruClient({
  bahan,
  kembaliKe = '/backoffice/pelunasan',
  antreLuring = false,
  tombolKembali,
  awal = null,
}: {
  bahan: BahanKlaimBaru;
  /**
   * "Laporkan ulang": isi dari BKM yang ditolak atau dibatalkan. Toko, faktur,
   * dan potongan TIDAK ikut — justru itu yang biasanya salah.
   */
  awal?: AwalKlaim | null;
  /**
   * Pengganti tautan "Kembali ke daftar". Aplikasi HP memasang tombol kembalinya
   * sendiri, yang kembali ke halaman yang benar-benar dibuka sebelumnya.
   */
  tombolKembali?: ReactNode;
  /** Ke mana kembali setelah kirim — berbeda antara kantor dan lapangan. */
  kembaliKe?: string;
  /**
   * PWA lapangan: tanpa sinyal, laporan disimpan di HP dan terkirim otomatis
   * begitu sinyal kembali. Formulir kantor tidak memakainya.
   */
  antreLuring?: boolean;
}) {
  const t = useTranslations('payments');
  const tFoto = useTranslations('foto');
  const tPesan = useTranslations('pesanToko');
  /*
   * Sesudah BKM tercatat (bukan sesudah masuk antrean — yang di antrean belum
   * punya nomor): formulir berganti menjadi panel "Kirim tanda terima ke toko".
   * Tautannya disiapkan server dari BKM yang tersimpan, dan teksnya menyebut
   * pembayaran DITERIMA untuk diperiksa — tidak pernah lunas (Aturan 1).
   */
  const [terkirim, setTerkirim] = useState<{
    docNo: string;
    memuat: boolean;
    tautan: TautanPesanKlaim | null;
  } | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Kunci kiriman: SATU per formulir, dibuat saat dibuka. Dua ketukan kirim,
  // atau kiriman ulang dari antrean, tetap satu BKM di server.
  const [kunci] = useState(newLocalId);

  const [storeId, setStoreId] = useState('');
  const [tglTransfer, setTglTransfer] = useState(awal?.tglTransfer || hariIniWib());
  const [cara, setCara] = useState<(typeof CARA)[number]>(awal?.cara ?? 'transfer');
  const [dipilih, setDipilih] = useState<Record<string, number>>({});
  const [potongan, setPotongan] = useState<Potongan[]>([]);
  const [fotoTransfer, setFotoTransfer] = useState<NilaiFoto>(awal?.fotoTransfer ?? null);
  const [fotoRincian, setFotoRincian] = useState<NilaiFoto>(awal?.fotoRincian ?? null);
  // Rincian bilyet giro. Disimpan walau cara bayar diganti — orang yang salah
  // pilih lalu kembali ke giro tidak perlu mengetik ulang; yang dikirim hanya
  // saat caranya memang giro.
  const [giroNo, setGiroNo] = useState(awal?.giro?.nomor ?? '');
  const [giroBank, setGiroBank] = useState(awal?.giro?.bank ?? '');
  const [giroTerbit, setGiroTerbit] = useState(awal?.giro?.terbit || hariIniWib());
  const [giroEfektif, setGiroEfektif] = useState(awal?.giro?.efektif ?? '');

  const pakaiGiro = cara === 'giro';
  /*
   * Aturan yang SAMA dengan penulisnya (`periksaGiro`), supaya tanggal efektif
   * di luar masa berlaku 70 hari terlihat saat diketik, bukan setelah seluruh
   * formulir terkirim. Servernya tetap memeriksa ulang.
   */
  const cekGiro = periksaGiro({
    nomor: giroNo,
    bank: giroBank,
    tanggalTerbit: tanggalWib(giroTerbit),
    tanggalEfektif: tanggalWib(giroEfektif),
  });
  const batasEfektif = tambahHari(giroTerbit, MASA_BERLAKU_GIRO_HARI);
  const galatTanggalGiro =
    !cekGiro.ok &&
    (cekGiro.alasan === 'GIRO_EFEKTIF_SEBELUM_TERBIT' || cekGiro.alasan === 'GIRO_LEWAT_MASA_BERLAKU')
      ? cekGiro.alasan
      : null;

  const piutang = bahan.piutangPerToko[storeId] ?? [];
  const retur = bahan.returPerToko[storeId] ?? [];
  /*
   * Jenis khusus PKP dikunci begitu tokonya bukan PKP. Servernya sudah menolak
   * — dan penolakan itu tetap yang menjaga — tapi penolakan yang baru muncul
   * setelah seluruh formulir terisi membuat orang mengetik ulang semuanya untuk
   * kesalahan yang sudah bisa terlihat sejak jenisnya dipilih.
   *
   * DIKUNCI, bukan disembunyikan: kalau hilang, orang mengira jenisnya belum
   * dibuat dan pergi membuat duplikatnya di Pengaturan.
   */
  const tokoPkp = bahan.toko.find((t) => t.id === storeId)?.pkp ?? false;
  const jenis = bahan.jenisPotongan;
  const terkunci = (j: { hanyaPkp: boolean }) => j.hanyaPkp && !tokoPkp;

  const nilaiFaktur = useMemo(
    () => Object.values(dipilih).reduce((s, n) => s + (n || 0), 0),
    [dipilih],
  );
  const totalPotongan = useMemo(
    () => potongan.reduce((s, p) => s + (p.nilai || 0), 0),
    [potongan],
  );
  const diterima = nilaiFaktur - totalPotongan;

  const gantiToko = (id: string) => {
    // Faktur dan nota retur keduanya milik satu toko; membawanya lintas toko
    // akan ditolak penulis, jadi dibersihkan di sini.
    setStoreId(id);
    setDipilih({});
    setPotongan([]);
  };

  const alihkan = (p: { id: string; outstanding: number }) =>
    setDipilih((lama) => {
      const baru = { ...lama };
      if (baru[p.id] !== undefined) delete baru[p.id];
      else baru[p.id] = p.outstanding;
      return baru;
    });

  const simpan = () => {
    startTransition(async () => {
      const isi = {
        claimedTransferAt: tglTransfer,
        method: cara,
        giro: pakaiGiro
          ? { nomor: giroNo, bank: giroBank, tanggalTerbit: giroTerbit, tanggalEfektif: giroEfektif }
          : null,
        pelunasan: Object.entries(dipilih).map(([receivableId, nilai]) => ({ receivableId, nilai })),
        potongan: potongan.map((p) => ({
          nama: p.nama,
          nilai: p.nilai,
          deductionTypeId: p.deductionTypeId || null,
          storeReturnId: p.storeReturnId || null,
          catatan: p.catatan,
        })),
        // "Laporkan ulang": menautkan BKM baru ke yang digantikan (unik di basis data).
        menggantikanId: awal?.dariId ?? null,
      };

      const antrekan = async () => {
        await antreKlaim({
          localId: kunci,
          storeId,
          storeName: bahan.toko.find((x) => x.id === storeId)?.name ?? '',
          receivedAmount: diterima,
          payload: isi,
          fotoTransfer: keTertunda(fotoTransfer),
          fotoRincian: keTertunda(fotoRincian),
        });
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        toast.success(t('okClaimQueued'));
        router.replace(kembaliKe);
      };

      let hasil: Awaited<ReturnType<typeof buatKlaimAction>>;
      if (antreLuring) {
        if (!navigator.onLine) return antrekan();
        try {
          const [transferPhotoUrl, breakdownPhotoUrl] = await Promise.all([naikkan(fotoTransfer), naikkan(fotoRincian)]);
          hasil = await buatKlaimAction({ storeId, ...isi, transferPhotoUrl, breakdownPhotoUrl, idempotencyKey: kunci });
        } catch (err) {
          // Foto yang DITOLAK server (terlalu besar, bukan gambar) tidak akan
          // lolos di antrean juga — sampaikan sekarang. Selebihnya sinyal.
          if (nasibUnggah(err) === 'terminal') {
            toast.error(tFoto(`err${err instanceof Error ? err.message : 'GAGAL'}` as never));
            return;
          }
          return antrekan();
        }
      } else {
        hasil = await buatKlaimAction({
          storeId,
          ...isi,
          transferPhotoUrl: fotoTransfer?.url ?? null,
          breakdownPhotoUrl: fotoRincian?.url ?? null,
        });
      }
      if (hasil.ok) {
        toast.success(t('okClaimCreated', { doc: hasil.docNo }));
        const docNo = hasil.docNo;
        setTerkirim({ docNo, memuat: true, tautan: null });
        try {
          const p = await tautanPesanKlaimBaruAction(docNo);
          setTerkirim({ docNo, memuat: false, tautan: p.ok ? p.tautan : null });
        } catch {
          setTerkirim({ docNo, memuat: false, tautan: null });
        }
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  const bisaSimpan =
    !pending &&
    storeId !== '' &&
    Object.keys(dipilih).length > 0 &&
    nilaiFaktur > 0 &&
    diterima >= 0 &&
    fotoTransfer !== null &&
    (!pakaiGiro || cekGiro.ok) &&
    potongan.every((p) => p.nama.trim() && p.nilai > 0);

  /*
   * Kenapa tombol kirim masih mati, disebut dengan urutan formulirnya. Tombol
   * pucat tanpa keterangan membuat orang menebak isian mana yang kurang.
   * Nilai diterima yang minus sudah diterangkan di kartu ringkasan.
   */
  // Dengan id isiannya, supaya keterangan bisa diketuk dan menggulir ke sana —
  // formulir ini panjang, dan kotak foto wajib ada jauh di atas tombolnya.
  const kurang: { teks: string; ke: string } | null = pending
    ? null
    : !storeId
      ? { teks: t('needStore'), ke: 'bkm-toko' }
      : pakaiGiro && !cekGiro.ok
        ? { teks: t('needGiro'), ke: 'giro-no' }
        : Object.keys(dipilih).length === 0 || nilaiFaktur <= 0
          ? { teks: t('needInvoice'), ke: 'bkm-faktur' }
          : !potongan.every((p) => p.nama.trim() && p.nilai > 0)
            ? { teks: t('needDeduction'), ke: 'bkm-potongan' }
            : fotoTransfer === null
              ? { teks: t('needPhoto', { label: t(`photo_${cara}` as never) }), ke: 'bkm-foto-wajib' }
              : null;

  if (terkirim) {
    return (
      <div className="@container space-y-6">
        <PageHeader title={tPesan('terkirimJudul', { doc: terkirim.docNo })} />
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 py-4 @2xl:flex-row @2xl:flex-wrap @2xl:items-center">
            {terkirim.memuat ? (
              <p className="text-sm text-muted-foreground">{tPesan('memuat')}</p>
            ) : terkirim.tautan ? (
              <>
                {/* Hanya MEMBUKA WhatsApp dengan pesan terisi — pengirimnya tetap orangnya sendiri. */}
                <Button asChild className="w-full @2xl:w-auto">
                  <a href={terkirim.tautan.url} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                    {tPesan('kirimTandaTerima')}
                  </a>
                </Button>
                {!terkirim.tautan.adaNomor && (
                  <p className="text-xs text-muted-foreground @2xl:basis-full">{tPesan('tanpaNomor')}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{tPesan('gagal')}</p>
            )}
            <Button variant="outline" className="w-full @2xl:w-auto" onClick={() => router.replace(kembaliKe)}>
              {tPesan('kembali')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="@container space-y-6">
      {tombolKembali ?? (
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={kembaliKe}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t('backToList')}
          </Link>
        </Button>
      )}

      <PageHeader title={t('newTitle')} />

      {awal && (
        <p className="flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('salinan', { doc: awal.dariDocNo })}</span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionWho')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 @2xl:grid-cols-3">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="bkm-toko">{t('colStore')}</Label>
            <Select value={storeId} onValueChange={gantiToko}>
              <SelectTrigger id="bkm-toko" className="w-full">
                <SelectValue placeholder={t('storePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {bahan.toko.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="bkm-tgl">{t(`dateLabel_${cara}` as never)}</Label>
            <TanggalInput
              id="bkm-tgl"
              value={tglTransfer}
              onChange={(e) => setTglTransfer(e.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="bkm-cara">{t('method')}</Label>
            <Select value={cara} onValueChange={(v) => setCara(v as never)}>
              <SelectTrigger id="bkm-cara" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARA.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`method_${c}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {pakaiGiro && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sectionGiro')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 @2xl:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="giro-no">{t('giroNo')}</Label>
              <Input
                id="giro-no"
                value={giroNo}
                onChange={(e) => setGiroNo(e.target.value)}
                placeholder={t('giroNoPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="giro-bank">{t('giroBank')}</Label>
              <Input
                id="giro-bank"
                value={giroBank}
                onChange={(e) => setGiroBank(e.target.value)}
                placeholder={t('giroBankPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="giro-terbit">{t('giroIssueDate')}</Label>
              <TanggalInput
                id="giro-terbit"
                value={giroTerbit}
                onChange={(e) => setGiroTerbit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="giro-efektif">{t('giroEffectiveDate')}</Label>
              <TanggalInput
                id="giro-efektif"
                value={giroEfektif}
                min={giroTerbit || undefined}
                max={batasEfektif ?? undefined}
                aria-invalid={galatTanggalGiro !== null}
                aria-describedby="giro-efektif-petunjuk"
                onChange={(e) => setGiroEfektif(e.target.value)}
              />
              <p
                id="giro-efektif-petunjuk"
                className={cn('text-xs', galatTanggalGiro ? 'text-destructive' : 'text-muted-foreground')}
              >
                {galatTanggalGiro
                  ? t(`err${galatTanggalGiro}` as never)
                  : batasEfektif
                    ? t('giroEffectiveHint', { date: tanggal(tanggalWib(batasEfektif)?.toISOString() ?? '') })
                    : null}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card id="bkm-faktur" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="text-base">{t('sectionInvoices')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('sectionInvoicesHint')}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {piutang.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noOpenInvoices')}</p>
            ) : (
              piutang.map((p) => {
                const aktif = dipilih[p.id] !== undefined;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                      aktif && 'border-primary/50 bg-primary/[0.04]',
                    )}
                  >
                    <Checkbox checked={aktif} onCheckedChange={() => alihkan(p)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{p.invoiceNo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('dueOn', { date: tanggal(p.dueDate) })} · {t('outstanding', { value: rupiah(p.outstanding) })}
                      </span>
                    </span>
                    {aktif && (
                      <span className="w-40 space-y-1">
                        <span className="block text-xs text-muted-foreground">{t('settledAmount')}</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={p.outstanding}
                          value={dipilih[p.id]}
                          onChange={(e) =>
                            setDipilih((lama) => ({ ...lama, [p.id]: Number(e.target.value) }))
                          }
                        />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card id="bkm-potongan" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {t('sectionDeductions')}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPotongan((lama) => [
                    ...lama,
                    { nama: '', nilai: 0, deductionTypeId: '', storeReturnId: '', catatan: '' },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addDeduction')}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {potongan.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDeductions')}</p>
            ) : (
              potongan.map((p, i) => (
                /* Satu kotak per potongan, isiannya tersusun ke bawah: di kolom
                   selebar HP tiga isian sebaris saling menghimpit. */
                <div key={i} className="space-y-3 rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label htmlFor={`potongan-jenis-${i}`} className="text-xs font-normal text-muted-foreground">
                      {t('deductionName')}
                    </Label>
                    <div className="flex items-center gap-2">
                      {/*
                        Dipilih dari master, bukan diketik. Nama bebas membuat
                        "Retur barang" dan "retur brg" jadi dua hal berbeda, dan
                        laporan apa pun di atas potongan pecah.
                      */}
                      {jenis.length > 0 ? (
                        <Select
                          value={p.deductionTypeId || 'lainnya'}
                          onValueChange={(v) =>
                            setPotongan((lama) =>
                              lama.map((r, n) => {
                                if (n !== i) return r;
                                const dipilih = jenis.find((j) => j.id === v);
                                return {
                                  ...r,
                                  deductionTypeId: dipilih ? v : '',
                                  nama: dipilih ? dipilih.nama : r.nama,
                                };
                              }),
                            )
                          }
                        >
                          <SelectTrigger id={`potongan-jenis-${i}`} className="w-full min-w-0 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {jenis.map((j) => (
                              <SelectItem key={j.id} value={j.id} disabled={terkunci(j)}>
                                {j.nama}
                                {terkunci(j) && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    {t('pkpOnly')}
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                            <SelectItem value="lainnya">{t('deductionOther')}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`potongan-jenis-${i}`}
                          className="min-w-0 flex-1"
                          value={p.nama}
                          placeholder={t('deductionNamePlaceholder')}
                          onChange={(e) =>
                            setPotongan((lama) =>
                              lama.map((r, n) => (n === i ? { ...r, nama: e.target.value } : r)),
                            )
                          }
                        />
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        aria-label={t('removeDeduction')}
                        onClick={() => setPotongan((lama) => lama.filter((_, n) => n !== i))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {p.deductionTypeId === '' && jenis.length > 0 && (
                      <Input
                        aria-label={t('deductionName')}
                        value={p.nama}
                        placeholder={t('deductionNamePlaceholder')}
                        onChange={(e) =>
                          setPotongan((lama) =>
                            lama.map((r, n) => (n === i ? { ...r, nama: e.target.value } : r)),
                          )
                        }
                      />
                    )}
                  </div>
                  <div className="grid gap-3 @2xl:grid-cols-2">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={`potongan-nilai-${i}`} className="text-xs font-normal text-muted-foreground">
                        {t('deductionAmount')}
                      </Label>
                      <Input
                        id={`potongan-nilai-${i}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={p.nilai || ''}
                        placeholder="0"
                        onChange={(e) =>
                          setPotongan((lama) =>
                            lama.map((r, n) => (n === i ? { ...r, nilai: Number(e.target.value) } : r)),
                          )
                        }
                      />
                    </div>
                    {/* Tautan ke nota retur. INI yang membuat Aturan 2 bisa
                        bekerja: tanpa tautannya, potongan ini cuma pengurang
                        harga biasa dan tidak pernah ditahan. */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={`potongan-retur-${i}`} className="text-xs font-normal text-muted-foreground">
                        {t('deductionReturn')}
                      </Label>
                      <Select
                        value={p.storeReturnId || 'none'}
                        onValueChange={(v) =>
                          setPotongan((lama) =>
                            lama.map((r, n) =>
                              n === i ? { ...r, storeReturnId: v === 'none' ? '' : v } : r,
                            ),
                          )
                        }
                      >
                        <SelectTrigger id={`potongan-retur-${i}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('deductionNoReturn')}</SelectItem>
                          {retur.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.noNrt} · {rupiah(r.sisa)}
                              {r.sisa < r.nilaiKlaim && ` / ${rupiah(r.nilaiKlaim)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))
            )}
            {potongan.some((p) => p.storeReturnId) && (
              <p className="text-xs text-muted-foreground">{t('deductionReturnHint')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sectionProof')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 @2xl:grid-cols-2">
            {/* Buktinya berbeda per cara bayar: struk transfer, kuitansi yang
                ditandatangani toko, atau bilyet giro itu sendiri. Kolomnya
                satu — yang dicocokkan admin keuangan tetap satu foto. */}
            <div id="bkm-foto-wajib" className="scroll-mt-4">
            <UnggahFoto
              label={t(`photo_${cara}` as never)}
              petunjuk={t(`photoHint_${cara}` as never)}
              nilai={fotoTransfer}
              onChange={setFotoTransfer}
              wajib
              disabled={pending}
              simpanDiHp={antreLuring}
            />
            </div>
            <UnggahFoto
              label={t('breakdownPhoto')}
              petunjuk={t('breakdownPhotoHint')}
              nilai={fotoRincian}
              onChange={setFotoRincian}
              disabled={pending}
              simpanDiHp={antreLuring}
            />
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card className={cn('py-0', diterima < 0 && 'border-destructive/50')}>
          <CardContent className="space-y-2 py-4">
            <Baris label={t('totalInvoice')} value={rupiah(nilaiFaktur)} />
            <Baris label={t('totalDeduction')} value={`− ${rupiah(totalPotongan)}`} />
            <div className="flex items-baseline justify-between border-t pt-2">
              <span className="font-medium">{t('totalReceived')}</span>
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  diterima < 0 && 'text-destructive',
                )}
              >
                {rupiah(diterima)}
              </span>
            </div>
            {diterima < 0 && <p className="text-xs text-destructive">{t('negativeReceived')}</p>}
            <p className="text-xs text-muted-foreground">
              {pakaiGiro ? t('claimNotSettledGiro') : t('claimNotSettled')}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-stretch gap-2 @2xl:items-end">
        <Button className="w-full @2xl:w-auto" disabled={!bisaSimpan} onClick={simpan}>
          {t('saveClaim')}
        </Button>
        {!bisaSimpan && kurang && (
          <button
            type="button"
            className="text-center text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground @2xl:text-right"
            aria-live="polite"
            onClick={() => document.getElementById(kurang.ke)?.scrollIntoView({ block: 'center' })}
          >
            {kurang.teks}
          </button>
        )}
      </div>
    </div>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
