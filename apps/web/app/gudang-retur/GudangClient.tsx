'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Camera, PackageOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { catatHitunganGudangAction } from '@/app/actions/store-returns';
import { dinamis } from '@/lib/i18n/dinamis';

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

type Baris = {
  id: string;
  noNrt: string;
  storeName: string;
  tanggal: string;
  nilaiKlaim: number;
  caraKirim: string;
  adaFoto: boolean;
};

export function GudangClient({ baris }: { baris: Baris[] }) {
  const t = useTranslations('pwaGudang');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dipilih, setDipilih] = useState<Baris | null>(null);
  const [nilai, setNilai] = useState('');
  const [catatan, setCatatan] = useState('');

  const simpan = () => {
    if (!dipilih) return;
    startTransition(async () => {
      const hasil = await catatHitunganGudangAction({
        storeReturnId: dipilih.id,
        receivedAt: hariIniWib(),
        deliveryMethod: dipilih.caraKirim as 'SALES' | 'TOKO' | 'EKSPEDISI',
        physicalAmount: Number(nilai),
        note: catatan,
      });
      if (!hasil.ok) {
        toast.error(td(`err${hasil.kode}`));
        return;
      }
      toast.success(t('okCounted'));
      setDipilih(null);
      setNilai('');
      setCatatan('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('summary', { count: baris.length })}</p>
      </header>

      {baris.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="anim-stagger space-y-3">
          {baris.map((b) => (
            <Card key={b.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{b.noNrt}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.storeName} · {tanggal(b.tanggal)} · {td(`via${b.caraKirim}`)}
                      {b.adaFoto && <Camera className="ml-1 inline h-3 w-3 align-[-1px]" />}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">{t('claimed')}</span>
                    <span className="block font-bold tabular-nums">{rupiah(b.nilaiKlaim)}</span>
                  </span>
                </div>
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    setDipilih(b);
                    setNilai('');
                    setCatatan('');
                  }}
                >
                  {t('count')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dipilih !== null} onOpenChange={(o) => !o && setDipilih(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('countTitle')}</DialogTitle>
            <DialogDescription>
              {dipilih &&
                t('countBody', { doc: dipilih.noNrt, claimed: rupiah(dipilih.nilaiKlaim) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="g-nilai">{t('countedAmount')}</Label>
              <Input
                id="g-nilai"
                type="number"
                inputMode="numeric"
                min={0}
                value={nilai}
                onChange={(e) => setNilai(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('countHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-catatan">{t('noteLabel')}</Label>
              <Textarea
                id="g-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending || nilai === '' || Number(nilai) < 0} onClick={simpan}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
