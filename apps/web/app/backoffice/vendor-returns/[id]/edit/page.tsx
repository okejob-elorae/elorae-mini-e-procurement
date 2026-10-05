'use client';

import { Fragment, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import {
  getVendorReturnById,
  updateVendorReturn,
  getReturnableFabricRolls,
  getAvailableRejectQtyByItem
} from '@/app/actions/vendor-returns';
import { getWorkOrders } from '@/app/actions/production';
import { getItems } from '@/app/actions/items';
import { getGRNs } from '@/app/actions/grn';
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

interface StoredLine {
  type: string;
  itemId: string;
  qty: number;
  reason: string;
  condition: string;
  referenceIssueId?: string;
  rollId?: string;
  rollRef?: string;
}

/** Prisma Json / server action may return lines as string or array */
function normalizeReturnLines(raw: unknown): StoredLine[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as StoredLine[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as StoredLine[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function EditVendorReturnPage() {
  const params = useParams();
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
  const id = typeof params.id === 'string' ? params.id : '';

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
  const [fabricRollOptions, setFabricRollOptions] = useState<
    Record<string, { value: string; label: string; qty: number }[]>
  >({});

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const [ret, suppliersRes, woList, itemsRes, grnList] = await Promise.all([
          getVendorReturnById(id),
          import('@/app/actions/suppliers').then(({ getSuppliersForSelect }) =>
            getSuppliersForSelect({ approvedOnly: true })
          ),
          getWorkOrders(),
          getItems({ isActive: true }),
          getGRNs()
        ]);

        if (!ret || ret.status !== 'DRAFT') {
          toast.error(t('form.notEditable'));
          router.replace('/backoffice/vendor-returns');
          return;
        }

        setVendorId(ret.vendorId);
        setWoId(ret.woId ?? '__none__');
        const retGrnId = (ret as { grnId?: string | null }).grnId;
        setGrnId(retGrnId && String(retGrnId).length > 0 ? String(retGrnId) : '__none__');

        const rawLines = normalizeReturnLines(ret.lines);
        if (rawLines.length > 0) {
          const fabricKey = (itemId: string, reason: string, condition: string) =>
            `${itemId}\0${reason}\0${condition}`;
          const fabricGroups = new Map<string, FormLine>();
          const formLines: FormLine[] = [];

          for (const l of rawLines) {
            const type = (l.type as LineType) ?? 'FABRIC';
            const itemId = l.itemId ?? '';
            const reason = l.reason ?? '';
            const condition = (l.condition as Condition) ?? 'GOOD';

            if (type === 'FABRIC' && l.rollId) {
              const key = fabricKey(itemId, reason, condition);
              let fl = fabricGroups.get(key);
              if (!fl) {
                fl = {
                  type: 'FABRIC',
                  itemId,
                  rollIds: [],
                  qty: '',
                  reason,
                  condition,
                  referenceIssueId: l.referenceIssueId,
                };
                fabricGroups.set(key, fl);
              }
              fl.rollIds = [...(fl.rollIds ?? []), l.rollId];
            } else if (type === 'FABRIC') {
              formLines.push({
                type: 'FABRIC',
                itemId,
                rollIds: [],
                qty: String(l.qty ?? ''),
                reason,
                condition,
                referenceIssueId: l.referenceIssueId,
              });
            } else {
              formLines.push({
                type,
                itemId,
                rollIds: [],
                qty: String(l.qty ?? ''),
                reason,
                condition,
                referenceIssueId: l.referenceIssueId,
              });
            }
          }
          const merged = [...fabricGroups.values(), ...formLines];
          setLines(merged.length > 0 ? merged : [{ type: 'FABRIC', itemId: '', rollIds: [], qty: '', reason: '', condition: 'GOOD' }]);

          const fabricItemIds = [...new Set(merged.filter((x) => x.type === 'FABRIC' && x.itemId).map((x) => x.itemId))];
          const options: Record<string, { value: string; label: string; qty: number }[]> = {};
          for (const itemId of fabricItemIds) {
            const rolls = await getReturnableFabricRolls(itemId);
            options[itemId] = rolls.map((r) => ({
              value: r.id,
              label: `${r.rollRef} (${r.remainingLength})`,
              qty: r.remainingLength
            }));
          }
          for (const fl of merged) {
            if (fl.type !== 'FABRIC' || !fl.itemId || !(fl.rollIds?.length)) continue;
            const list = [...(options[fl.itemId] ?? [])];
            for (const rid of fl.rollIds!) {
              if (list.some((o) => o.value === rid)) continue;
              const sl = rawLines.find((r) => r.rollId === rid && r.itemId === fl.itemId);
              const q = sl != null ? Number(sl.qty) : 0;
              list.push({
                value: rid,
                label: sl?.rollRef ? `${sl.rollRef} (${q})` : rid,
                qty: q > 0 ? q : 0.0001,
              });
            }
            options[fl.itemId] = list;
          }
          setFabricRollOptions((prev) => ({ ...prev, ...options }));
        }

        let urlsStr = '';
        if (ret.evidenceUrls) {
          try {
            const parsed =
              typeof ret.evidenceUrls === 'string'
                ? JSON.parse(ret.evidenceUrls)
                : ret.evidenceUrls;
            urlsStr = Array.isArray(parsed) ? parsed.join('\n') : '';
          } catch {
            urlsStr = '';
          }
        }
        setEvidenceUrls(urlsStr);

        const vendorList = Array.isArray(suppliersRes) ? suppliersRes : [];
        setVendors(vendorList as unknown as Supplier[]);
        setWorkOrders(
          (woList as { id: string; docNumber: string }[]).map((w) => ({
            id: w.id,
            docNumber: w.docNumber
          }))
        );
        const grnRows = (grnList as { id: string; docNumber: string }[]).map((g) => ({
          id: g.id,
          docNumber: g.docNumber,
        }));
        const retGrn = (ret as { grn?: { id: string; docNumber: string } | null }).grn;
        if (retGrn?.id && !grnRows.some((g) => g.id === retGrn.id)) {
          grnRows.unshift({ id: retGrn.id, docNumber: retGrn.docNumber });
        }
        setGrns(grnRows);
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
      } catch {
        toast.error(t('form.loadDataFailed'));
        router.replace('/backoffice/vendor-returns');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, router, t]);

  /** Filter items by line type: FABRIC → fabric items, ACCESSORIES → accessories, FG_REJECT → finished goods. */
  const itemOptionsForLineType = (lineType: LineType): ItemOption[] => {
    if (lineType === 'FABRIC') return items.filter((it) => it.type === 'FABRIC');
    if (lineType === 'ACCESSORIES') return items.filter((it) => it.type === 'ACCESSORIES');
    if (lineType === 'FG_REJECT') return items.filter((it) => it.type === 'FINISHED_GOOD');
    return items;
  };

  const loadFabricRollsForItem = async (itemId: string) => {
    if (!itemId) return;
    const rolls = await getReturnableFabricRolls(itemId);
    setFabricRollOptions((prev) => ({
      ...prev,
      [itemId]: rolls.map((r) => ({
        value: r.id,
        label: `${r.rollRef} (${r.remainingLength})`,
        qty: r.remainingLength
      }))
    }));
  };

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
        } else if (field === 'itemId' && line.type === 'FABRIC' && value) {
          loadFabricRollsForItem(value);
          return { ...updated, rollIds: [], qty: '' };
        }
        return updated;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !id) return;

    const parsedLines: VendorReturnLineInput[] = [];
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
        const itemRollOpts = fabricRollOptions[l.itemId] ?? [];
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
      const urls = evidenceUrls
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
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

      await updateVendorReturn(
        id,
        {
          woId: woId === '__none__' ? undefined : woId,
          grnId: grnId === '__none__' ? undefined : grnId,
          vendorId,
          lines: parsedLines,
          evidenceUrls: urls.length > 0 ? urls : undefined
        },
        session.user.id
      );
      toast.success(t('form.updated'));
      router.replace('/backoffice/vendor-returns');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('form.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <h1 className="text-2xl font-bold">{t('form.editTitle')}</h1>
          <TombolBantuan judul={t('form.editTitle')} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('form.cardTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>{t('form.vendorLabel')}</Label>
                <SearchableCombobox
                  options={vendors.map((v) => ({ value: v.id, label: `${v.code} – ${v.name}` }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder={t('form.selectVendor')}
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
                            onValueChange={(v) => updateLine(i, 'itemId', v)}
                            placeholder={t('form.selectItem')}
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
            <p className="mt-2 text-sm text-muted-foreground">
              {t('form.totalValueNote')}
            </p>
            </div>

            <div className="space-y-2">
              <Label>{t('form.evidenceLabel')}</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={evidenceUrls}
                onChange={(e) => setEvidenceUrls(e.target.value)}
                placeholder={t('form.evidencePlaceholder')}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('form.saving') : t('form.saveChanges')}
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
