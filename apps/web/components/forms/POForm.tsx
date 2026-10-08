'use client';

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createPoSchema, poItemSchema } from '@/lib/validations';
import { hitungTotalPo } from '@/lib/purchase-orders/ppn';
import { getItems } from '@/app/actions/items';
import { getCachedItems } from '@/lib/offline/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { labelPemasok, urutPemasok } from '@/lib/suppliers/label-pemasok';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, Loader2, AlertTriangle, WifiOff, Factory, X, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { isOnline } from '@/lib/offline/sync';
import { useLocale, useTranslations } from 'next-intl';
import { parseItemVariants, variantSelectOptions } from '@/lib/items/variants';
import { previewChainDays } from '@/app/actions/lead-time';
import { EtaSuggestionHint } from '@/components/lead-time/eta-suggestion-hint';
import { sumPcsQty } from '@/lib/leadtime/calculations';
import { labelTahap, type TahapPo } from '@/lib/purchase-orders/tahap';
import {
  kekurangan,
  qtyDariHasil,
  tulisQtyBahan,
  type KebutuhanTahapPo,
} from '@/lib/purchase-orders/kebutuhan-tahap';
import { jumlahRoll } from '@/lib/purchase-orders/rincian-warna';
import { opsiVarianWarna, tcxDariLabel } from '@/lib/purchase-orders/varian-warna';
import { hexPantoneAction } from '@/app/actions/po-varian-warna';
import { PanelKebutuhanTahap } from '@/components/forms/po/PanelKebutuhanTahap';
import { AlatMassalPo } from '@/components/forms/po/AlatMassalPo';
import { HitungWarnaPopover } from '@/components/forms/po/HitungWarnaPopover';
import { DialogWarnaBaru } from '@/components/forms/po/DialogWarnaBaru';

type POFormData = z.infer<ReturnType<typeof createPoSchema>>;
type POItemData = z.infer<typeof poItemSchema>;

interface Supplier {
  id: string;
  code: string;
  name: string;
}

interface Item {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  uom: {
    id: string;
    code: string;
  };
  variants?: Array<Record<string, string>>;
  /** `ItemType`; varian warna baru hanya untuk bahan (bukan `FINISHED_GOOD`). */
  type?: string;
  /** Kg per roll bahan berbahan kg — kolom Roll. */
  kgPerRoll?: number | null;
}

/** Bahan, bukan barang jadi — boleh dirinci per warna dan diberi warna baru. */
const bahanNonJadi = (item: Item | undefined): item is Item => !!item?.type && item.type !== 'FINISHED_GOOD';

interface POFormProps {
  initialData?: {
    supplierId?: string;
    etaDate?: Date | null;
    paymentDueDate?: Date | null;
    notes?: string;
    terms?: string;
    items?: Array<{
      itemId: string;
      variantSku?: string | null;
      item: {
        sku: string;
        nameId: string;
        uom: { id: string; code: string };
        variants?: unknown;
      };
      qty: number;
      price: number;
      ppnIncluded?: boolean;
      uomId: string;
      notes?: string;
    }>;
  };
  suppliers: Supplier[];
  /**
   * Tarif PPN untuk pratinjau total: PO baru = tarif Pengaturan → Pajak; PO yang
   * diedit = tarif yang tersimpan di PO (`null` = PO lama, tanpa PPN). Server
   * menghitung ulang dengan aturan yang sama (`hitungTotalPo`). `undefined` =
   * tarif belum diketahui (belum termuat / luring): PPN tetap dihitung server
   * saat PO disimpan, jadi pratinjau tidak boleh menyebutnya "tidak dihitung".
   */
  ppnRatePercent?: number | null;
  /**
   * Tahap produksi yang dilayani PO ini (PO baru dari ruang kerja tahap, atau
   * tautan PO yang diedit). Tampil sebagai chip yang bisa dilepas; tanpa prop
   * ini `planStageId` tidak dikirim, jadi edit tidak menyentuh tautan lama.
   */
  tahap?: TahapPo | null;
  /**
   * Kebutuhan bahan tahap (PO baru dari ruang kerja tahap): panel "Kebutuhan
   * vs tahap" dengan kalkulator 3 arah, dan alat "Bagi rata kebutuhan".
   */
  kebutuhanTahap?: KebutuhanTahapPo | null;
  /** Isian awal PO baru (kekurangan bahan tahap + catatan); diabaikan bila `initialData` ada. */
  isiAwal?: { notes: string; items: Array<{ itemId: string; uomId: string; qty: number }> } | null;
  onSubmit: (data: POFormData) => Promise<void>;
  onSaveLocally?: (
    data: POFormData,
    context: {
      enrichedItems: Array<
        POItemData & { sku?: string; itemName?: string; uomCode?: string }
      >;
      totalAmount: number;
      supplier?: Supplier;
    }
  ) => Promise<void>;
  isLoading?: boolean;
}

