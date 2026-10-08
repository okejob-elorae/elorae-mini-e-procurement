'use client';

import { Fragment, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { toast } from 'sonner';
import { createVendorReturn, getReturnableFabricRolls, getAvailableRejectQtyByItem } from '@/app/actions/vendor-returns';
import { getWorkOrders } from '@/app/actions/production';
import { getItems } from '@/app/actions/items';
import { getGRNs, getRincianGRN } from '@/app/actions/grn';
import { BuktiRetur, PerkiraanNilaiRetur } from '../BuktiDanNilaiRetur';
import { pisahTautanBukti, type BarisPerkiraan } from '../perkiraan-nilai';
import { labelPemasok, urutPemasok } from '@/lib/suppliers/label-pemasok';
import type { VendorReturnLineInput } from '@/app/actions/vendor-returns';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';

interface Supplier {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface WorkOrderOption {
  id: string;
  docNumber: string;
}

interface GRNOption {
  id: string;
  docNumber: string;
  supplierId?: string;
}

type ItemTypeOption = 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD';

interface ItemOption {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type?: ItemTypeOption;
}

type LineType = 'FABRIC' | 'ACCESSORIES' | 'FG_REJECT';
type Condition = 'GOOD' | 'DAMAGED' | 'DEFECTIVE';

interface FormLine {
  type: LineType;
  itemId: string;
  /** For FABRIC: selected roll IDs (multiple). Qty derived from sum of roll lengths. */
  rollIds?: string[];
  qty: string;
  reason: string;
  condition: Condition;
  referenceIssueId?: string;
}

export default function NewVendorReturnPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('vendorReturn');
  const lineTypeLabel = (type: string) =>
    type === 'FABRIC' || type === 'ACCESSORIES' || type === 'FG_REJECT'
      ? t(`lineType.${type}`)
      : type;
  const conditionLabel = (condition: string) =>
    condition === 'GOOD' || condition === 'DAMAGED' || condition === 'DEFECTIVE'
      ? t(`condition.${condition}`)
      : condition;
  const [vendors, setVendors] = useState<Supplier[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [grns, setGrns] = useState<GRNOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [woId, setWoId] = useState<string>('__none__');
  const [grnId, setGrnId] = useState<string>('__none__');
  const [vendorId, setVendorId] = useState<string>('');
  const [lines, setLines] = useState<FormLine[]>([
    { type: 'FABRIC', itemId: '', rollIds: [], qty: '', reason: '', condition: 'GOOD' }
  ]);
  const [evidenceUrls, setEvidenceUrls] = useState<string>('');
  // `?grnId=` dari tombol "Retur ke pemasok" di rincian GRN: GRN, pemasok, dan barangnya terisi.
  const grnIdAwal = useSearchParams().get('grnId') ?? '';
  const [dariGrn, setDariGrn] = useState<string | null>(null);
  const [fabricRollOptions, setFabricRollOptions] = useState<
    Record<string, Array<{ value: string; label: string; qty: number }>>
  >({});

  useEffect(() => {
    const load = async () => {
      try {
        const { getSuppliersForSelect } = await import('@/app/actions/suppliers');
        const [supplierData, woList, itemsRes, grnList] = await Promise.all([
          getSuppliersForSelect({ approvedOnly: true }),
          getWorkOrders(),
          getItems({ isActive: true }),
          getGRNs()
        ]);
        {
          const data = supplierData;
          const list = Array.isArray(data) ? data : [];
          setVendors((list as unknown as Supplier[]) || []);
        }
        setWorkOrders(
          (woList as { id: string; docNumber: string }[]).map((w) => ({
            id: w.id,
            docNumber: w.docNumber
          }))
        );
        const daftarGrn = (grnList as { id: string; docNumber: string; supplierId?: string }[]).map((g) => ({
          id: g.id,
          docNumber: g.docNumber,
          supplierId: g.supplierId,
        }));
        setGrns(daftarGrn);
        const raw =
          Array.isArray(itemsRes) ? itemsRes : (itemsRes as { items?: unknown[] })?.items ?? [];
        const itemList: ItemOption[] = Array.isArray(raw)
          ? raw
              .filter(
                (i): i is Record<'id' | 'sku' | 'nameId' | 'nameEn' | 'type', string> =>
                  typeof i === 'object' &&
                  i !== null &&
                  'id' in i &&
                  'sku' in i &&
                  'nameId' in i &&
                  'nameEn' in i
              )
              .map((i) => ({
                id: i.id,
                sku: i.sku,
                nameId: i.nameId,
                nameEn: i.nameEn,
                type: (i.type as ItemTypeOption) || undefined,
              }))
          : [];
        setItems(itemList);

        const grnAwal = grnIdAwal ? daftarGrn.find((g) => g.id === grnIdAwal) : undefined;
        if (grnAwal) {
          setGrnId(grnAwal.id);
          if (grnAwal.supplierId) setVendorId(grnAwal.supplierId);
          setDariGrn(grnAwal.docNumber);
          // Barang GRN (butuh izin inventori; tanpa itu hanya GRN dan pemasok yang terisi).
          const rincian = await getRincianGRN(grnAwal.id).catch(() => null);
          const jenisBarang = new Map(itemList.map((it) => [it.id, it.type]));
          const baris: FormLine[] = (rincian?.baris ?? []).flatMap((b): FormLine[] => {
            const jenis = jenisBarang.get(b.itemId);
            if (jenis === 'FABRIC') return [{ type: 'FABRIC', itemId: b.itemId, rollIds: [], qty: '', reason: '', condition: 'GOOD' }];
            if (jenis === 'ACCESSORIES') return [{ type: 'ACCESSORIES', itemId: b.itemId, qty: '', reason: '', condition: 'GOOD' }];
            return [];
          });
          if (baris.length > 0) {
            setLines(baris);
            // Roll kain yang bisa diretur untuk setiap baris kain (sama dengan memilih barangnya).
            const kain = [...new Set(baris.filter((b) => b.type === 'FABRIC').map((b) => b.itemId))];
            const rollPerBarang = await Promise.all(
              kain.map(async (itemId) => [itemId, await getReturnableFabricRolls(itemId).catch(() => [])] as const)
            );
            setFabricRollOptions((prev) => {
              const baru = { ...prev };
              for (const [itemId, rolls] of rollPerBarang) {
                baru[itemId] = rolls.map((r) => ({
                  value: r.id,
                  label: `${r.rollRef} (${r.remainingLength.toLocaleString('id-ID')} MTR)`,
                  qty: r.remainingLength,
                }));
              }
              return baru;
            });
          }
        }
      } catch {
        toast.error(t('form.loadDataFailed'));
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // grnIdAwal hanya dibaca saat formulir dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { type: 'FABRIC', itemId: '', rollIds: [], qty: '', reason: '', condition: 'GOOD' }
    ]);
  };

  const removeLine = (index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateLine = (index: number, field: keyof FormLine, value: string) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        if (field === 'type') {
          updated.itemId = '';
          updated.rollIds = [];
          updated.qty = '';
        }
        return updated;
      })
    );
  };


  /** Filter items by line type: FABRIC → fabric items, ACCESSORIES → accessories, FG_REJECT → finished goods. */
  const itemOptionsForLineType = (lineType: LineType): ItemOption[] => {
    if (lineType === 'FABRIC') return items.filter((it) => it.type === 'FABRIC');
    if (lineType === 'ACCESSORIES') return items.filter((it) => it.type === 'ACCESSORIES');
    if (lineType === 'FG_REJECT') return items.filter((it) => it.type === 'FINISHED_GOOD');
    return items;
  };

  const loadFabricRollsForItem = async (itemId: string) => {
    if (!itemId) return;
    try {
      const rolls = await getReturnableFabricRolls(itemId);
      setFabricRollOptions((prev) => ({
        ...prev,
        [itemId]: rolls.map((r) => ({
          value: r.id,
          label: `${r.rollRef} (${r.remainingLength.toLocaleString('id-ID')} MTR)`,
          qty: r.remainingLength,
        })),
      }));
    } catch {
      toast.error(t('form.loadRollsFailed'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) return;

    const parsedLines: VendorReturnLineInput[] = [];
    const optsByItem = fabricRollOptions;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.itemId || (l.reason?.trim().length ?? 0) < 3) {
        toast.error(t('form.lineItemReasonRequired', { line: i + 1 }));
        return;
      }
      if (l.type === 'FABRIC') {
        const rollIds = l.rollIds ?? [];
        if (rollIds.length === 0) {
          toast.error(t('form.lineRollRequired', { line: i + 1 }));
          return;
        }
        const itemRollOpts = optsByItem[l.itemId] ?? [];
        for (const rollId of rollIds) {
          const opt = itemRollOpts.find((o) => o.value === rollId);
          const qty = opt?.qty ?? 0;
          if (!(qty > 0)) continue;
          parsedLines.push({
            type: 'FABRIC',
            itemId: l.itemId,
            qty,
            reason: l.reason.trim(),
            condition: l.condition as Condition,
            referenceIssueId: l.referenceIssueId || undefined,
            rollId,
          });
        }
        continue;
      }
      const qty = Number(l.qty);
      if (!(qty > 0)) {
        toast.error(t('form.lineQtyRequired', { line: i + 1 }));
        return;
      }
      if (l.type === 'FG_REJECT') {
        try {
          const available = await getAvailableRejectQtyByItem(l.itemId);
          if (qty > available) {
            toast.error(t('form.lineRejectExceeds', { line: i + 1, max: available }));
            return;
          }
        } catch {
          toast.error(t('form.lineRejectCheckFailed', { line: i + 1 }));
          return;
        }
      }
      parsedLines.push({
        type: l.type,
        itemId: l.itemId,
        qty,
        reason: l.reason.trim(),
        condition: l.condition as Condition,
        referenceIssueId: l.referenceIssueId || undefined,
      });
    }

    if (!vendorId) {
      toast.error(t('form.selectVendorToast'));
      return;
    }

    setIsSubmitting(true);
    try {
      const urls = pisahTautanBukti(evidenceUrls);
      const invalidUrl = urls.find((u) => {
        try {
          new URL(u);
          return false;
        } catch {
          return true;
        }
      });
      if (invalidUrl) {
        toast.error(t('form.invalidEvidenceUrl', { url: invalidUrl }));
        setIsSubmitting(false);
        return;
      }

      await createVendorReturn(
        {
          woId: woId === '__none__' ? undefined : woId,
          grnId: grnId === '__none__' ? undefined : grnId,
          vendorId,
          lines: parsedLines,
          evidenceUrls: urls.length > 0 ? urls : undefined
        },
        session.user.id
      );
      toast.success(t('form.created'));
      router.replace('/backoffice/vendor-returns');
    } catch {
      // Pesan lemparan disamarkan di build produksi: selalu teks terjemahan.
      toast.error(t('form.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Perkiraan nilai: kain = jumlah panjang roll yang dipilih, lainnya = qty yang diketik.
  const barisPerkiraan: BarisPerkiraan[] = lines.map((l) => ({
    type: l.type,
    itemId: l.itemId,
    qty:
      l.type === 'FABRIC'
        ? (l.rollIds ?? []).reduce(
            (n, id) => n + ((fabricRollOptions[l.itemId] ?? []).find((o) => o.value === id)?.qty ?? 0),
            0
          )
        : Number(l.qty) || 0,
  }));

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/vendor-returns">
          <Button variant="ghost" size="icon" aria-label={t('backToList')} title={t('backToList')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t('form.judulBaru')}</h1>
          <TombolBantuan judul={t('form.judulBaru')} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('form.judulKartu')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dariGrn && <p className="text-sm text-muted-foreground">{t('form.dariGrn', { grn: dariGrn })}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>{t('form.vendorLabel')}</Label>
                <SearchableCombobox
                  options={urutPemasok(vendors).map((v) => ({ value: v.id, label: labelPemasok(v) }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder={t('form.selectVendor')}
                  searchPlaceholder={t('form.cariPemasok')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('form.woLabel')}</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: t('form.none') },
                    ...workOrders.map((w) => ({ value: w.id, label: w.docNumber })),
                  ]}
                  value={woId}
                  onValueChange={setWoId}
                  placeholder={t('form.none')}
                  searchPlaceholder={t('form.cariPerintahKerja')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('form.grnLabel')}</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: t('form.none') },
                    ...grns.map((grn) => ({ value: grn.id, label: grn.docNumber })),
                  ]}
                  value={grnId}
                  onValueChange={setGrnId}
                  placeholder={t('form.selectGrn')}
                  searchPlaceholder={t('form.cariGrn')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>{t('form.lineItems')}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('form.addLine')}
                </Button>
              </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colType')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="w-24">{t('colQty')}</TableHead>
                    <TableHead>{t('colCondition')}</TableHead>
                    <TableHead>{t('colReason')}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{t('form.colActions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, i) => (
                    <Fragment key={i}>
                      <TableRow>
                        <TableCell>
                          <Select
                            value={line.type}
                            onValueChange={(v) => updateLine(i, 'type', v)}
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="FABRIC">{lineTypeLabel('FABRIC')}</SelectItem>
                              <SelectItem value="ACCESSORIES">{lineTypeLabel('ACCESSORIES')}</SelectItem>
                              <SelectItem value="FG_REJECT">{lineTypeLabel('FG_REJECT')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <SearchableCombobox
                            options={itemOptionsForLineType(line.type).map((it) => ({
                              value: it.id,
                              label: `${it.sku} – ${it.nameId || it.nameEn}`,
                            }))}
                            value={line.itemId}
                            onValueChange={(v) => {
                              setLines((prev) =>
                                prev.map((l, idx) =>
                                  idx === i
                                    ? { ...l, itemId: v, ...(l.type === 'FABRIC' ? { rollIds: [], qty: '' } : {}) }
                                    : l
                                )
                              );
                              if (lines[i].type === 'FABRIC' && v) void loadFabricRollsForItem(v);
                            }}
                            placeholder={t('form.selectItem')}
                            searchPlaceholder={t('form.cariBarang')}
                            triggerClassName="min-w-[180px]"
                          />
                        </TableCell>
                        <TableCell>
                          {line.type === 'FABRIC' ? (
                            <SearchableCombobox
                              options={(fabricRollOptions[line.itemId] ?? [])
                                .filter((o) => !(line.rollIds ?? []).includes(o.value))
                                .map((o) => ({ value: o.value, label: o.label }))}
                              value=""
                              onValueChange={(rollId) => {
                                if (!rollId || (line.rollIds ?? []).includes(rollId)) return;
                                setLines((prev) =>
                                  prev.map((l, idx) =>
                                    idx === i
                                      ? { ...l, rollIds: [...(l.rollIds ?? []), rollId] }
                                      : l
                                  )
                                );
                              }}
                              placeholder={t('form.selectRoll')}
                              searchPlaceholder={t('form.cariRoll')}
                              triggerClassName="min-w-[160px]"
                            />
                          ) : (
                            <Input
                              type="number"
                              min={0.0001}
                              step="any"
                              value={line.qty}
                              onChange={(e) => updateLine(i, 'qty', e.target.value)}
                              placeholder="0"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={line.condition}
                            onValueChange={(v) => updateLine(i, 'condition', v)}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="GOOD">{conditionLabel('GOOD')}</SelectItem>
                              <SelectItem value="DAMAGED">{conditionLabel('DAMAGED')}</SelectItem>
                              <SelectItem value="DEFECTIVE">{conditionLabel('DEFECTIVE')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.reason}
                            onChange={(e) => updateLine(i, 'reason', e.target.value)}
                            placeholder={t('form.reasonPlaceholder')}
                            className="min-w-[160px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(i)}
                            disabled={lines.length <= 1}
                            aria-label={t('form.removeLine', { line: i + 1 })}
                            title={t('form.removeLine', { line: i + 1 })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {line.type === 'FABRIC' && (line.rollIds ?? []).length > 0 && (
                        <TableRow className="bg-muted/40">
                          <TableCell colSpan={6}>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-muted-foreground">{t('form.rolls')}</span>
                              {(line.rollIds ?? []).map((rollId) => {
                                const opts = fabricRollOptions[line.itemId] ?? [];
                                const selected = opts.find((o) => o.value === rollId);
                                const label = selected?.label ?? rollId;
                                return (
                                  <Badge
                                    key={rollId}
                                    variant="secondary"
                                    asChild
                                    className="cursor-pointer border-border gap-1.5 py-1 transition-[color,background-color,border-color] hover:bg-destructive/20 hover:border-destructive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setLines((prev) =>
                                          prev.map((l, idx) =>
                                            idx === i
                                              ? {
                                                  ...l,
                                                  rollIds: (l.rollIds ?? []).filter((id) => id !== rollId),
                                                }
                                              : l
                                          )
                                        );
                                      }}
                                      aria-label={t('form.removeRoll', { label })}
                                    >
                                      {label}
                                      <span
                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                        aria-hidden
                                      >
                                        ×
                                      </span>
                                    </button>
                                  </Badge>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PerkiraanNilaiRetur baris={barisPerkiraan} />
            </div>

            <BuktiRetur teks={evidenceUrls} onTeksChange={setEvidenceUrls} />
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('form.creating') : t('form.tombolBuat')}
          </Button>
          <Link href="/backoffice/vendor-returns">
            <Button type="button" variant="outline">
              {t('cancel')}
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
