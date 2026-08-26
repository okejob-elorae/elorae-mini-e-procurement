'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BarisBarang } from '@/lib/receivables/return-writer';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Penyunting rincian barang.
 *
 * Rinciannya opsional — sales di lapangan sering hanya sempat memotret nota dan
 * mengetik totalnya. Tapi begitu rincian diisi, TOTALNYA DIHITUNG dari rincian
 * dan kolom total dikunci: total yang diketik di samping rincian yang tidak
 * menjumlah ke sana adalah dua kebenaran untuk satu nota.
 *
 * Rincian inilah yang membuat perbandingan per barang mungkin — tanpa itu
 * pemilik hanya tahu ADA selisih, bukan barang mana yang kurang.
 */
export function BarisBarangEditor({
  rows,
  onChange,
  qtyLabel,
}: {
  rows: BarisBarang[];
  /*
   * Sengaja setter React, bukan `(rows) => void`. Menambah baris dengan
   * `onChange([...rows, baru])` memakai potret `rows` saat render, jadi dua klik
   * yang jatuh di batch yang sama hanya menghasilkan SATU baris — yang kedua
   * menimpa yang pertama. Bentuk fungsional selalu membaca nilai terkini.
   */
  onChange: Dispatch<SetStateAction<BarisBarang[]>>;
  qtyLabel: string;
}) {
  const t = useTranslations('storeReturns');
  const total = rows.reduce((s, r) => s + (r.qty || 0) * (r.price || 0), 0);

  const ubah = (i: number, patch: Partial<BarisBarang>) =>
    onChange((lama) => lama.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('itemsLabel')}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange((lama) => [...lama, { itemName: '', qty: 1, price: 0 }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('addItem')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('itemsHint')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                {i === 0 && <span className="text-xs text-muted-foreground">{t('colItem')}</span>}
                <Input
                  value={r.itemName}
                  onChange={(e) => ubah(i, { itemName: e.target.value })}
                  placeholder={t('itemNamePlaceholder')}
                />
              </div>
              <div className="w-20 space-y-1">
                {i === 0 && <span className="text-xs text-muted-foreground">{qtyLabel}</span>}
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={r.qty}
                  onChange={(e) => ubah(i, { qty: Number(e.target.value) })}
                />
              </div>
              <div className="w-32 space-y-1">
                {i === 0 && <span className="text-xs text-muted-foreground">{t('colPrice')}</span>}
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={r.price}
                  onChange={(e) => ubah(i, { price: Number(e.target.value) })}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('removeItem')}
                onClick={() => onChange((lama) => lama.filter((_, n) => n !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <p className="text-right text-sm">
            {t('itemsTotal', { value: rupiah(total) })}
          </p>
        </div>
      )}
    </div>
  );
}