/** Langganan sinyal (online/offline) untuk `useSyncExternalStore`. */
function langgananSinyal(berubah: () => void): () => void {
  window.addEventListener('online', berubah);
  window.addEventListener('offline', berubah);
  return () => {
    window.removeEventListener('online', berubah);
    window.removeEventListener('offline', berubah);
  };
}

/**
 * Tombol simpan PO baru. PO yang dibuat berstatus DRAF — belum sampai ke
 * pemasok sampai diajukan dari rinciannya — jadi tombolnya "Simpan draf" (dulu
 * labelnya menjanjikan PO terkirim). Tanpa sinyal: "Simpan di perangkat".
 */
function TombolSimpanPo({
  onSimpan,
  onSimpanDiPerangkat,
  isLoading,
}: {
  onSimpan: () => Promise<void>;
  onSimpanDiPerangkat: () => Promise<void>;
  isLoading: boolean;
}) {
  const t = useTranslations('purchaseOrders.form');
  const daring = useSyncExternalStore(langgananSinyal, () => isOnline(), () => true);
  return (
    <Button
      type="button"
      variant={daring ? 'default' : 'secondary'}
      disabled={isLoading}
      onClick={() => void (daring ? onSimpan() : onSimpanDiPerangkat())}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('menyimpan')}
        </>
      ) : daring ? (
        t('simpanDraf')
      ) : (
        <>
          <WifiOff className="mr-2 h-4 w-4" />
          {t('simpanDiPerangkat')}
        </>
      )}
    </Button>
  );
}

