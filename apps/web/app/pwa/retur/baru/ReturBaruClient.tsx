'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeteranganKirim } from '../../KeteranganKirim';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { BacaNota } from '@/components/ocr/BacaNota';
import { catatReturTokoAction } from '@/app/actions/store-returns';
import { dinamis } from '@/lib/i18n/dinamis';
import { unggahFoto } from '@/lib/foto/unggah';
import { PERISTIWA_ANTREAN } from '@/lib/pwa/offline/hitung';
import { nasibUnggah } from '@/lib/pwa/offline/laporan-classify';
import { antreRetur } from '@/lib/pwa/offline/laporan-queue';
import { newLocalId } from '@/lib/pwa/offline/queue';

import { TautanKembali } from "@/app/pwa/TautanKembali";
import type { AwalRetur } from '@/lib/receivables/return-queries';
import { Copy } from 'lucide-react';
import { TanggalInput } from "@/components/ui/tanggal-input";
function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const KIRIM = ['SALES', 'TOKO', 'EKSPEDISI'] as const;

export function ReturBaruClient({
  toko,
  awal = null,
}: {
  toko: { id: string; name: string }[];
  /** "Laporkan ulang" dari nota yang dibatalkan. Toko TIDAK ikut — biasanya itu yang salah. */
  awal?: AwalRetur | null;
}) {
  const t = useTranslations('pwaRetur');
  const tFoto = useTranslations('foto');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Kunci kiriman: satu per formulir. Kiriman ulang dari antrean tidak
  // mencatat nota yang sama dua kali.
  const [kunci] = useState(newLocalId);

  const [noNrt, setNoNrt] = useState(awal?.noNrt ?? '');
  const [storeId, setStoreId] = useState('');
  const [tanggal, setTanggal] = useState(awal?.tanggal || hariIniWib());
  const [caraKirim, setCaraKirim] = useState<(typeof KIRIM)[number]>(awal?.caraKirim ?? 'SALES');
  const [nilai, setNilai] = useState(awal ? String(awal.nilai) : '');
  const [foto, setFoto] = useState<NilaiFoto>(awal?.foto ?? null);
  const [catatan, setCatatan] = useState('');

  const bisaKirim =
    !pending && noNrt.trim() !== '' && storeId !== '' && Number(nilai) > 0 && foto !== null;
  const kurang = pending
    ? null
    : foto === null
      ? t('kurangFoto')
      : noNrt.trim() === ''
        ? t('kurangNomor')
        : storeId === ''
          ? t('kurangToko')
          : !(Number(nilai) > 0)
            ? t('kurangNilai')
            : null;

  const kirim = () => {
    startTransition(async () => {
      const isi = {
        noNrt,
        claimDate: tanggal,
        deliveryMethod: caraKirim,
        claimedAmount: Number(nilai),
        note: catatan,
        menggantikanId: awal?.dariId ?? null,
      };

      // Tanpa sinyal: simpan di HP, terkirim otomatis begitu sinyal kembali.
      const antrekan = async () => {
        await antreRetur({
          localId: kunci,
          storeId,
          storeName: toko.find((s) => s.id === storeId)?.name ?? '',
          payload: isi,
          foto: foto ? (foto.berkas ? { nama: foto.nama, blob: foto.berkas } : { nama: foto.nama, url: foto.url }) : null,
        });
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        toast.success(t('okQueued'));
        router.replace('/pwa/retur');
      };

      if (!navigator.onLine) return antrekan();
      let hasil: Awaited<ReturnType<typeof catatReturTokoAction>>;
      try {
        const photoUrl = foto
          ? foto.berkas
            ? await unggahFoto(new File([foto.berkas], foto.nama, { type: foto.berkas.type || 'image/jpeg' }))
            : foto.url
          : null;
        hasil = await catatReturTokoAction({ storeId, ...isi, photoUrl, idempotencyKey: kunci });
      } catch (err) {
        // Foto yang DITOLAK server tidak akan lolos di antrean juga.
        if (nasibUnggah(err) === 'terminal') {
          toast.error(tFoto(`err${err instanceof Error ? err.message : 'GAGAL'}` as never));
          return;
        }
        return antrekan();
      }
      if (!hasil.ok) {
        toast.error(td(`err${hasil.kode}`));
        return;
      }
      toast.success(t('okCreated'));
      router.replace('/pwa/retur');
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/retur" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('newBody')}</p>
      </header>

      {awal && (
        <p className="flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('salinan', { doc: awal.dariNoNrt })}</span>
        </p>
      )}

      <Card className="py-0">
        <CardContent className="space-y-4 py-4">
          {/* Foto didahulukan: inilah pekerjaan sebenarnya di lapangan, dan
              sisanya disalin dari yang terlihat di foto itu. */}
          <UnggahFoto
            label={t('photoLabel')}
            petunjuk={t('photoHint')}
            nilai={foto}
            onChange={setFoto}
            wajib
            disabled={pending}
            simpanDiHp
          />

          {/* Fotonya sudah diambil; membaca angkanya dari situ menghemat tiga
              hal yang paling sering salah ketik di HP: nomor, tanggal, total. */}
          {/* Membaca nota butuh fotonya di server; foto yang masih di HP
              (tanpa sinyal) dilewati — angkanya diketik tangan. */}
          <BacaNota
            fotoUrl={foto && !foto.berkas ? foto.url : null}
            disabled={pending}
            onTotal={(n) => setNilai(String(n))}
            onNomor={(no) => setNoNrt((lama) => (lama.trim() === '' ? no : lama))}
            onTanggal={(tgl) => setTanggal((lama) => (lama === hariIniWib() ? tgl : lama))}
          />

          <div className="space-y-2">
            <Label htmlFor="r-no">{t('noNrt')}</Label>
            <Input
              id="r-no"
              value={noNrt}
              onChange={(e) => setNoNrt(e.target.value)}
              placeholder={t('noNrtPlaceholder')}
              inputMode="text"
            />
            <p className="text-xs text-muted-foreground">{t('noNrtHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-toko">{t('store')}</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger id="r-toko" className="w-full">
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

          <div className="space-y-2">
            <Label htmlFor="r-nilai">{t('amount')}</Label>
            <Input
              id="r-nilai"
              type="number"
              inputMode="numeric"
              min={1}
              value={nilai}
              onChange={(e) => setNilai(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-tgl">{t('claimDate')}</Label>
            <TanggalInput
              id="r-tgl"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-kirim">{t('deliveryMethod')}</Label>
            <Select value={caraKirim} onValueChange={(v) => setCaraKirim(v as never)}>
              <SelectTrigger id="r-kirim" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIRIM.map((k) => (
                  <SelectItem key={k} value={k}>
                    {td(`via${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-catatan">{t('noteLabel')}</Label>
            <Textarea
              id="r-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" disabled={!bisaKirim} onClick={kirim}>
        {t('send')}
      </Button>
      <KeteranganKirim teks={kurang} />
    </div>
  );
}
