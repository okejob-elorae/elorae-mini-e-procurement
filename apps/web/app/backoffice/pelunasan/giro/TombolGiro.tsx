'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import { putuskanGiroAction } from '@/app/actions/receivables';

/**
 * Dua keputusan atas bilyet giro yang menunggu: cair, atau ditolak bank.
 *
 * Satu komponen untuk tiga layar (Daftar giro, daftar pelunasan, rincian BKM)
 * supaya ketiganya meminta konfirmasi dan alasan dengan cara yang sama — dua
 * salinan dialog uang akan menyimpang, lalu satu layar mengizinkan yang lain
 * tolak.
 *
 * "Cair" meminta konfirmasi karena ia mengurangi piutang: menekannya adalah
 * pernyataan bahwa uangnya sudah ada di rekening.
 */
export function TombolGiro({
  claimId,
  giroNo,
  nilai,
  susun = false,
}: {
  claimId: string;
  giroNo: string;
  /** Nilai giro yang sudah diformat, untuk kalimat konfirmasi. */
  nilai: string;
  /** Tumpuk tombolnya (kolom tindakan tabel yang sempit). */
  susun?: boolean;
}) {
  const t = useTranslations('giro');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cairTerbuka, setCairTerbuka] = useState(false);
  const [tolakTerbuka, setTolakTerbuka] = useState(false);
  const [alasan, setAlasan] = useState('');

  const putuskan = (hasil: 'CAIR' | 'DITOLAK', catatan?: string) => {
    startTransition(async () => {
      const r = await putuskanGiroAction(claimId, hasil, catatan);
      if (r.ok) {
        toast.success(hasil === 'CAIR' ? t('okCleared') : t('okBounced'));
        setCairTerbuka(false);
        setTolakTerbuka(false);
        setAlasan('');
        router.refresh();
      } else {
        toast.error(td(`err${r.kode}`));
      }
    });
  };

  return (
    <>
      <span className={cn('inline-flex gap-1', susun ? 'flex-col items-end' : 'flex-wrap')}>
        <Button size="sm" disabled={pending} onClick={() => setCairTerbuka(true)}>
          <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
          {t('clear')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setAlasan('');
            setTolakTerbuka(true);
          }}
        >
          {t('bounce')}
        </Button>
      </span>

      <AlertDialog open={cairTerbuka} onOpenChange={setCairTerbuka}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clearTitle', { no: giroNo })}</AlertDialogTitle>
            <AlertDialogDescription>{t('clearBody', { value: nilai })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                // Tetap terbuka sampai servernya menjawab; ditutup oleh `putuskan`.
                e.preventDefault();
                putuskan('CAIR');
              }}
            >
              {t('clearConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={tolakTerbuka} onOpenChange={setTolakTerbuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bounceTitle', { no: giroNo })}</DialogTitle>
            <DialogDescription>{t('bounceBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`giro-tolak-${claimId}`}>{t('bounceReason')}</Label>
            <Textarea
              id={`giro-tolak-${claimId}`}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('bouncePlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasan.trim().length === 0}
              onClick={() => putuskan('DITOLAK', alasan)}
            >
              {t('bounce')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
