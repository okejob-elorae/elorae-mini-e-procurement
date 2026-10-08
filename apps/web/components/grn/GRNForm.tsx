'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Trash2, Loader2, Barcode, X, ImagePlus } from 'lucide-react';
import { BarcodeScanner } from '@/components/scanners/BarcodeScanner';
import { simpanGRN, type GRNFormData } from '@/app/actions/grn';
import { getPOs } from '@/app/actions/purchase-orders';
import { getPOById } from '@/app/actions/purchase-orders';
import { getItems } from '@/app/actions/items';
import { getItemCategories } from '@/app/actions/item-categories';
import { offlineDB, getPendingGRNs, removePendingGRN, type PendingGRN } from '@/lib/offline/db';
import {
  alasanTidakBisaSimpanGrn,
  ambilDrafGrn,
  barisDariDraf,
  drafBermakna,
  drafDariGrnLama,
  drafDariIsian,
  fotoDariDataUrl,
  galatSambungan,
  hapusDrafGrn,
  kunciDrafLengket,
  segarkanAngkaPo,
  simpanDrafGrn,
  type DrafGrn,
} from '@/lib/offline/grn-draf';
import { formatDisplayDateTime } from '@/lib/date-only';
import { labelPemasok, urutPemasok } from '@/lib/suppliers/label-pemasok';
import { adaYangBisaDiisi, bisaDiisiSisa, isiKosongDenganSisa, lebihDariSisa, sisaPo } from '@/lib/inventory/grn-sisa-po';
import { newLocalId } from '@/lib/pwa/id-lokal';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { FabricRollInput, FabricRackPreview } from '@/components/grn/FabricRollInput';
import { parseItemVariants, variantSelectOptions } from '@/lib/items/variants';
import { awalFormulirGrn } from '@/app/backoffice/inventory/grn/new/awal-grn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Supplier {
  id: string;
  code: string;
  name: string;
  /** false = pemasok belum/tidak disetujui (punya dokumen lama); ditandai di pilihan. */
  disetujui?: boolean;
}

interface ItemOption {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type?: string;
  categoryId?: string | null;
  uomId: string;
  uom?: { id?: string; code: string };
  variants?: unknown;
}

interface ItemCategoryOption {
  id: string;
  name: string;
  code?: string | null;
}

interface LineRow {
  id: string;
  itemId: string;
  itemType?: string;
  sku: string;
  nameId: string;
  uomId: string;
  uomCode: string;
  /** Item.variants[].sku for inventory bucket */
  variantSku?: string;
  qty: number;
  unitCost: number;
  /** Fabric: tokenized roll lengths (one string per roll). Qty is derived from valid numeric values. */
  rollValues?: string[];
  /** PO ordered qty for this line when loaded from PO – used for "Received X / Y" in FabricRollInput. */
  poOrderedQty?: number | null;
  /** Already received qty for this line from previous GRNs (from PO line receivedQty). */
  poAlreadyReceivedQty?: number | null;
}

interface GRNFormProps {
  suppliers: Supplier[];
  onSuccess?: () => void;
  /** `?poId=` dari tombol "Terima barang" di rincian PO: PO dan pemasoknya terisi. */
  poIdAwal?: string;
}

function barisKosong(id: string): LineRow {
  return {
    id,
    itemId: '',
    itemType: '',
    sku: '',
    nameId: '',
    uomId: '',
    uomCode: '',
    variantSku: undefined,
    qty: 0,
    unitCost: 0,
    rollValues: [],
  };
}

/** Langganan perubahan sinyal (online/offline) untuk `useSyncExternalStore`. */
function langgananSinyal(berubah: () => void): () => void {
  window.addEventListener('online', berubah);
  window.addEventListener('offline', berubah);
  return () => {
    window.removeEventListener('online', berubah);
    window.removeEventListener('offline', berubah);
  };
}

