'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
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

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const KIRIM = ['SALES', 'TOKO', 'EKSPEDISI'] as const;

export function ReturBaruClient({ toko }: { toko: { id: string; name: string }[] }) {
  const t = useTranslations('pwaRetur');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [noNrt, setNoNrt] = useState('');
  const [storeId, setStoreId] = useState('');
  const [tanggal, setTanggal] = useState(hariIniWib());
  const [caraKirim, setCaraKirim] = useState<(typeof KIRIM)[number]>('SALES');
  const [nilai, setNilai] = useState('');
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState('');

  const bisaKirim =
    !pending && noNrt.trim() !== '' && storeId !== '' && Number(nilai) > 0 && foto !== null;

  const kirim = () => {
    startTransition(async () => {
      const hasil = await catatReturTokoAction({
        noNrt,
        storeId,
        claimDate: tanggal,
        deliveryMethod: caraKirim,
        claimedAmount: Number(nilai),
        photoUrl: foto?.url ?? null,
        note: catatan,
      });
      if (!hasil.ok) {
        toast.error(td(`err${hasil.kode}`));
        return;
      }
      toast.success(t('okCreated'));
      router.push('/pwa/retur');
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/pwa/retur">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('back')}
        </Link>
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('newBody')}</p>
      </header>

      <Card>
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
          />

          {/* Fotonya sudah diambil; membaca angkanya dari situ menghemat tiga
              hal yang paling sering salah ketik di HP: nomor, tanggal, total. */}
          <BacaNota
            fotoUrl={foto?.url ?? null}
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
              <SelectTrigger id="r-toko">
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
            <Input
              id="r-tgl"
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-kirim">{t('deliveryMethod')}</Label>
            <Select value={caraKirim} onValueChange={(v) => setCaraKirim(v as never)}>
              <SelectTrigger id="r-kirim">
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
    </div>
  );
}
