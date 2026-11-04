'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { putuskanGRNPemilik } from '@/app/actions/grn';

/**
 * Setuju / tolak GRN terima-lebih oleh pemilik — tab Penerimaan Barang dan
 * rincian GRN. Dulu "Tolak" memakai `window.confirm` bawaan peramban dan
 * galatnya ditampilkan dari `err.message` (disamarkan di build produksi);
 * sekarang keduanya lewat dialog aplikasi dan penolakan datang sebagai kode.
 */
export function KeputusanPemilikGrn({
  grnId,
  docNumber,
  onSelesai,
}: {
  grnId: string;
  docNumber: string;
  onSelesai: () => void | Promise<void>;
}) {
  const t = useTranslations('inventory.grnPemilik');
  const tUmum = useTranslations('common');
  const [dialog, setDialog] = useState<'setuju' | 'tolak' | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const jalankan = async (keputusan: 'setuju' | 'tolak') => {
    setSibuk(true);
    try {
      const hasil = await putuskanGRNPemilik(grnId, keputusan);
      if (hasil.ok) {
        toast.success(keputusan === 'setuju' ? t('disetujuiToast') : t('ditolakToast'));
      } else {
        toast.error(t(`err.${hasil.code}`));
      }
      await onSelesai();
    } catch {
      toast.error(t('err.GAGAL'));
    } finally {
      setSibuk(false);
      setDialog(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={sibuk} onClick={() => setDialog('setuju')}>
          {sibuk && dialog === 'setuju' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('setujui')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={sibuk}
          onClick={() => setDialog('tolak')}
        >
          {sibuk && dialog === 'tolak' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('tolak')}
        </Button>
      </div>
      <AlertDialog open={dialog !== null} onOpenChange={(buka) => !buka && !sibuk && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === 'tolak' ? t('tolakJudul', { doc: docNumber }) : t('setujuJudul', { doc: docNumber })}
            </AlertDialogTitle>
            <AlertDialogDescription>{dialog === 'tolak' ? t('tolakIsi') : t('setujuIsi')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{tUmum('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={dialog === 'tolak' ? 'destructive' : 'default'}
              disabled={sibuk}
              onClick={(e) => {
                // Dialog tetap terbuka sampai keputusan tersimpan.
                e.preventDefault();
                if (dialog) void jalankan(dialog);
              }}
            >
              {sibuk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialog === 'tolak' ? t('tolak') : t('setujui')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
