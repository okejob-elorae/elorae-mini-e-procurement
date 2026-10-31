'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ScanLine, Sigma } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/ui/status-pill';
import { dinamis } from '@/lib/i18n/dinamis';
import { bacaNotaAction } from '@/app/actions/ocr';
import { cocokTotal, type BarisTerbaca, type HasilBacaNota } from '@/lib/ocr/nota';
import type { BarisBarang } from '@/lib/receivables/return-writer';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Membaca rincian nota dari fotonya.
 *
 * MENGUSULKAN, tidak pernah mengisi sendiri. Ini bukan kehati-hatian berlebih:
 * OCR salah sesekali dan itu sifatnya, bukan cacat yang bisa diperbaiki. Sebuah
 * angka uang yang muncul di formulir tanpa ada yang melihatnya adalah persis
 * cara sebuah nota jadi salah tanpa ada yang bisa menjelaskan kapan.
 *
 * Karena itu: hasilnya ditampilkan lebih dulu, baris yang meragukan ditandai,
 * baris yang gagal dibaca ikut ditampilkan apa adanya, dan tidak ada satu pun
 * yang masuk ke formulir sampai tombolnya ditekan.
 */
export function BacaNota({
  fotoUrl,
  adaBarisTerisi,
  onTerapkan,
  onTotal,
  onNomor,
  onTanggal,
  disabled = false,
}: {
  fotoUrl: string | null;
  /** Kalau rinciannya sudah terisi, hasil bacaan DITAMBAHKAN, bukan menimpa. */
  adaBarisTerisi?: boolean;
  /**
   * Ke mana hasilnya masuk.
   *
   * Layar kantor punya penyunting rincian, jadi ia menerima barisnya. Layar HP
   * TIDAK punya — di lapangan sales memotret nota dan mengetik totalnya, dan
   * itu memang bentuk yang dipilih. Di sana yang masuk cuma jumlah baris yang
   * dicentang. Panel tinjauannya sama persis di keduanya: yang berbeda hanya
   * apa yang diterima formulirnya, bukan apa yang boleh dilihat orangnya.
   */
  onTerapkan?: (baris: BarisBarang[]) => void;
  onTotal?: (total: number) => void;
  /** Hanya dipanggil untuk kolom yang MASIH KOSONG — lihat catatan di bawah. */
  onNomor?: (no: string) => void;
  onTanggal?: (tanggal: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('ocr');
  const td = dinamis(t);
  const [pending, startTransition] = useTransition();
  const [hasil, setHasil] = useState<HasilBacaNota | null>(null);
  const [keyakinan, setKeyakinan] = useState(0);
  const [pilih, setPilih] = useState<boolean[]>([]);
  const [sudahDipakai, setSudahDipakai] = useState(false);

  if (!fotoUrl) return null;

  const baca = () => {
    startTransition(async () => {
      const r = await bacaNotaAction(fotoUrl);
      if (!r.ok) {
        toast.error(td(`err${r.kode}`));
        return;
      }
      setHasil(r.hasil);
      setKeyakinan(r.keyakinan);
      setPilih(r.hasil.baris.map(() => true));
      setSudahDipakai(false);
      if (r.hasil.baris.length === 0) toast.warning(t('nothingRead'));

      /*
       * Nomor dan tanggal diisikan lewat pemanggilnya, yang hanya menerapkannya
       * kalau kolomnya MASIH KOSONG. Menimpa apa yang sudah diketik orang
       * adalah cara tercepat membuat fitur ini dimatikan: sekali saja ia
       * menghapus nomor yang benar, tidak ada yang mau memakainya lagi.
       */
      if (r.hasil.noNota) onNomor?.(r.hasil.noNota);
      if (r.hasil.tanggal) onTanggal?.(r.hasil.tanggal);
    });
  };

  const terapkan = () => {
    const dipilih = (hasil?.baris ?? []).filter((_, i) => pilih[i]);
    onTerapkan?.(dipilih.map((b) => ({ itemName: b.itemName, qty: b.qty, price: b.price })));
    onTotal?.(dipilih.reduce((s, b) => s + b.amount, 0));
    setSudahDipakai(true);
    toast.success(t('applied', { count: dipilih.length }));
  };

  const jumlahDipilih = pilih.filter(Boolean).length;
  const barisDipilih = (hasil?.baris ?? []).filter((_, i) => pilih[i]);
  const totalDipilih = barisDipilih.reduce((s, b) => s + b.amount, 0);
  /*
   * Total tertulis di nota vs jumlah baris yang dipilih. Inilah pemeriksaan
   * paling penting di layar ini — bukan sekadar berguna. Diuji dengan foto yang
   * satu barisnya tertutup tinta: mesinnya menjatuhkan baris itu tanpa tanda
   * apa pun dan tetap melaporkan keyakinan 93%. Cuma angka ini yang tahu.
   */
  const totalCocok = cocokTotal(barisDipilih, hasil?.total ?? null) === true;

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ScanLine className="h-4 w-4" />
            {t('title')}
          </p>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending || disabled} onClick={baca}>
          {pending ? t('reading') : hasil ? t('rereadButton') : t('readButton')}
        </Button>
      </div>

      {hasil && (
        <div className="space-y-3">
          {/* Keyakinan rendah berarti FOTONYA buruk, bukan notanya. Disebut
              supaya orang memotret ulang alih-alih membetulkan angka satu-satu. */}
          {keyakinan > 0 && keyakinan < 70 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('lowConfidence', { pct: Math.round(keyakinan) })}
            </p>
          )}

          {hasil.baris.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('nothingRead')}</p>
          ) : (
            <div className="space-y-1.5">
              {hasil.baris.map((b, i) => (
                <BarisUsulan
                  key={i}
                  baris={b}
                  dipilih={pilih[i]}
                  onToggle={(v) => setPilih((lama) => lama.map((x, n) => (n === i ? v : x)))}
                />
              ))}
            </div>
          )}

          {hasil.total != null && (
            <p className="flex items-center gap-1.5 text-xs">
              <Sigma className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className={totalCocok ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-500'}>
                {totalCocok
                  ? t('totalMatches', { total: rupiah(hasil.total) })
                  : t('totalDiffers', {
                      total: rupiah(hasil.total),
                      selected: rupiah(totalDipilih),
                    })}
              </span>
            </p>
          )}

          {/* Baris yang GAGAL dibaca, ditampilkan apa adanya. Yang hilang tanpa
              jejak adalah cara tercepat kehilangan satu barang dari sebuah nota. */}
          {hasil.dilewati.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('skippedLabel')}</p>
              <ul className="space-y-0.5">
                {hasil.dilewati.map((s, i) => (
                  <li key={i} className="font-mono text-xs text-muted-foreground">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={jumlahDipilih === 0 || sudahDipakai || disabled}
            onClick={terapkan}
          >
            {sudahDipakai
              ? t('alreadyApplied')
              : !onTerapkan
                ? t('applyTotal', { total: rupiah(totalDipilih) })
                : adaBarisTerisi
                  ? t('applyAppend', { count: jumlahDipilih })
                  : t('apply', { count: jumlahDipilih })}
          </Button>
        </div>
      )}
    </div>
  );
}

function BarisUsulan({
  baris,
  dipilih,
  onToggle,
}: {
  baris: BarisTerbaca;
  dipilih: boolean;
  onToggle: (v: boolean) => void;
}) {
  const t = useTranslations('ocr');
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
      <Checkbox checked={dipilih} onCheckedChange={(v) => onToggle(v === true)} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{baris.itemName}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">
          {baris.qty} × {rupiah(baris.price)} = {rupiah(baris.amount)}
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {/* Angka turunan MENGAKU diturunkan. Angka turunan yang menyamar
            sebagai hasil baca adalah kebohongan kecil yang menumpuk. */}
        {baris.asalQty === 'dihitung' && (
          <StatusPill tone="waiting">{t('qtyDerived')}</StatusPill>
        )}
        {baris.janggal && <StatusPill tone="attention">{t('odd')}</StatusPill>}
      </span>
    </label>
  );
}
