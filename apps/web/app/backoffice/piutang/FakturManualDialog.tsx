'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { buatFakturManualAction } from '@/app/actions/receivable-import';
import type { BarisFaktur } from '@/lib/receivables/manual-writer';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

function hariIniWib(tambah = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
    new Date(Date.now() + tambah * 86_400_000),
  );
}

export type PilihanBarang = { value: string; label: string; nama: string };

export function FakturManualDialog({
  terbuka,
  onOpenChange,
  toko,
  katalog,
}: {
  terbuka: boolean;
  onOpenChange: (v: boolean) => void;
  toko: { id: string; name: string }[];
  katalog: PilihanBarang[];
}) {
  const t = useTranslations('fakturManual');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [noFaktur, setNoFaktur] = useState('');
  const [storeId, setStoreId] = useState('');
  const [tglFaktur, setTglFaktur] = useState(hariIniWib());
  const [tempo, setTempo] = useState(hariIniWib(30));
  const [nilai, setNilai] = useState('');
  const [items, setItems] = useState<BarisFaktur[]>([]);

  const totalRincian = items.reduce((s, b) => s + (b.qty || 0) * (b.price || 0), 0);

  const bisaSimpan =
    !pending &&
    noFaktur.trim() !== '' &&
    storeId !== '' &&
    (items.length === 0
      ? Number(nilai) > 0
      : items.every((b) => b.itemName.trim() && b.qty > 0) && totalRincian > 0);

  const simpan = () => {
    startTransition(async () => {
      const hasil = await buatFakturManualAction({
        invoiceNo: noFaktur,
        storeId,
        invoiceDate: tglFaktur,
        dueDate: tempo,
        amount: Number(nilai),
        items,
      });
      if (!hasil.ok) {
        toast.error(t(`err${hasil.kode}` as never));
        return;
      }
      toast.success(t('okCreated'));
      onOpenChange(false);
      setNoFaktur('');
      setStoreId('');
      setNilai('');
      setItems([]);
      router.refresh();
    });
  };

  return (
    <Dialog open={terbuka} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fm-no">{t('invoiceNo')}</Label>
              <Input
                id="fm-no"
                value={noFaktur}
                onChange={(e) => setNoFaktur(e.target.value)}
                placeholder={t('invoiceNoPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fm-toko">{t('store')}</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger id="fm-toko">
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fm-tgl">{t('invoiceDate')}</Label>
              <Input
                id="fm-tgl"
                type="date"
                value={tglFaktur}
                onChange={(e) => setTglFaktur(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fm-tempo">{t('dueDate')}</Label>
              <Input
                id="fm-tempo"
                type="date"
                value={tempo}
                onChange={(e) => setTempo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('itemsLabel')}</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setItems((lama) => [...lama, { itemName: '', qty: 1, price: 0 }])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addItem')}
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('itemsHint')}</p>
            ) : (
              <div className="space-y-2">
                {items.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-40 flex-1 space-y-1">
                      <div className="flex gap-2">
                        <SearchableCombobox
                          options={katalog}
                          value={b.itemId ?? ''}
                          onValueChange={(v) => {
                            const dipilih = katalog.find((k) => k.value === v);
                            setItems((lama) =>
                              lama.map((r, n) =>
                                n === i
                                  ? {
                                      ...r,
                                      itemId: v || null,
                                      itemName: dipilih ? dipilih.nama : r.itemName,
                                    }
                                  : r,
                              ),
                            );
                          }}
                          placeholder={t('itemPickPlaceholder')}
                          triggerClassName="w-full min-w-0 flex-1"
                        />
                        <Input
                          value={b.itemName}
                          placeholder={t('itemNamePlaceholder')}
                          className="min-w-0 flex-1"
                          onChange={(e) =>
                            setItems((lama) =>
                              lama.map((r, n) => (n === i ? { ...r, itemName: e.target.value } : r)),
                            )
                          }
                        />
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      value={b.qty}
                      onChange={(e) =>
                        setItems((lama) =>
                          lama.map((r, n) => (n === i ? { ...r, qty: Number(e.target.value) } : r)),
                        )
                      }
                    />
                    <Input
                      type="number"
                      min={0}
                      className="w-32"
                      value={b.price}
                      onChange={(e) =>
                        setItems((lama) =>
                          lama.map((r, n) => (n === i ? { ...r, price: Number(e.target.value) } : r)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('removeItem')}
                      onClick={() => setItems((lama) => lama.filter((_, n) => n !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-right text-sm">
                  {t('itemsTotal', { value: rupiah(totalRincian) })}
                </p>
              </div>
            )}
          </div>

          {/* Total manual hilang begitu rincian diisi — dua kebenaran untuk satu
              faktur adalah cara termudah menagih angka yang salah. */}
          {items.length === 0 && (
            <div className="space-y-2">
              <Label htmlFor="fm-nilai">{t('amount')}</Label>
              <Input
                id="fm-nilai"
                type="number"
                inputMode="numeric"
                min={1}
                value={nilai}
                onChange={(e) => setNilai(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button disabled={!bisaSimpan} onClick={simpan}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
