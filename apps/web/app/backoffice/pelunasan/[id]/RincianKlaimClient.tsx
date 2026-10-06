'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, BadgeCheck, ImageOff, Landmark, Link2, MessageCircle, MessageSquareWarning, Printer, RotateCcw } from 'lucide-react';
import { RiwayatDokumen } from '@/components/receivables/RiwayatDokumen';
import type { BarisRiwayat } from '@/lib/receivables/koreksi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { dinamis } from '@/lib/i18n/dinamis';
import {
  batalkanKlaimAction,
  tautkanUlangPotonganAction,
  verifikasiKlaimAction,
} from '@/app/actions/receivables';
import type { RincianKlaim } from '@/lib/receivables/claim-queries';
import type { StatusGiro } from '@/lib/receivables/giro';
import { TombolGiro } from '../giro/TombolGiro';
import { kunciGalatPutusan, tombolPutusan } from './putusan-klaim';

/** Rincian bilyet giro sebuah BKM; tanggal sudah diformat di server. */
export type GiroKlaim = {
  nomor: string;
  bank: string;
  terbit: string;
  efektif: string;
  status: StatusGiro;
  cairPada: string | null;
  /** Masa berlaku 70 hari sudah habis sementara giro masih menunggu. */
  kedaluwarsa: boolean;
};

const NADA_GIRO: Record<StatusGiro, StatusTone> = {
  MENUNGGU: 'waiting',
  CAIR: 'settled',
  DITOLAK: 'attention',
};

/** Cara bayar yang punya label bukti sendiri; yang lain dibaca sebagai transfer. */
const CARA_DIKENAL = ['transfer', 'tunai', 'giro'];

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const NADA: Record<RincianKlaim['status'], StatusTone> = {
  DIKIRIM: 'waiting',
  TERVERIFIKASI: 'settled',
  DITOLAK: 'inactive',
  DIBATALKAN: 'inactive',
};

