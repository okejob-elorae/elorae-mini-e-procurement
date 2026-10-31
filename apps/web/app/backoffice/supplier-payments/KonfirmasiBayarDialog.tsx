'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { TanggalInput } from '@/components/ui/tanggal-input';
import { hariIniWib } from '@/lib/tanggal-isian';
import { tanggalBayarDariIsian } from './tanggal-bayar';

export type PoUntukKonfirmasiBayar = {
  docNumber: string;
  supplierName: string;
  grandTotal: number;
  /** Utang barang yang sudah diterima (harga PO, sesudah kredit retur). */
  utangDiterima: number;
  /** Sisa nilai PO yang barangnya belum datang. */
  komitmen: number;
  adaPenerimaan: boolean;
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

/**
 * Konfirmasi "Tandai lunas" / "Batalkan tanda lunas" — register pembayaran
 * pemasok dan rincian PO. Dulu satu klik langsung memposting jurnal, bahkan
 * untuk PO yang barangnya belum diterima sama sekali. Sekarang: tanggal bayar
 * (jurnal diberi tanggal itu, tidak boleh sesudah hari ini), nilai, dan
 * peringatan bila belum/tidak seluruh barang diterima.
 */
export function KonfirmasiBayarDialog({
  open,
  onOpenChange,
  arah,
  po,
  sibuk,
  onKonfirmasi,
}: {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  arah: 'bayar' | 'batal';
  po: PoUntukKonfirmasiBayar | null;
  sibuk: boolean;
  onKonfirmasi: (paidAt: Date | null) => void | Promise<void>;
}) {
  const t = useTranslations('supplierPayments.konfirmasi');
  const tUmum = useTranslations('common');
  const hariIni = hariIniWib();
  const [tanggal, setTanggal] = useState(hariIni);
  // Setiap kali dialog dibuka, tanggal kembali ke hari ini (bukan pilihan PO sebelumnya).
  const [bukaSebelum, setBukaSebelum] = useState(open);
  if (open !== bukaSebelum) {
    setBukaSebelum(open);
    if (open) setTanggal(hariIni);
  }
  const paidAt = arah === 'bayar' ? tanggalBayarDariIsian(tanggal) : null;
  const tanggalSalah = arah === 'bayar' && paidAt == null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(buka) => {
        if (sibuk) return;
        onOpenChange(buka);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {arah === 'bayar' ? t('judulBayar', { doc: po?.docNumber ?? '' }) : t('judulBatal', { doc: po?.docNumber ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{arah === 'bayar' ? t('isiBayar') : t('isiBatal')}</AlertDialogDescription>
        </AlertDialogHeader>

        {po && (
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('pemasok')}</span>
              <span className="text-right font-medium">{po.supplierName}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('totalPo')}</span>
              <span className="tabular-nums">{rp(po.grandTotal)}</span>
            </div>
            {arah === 'bayar' && (
              <>
                <div className="flex justify-between gap-4 font-semibold">
                  <span>{t('utangDiterima')}</span>
                  <span className="tabular-nums">{rp(po.utangDiterima)}</span>
                </div>
                {po.komitmen > 0 && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('komitmen')}</span>
                    <span className="tabular-nums">{rp(po.komitmen)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {arah === 'bayar' && po && (!po.adaPenerimaan || po.komitmen > 0) && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{!po.adaPenerimaan ? t('peringatanBelumDiterima') : t('peringatanSebagian', { nilai: rp(po.komitmen) })}</p>
          </div>
        )}

        {arah === 'bayar' && (
          <div className="space-y-2">
            <Label htmlFor="tanggal-bayar-po">{t('tanggalBayar')}</Label>
            <TanggalInput
              id="tanggal-bayar-po"
              value={tanggal}
              max={hariIni}
              required
              onChange={(e) => setTanggal(e.target.value)}
              aria-invalid={tanggalSalah}
            />
            {tanggalSalah && <p className="text-xs text-destructive">{t('tanggalSalah')}</p>}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{tUmum('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={arah === 'batal' ? 'destructive' : 'default'}
            disabled={sibuk || tanggalSalah}
            onClick={(e) => {
              // Dialog tetap terbuka sampai aksi selesai.
              e.preventDefault();
              void onKonfirmasi(paidAt);
            }}
          >
            {sibuk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {arah === 'bayar' ? t('tombolBayar') : t('tombolBatal')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