export function POForm({
  initialData,
  suppliers,
  ppnRatePercent,
  tahap = null,
  kebutuhanTahap = null,
  isiAwal = null,
  onSubmit,
  onSaveLocally,
  isLoading = false,
}: POFormProps) {
  const locale = useLocale();
  const tRingkasan = useTranslations('purchaseOrders.ringkasan');
  const tToasts = useTranslations('toasts');
  const tSecurity = useTranslations('security');
  const tPlaceholders = useTranslations('placeholders');
  const tValidation = useTranslations('validation');
  const tf = useTranslations('purchaseOrders.form');
  const tTahap = useTranslations('purchaseOrders.tahap');
  const tRincian = useTranslations('purchaseOrders.rincian');
  const poSchemaT = useMemo(() => createPoSchema((k) => tValidation(k)), [tValidation]);
  const [items, setItems] = useState<Item[]>([]);
  const [lineItems, setLineItems] = useState<Array<POItemData & { id: string }>>(
    initialData?.items?.map((item, idx) => ({
      id: `line-${idx}`,
      itemId: item.itemId,
      variantSku: item.variantSku?.trim() || undefined,
      qty: Number(item.qty),
      price: Number(item.price),
      ppnIncluded: item.ppnIncluded ?? true,
      uomId: item.uomId,
      notes: item.notes,
    })) ||
      (isiAwal && isiAwal.items.length > 0
        ? isiAwal.items.map((b, idx) => ({
            id: `line-${idx}`,
            itemId: b.itemId,
            variantSku: undefined,
            qty: b.qty,
            price: 0,
            ppnIncluded: true,
            uomId: b.uomId,
          }))
        : [{ id: 'line-0', itemId: '', variantSku: undefined, qty: 0, price: 0, ppnIncluded: true, uomId: '' }])
  );
  // Konsumsi/pcs di panel "Kebutuhan vs tahap" — hanya untuk menghitung, tidak disimpan.
  const [konsumsiPanel, setKonsumsiPanel] = useState<Record<string, number>>({});
  // Hex swatch per kode TCX ("19-4005") dari varian bahan yang dipakai baris.
  const [hexPantone, setHexPantone] = useState<Record<string, string>>({});
  // Baris yang sedang menambah "+ Warna baru" (tetap diingat selama dialog menutup, supaya isinya tidak kosong).
  const [warnaBaruUntuk, setWarnaBaruUntuk] = useState<{ lineId: string; itemId: string } | null>(null);
  const [warnaBaruBuka, setWarnaBaruBuka] = useState(false);
  const bukaWarnaBaru = (lineId: string, itemId: string) => {
    setWarnaBaruUntuk({ lineId, itemId });
    setWarnaBaruBuka(true);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [etaPreview, setEtaPreview] = useState<{
    totalDays: number;
    suggestedEta: Date | null;
    supplierCode: string;
  } | null>(null);
  const [etaTouched, setEtaTouched] = useState(Boolean(initialData?.etaDate));
  // Chip "Untuk tahap": dilepas = PO disimpan tanpa tahap (null), bisa dipasang lagi.
  const [tahapDilepas, setTahapDilepas] = useState(false);
  const planStageIdKirim: string | null | undefined = tahap ? (tahapDilepas ? null : tahap.id) : undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<POFormData>({
    resolver: zodResolver(poSchemaT) as any,
    defaultValues: {
      supplierId: initialData?.supplierId || '',
      etaDate: initialData?.etaDate ?? null,
      paymentDueDate: initialData?.paymentDueDate ?? null,
      notes: initialData?.notes || (!initialData ? isiAwal?.notes : '') || '',
      terms: initialData?.terms || '',
      items: initialData?.items?.map(item => ({
        itemId: item.itemId,
        variantSku: item.variantSku?.trim() || undefined,
        qty: Number(item.qty),
        price: Number(item.price),
        ppnIncluded: item.ppnIncluded ?? true,
        uomId: item.uomId,
        notes: item.notes,
      })) || [],
    },
  });

  useEffect(() => {
    const loadItems = async () => {
      try {
        if (!isOnline()) {
          const cached = await getCachedItems();
          if (cached.length > 0) {
            setItems(
              cached.map((item) => ({
                id: item.id,
                sku: item.sku,
                nameId: item.nameId,
                nameEn: item.nameEn,
                uom: {
                  id: item.uomId,
                  code: item.uomCode || '',
                },
                variants: item.variants,
                type: item.type,
              }))
            );
            return;
          }
        }

        const data = await getItems({ isActive: true });
        const list = Array.isArray(data) ? data : (data as { items: unknown[] }).items;
        const mapped: Item[] = list.map((row: unknown) => {
          const r = row as {
            id: string;
            sku: string;
            nameId: string;
            nameEn: string;
            uomId?: string;
            uom?: { id?: string; code: string };
            variants?: unknown;
            type?: string;
            kgPerRoll?: number | null;
          };
          return {
            id: r.id,
            sku: r.sku,
            nameId: r.nameId,
            nameEn: r.nameEn,
            uom: { id: r.uomId ?? r.uom?.id ?? '', code: r.uom?.code ?? '' },
            variants: parseItemVariants(r.variants),
            type: r.type,
            kgPerRoll: typeof r.kgPerRoll === 'number' ? r.kgPerRoll : null,
          };
        });
        setItems(mapped);
      } catch {
        toast.error(tToasts('failedToLoadItems'));
      }
    };

    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load items on mount
  }, []);

  // Keep form state in sync with line items so validation and submit see current data
  useEffect(() => {
    setValue(
      'items',
      lineItems.map((lineItem) => {
        const { id: _omitId, ...item } = lineItem;
        void _omitId;
        return {
        itemId: item.itemId ?? '',
        variantSku: item.variantSku,
        qty: item.qty ?? 0,
        price: item.price ?? 0,
        ppnIncluded: item.ppnIncluded ?? true,
        uomId: item.uomId ?? '',
        notes: item.notes ?? '',
      };
      }),
      { shouldValidate: false }
    );
  }, [lineItems, setValue]);

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        id: `line-${Date.now()}`,
        itemId: '',
        variantSku: undefined,
        qty: 0,
        price: 0,
        ppnIncluded: true,
        uomId: '',
      },
    ]);
  };

  const removeLineItem = (idParam: string) => {
    if (lineItems.length === 1) {
      toast.error(tToasts('atLeastOneLineItemRequired'));
      return;
    }
    setLineItems(lineItems.filter((item) => item.id !== idParam));
  };

  const updateLineItem = (idParam: string, field: keyof POItemData, value: unknown) => {
    const updated = lineItems.map((item) => {
      if (item.id === idParam) {
        const updatedItem = { ...item, [field]: value } as POItemData & { id: string };
        // Auto-set UOM and variant when item is selected
        if (field === 'itemId' && value) {
          const selectedItem = items.find((i) => i.id === value);
          if (selectedItem) {
            updatedItem.uomId = selectedItem.uom.id;
            const opts = variantSelectOptions(parseItemVariants(selectedItem.variants));
            updatedItem.variantSku = opts.length === 1 ? opts[0].sku : undefined;
          }
        }
        return updatedItem;
      }
      return item;
    });
    setLineItems(updated);
  };

  const calculateLineTotal = (qty: number, price: number) => {
    return qty * price;
  };

  // ─── Kebutuhan tahap, rincian per warna, isi massal ───────────────────────

  /** Panel kebutuhan hanya untuk PO yang (masih) ditautkan ke tahap. */
  const kebutuhanAktif = tahap && !tahapDilepas ? kebutuhanTahap : null;

  /** Qty satu bahan ditulis ke barisnya (dibagi rata bila dirinci per warna); bahan tanpa baris mendapat baris. */
  const tulisQtyBahanKeBaris = (itemId: string, qty: number) => {
    const ditulis = tulisQtyBahan(lineItems, itemId, qty);
    if (ditulis) {
      setLineItems(ditulis);
      return;
    }
    if (!(qty > 0)) return;
    const uomId = items.find((i) => i.id === itemId)?.uom.id ?? '';
    const baru = { id: `line-${Date.now()}`, itemId, variantSku: undefined, qty, price: 0, ppnIncluded: true, uomId };
    const kosong = lineItems.findIndex((l) => !l.itemId);
    setLineItems(
      kosong >= 0 ? lineItems.map((l, i) => (i === kosong ? { ...baru, id: l.id } : l)) : [...lineItems, baru]
    );
  };

  /** "Bagi rata kebutuhan": kekurangan tiap bahan tahap dibagi rata ke baris bahan itu yang sudah ada. */
  const bagiRataKebutuhan = () => {
    if (!kebutuhanAktif) return;
    let hasil = lineItems;
    let jumlah = 0;
    for (const b of kebutuhanAktif.bahan) {
      const konsumsi = konsumsiPanel[b.itemId] ?? b.perPcs;
      const sisa = kekurangan(qtyDariHasil(kebutuhanAktif.targetQty, konsumsi, b.wastePercent), b.diPo);
      const ditulis = tulisQtyBahan(hasil, b.itemId, sisa);
      if (!ditulis) continue;
      hasil = ditulis;
      jumlah += hasil.filter((l) => l.itemId === b.itemId).length;
    }
    if (jumlah === 0) {
      toast.info(tRincian('bagiRataKosong'));
      return;
    }
    setLineItems(hasil);
    toast.success(tRincian('toastBagiRata', { n: jumlah }));
  };

  /** Isi qty atau harga semua baris yang sudah berisi barang. */
  const isiSemuaBaris = (kolom: 'qty' | 'price', nilai: number) => {
    const jumlah = lineItems.filter((l) => l.itemId).length;
    if (jumlah === 0) {
      toast.error(tToasts('addAtLeastOneValidLineItem'));
      return;
    }
    setLineItems(lineItems.map((l) => (l.itemId ? { ...l, [kolom]: nilai } : l)));
    toast.success(tRincian(kolom === 'qty' ? 'toastQtySemua' : 'toastHargaSemua', { n: jumlah }));
  };

  /** "Hitung warna": satu baris bahan menjadi N baris bahan yang sama; warnanya dipilih sesudahnya. */
  const pecahPerWarna = (lineId: string, bagian: number[]) => {
    const i = lineItems.findIndex((l) => l.id === lineId);
    if (i < 0 || bagian.length === 0) return;
    const asal = lineItems[i];
    const cap = Date.now();
    const baru = bagian.map((qty, k) => ({
      ...asal,
      id: k === 0 ? asal.id : `line-${cap}-${k}`,
      qty,
      variantSku: k === 0 ? asal.variantSku : undefined,
    }));
    setLineItems([...lineItems.slice(0, i), ...baru, ...lineItems.slice(i + 1)]);
    toast.success(tRincian('toastHitungWarna', { n: bagian.length }));
  };

  // Swatch Pantone varian bahan yang dipakai baris (kode TCX → hex), dibaca sekali per kode.
  const kodePantoneBaris = useMemo(() => {
    const kode = new Set<string>();
    for (const l of lineItems) {
      const item = items.find((i) => i.id === l.itemId);
      if (!bahanNonJadi(item)) continue;
      for (const o of opsiVarianWarna(item.variants)) {
        const tcx = tcxDariLabel(o.pantone);
        if (tcx) kode.add(tcx);
      }
    }
    return [...kode].sort().join(',');
  }, [lineItems, items]);

  useEffect(() => {
    if (!kodePantoneBaris || !isOnline()) return;
    const belum = kodePantoneBaris.split(',').filter((k) => !hexPantone[k]);
    if (belum.length === 0) return;
    let batal = false;
    hexPantoneAction(belum)
      .then((peta) => {
        if (!batal) setHexPantone((lama) => ({ ...lama, ...peta }));
      })
      .catch(() => {});
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hex yang sudah ada hanya dibaca untuk melewatinya
  }, [kodePantoneBaris]);

  const swatchPantone = (pantone: string | null): string | undefined => {
    const tcx = tcxDariLabel(pantone);
    return tcx ? hexPantone[tcx] : undefined;
  };

  const bahanWarnaBaru = warnaBaruUntuk ? items.find((i) => i.id === warnaBaruUntuk.itemId) : undefined;
  const pakaiVarianWarna = (lineId: string, sku: string) =>
    setLineItems((lama) => lama.map((l) => (l.id === lineId ? { ...l, variantSku: sku } : l)));

  // Pratinjau total dengan rumus yang sama dengan server (PPN baris "belum termasuk PPN").
  const ringkasanTotal = useMemo(() => {
    try {
      return hitungTotalPo(
        lineItems.map((l) => ({ qty: l.qty || 0, price: l.price || 0, ppnIncluded: l.ppnIncluded ?? true })),
        ppnRatePercent ?? null
      );
    } catch {
      return null;
    }
  }, [lineItems, ppnRatePercent]);

  const filteredItems = items.filter(
    (item) =>
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.nameId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.nameEn.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getItemDisplayName = (item: Item) => (locale === 'en' ? item.nameEn : item.nameId);

  const onFormSubmit = async (data: POFormData) => {
    // Validate line items
    const validItems = lineItems.filter(
      (item) => item.itemId && item.qty > 0 && item.price >= 0
    );

    if (validItems.length === 0) {
      toast.error(tToasts('addAtLeastOneValidLineItem'));
      return;
    }

    for (const line of validItems) {
      const cat = items.find((i) => i.id === line.itemId);
      const opts = variantSelectOptions(parseItemVariants(cat?.variants));
      if (opts.length > 0 && !line.variantSku?.trim()) {
        toast.error(tf('errVarian'));
        return;
      }
    }

    // Check ETA date
    if (data.etaDate && new Date(data.etaDate) < new Date()) {
      toast.warning(tToasts('etaDateInPast'));
    }

    await onSubmit({
      ...data,
      planStageId: planStageIdKirim,
      items: validItems.map((lineItem) => {
        const { id: _omitId, ...item } = lineItem;
        void _omitId;
        return item;
      }),
    });
  };

  const handleSaveLocally = handleSubmit(async (data) => {
    if (!onSaveLocally) return;

    const enrichedItems = data.items.map((line: POItemData) => {
      const source = items.find((i) => i.id === line.itemId);
      return {
        ...line,
        sku: source?.sku,
        itemName: source?.nameId,
        uomCode: source?.uom.code,
      };
    });

    const totalAmount = data.items.reduce(
      (sum: number, line: POItemData) => sum + line.qty * line.price,
      0
    );
    const supplier = suppliers.find((s) => s.id === data.supplierId);

    await onSaveLocally({ ...data, planStageId: planStageIdKirim }, { enrichedItems, totalAmount, supplier });
  });

  const onValidationError = (err: FieldErrors<POFormData>) => {
    const first = Object.values(err)[0];
    const msg = first?.message ?? '';
    const securityKeys = ['userNotFound','pinNotSet','tooManyAttempts','pinIncorrect','enterCurrentPin','currentPinIncorrect','pinFormatError','adminOnlyReset'];
    const display = msg && securityKeys.includes(msg) ? tSecurity(msg) : (msg || tToasts('fixFormData'));
    toast.error(display);
  };

  const handleSubmitForm = handleSubmit(onFormSubmit, onValidationError);

  const etaDate = watch('etaDate');
  const isETAPast = etaDate && new Date(etaDate) < new Date();
  const supplierId = watch('supplierId');

  useEffect(() => {
    if (!supplierId || !isOnline()) {
      setEtaPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        const pcsQty = sumPcsQty(
          lineItems
            .filter((l) => l.itemId && l.qty > 0)
            .map((l) => {
              const item = items.find((i) => i.id === l.itemId);
              return {
                qty: l.qty,
                uomCode: item?.uom.code ?? null,
                itemType: null,
              };
            })
        );
        try {
          const preview = await previewChainDays(
            supplierId,
            pcsQty > 0 ? pcsQty : null
          );
          if (preview.totalDays <= 0 || !preview.suggestedEta) {
            setEtaPreview(null);
            return;
          }
          const supplier = suppliers.find((s) => s.id === supplierId);
          setEtaPreview({
            totalDays: preview.totalDays,
            suggestedEta: new Date(preview.suggestedEta),
            supplierCode: supplier?.code ?? "",
          });
          if (!etaTouched && !watch("etaDate")) {
            setValue("etaDate", new Date(preview.suggestedEta), {
              shouldValidate: true,
            });
          }
        } catch {
          setEtaPreview(null);
        }
      })();
    }, 400);
    return () => clearTimeout(handle);
  }, [supplierId, lineItems, items, suppliers, etaTouched, setValue, watch]);

  return (
    <form onSubmit={handleSubmitForm} className="space-y-6">
      {/* Pemasok dan perkiraan tiba */}
      <Card>
        <CardHeader>
          <CardTitle>{tf('kartuPemasok')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tahap &&
            (tahapDilepas ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{tTahap('dilepas', { tahap: labelTahap(tahap) })}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTahapDilepas(false)}>
                  <Undo2 className="mr-1 h-4 w-4" />
                  {tTahap('tautkanLagi')}
                </Button>
              </div>
            ) : (
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border bg-secondary py-0.5 pl-3 pr-1 text-sm text-secondary-foreground">
                <Factory className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{tTahap('untukTahap', { tahap: labelTahap(tahap) })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 rounded-full"
                  onClick={() => setTahapDilepas(true)}
                  aria-label={tTahap('lepas')}
                  title={tTahap('lepas')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="supplierId">{tf('pemasok')} *</Label>
              <SearchableCombobox
                id="supplierId"
                options={urutPemasok(suppliers).map((s) => ({ value: s.id, label: labelPemasok(s) }))}
                value={watch('supplierId')}
                onValueChange={(value) => setValue('supplierId', value, { shouldValidate: true })}
                placeholder={tPlaceholders('selectSupplier')}
                searchPlaceholder={tPlaceholders('cariPemasok')}
                aria-invalid={!!errors.supplierId}
                className={errors.supplierId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
              />
              {errors.supplierId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.supplierId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="etaDate">{tf('tanggalEta')}</Label>
              <DatePicker
                id="etaDate"
                value={watch('etaDate') ?? null}
                aria-invalid={!!errors.etaDate}
                className={errors.etaDate ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                onChange={(date) => {
                  setEtaTouched(true);
                  setValue('etaDate', date ?? null, { shouldValidate: true });
                }}
              />
              {errors.etaDate && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.etaDate.message}
                </p>
              )}
              {etaPreview?.suggestedEta && (
                <EtaSuggestionHint
                  supplierCode={etaPreview.supplierCode}
                  totalDays={etaPreview.totalDays}
                  suggestedEta={etaPreview.suggestedEta}
                  onUseDate={() => {
                    setEtaTouched(true);
                    setValue("etaDate", etaPreview.suggestedEta, {
                      shouldValidate: true,
                    });
                  }}
                />
              )}
              {isETAPast && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {tf('etaLewat')}
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentDueDate">{tf('jatuhTempo')}</Label>
              <DatePicker
                id="paymentDueDate"
                value={watch('paymentDueDate') ?? null}
                aria-invalid={!!errors.paymentDueDate}
                className={errors.paymentDueDate ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                onChange={(date) => {
                  setValue('paymentDueDate', date ?? null, { shouldValidate: true });
                }}
              />
              {errors.paymentDueDate && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.paymentDueDate.message}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {kebutuhanAktif && (
        <PanelKebutuhanTahap
          kebutuhan={kebutuhanAktif}
          baris={lineItems}
          konsumsi={konsumsiPanel}
          onKonsumsi={(itemId, nilai) => setKonsumsiPanel((lama) => ({ ...lama, [itemId]: nilai }))}
          onTulisQty={tulisQtyBahanKeBaris}
        />
      )}

      {/* Daftar barang */}
      <Card>
        <CardHeader>
          <CardTitle>{tf('kartuBarang')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {errors.items?.message && (
            <p className="text-sm text-destructive" role="alert">
              {errors.items.message}
            </p>
          )}
          <div className="flex justify-between items-center">
            <div className="flex-1 max-w-sm">
              <Input
                placeholder={tPlaceholders('cariBarangSkuNama')}
                aria-label={tPlaceholders('cariBarangSkuNama')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
              <Plus className="h-4 w-4 mr-2" />
              {tf('tambahBarang')}
            </Button>
          </div>

          <AlatMassalPo
            onQtySemua={(n) => isiSemuaBaris('qty', n)}
            onHargaSemua={(n) => isiSemuaBaris('price', n)}
            onBagiRata={kebutuhanAktif ? bagiRataKebutuhan : undefined}
          />

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tf('colBarang')}</TableHead>
                  <TableHead>{tf('colVarian')}</TableHead>
                  <TableHead>{tf('colQty')}</TableHead>
                  <TableHead>{tf('colSatuan')}</TableHead>
                  <TableHead className="text-right">{tRincian('colRoll')}</TableHead>
                  <TableHead>{tf('colHarga')}</TableHead>
                  <TableHead>{tf('colPpn')}</TableHead>
                  <TableHead className="text-right">{tf('colTotal')}</TableHead>
                  <TableHead>{tf('colCatatan')}</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">{tf('colAksi')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((lineItem) => {
                  const selectedItem = items.find((i) => i.id === lineItem.itemId);
                  const lineTotal = calculateLineTotal(lineItem.qty, lineItem.price);
                  const variantOpts = variantSelectOptions(parseItemVariants(selectedItem?.variants));
                  const bahan = bahanNonJadi(selectedItem) ? selectedItem : null;
                  const warnaOpts = bahan ? opsiVarianWarna(bahan.variants) : [];
                  const roll = jumlahRoll(lineItem.qty, selectedItem?.kgPerRoll, selectedItem?.uom.code);
                  const swatchTerpilih = warnaOpts.find((o) => o.sku === lineItem.variantSku)?.pantone ?? null;

                  return (
                    <TableRow key={lineItem.id}>
                      <TableCell>
                        <SearchableCombobox
                          options={filteredItems.map((item) => ({
                            value: item.id,
                            label: `${item.sku} - ${getItemDisplayName(item)}`,
                          }))}
                          value={lineItem.itemId}
                          onValueChange={(value) => updateLineItem(lineItem.id, 'itemId', value)}
                          placeholder={tPlaceholders('pilihBarang')}
                          searchPlaceholder={tPlaceholders('cariBarang')}
                          triggerClassName="max-w-[16rem] min-w-0"
                        />
                      </TableCell>
                      <TableCell className="min-w-[10rem] max-w-[16rem]">
                        {bahan ? (
                          warnaOpts.length === 0 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => bukaWarnaBaru(lineItem.id, bahan.id)}
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              {tRincian('tambahWarna')}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              {swatchPantone(swatchTerpilih) ? (
                                <span
                                  className="h-4 w-4 shrink-0 rounded-sm border"
                                  style={{ backgroundColor: swatchPantone(swatchTerpilih) }}
                                  aria-hidden
                                />
                              ) : null}
                              <Select
                                value={lineItem.variantSku?.trim() ? lineItem.variantSku : '__none__'}
                                onValueChange={(v) => {
                                  if (v === '__baru__') {
                                    bukaWarnaBaru(lineItem.id, bahan.id);
                                    return;
                                  }
                                  updateLineItem(lineItem.id, 'variantSku', v === '__none__' ? undefined : v);
                                }}
                              >
                                <SelectTrigger className="w-full max-w-[14rem]">
                                  <SelectValue placeholder={tf('colVarian')} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">{tf('pilihVarian')}</SelectItem>
                                  {warnaOpts.map((o) => (
                                    <SelectItem key={o.sku} value={o.sku}>
                                      <span className="flex items-center gap-2">
                                        {swatchPantone(o.pantone) ? (
                                          <span
                                            className="h-3 w-3 shrink-0 rounded-sm border"
                                            style={{ backgroundColor: swatchPantone(o.pantone) }}
                                            aria-hidden
                                          />
                                        ) : null}
                                        {o.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="__baru__">{tRincian('warnaBaru')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )
                        ) : variantOpts.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <Select
                            value={lineItem.variantSku?.trim() ? lineItem.variantSku : '__none__'}
                            onValueChange={(v) =>
                              updateLineItem(
                                lineItem.id,
                                'variantSku',
                                v === '__none__' ? undefined : v
                              )
                            }
                          >
                            <SelectTrigger className="w-full max-w-[14rem]">
                              <SelectValue placeholder={tf('colVarian')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{tf('pilihVarian')}</SelectItem>
                              {variantOpts.map((o) => (
                                <SelectItem key={o.sku} value={o.sku}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={lineItem.qty || ''}
                          onChange={(e) =>
                            updateLineItem(
                              lineItem.id,
                              'qty',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {selectedItem?.uom.code || '-'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {roll == null ? '—' : roll.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={lineItem.price || ''}
                          onChange={(e) =>
                            updateLineItem(
                              lineItem.id,
                              'price',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={lineItem.ppnIncluded ? 'include' : 'exclude'}
                          onValueChange={(value) =>
                            updateLineItem(lineItem.id, 'ppnIncluded', value === 'include')
                          }
                        >
                          <SelectTrigger className="max-w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="include">{tf('termasukPpn')}</SelectItem>
                            <SelectItem value="exclude">{tf('belumPpn')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        Rp {lineTotal.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={lineItem.notes || ''}
                          onChange={(e) =>
                            updateLineItem(lineItem.id, 'notes', e.target.value)
                          }
                          placeholder={tPlaceholders('optional')}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          {bahan ? (
                            <HitungWarnaPopover
                              namaBahan={getItemDisplayName(bahan)}
                              satuan={bahan.uom.code}
                              qtyAwal={lineItem.qty}
                              onBuat={(bagian) => pecahPerWarna(lineItem.id, bagian)}
                            />
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLineItem(lineItem.id)}
                            aria-label={tf('hapusBaris')}
                            title={tf('hapusBaris')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Subtotal, PPN, total */}
          {ringkasanTotal && (
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{tRingkasan('subtotal')}</span>
                  <span className="tabular-nums">Rp {ringkasanTotal.subtotal.toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {ppnRatePercent === undefined
                      ? tRingkasan('ppnSaatSimpan')
                      : ppnRatePercent === null
                        ? tRingkasan('ppnTidakDihitung')
                        : tRingkasan('ppn', { tarif: ppnRatePercent.toLocaleString('id-ID') })}
                  </span>
                  <span className="tabular-nums">
                    {ppnRatePercent === undefined ? '—' : `Rp ${ringkasanTotal.taxAmount.toLocaleString('id-ID')}`}
                  </span>
                </div>
                <div className="flex justify-between gap-4 pt-1 border-t">
                  <span className="font-medium">
                    {ppnRatePercent === undefined ? tRingkasan('totalSebelumPpn') : tRingkasan('totalPo')}
                  </span>
                  <span className="text-2xl font-bold tabular-nums">
                    Rp {ringkasanTotal.grandTotal.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Catatan dan syarat */}
      <Card>
        <CardHeader>
          <CardTitle>{tf('kartuLain')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">{tf('catatan')}</Label>
            <Textarea
              id="notes"
              {...register('notes')}
              placeholder={tPlaceholders('additionalNotes')}
              rows={3}
              aria-invalid={!!errors.notes}
              className={errors.notes ? 'border-destructive focus-visible:ring-destructive/20' : ''}
            />
            {errors.notes && (
              <p className="text-sm text-destructive" role="alert">
                {errors.notes.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="terms">{tf('syaratBayar')}</Label>
            <Textarea
              id="terms"
              {...register('terms')}
              placeholder={tPlaceholders('paymentTerms')}
              rows={3}
              aria-invalid={!!errors.terms}
              className={errors.terms ? 'border-destructive focus-visible:ring-destructive/20' : ''}
            />
            {errors.terms && (
              <p className="text-sm text-destructive" role="alert">
                {errors.terms.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <DialogWarnaBaru
        bahan={
          bahanWarnaBaru
            ? { id: bahanWarnaBaru.id, sku: bahanWarnaBaru.sku, nama: getItemDisplayName(bahanWarnaBaru) }
            : null
        }
        open={warnaBaruBuka}
        onOpenChange={setWarnaBaruBuka}
        onDibuat={(varian, variants) => {
          const sasaran = warnaBaruUntuk;
          if (!sasaran) return;
          setItems((lama) => lama.map((i) => (i.id === sasaran.itemId ? { ...i, variants } : i)));
          const tcx = tcxDariLabel(varian.pantone);
          const hex = varian.hex;
          if (tcx && hex) setHexPantone((lama) => ({ ...lama, [tcx]: hex }));
          pakaiVarianWarna(sasaran.lineId, varian.sku);
        }}
        onSudahAda={(sku, variants) => {
          const sasaran = warnaBaruUntuk;
          if (!sasaran) return;
          if (variants) setItems((lama) => lama.map((i) => (i.id === sasaran.itemId ? { ...i, variants } : i)));
          pakaiVarianWarna(sasaran.lineId, sku);
        }}
      />

      {/* Tombol simpan */}
      <div className="flex justify-end gap-2">
        {onSaveLocally ? (
          <TombolSimpanPo
            onSimpan={handleSubmitForm}
            onSimpanDiPerangkat={handleSaveLocally}
            isLoading={isLoading}
          />
        ) : (
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initialData ? tf('simpanPerubahan') : tf('simpanDraf')}
          </Button>
        )}
      </div>
    </form>
  );
}