export function RincianKlaimClient({
  data,
  giro,
  bolehMemutuskan,
  bolehMembuat = false,
  konfirmasiToko = null,
  digantiOleh = null,
  menggantikan = null,
  koreksi = null,
  riwayat = [],
  pemeriksaSama = false,
}: {
  data: RincianKlaim;
  /** `null` kalau klaim ini bukan giro. */
  giro: GiroKlaim | null;
  bolehMemutuskan: boolean;
  /** Boleh membuat BKM dari kantor — untuk "Buat ulang" dari BKM yang ditolak/dibatalkan. */
  bolehMembuat?: boolean;
  /** BKM pengganti, kalau BKM yang ditolak/dibatalkan ini sudah dibuat ulang. */
  digantiOleh?: { id: string; nomor: string } | null;
  /** BKM yang digantikan BKM ini. */
  menggantikan?: { id: string; nomor: string } | null;
  /** Permintaan koreksi dari sales yang belum ditangani. */
  koreksi?: { pada: string; alasan: string } | null;
  riwayat?: BarisRiwayat[];
  /** Tautan WhatsApp konfirmasi ke toko; hanya ada sesudah klaim terverifikasi. */
  konfirmasiToko?: { url: string; adaNomor: boolean } | null;
  /**
   * Penonton adalah pelapor atau pencatat BKM ini (`pemeriksaSamaKlaim`, dihitung
   * di server dari sesi). Tombol putusan tetap tampil tapi mati dengan alasannya.
   */
  pemeriksaSama?: boolean;
}) {
  const t = useTranslations('payments');
  const tPesan = useTranslations('pesanToko');
  const td = dinamis(t);
  const tGiro = dinamis(useTranslations('giro'));
  const cara = CARA_DIKENAL.includes(data.method) ? data.method : 'transfer';
  // Giro yang menunggu diputuskan lewat bilyetnya (cair / ditolak bank), bukan
  // lewat tombol verifikasi mutasi — penulisnya pun menolak jalan biasa.
  const giroMenunggu = data.status === 'DIKIRIM' && giro?.status === 'MENUNGGU';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tolakTerbuka, setTolakTerbuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [batalTerbuka, setBatalTerbuka] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState('');
  const [tautUlang, setTautUlang] = useState<{ id: string; nama: string } | null>(null);
  const [returBaru, setReturBaru] = useState<string>('none');
  const [alasanTaut, setAlasanTaut] = useState('');
  // Jawaban PEMERIKSA_SAMA dari server juga mematikan tombol, tanpa muat ulang.
  const [pemeriksaSamaDariServer, setPemeriksaSamaDariServer] = useState(false);
  const tombol = tombolPutusan({
    status: data.status,
    bolehMemutuskan,
    giroMenunggu,
    pemeriksaSama: pemeriksaSama || pemeriksaSamaDariServer,
  });

  const adaMenggantung = data.potongan.some((p) => p.tautanMenggantung);

  const putuskan = (keputusan: 'TERVERIFIKASI' | 'DITOLAK', catatan?: string) => {
    startTransition(async () => {
      const hasil = await verifikasiKlaimAction(data.id, keputusan, catatan);
      if (hasil.ok) {
        toast.success(keputusan === 'TERVERIFIKASI' ? t('okVerified') : t('okRejected'));
        setTolakTerbuka(false);
        router.refresh();
      } else {
        if (hasil.kode === 'PEMERIKSA_SAMA') setPemeriksaSamaDariServer(true);
        toast.error(t(kunciGalatPutusan(hasil.kode, keputusan) as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/pelunasan">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader
        title={data.docNo}
        meta={
          <>
            <span className="block">
              {[
                data.storeName,
                data.salesmanName,
                t(`method_${data.method}` as never),
                t('claimedOn', { date: tanggal(data.claimedTransferAt) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="mt-1 inline-flex">
              <StatusPill tone={NADA[data.status]}>{t(`status${data.status}` as never)}</StatusPill>
            </span>
          </>
        }
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={`/print/bkm/${data.id}`} target="_blank" rel="noreferrer">
                <Printer className="mr-1.5 h-4 w-4" />
                {t('print')}
              </a>
            </Button>
            {konfirmasiToko && (
              /* Hanya MEMBUKA WhatsApp dengan pesan terisi — admin sendiri yang menekan kirim. */
              <Button
                variant="outline"
                asChild
                title={konfirmasiToko.adaNomor ? tPesan('konfirmasiPetunjuk') : tPesan('tanpaNomor')}
              >
                <a href={konfirmasiToko.url} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  {tPesan('kirimKonfirmasi')}
                </a>
              </Button>
            )}
            {/*
              Membatalkan tersedia di keadaan APA PUN, termasuk yang sudah
              terverifikasi. Klaim yang salah catat tidak berhenti salah hanya
              karena sudah sempat disahkan — dan sebelum ini satu-satunya jalan
              keluar adalah "menolak", yang artinya lain sama sekali.
            */}
            {/* Salah toko atau salah faktur tidak dibetulkan di tempat: BKM baru
                dibuat dari salinan ini (tanggal, cara bayar, giro, foto ikut). */}
            {(data.status === 'DIBATALKAN' || data.status === 'DITOLAK') && bolehMembuat && !digantiOleh && (
              <Button variant="outline" asChild>
                <Link href={`/backoffice/pelunasan/baru?salin=${data.id}`}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {t('remake')}
                </Link>
              </Button>
            )}
            {data.status !== 'DIBATALKAN' && bolehMemutuskan && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setBatalTerbuka(true);
                  setAlasanBatal('');
                }}
              >
                {t('void')}
              </Button>
            )}
            {tombol.tampil && (
              <>
              <Button
                disabled={pending || tombol.alasanNonaktif !== null}
                title={tombol.alasanNonaktif === 'PEMERIKSA_SAMA' ? t('errPEMERIKSA_SAMA') : undefined}
                onClick={() => putuskan('TERVERIFIKASI')}
              >
                <BadgeCheck className="mr-1.5 h-4 w-4" />
                {t('verify')}
              </Button>
              <Button
                variant="outline"
                disabled={pending || tombol.alasanNonaktif !== null}
                title={tombol.alasanNonaktif === 'PEMERIKSA_SAMA' ? t('errPEMERIKSA_SAMA') : undefined}
                onClick={() => {
                  setTolakTerbuka(true);
                  setAlasan('');
                }}
              >
                {t('reject')}
              </Button>
              </>
            )}
          </span>
        }
      />

      {/* Alasan tombol putusan mati — di bawah judul, bukan di kolom tombol:
          kolom tombol tidak menyusut, jadi kalimat panjang di sana menjepit judul. */}
      {tombol.alasanNonaktif === 'PEMERIKSA_SAMA' && (
        <p className="text-sm text-muted-foreground">{t('errPEMERIKSA_SAMA')}</p>
      )}

      {/* Sales tidak bisa lagi mengubah BKM yang sudah diproses — permintaannya
          tampil di dokumennya sendiri, bukan hanya di lonceng. */}
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
              <Link href={`/backoffice/pelunasan/${menggantikan.id}`} className="font-medium underline underline-offset-4">
                {menggantikan.nomor}
              </Link>
            </span>
          )}
          {digantiOleh && (
            <span className="block">
              {t('replacedBy')}{' '}
              <Link href={`/backoffice/pelunasan/${digantiOleh.id}`} className="font-medium underline underline-offset-4">
                {digantiOleh.nomor}
              </Link>
            </span>
          )}
        </p>
      )}

      {adaMenggantung && (
        <Card className="border-destructive/40 bg-destructive/[0.05]">
          <CardContent className="flex items-start gap-3 py-4 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{t('danglingWarning')}</span>
          </CardContent>
        </Card>
      )}

      {giro && (
        <Card className={cn(giro.kedaluwarsa && 'border-destructive/40')}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Landmark className="h-4 w-4" />
              {tGiro('cardTitle')}
              <StatusPill tone={giro.kedaluwarsa ? 'attention' : NADA_GIRO[giro.status]}>
                {tGiro(`status_${giro.status}`)}
              </StatusPill>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <Isian label={tGiro('fieldNo')} nilai={giro.nomor} />
              <Isian label={tGiro('fieldBank')} nilai={giro.bank} />
              <Isian label={tGiro('fieldIssued')} nilai={giro.terbit} />
              <Isian label={tGiro('fieldEffective')} nilai={giro.efektif} />
            </dl>
            {giro.kedaluwarsa && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {tGiro('expired')}
              </p>
            )}
            {giro.status === 'CAIR' && giro.cairPada && (
              <p className="text-sm text-muted-foreground">{tGiro('clearedOn', { date: giro.cairPada })}</p>
            )}
            {giroMenunggu && bolehMemutuskan && (
              <TombolGiro
                claimId={data.id}
                giroNo={giro.nomor}
                nilai={rupiah(data.nilaiDiterima)}
                pemeriksaSama={pemeriksaSama || pemeriksaSamaDariServer}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Dua bukti berdampingan — inilah yang dicocokkan admin dengan mutasi. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('sectionProof')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Bukti
            label={td(`photo_${cara}`)}
            url={data.fotoTransfer}
            kosong={td(`noPhoto_${cara}`)}
          />
          <Bukti label={t('breakdownPhoto')} url={data.fotoRincian} kosong={t('noPhotoBreakdown')} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionInvoices')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colInvoiceNo')}</TableHead>
                  <TableHead className="text-right">{t('colInvoiceValue')}</TableHead>
                  <TableHead className="text-right">{t('colSettled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.faktur.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.invoiceNo}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rupiah(f.nilaiFaktur)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {rupiah(f.nilaiDilunasi)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionDeductions')}</CardTitle>
          </CardHeader>
          <CardContent className={data.potongan.length === 0 ? undefined : 'px-0'}>
            {data.potongan.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDeductions')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('deductionName')}</TableHead>
                    <TableHead className="text-right">{t('deductionAmount')}</TableHead>
                    <TableHead className="text-right">{t('colHeld')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.potongan.map((p, i) => (
                    <TableRow key={i} className={cn(p.tertahan > 0 && 'bg-destructive/[0.06]')}>
                      <TableCell>
                        <span className="font-medium">{p.nama}</span>
                        {p.noNrt && (
                          <Link
                            href={`/backoffice/retur-toko/${p.storeReturnId}`}
                            className="block text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {p.noNrt}
                          </Link>
                        )}
                        {p.tautanMenggantung && (
                          <span className="block text-xs font-medium text-destructive">
                            {t('danglingRow')}
                          </span>
                        )}
                        {p.catatan && (
                          <span className="block text-xs text-muted-foreground">{p.catatan}</span>
                        )}
                        {bolehMemutuskan && data.status !== 'DIBATALKAN' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-1 h-7 px-2 text-xs"
                            disabled={pending}
                            onClick={() => {
                              setTautUlang({ id: p.id, nama: p.nama });
                              setReturBaru(p.storeReturnId ?? 'none');
                              setAlasanTaut('');
                            }}
                          >
                            <Link2 className="mr-1 h-3 w-3" />
                            {t('relink')}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(p.nilai)}</TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          p.tertahan > 0 && 'font-semibold text-destructive',
                        )}
                      >
                        {p.tertahan > 0 ? rupiah(p.tertahan) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card
        className={cn(
          data.status === 'TERVERIFIKASI' && data.nilaiTertahan > 0 && 'border-destructive/40',
        )}
      >
        <CardContent className="space-y-2 py-4">
          <Baris label={t('totalInvoice')} value={rupiah(data.nilaiFaktur)} />
          <Baris label={t('totalDeduction')} value={`− ${rupiah(data.totalPotongan)}`} />
          <div className="flex items-baseline justify-between border-t pt-2">
            <span className="font-medium">{t('totalReceived')}</span>
            <span className="text-lg font-semibold tabular-nums">{rupiah(data.nilaiDiterima)}</span>
          </div>

          {data.status === 'DIKIRIM' && (
            <p className="text-xs text-muted-foreground">
              {giroMenunggu ? t('claimNotSettledGiro') : t('claimNotSettled')}
            </p>
          )}
          {data.status === 'TERVERIFIKASI' && data.nilaiTertahan > 0 && (
            <p className="text-sm text-destructive">
              {t('heldExplain', { value: rupiah(data.nilaiTertahan) })}
            </p>
          )}
          {data.status !== 'DIKIRIM' && data.verifikatorNama && (
            <p className="text-xs text-muted-foreground">
              {t(data.ditarikSales ? 'withdrawnBySales' : 'decidedBy', {
                name: data.verifikatorNama,
                date: data.verifikasiPada ? tanggal(data.verifikasiPada) : '—',
              })}
            </p>
          )}
          {data.catatanVerifikasi && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">{data.catatanVerifikasi}</p>
          )}
        </CardContent>
      </Card>

      <RiwayatDokumen baris={riwayat} />

      <Dialog open={batalTerbuka} onOpenChange={setBatalTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('voidTitle')}</DialogTitle>
            <DialogDescription>{t('voidBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-batal">{t('voidReason')}</Label>
            <Textarea
              id="alasan-batal"
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              placeholder={t('voidPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasanBatal.trim().length === 0}
              onClick={() =>
                startTransition(async () => {
                  const hasil = await batalkanKlaimAction(data.id, alasanBatal);
                  if (hasil.ok) {
                    toast.success(t('okVoided'));
                    setBatalTerbuka(false);
                    router.refresh();
                  } else {
                    toast.error(td(`err${hasil.kode}`));
                  }
                })
              }
            >
              {t('void')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tautUlang !== null} onOpenChange={(o) => !o && setTautUlang(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('relinkTitle')}</DialogTitle>
            <DialogDescription>
              {tautUlang && t('relinkBody', { nama: tautUlang.nama })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="taut-nota">{t('deductionReturn')}</Label>
              <Select value={returBaru} onValueChange={setReturBaru}>
                <SelectTrigger id="taut-nota">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('deductionNoReturn')}</SelectItem>
                  {data.returToko.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.noNrt} · {rupiah(r.sisa)}
                      {r.sisa < r.nilaiKlaim && ` / ${rupiah(r.nilaiKlaim)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="taut-alasan">{t('relinkReason')}</Label>
              <Textarea
                id="taut-alasan"
                value={alasanTaut}
                onChange={(e) => setAlasanTaut(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || alasanTaut.trim().length === 0}
              onClick={() =>
                tautUlang &&
                startTransition(async () => {
                  const hasil = await tautkanUlangPotonganAction(
                    tautUlang.id,
                    returBaru === 'none' ? null : returBaru,
                    alasanTaut,
                  );
                  if (hasil.ok) {
                    toast.success(t('okRelinked'));
                    setTautUlang(null);
                    router.refresh();
                  } else {
                    toast.error(td(`err${hasil.kode}`));
                  }
                })
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tolakTerbuka} onOpenChange={setTolakTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectTitle')}</DialogTitle>
            <DialogDescription>{t('rejectBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-tolak">{t('rejectReason')}</Label>
            <Textarea
              id="alasan-tolak"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('rejectPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasan.trim().length === 0}
              onClick={() => putuskan('DITOLAK', alasan)}
            >
              {t('reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bukti({ label, url, kosong }: { label: string; url: string | null; kosong: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="max-h-96 w-full rounded-lg border object-contain transition-opacity hover:opacity-90"
          />
        </a>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <ImageOff className="h-4 w-4 shrink-0" />
          {kosong}
        </div>
      )}
    </div>
  );
}

function Isian({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{nilai}</dd>
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