function sinyalSekarang(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

/*
 * GRN butuh sinyal: tidak ada antrean luring untuk GRN (lihat
 * `lib/offline/grn-draf.ts`). Isian formulir disimpan sebagai draf per
 * pengguna di perangkat, dan dihapus hanya setelah GRN tersimpan atau dibuang.
 */
export function GRNForm({ suppliers, onSuccess, poIdAwal = '' }: GRNFormProps) {
  const { data: session } = useSession();
  const t = useTranslations('inventory.grnForm');
  const tToasts = useTranslations('toasts');
  const tTolak = useTranslations('grnErrors');
  const tUmum = useTranslations('common');
  const locale = useLocale();
  const daring = useSyncExternalStore(langgananSinyal, sinyalSekarang, () => true);
  const alasanSimpan = alasanTidakBisaSimpanGrn({ daring });
  const idSesi = session?.user?.id ?? '';
  // Sesi bisa jadi null saat tab dibuka lagi tanpa sinyal; kunci draf tetap milik pengguna ini.
  const [kunciDraf, setKunciDraf] = useState(idSesi);
  const kunciSekarang = kunciDrafLengket(kunciDraf, idSesi);
  if (kunciSekarang !== kunciDraf) setKunciDraf(kunciSekarang);
  const [poId, setPoId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [lines, setLines] = useState<LineRow[]>([barisKosong('0')]);
  const [categoryId, setCategoryId] = useState<string>('');
  const [notes, setNotes] = useState('');
  /**
   * Kunci kiriman GRN, SEKALI per isian dan ikut draf: simpan ulang sesudah
   * jawaban hilang mendapat GRN yang sama dari server, bukan GRN kedua. Diganti
   * hanya saat isian diganti (draf dibuang / draf lain dimuat).
   */
  const [kunciKirim, setKunciKirim] = useState(() => newLocalId());
  const [photoUrls] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [poList, setPoList] = useState<Array<{ id: string; docNumber: string; supplierId: string; namaPemasok: string }>>([]);
  /** Ada draf berisi untuk PO lain saat dibuka dari "Terima barang": PO tautan menunggu pilihan pengguna. */
  const [poTautanTertunda, setPoTautanTertunda] = useState<string | null>(null);
  const inputFotoRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [categories, setCategories] = useState<ItemCategoryOption[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [nextLineId, setNextLineId] = useState(1);
  const [errors, setErrors] = useState<{ supplierId?: string; lines?: string }>({});
  /** Number of existing GRNs for the selected PO (when loaded from PO). */
  const [poGrnCount, setPoGrnCount] = useState(0);
  /** GRN lama (antrean luring yang tidak pernah terkirim) yang sedang dimuat ke formulir. */
  const [pendingLamaId, setPendingLamaId] = useState<number | null>(null);
  // Draf dibaca dulu sebelum ada yang ditulis, supaya draf tidak tertimpa formulir kosong.
  const [drafSiap, setDrafSiap] = useState(false);
  const [drafGagal, setDrafGagal] = useState(false);
  const [drafPulih, setDrafPulih] = useState<number | null>(null);
  const [grnLama, setGrnLama] = useState<PendingGRN[]>([]);
  const [konfirmasi, setKonfirmasi] = useState<{ jenis: 'muat' | 'hapus'; lama: PendingGRN } | null>(null);
  /** GRN sudah tersimpan: draf tidak boleh ditulis lagi (timer tertunda / unmount). */
  const selesaiRef = useRef(false);
  /** Tulis/hapus draf berurutan, supaya tulisan lama tidak menghidupkan draf yang sudah dihapus. */
  const antreanDraf = useRef<Promise<unknown>>(Promise.resolve());
  const drafTertunda = useRef<{ draf: DrafGrn; foto: Blob[] } | null>(null);
  /** PO dari draf: barisnya sudah ada di draf, jangan ditimpa baris PO kosong. */
  const lewatiBarisPo = useRef<string | null>(null);
  /**
   * Pengguna sudah mengubah isian (qty, roll, harga, barang, catatan, foto…)?
   * Draf hanya ditulis sesudahnya: membuka "Terima barang" dari PO lalu pergi
   * tanpa mengetik apa pun dulu menyimpan draf, dan lain kali Terima Barang
   * (tanpa PO) memulihkan PO lama itu dengan "Draf dipulihkan".
   */
  const [diubah, setDiubah] = useState(false);

  const loadPOs = useCallback(async () => {
    try {
      const list = await getPOs({ status: 'SUBMITTED' });
      const part = await getPOs({ status: 'PARTIAL' });
      const listArr = Array.isArray(list)
        ? list
        : list && typeof list === 'object' && 'items' in list
          ? (list as { items: unknown[] }).items
          : [];
      const partArr = Array.isArray(part)
        ? part
        : part && typeof part === 'object' && 'items' in part
          ? (part as { items: unknown[] }).items
          : [];
      const combined = [...listArr, ...partArr].map((p: unknown) => {
        const po = p as { id: string; docNumber: string; supplierId: string; supplier?: { name?: string } };
        return { id: po.id, docNumber: po.docNumber, supplierId: po.supplierId, namaPemasok: po.supplier?.name ?? '' };
      });
      setPoList(combined);
    } catch {
      setPoList([]);
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const result = await getItems({ isActive: true });
      const list = Array.isArray(result) ? result : (result as { items?: unknown[] }).items ?? [];
      setItems(list as ItemOption[]);
    } catch {
      setItems([]);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const rows = await getItemCategories(true);
      setCategories((rows as ItemCategoryOption[]) || []);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadPOs();
    loadItems();
    loadCategories();
  }, [loadPOs, loadItems, loadCategories]);

  useEffect(() => {
    if (!poId) {
      lewatiBarisPo.current = null;
      setPoGrnCount(0);
      return;
    }
    const dariDraf = lewatiBarisPo.current === poId;
    if (!dariDraf) lewatiBarisPo.current = null;
    // PO yang sudah diganti (atau draf yang baru dimuat) tidak boleh ditimpa jawaban lama.
    let usang = false;
    (async () => {
      try {
        const po = await getPOById(poId);
        if (usang || !po || !po.supplier) return;
        setSupplierId(po.supplierId);
        const grns = (po as { grns?: Array<{ id: string }> }).grns;
        setPoGrnCount(grns?.length ?? 0);
        if (dariDraf) {
          // Barisnya dari draf; hanya angka dipesan/sudah diterima yang diperbarui.
          const angkaPo = (po.items || []).map((line) => ({
            itemId: line.itemId,
            variantSku: line.variantSku?.trim() ?? '',
            dipesan: Number(line.qty),
            diterima: line.receivedQty != null ? Number(line.receivedQty) : null,
          }));
          setLines((prev) => segarkanAngkaPo(prev, angkaPo));
          return;
        }
        const rows: LineRow[] = (po.items || [])
          .filter((line) => line.item != null)
          .map((line, i) => ({
          id: `po-${i}`,
          itemId: line.itemId,
          itemType: line.item!.type ?? '',
          sku: line.item!.sku,
          nameId: line.item!.nameId,
          uomId: line.uomId || line.item!.uom?.id || '',
          uomCode: line.item!.uom?.code ?? '',
          variantSku: line.variantSku?.trim() || undefined,
          qty: 0,
          unitCost: Number(line.price),
          rollValues: [],
          poOrderedQty: Number(line.qty),
          poAlreadyReceivedQty: line.receivedQty != null ? Number(line.receivedQty) : null,
        }));
        if (rows.length > 0) setLines(rows);
      } catch {
        if (!dariDraf && !usang) toast.error(t('loadPoFailed'));
      }
    })();
    return () => {
      usang = true;
    };
  }, [poId, t]);

  const terapkanDraf = useCallback((draf: DrafGrn, foto: Blob[]) => {
    lewatiBarisPo.current = draf.poId || null;
    setPoId(draf.poId);
    setSupplierId(draf.supplierId);
    setCategoryId(draf.categoryId);
    setNotes(draf.notes);
    setLines(barisDariDraf(draf));
    setPendingLamaId(draf.pendingLamaId);
    setDiubah(true);
    setKunciKirim(draf.kunciKirim || newLocalId());
    setPhotoFiles(
      foto.map((b, i) =>
        b instanceof File ? b : new File([b], `foto-${i + 1}.jpg`, { type: b.type || 'image/jpeg' })
      )
    );
    setErrors({});
  }, []);

  // Pulihkan draf pengguna ini + daftar GRN lama yang tidak pernah terkirim.
  useEffect(() => {
    if (!kunciDraf) return;
    let batal = false;
    (async () => {
      const [simpanan, lama] = await Promise.all([
        ambilDrafGrn(offlineDB.drafGRN, kunciDraf),
        getPendingGRNs().catch(() => [] as PendingGRN[]),
      ]);
      if (batal) return;
      const awal = awalFormulirGrn(
        poIdAwal,
        simpanan ? { poId: simpanan.draf.poId, bermakna: drafBermakna(simpanan.draf, simpanan.foto.length) } : null,
      );
      if (simpanan && (awal === 'draf' || awal === 'konflik')) {
        terapkanDraf(simpanan.draf, simpanan.foto);
        setDrafPulih(simpanan.draf.disimpanPada);
      }
      if (awal === 'po') setPoId(poIdAwal);
      if (awal === 'konflik') setPoTautanTertunda(poIdAwal);
      setGrnLama(lama);
      setDrafSiap(true);
    })();
    return () => {
      batal = true;
    };
    // poIdAwal hanya dibaca saat formulir dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunciDraf, terapkanDraf]);

  const tulisDraf = useCallback(
    (draf: DrafGrn, foto: Blob[]) => {
      antreanDraf.current = antreanDraf.current.then(async () => {
        if (selesaiRef.current) return;
        const ok = await simpanDrafGrn(offlineDB.drafGRN, kunciDraf, draf, foto);
        setDrafGagal(!ok);
      });
    },
    [kunciDraf]
  );

  const siramDraf = useCallback(() => {
    const tunda = drafTertunda.current;
    drafTertunda.current = null;
    if (tunda) tulisDraf(tunda.draf, tunda.foto);
  }, [tulisDraf]);

  // Setiap perubahan isian → draf (ditunda sebentar; foto bisa besar).
  useEffect(() => {
    if (!drafSiap || !diubah) return;
    drafTertunda.current = {
      draf: drafDariIsian({ poId, supplierId, categoryId, notes, pendingLamaId, kunciKirim, lines }, Date.now()),
      foto: photoFiles,
    };
    const pewaktu = window.setTimeout(siramDraf, 400);
    return () => window.clearTimeout(pewaktu);
  }, [drafSiap, diubah, poId, supplierId, categoryId, notes, pendingLamaId, kunciKirim, lines, photoFiles, siramDraf]);

  // Tab ditutup/disembunyikan atau pindah halaman: sisa isian ditulis segera.
  useEffect(() => {
    const sembunyi = () => {
      if (document.visibilityState === 'hidden') siramDraf();
    };
    window.addEventListener('pagehide', siramDraf);
    document.addEventListener('visibilitychange', sembunyi);
    return () => {
      window.removeEventListener('pagehide', siramDraf);
      document.removeEventListener('visibilitychange', sembunyi);
      siramDraf();
    };
  }, [siramDraf]);

  /** GRN tersimpan: hapus drafnya dan GRN lama asalnya (kalau ada). */
  const selesaikanDraf = async () => {
    selesaiRef.current = true;
    drafTertunda.current = null;
    const lamaId = pendingLamaId;
    antreanDraf.current = antreanDraf.current.then(async () => {
      await hapusDrafGrn(offlineDB.drafGRN, kunciDraf);
      if (lamaId != null) await removePendingGRN(lamaId).catch(() => {});
    });
    // IndexedDB yang macet tidak boleh menahan layar setelah GRN tersimpan.
    await Promise.race([antreanDraf.current, new Promise((r) => window.setTimeout(r, 2000))]);
  };

  const buangDraf = () => {
    // Draf tersimpan dihapus langsung: sesudah dibuang, isian kosong tidak ditulis lagi (belum diubah).
    drafTertunda.current = null;
    antreanDraf.current = antreanDraf.current.then(() => hapusDrafGrn(offlineDB.drafGRN, kunciDraf));
    setDiubah(false);
    setPoTautanTertunda(null);
    lewatiBarisPo.current = null;
    setPoId('');
    setSupplierId('');
    setCategoryId('');
    setNotes('');
    setLines([barisKosong('0')]);
    setPhotoFiles([]);
    setPendingLamaId(null);
    setKunciKirim(newLocalId());
    setPoGrnCount(0);
    setDrafPulih(null);
    setErrors({});
  };

  const muatGrnLama = (lama: PendingGRN) => {
    const barang = new Map(items.map((i) => [i.id, { type: i.type, uomCode: i.uom?.code }]));
    const foto = (lama.photoBase64 ?? [])
      .map((url, i) => fotoDariDataUrl(url, `grn-${lama.localId ?? 0}-${i + 1}.jpg`))
      .filter((f): f is File => f !== null);
    // Cap waktu draf = saat GRN lama dicatat; draf berikutnya ditulis efek simpan.
    terapkanDraf(drafDariGrnLama(lama, barang, new Date(lama.createdAt).getTime() || 0), foto);
    setDrafPulih(null);
  };

  const jalankanKonfirmasi = async () => {
    const k = konfirmasi;
    setKonfirmasi(null);
    if (!k) return;
    if (k.jenis === 'muat') {
      muatGrnLama(k.lama);
      return;
    }
    const id = k.lama.localId;
    if (id == null) return;
    try {
      await removePendingGRN(id);
    } catch {
      toast.error(t('grnLama.gagalHapus'));
      return;
    }
    setGrnLama((d) => d.filter((g) => g.localId !== id));
    if (pendingLamaId === id) setPendingLamaId(null);
  };

  const addLine = () => {
    setDiubah(true);
    setErrors((e) => ({ ...e, lines: undefined }));
    setLines((prev) => [...prev, barisKosong(`line-${nextLineId}`)]);
    setNextLineId((n) => n + 1);
  };

  const removeLine = (id: string) => {
    setDiubah(true);
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const setLineItem = (lineId: string, item: ItemOption | null) => {
    if (!item) return;
    setDiubah(true);
    const vOpts = variantSelectOptions(parseItemVariants(item.variants));
    setLines((prev) =>
      prev.map((r) =>
        r.id === lineId
          ? {
              ...r,
              itemId: item.id,
              itemType: item.type,
              sku: item.sku,
              nameId: item.nameId,
              uomId: item.uomId || (item.uom as { id?: string })?.id || '',
              uomCode: item.uom?.code ?? '',
              variantSku: vOpts.length === 1 ? vOpts[0].sku : undefined,
              rollValues: item.type === 'FABRIC' ? (r.rollValues ?? []) : undefined,
            }
          : r
      )
    );
  };

  const setLineVariantSku = (lineId: string, variantSku: string | undefined) => {
    setDiubah(true);
    setLines((prev) =>
      prev.map((r) => (r.id === lineId ? { ...r, variantSku } : r))
    );
  };

  const setLineQty = (lineId: string, qty: number) => {
    setDiubah(true);
    setLines((prev) =>
      prev.map((r) => (r.id === lineId ? { ...r, qty } : r))
    );
  };

  const parseRollValuesToLengths = (rollValues: string[]): number[] =>
    rollValues
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

  const setLineRollValues = (lineId: string, rollValues: string[]) => {
    setDiubah(true);
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== lineId) return r;
        const lengths = parseRollValuesToLengths(rollValues);
        return { ...r, rollValues, qty: lengths.reduce((sum, n) => sum + n, 0) };
      })
    );
  };

  const setLineUnitCost = (lineId: string, unitCost: number) => {
    setDiubah(true);
    setLines((prev) =>
      prev.map((r) => (r.id === lineId ? { ...r, unitCost } : r))
    );
  };

  const handleScan = (decoded: string) => {
    const trimmed = decoded.trim();
    const item = items.find((i) => i.sku === trimmed || i.sku.toLowerCase() === trimmed.toLowerCase());
    if (item) {
      const emptyIdx = lines.findIndex((l) => !l.itemId);
      if (emptyIdx >= 0) {
        setLineItem(lines[emptyIdx].id, item);
      } else {
        addLine();
        setTimeout(() => {
          setLines((prev) => {
            const last = prev[prev.length - 1];
            return prev.map((r) =>
              r.id === last.id
                ? (() => {
                    const scanVOpts = variantSelectOptions(parseItemVariants(item.variants));
                    return {
                      ...r,
                      itemId: item.id,
                      itemType: item.type,
                      sku: item.sku,
                      nameId: item.nameId,
                      uomId: item.uomId || (item.uom as { id?: string })?.id || '',
                      uomCode: item.uom?.code ?? '',
                      variantSku: scanVOpts.length === 1 ? scanVOpts[0].sku : undefined,
                    };
                  })()
                : r
            );
          });
        }, 0);
      }
      setScanOpen(false);
      toast.success(t('scanAdded', { sku: item.sku }));
    } else {
      toast.error(t('scanNotFound', { code: trimmed }));
    }
  };

  const runningTotal = lines.reduce(
    (sum, r) => sum + (r.qty || 0) * (r.unitCost || 0),
    0
  );

  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = photoFiles.map((f) => URL.createObjectURL(f));
    setPhotoPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photoFiles]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setDiubah(true);
    setPhotoFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removePhoto = (index: number) => {
    setDiubah(true);
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!kunciDraf) {
      toast.error(tToasts('youMustBeLoggedIn'));
      return;
    }
    const nextErrors: { supplierId?: string; lines?: string } = {};
    if (!supplierId) nextErrors.supplierId = t('errSelectSupplier');
    const validLines = lines.filter((l) => l.itemId && l.qty > 0 && l.unitCost >= 0);
    if (validLines.length === 0) nextErrors.lines = t('errLines');
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error(tToasts('pleaseFixErrorsBelow'));
      return;
    }

    for (const l of validLines) {
      const rowItem = items.find((i) => i.id === l.itemId);
      const vOpts = variantSelectOptions(parseItemVariants(rowItem?.variants));
      if (vOpts.length > 0 && !l.variantSku?.trim()) {
        toast.error(t('errVariant'));
        return;
      }
    }

    // GRN butuh sinyal; isiannya sudah tersimpan sebagai draf di perangkat.
    if (alasanTidakBisaSimpanGrn({ daring: sinyalSekarang() }) !== null) {
      toast.error(t('butuhSinyal'));
      return;
    }

    setIsLoading(true);
    try {
      let urls = [...photoUrls];
      if (photoFiles.length > 0) {
        try {
          const formData = new FormData();
          photoFiles.forEach((f) => formData.append('files', f));
          const res = await fetch('/api/upload/grn-photo', {
            method: 'POST',
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            urls = [...urls, ...(data.urls || [])];
          }
        } catch {
          toast.error(tToasts('photoUploadFailed'));
        }
      }

      const data: GRNFormData = {
        poId: poId || undefined,
        supplierId,
        items: validLines.map((l) => {
          const lengths = l.itemType === 'FABRIC' ? parseRollValuesToLengths(l.rollValues ?? []) : [];
          return {
            ...(l.itemType === 'FABRIC' && lengths.length > 0
              ? {
                  rolls: lengths.map((length, idx) => ({
                    rollRef: `${l.sku || 'ROLL'}-${idx + 1}`,
                    length,
                  })),
                }
              : {}),
            itemId: l.itemId,
            variantSku: l.variantSku?.trim() || undefined,
            qty: l.itemType === 'FABRIC' && lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) : l.qty,
            unitCost: l.unitCost,
            uomId: l.uomId,
          };
        }),
        notes: notes || undefined,
        photoUrls: urls.length > 0 ? urls : undefined,
        idempotencyKey: kunciKirim,
      };
      // Penolakan berkode (PO batal/draf/ditutup) dikembalikan, bukan dilempar:
      // di build produksi pesan lemparan aksi server disamarkan.
      const hasil = await simpanGRN(data);
      if (!hasil.ok) {
        toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : t('createFailed'));
        return;
      }
      await selesaikanDraf();
      // Kiriman ulang (jawaban sebelumnya hilang): GRN sudah tercatat, tidak ada yang masuk dua kali.
      toast.success(hasil.ulang ? t('sudahTercatat', { doc: hasil.docNumber }) : t('createdToast'));
      onSuccess?.();
    } catch (err: unknown) {
      // Sambungan putus: GRN mungkin sudah tercatat, mungkin belum — jangan menebak.
      if (galatSambungan(err)) {
        toast.error(t('sambunganPutus'));
      } else {
        // Pesan lemparan disamarkan di build produksi; selalu teks terjemahan.
        toast.error(t('createFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isianBermakna = drafBermakna(
    drafDariIsian({ poId, supplierId, categoryId, notes, pendingLamaId, kunciKirim, lines }, 0),
    photoFiles.length
  );

  /** Buang draf PO lain, lalu isi formulir dengan PO dari tautan "Terima barang". */
  const terimaPoTautan = () => {
    const id = poTautanTertunda;
    buangDraf();
    if (id) setPoId(id);
  };

  // Satu format pemasok di semua formulir: "Nama (KODE)", urut nama (`lib/suppliers/label-pemasok`).
  const labelPilihanPemasok = (s: Supplier) =>
    `${labelPemasok(s)}${s.disetujui === false ? ` · ${t('belumDisetujui')}` : ''}`;

  const namaPemasok = (id: string) => {
    const s = suppliers.find((x) => x.id === id);
    return s ? labelPemasok(s) : t('grnLama.pemasokTakDikenal');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!daring && (
        <Alert>
          <AlertDescription>
            {drafSiap && !drafGagal ? t('tanpaSinyalDrafAman') : t('tanpaSinyalDrafBelum')}
          </AlertDescription>
        </Alert>
      )}
      {poTautanTertunda !== null && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('drafPoLain', {
                po: poList.find((p) => p.id === poTautanTertunda)?.docNumber ?? t('poTautan'),
              })}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPoTautanTertunda(null)}>
                {t('lanjutkanDraf')}
              </Button>
              <Button type="button" size="sm" onClick={terimaPoTautan}>
                {t('buangDanTerimaPo')}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {drafPulih !== null && poTautanTertunda === null && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('draf.pulih', { time: formatDisplayDateTime(drafPulih, locale) })}</span>
            <Button type="button" variant="outline" size="sm" onClick={buangDraf}>
              {t('draf.buang')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {grnLama.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>{t('grnLama.judul', { count: grnLama.length })}</AlertTitle>
          <AlertDescription>
            <ul className="w-full divide-y">
              {grnLama.map((g) => (
                <li key={g.localId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-foreground">
                    <span className="font-medium">{namaPemasok(g.supplierId)}</span>
                    {' · '}
                    {t('grnLama.ringkas', {
                      count: g.items.length,
                      total: g.totalAmount.toLocaleString('id-ID'),
                      time: formatDisplayDateTime(g.createdAt, locale),
                    })}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {g.localId === pendingLamaId ? (
                      <Badge variant="secondary">{t('grnLama.diFormulir')}</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => (isianBermakna ? setKonfirmasi({ jenis: 'muat', lama: g }) : muatGrnLama(g))}
                      >
                        {t('grnLama.muat')}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setKonfirmasi({ jenis: 'hapus', lama: g })}>
                      {tUmum('delete')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('judulKartu')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 w-full">
              <Label htmlFor="categoryId">{t('categoryFilter')}</Label>
              <SearchableCombobox
                id="categoryId"
                options={[
                  { value: '__all__', label: t('allCategories') },
                  ...categories.map((c) => ({
                    value: c.id,
                    label: (c.code ? `${c.code} - ` : '') + c.name,
                  })),
                ]}
                value={categoryId || '__all__'}
                onValueChange={(v) => setCategoryId(v === '__all__' ? '' : v)}
                placeholder={t('allCategories')}
                searchPlaceholder={t('cariKategori')}
                triggerClassName="min-h-[44px] w-full"
              />
            </div>
            <div className="space-y-2 w-full">
              <Label htmlFor="poId">{t('poReference')}</Label>
              <SearchableCombobox
                id="poId"
                options={[
                  { value: '__none__', label: t('noPo') },
                  ...poList.map((po) => ({
                    value: po.id,
                    label: po.namaPemasok ? `${po.docNumber} · ${po.namaPemasok}` : po.docNumber,
                  })),
                ]}
                value={poId || '__none__'}
                onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
                placeholder={t('selectPo')}
                searchPlaceholder={t('cariPo')}
                triggerClassName="min-h-[44px] w-full"
              />
            </div>
            <div className="space-y-2 w-full">
              <Label htmlFor="supplierId">{t('supplier')} *</Label>
              <SearchableCombobox
                id="supplierId"
                // Pemasok belum disetujui hanya ada di pilihan sebagai pemasok PO/draf yang
                // sedang dipakai; GRN baru tanpa PO tetap untuk pemasok disetujui saja.
                options={urutPemasok(suppliers).map((s) => ({
                  value: s.id,
                  label: labelPilihanPemasok(s),
                  disabled: s.disetujui === false && s.id !== supplierId,
                }))}
                value={supplierId}
                onValueChange={(v) => {
                  setDiubah(true);
                  setSupplierId(v);
                  setErrors((e) => ({ ...e, supplierId: undefined }));
                }}
                placeholder={t('selectSupplier')}
                searchPlaceholder={t('cariPemasok')}
                aria-invalid={!!errors.supplierId}
                className={errors.supplierId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                triggerClassName="min-h-[44px] w-full"
              />
              {errors.supplierId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.supplierId}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>{t('lineItems')}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setScanOpen(true)}
                >
                  <Barcode className="mr-2 h-4 w-4" />
                  {t('scanBarcode')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="min-h-[44px]">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('addLine')}
                </Button>
              </div>
            </div>
            {errors.lines && (
              <p className="text-sm text-destructive" role="alert">
                {errors.lines}
              </p>
            )}
            {adaYangBisaDiisi(lines) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t('isiSisaPenjelasan')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => {
                    setDiubah(true);
                    setLines((prev) => isiKosongDenganSisa(prev));
                  }}
                >
                  {t('isiSemuaSisa')}
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[16rem]">{t('colItem')}</TableHead>
                    <TableHead>{t('colVariant')}</TableHead>
                    <TableHead>{t('colUom')}</TableHead>
                    <TableHead className="min-w-[8rem] text-right">{t('colQty')}</TableHead>
                    <TableHead className="min-w-[9rem] text-right">{t('colUnitCost')}</TableHead>
                    <TableHead className="text-right">{t('colTotal')}</TableHead>
                    <TableHead className="w-10 sticky right-0 bg-card">
                      <span className="sr-only">{t('colActions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((row) => {
                    const rowItem = items.find((i) => i.id === row.itemId);
                    const rowVOpts = variantSelectOptions(parseItemVariants(rowItem?.variants));
                    const kain = row.itemType === 'FABRIC';
                    const sisa = sisaPo(row);
                    const satuan = row.uomCode || (kain ? 'MTR' : '');
                    const lebih = lebihDariSisa(row);
                    const rollVals = row.rollValues ?? [];
                    const lengths = parseRollValuesToLengths(rollVals);
                    const invalidCount = rollVals.length - lengths.length;
                    return (
                    <Fragment key={row.id}>
                      <TableRow className={kain ? 'border-b-0' : undefined}>
                        <TableCell className="align-top whitespace-normal">
                          <SearchableCombobox
                            options={items
                              .filter((i) => !categoryId || i.categoryId === categoryId)
                              .map((i) => ({ value: i.id, label: `${i.sku} – ${i.nameId}` }))}
                            value={row.itemId}
                            onValueChange={(v) => {
                              const item = items.find((i) => i.id === v);
                              if (item) setLineItem(row.id, item);
                            }}
                            placeholder={t('selectItem')}
                            searchPlaceholder={t('cariBarang')}
                            triggerClassName="min-h-[44px]"
                          />
                          {/* Angka PO baris ini: gudang tidak perlu membuka rincian PO di tab lain. */}
                          {sisa != null && (
                            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                              {t('angkaPo', {
                                dipesan: Number(row.poOrderedQty ?? 0).toLocaleString('id-ID'),
                                sudah: Number(row.poAlreadyReceivedQty ?? 0).toLocaleString('id-ID'),
                                sisa: sisa.toLocaleString('id-ID'),
                                satuan,
                              })}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[10rem] max-w-[14rem] align-top">
                          {rowVOpts.length === 0 ? (
                            <span className="text-sm text-muted-foreground">—</span>
                          ) : (
                            <Select
                              value={row.variantSku?.trim() ? row.variantSku : '__none__'}
                              onValueChange={(v) =>
                                setLineVariantSku(row.id, v === '__none__' ? undefined : v)
                              }
                            >
                              <SelectTrigger className="min-h-[44px] w-full max-w-[14rem]">
                                <SelectValue placeholder={t('colVariant')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">{t('selectVariant')}</SelectItem>
                                {rowVOpts.map((o) => (
                                  <SelectItem key={o.sku} value={o.sku}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="align-top pt-4">{row.uomCode || '-'}</TableCell>
                        <TableCell className="align-top whitespace-normal">
                          {kain ? (
                            // Kain: qty = jumlah panjang roll di baris di bawahnya, bukan diketik.
                            <div className="min-h-[44px] text-right">
                              <p className="pt-2 font-medium tabular-nums">
                                {(row.qty || 0).toLocaleString('id-ID')}
                              </p>
                              <p className="text-xs text-muted-foreground">{t('qtyDariRoll')}</p>
                            </div>
                          ) : (
                            <>
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                className="min-h-[44px] w-full min-w-[6rem] text-right tabular-nums"
                                aria-label={t('qtyUntuk', { barang: row.sku || t('barisBaru') })}
                                value={row.qty || ''}
                                onChange={(e) => setLineQty(row.id, parseFloat(e.target.value) || 0)}
                              />
                              {bisaDiisiSisa(row) && row.qty !== sisa && (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto px-0 py-1 text-xs"
                                  onClick={() => setLineQty(row.id, sisa as number)}
                                >
                                  {t('isiSisa', { sisa: (sisa as number).toLocaleString('id-ID') })}
                                </Button>
                              )}
                            </>
                          )}
                          {lebih && (
                            <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
                              {t('melebihiSisa', { sisa: (sisa ?? 0).toLocaleString('id-ID') })}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            className="min-h-[44px] w-full min-w-[7rem] text-right tabular-nums"
                            aria-label={t('hargaUntuk', { barang: row.sku || t('barisBaru') })}
                            value={row.unitCost || ''}
                            onChange={(e) => setLineUnitCost(row.id, parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="align-top pt-4 text-right tabular-nums">
                          Rp {((row.qty || 0) * (row.unitCost || 0)).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={t('removeLine')}
                            title={t('removeLine')}
                            onClick={() => removeLine(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {kain && (
                        // Panjang roll di baris sendiri, hanya untuk kain — dulu kolom 238 px
                        // berisi "-" untuk barang lain dan memeras isian Qty jadi 26 px.
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/20 py-3 whitespace-normal">
                            <div className="space-y-3">
                              <Label className="text-sm">{t('colRollLengths')}</Label>
                              <FabricRollInput
                                value={rollVals}
                                onChange={(v) => setLineRollValues(row.id, v)}
                                uomCode={satuan || 'MTR'}
                                poOrderedQty={row.poOrderedQty}
                                placeholder="100, 50, 100..."
                                showRackPreview={false}
                                aria-label={t('rollLengthsFor', { sku: row.sku || t('fabricFallback') })}
                                className="max-w-xl"
                              />
                              {rollVals.length > 0 && (
                                <>
                                  <p className="text-sm text-muted-foreground">
                                    {t('rollCount', { count: rollVals.length })}
                                    {invalidCount > 0 && (
                                      <span className="text-destructive"> {t('rollInvalid', { count: invalidCount })}</span>
                                    )}{' '}
                                    · {lengths.reduce((x, y) => x + y, 0).toLocaleString('id-ID')} {satuan || 'MTR'}
                                    {(poGrnCount > 0 || Number(row.poAlreadyReceivedQty ?? 0) > 0) && row.poOrderedQty != null && (
                                      <span className="ml-1">
                                        · {t('alreadyReceived', {
                                          qty: Number(row.poAlreadyReceivedQty ?? 0).toLocaleString('id-ID'),
                                          uom: satuan || 'MTR',
                                          count: poGrnCount,
                                        })}
                                      </span>
                                    )}
                                  </p>
                                  <FabricRackPreview
                                    rollValues={rollVals}
                                    uomCode={satuan || 'MTR'}
                                    onRemoveRoll={(index) =>
                                      setLineRollValues(
                                        row.id,
                                        (row.rollValues ?? []).filter((_, i) => i !== index)
                                      )
                                    }
                                  />
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm font-medium">{t('runningTotal', { total: runningTotal.toLocaleString('id-ID') })}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grn-foto">{t('photosOptional')}</Label>
            {/* Tombol sendiri: input berkas bawaan peramban berbahasa Inggris ("Choose Files"). */}
            <input
              ref={inputFotoRef}
              id="grn-foto"
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              className="sr-only"
              tabIndex={-1}
            />
            <div>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => inputFotoRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                {t('pilihFoto')}
              </Button>
            </div>
            {photoFiles.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">{t('filesSelected', { count: photoFiles.length })}</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                  {photoPreviewUrls.map((url, index) => (
                    <div
                      key={`${url}-${index}`}
                      className="relative aspect-square rounded-lg border bg-muted overflow-hidden group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- object URL preview, not a static asset */}
                      <img
                        src={url}
                        alt={t('photoPreview', { index: index + 1 })}
                        className="w-full h-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-7 w-7 opacity-90 group-hover:opacity-100"
                        onClick={() => removePhoto(index)}
                        aria-label={t('removePhoto')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('notes')}</Label>
            <Textarea
              value={notes}
              onChange={(e) => {
                setDiubah(true);
                setNotes(e.target.value);
              }}
              placeholder={t('notesPlaceholder')}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button type="submit" disabled={isLoading || alasanSimpan !== null} className="min-h-[44px] w-full sm:w-auto">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('creating')}
            </>
          ) : (
            t('createButton')
          )}
        </Button>
        {alasanSimpan !== null && (
          <p className="text-sm text-muted-foreground" role="status">
            {t('butuhSinyal')}
          </p>
        )}
      </div>

      <AlertDialog
        open={konfirmasi !== null}
        onOpenChange={(buka) => {
          if (!buka) setKonfirmasi(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {konfirmasi?.jenis === 'hapus' ? t('grnLama.hapusJudul') : t('grnLama.muatJudul')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {konfirmasi?.jenis === 'hapus' ? t('grnLama.hapusIsi') : t('grnLama.muatIsi')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tUmum('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={konfirmasi?.jenis === 'hapus' ? 'destructive' : 'default'}
              onClick={jalankanKonfirmasi}
            >
              {konfirmasi?.jenis === 'hapus' ? tUmum('delete') : t('grnLama.muat')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('scanBarcodeTitle')}</DialogTitle>
          </DialogHeader>
          <BarcodeScanner
            onScan={handleScan}
            onClose={() => setScanOpen(false)}
            width={300}
          />
        </DialogContent>
      </Dialog>
    </form>
  );
}
