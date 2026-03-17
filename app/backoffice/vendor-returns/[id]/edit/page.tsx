'use client';

import { Fragment, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
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

export default function EditVendorReturnPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
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
          fetch('/api/suppliers?approvedOnly=true'),
          getWorkOrders(),
          getItems({ isActive: true }),
          getGRNs()
        ]);

        if (!ret || ret.status !== 'DRAFT') {
          toast.error('Return not found or cannot be edited');
          router.replace('/backoffice/vendor-returns');
          return;
        }

        setVendorId(ret.vendorId);
        setWoId(ret.woId ?? '__none__');
        setGrnId((ret as { grnId?: string | null }).grnId ?? '__none__');

        const rawLines = (ret.lines as StoredLine[] | null) || [];
        if (rawLines.length > 0) {
          const formLines: FormLine[] = [];
          for (const l of rawLines) {
            const type = (l.type as LineType) ?? 'FABRIC';
            const itemId = l.itemId ?? '';
            const reason = l.reason ?? '';
            const condition = (l.condition as Condition) ?? 'GOOD';
            if (type === 'FABRIC' && l.rollId && formLines.length > 0) {
              const last = formLines[formLines.length - 1];
              if (last.type === 'FABRIC' && last.itemId === itemId && last.reason === reason && last.condition === condition) {
                last.rollIds = [...(last.rollIds ?? []), l.rollId!];
                continue;
              }
            }
            formLines.push({
              type,
              itemId,
              qty: String(l.qty ?? ''),
              reason,
              condition,
              referenceIssueId: l.referenceIssueId,
              rollIds: type === 'FABRIC' && l.rollId ? [l.rollId] : [],
            });
          }
          setLines(formLines);
          const fabricItemIds = [...new Set(formLines.filter((l) => l.type === 'FABRIC' && l.itemId).map((l) => l.itemId))];
          const options: Record<string, { value: string; label: string; qty: number }[]> = {};
          for (const itemId of fabricItemIds) {
            const rolls = await getReturnableFabricRolls(itemId);
            options[itemId] = rolls.map((r) => ({
              value: r.id,
              label: `${r.rollRef} (${r.remainingLength})`,
              qty: r.remainingLength
            }));
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

        if (suppliersRes.ok) {
          const data = await suppliersRes.json();
          const list = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data)) ? data.data : [];
          setVendors((list as Supplier[]) || []);
        }
        setWorkOrders(
          (woList as { id: string; docNumber: string }[]).map((w) => ({
            id: w.id,
            docNumber: w.docNumber
          }))
        );
        setGrns(
          (grnList as { id: string; docNumber: string }[]).map((g) => ({
            id: g.id,
            docNumber: g.docNumber,
          }))
        );
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
        toast.error('Failed to load data');
        router.replace('/backoffice/vendor-returns');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, router]);

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
        toast.error(`Line ${i + 1}: item and reason (min 3 chars) required`);
        return;
      }
      if (l.type === 'FABRIC') {
        const rollIds = l.rollIds ?? [];
        if (rollIds.length === 0) {
          toast.error(`Line ${i + 1}: select at least one roll for fabric item`);
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
        toast.error(`Line ${i + 1}: qty > 0 required`);
        return;
      }
      if (l.type === 'FG_REJECT') {
        try {
          const available = await getAvailableRejectQtyByItem(l.itemId);
          if (qty > available) {
            toast.error(`Line ${i + 1}: reject qty exceeds available rejects (max ${available})`);
            return;
          }
        } catch {
          toast.error(`Line ${i + 1}: could not check available reject qty`);
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
      toast.error('Select a vendor');
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
        toast.error('Invalid evidence URL: ' + invalidUrl);
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
      toast.success('Vendor return updated');
      router.replace('/backoffice/vendor-returns');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
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
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Edit Vendor Return</h1>
          <p className="text-muted-foreground">
            Update draft return (vendor, work order, lines, evidence)
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Vendor Return</CardTitle>
            <CardDescription>Vendor and optional work order / GRN reference. Add line items below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Vendor *</Label>
                <SearchableCombobox
                  options={vendors.map((v) => ({ value: v.id, label: `${v.code} – ${v.name}` }))}
                  value={vendorId}
                  onValueChange={setVendorId}
                  placeholder="Select vendor"
                />
              </div>
              <div className="space-y-2">
                <Label>Work Order (optional)</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: 'None' },
                    ...workOrders.map((w) => ({ value: w.id, label: w.docNumber })),
                  ]}
                  value={woId}
                  onValueChange={setWoId}
                  placeholder="None"
                />
              </div>
              <div className="space-y-2">
                <Label>GRN (optional)</Label>
                <SearchableCombobox
                  options={[
                    { value: '__none__', label: 'None' },
                    ...grns.map((grn) => ({ value: grn.id, label: grn.docNumber })),
                  ]}
                  value={grnId}
                  onValueChange={setGrnId}
                  placeholder="Select GRN"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Line items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add line
                </Button>
              </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-12"></TableHead>
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
                            <SelectTrigger className="w-[130px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="FABRIC">FABRIC</SelectItem>
                              <SelectItem value="ACCESSORIES">ACCESSORIES</SelectItem>
                              <SelectItem value="FG_REJECT">FG_REJECT</SelectItem>
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
                            placeholder="Select item"
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
                              placeholder="Select roll"
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
                              <SelectItem value="GOOD">GOOD</SelectItem>
                              <SelectItem value="DAMAGED">DAMAGED</SelectItem>
                              <SelectItem value="DEFECTIVE">DEFECTIVE</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.reason}
                            onChange={(e) => updateLine(i, 'reason', e.target.value)}
                            placeholder="Reason (min 3 chars)"
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
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {line.type === 'FABRIC' && (line.rollIds ?? []).length > 0 && (
                        <TableRow className="bg-muted/40">
                          <TableCell colSpan={6}>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-muted-foreground">Rolls:</span>
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
                                      aria-label={`Remove roll ${label}`}
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
              Total value is calculated on save from current average cost.
            </p>
            </div>

            <div className="space-y-2">
              <Label>Evidence URLs (optional)</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={evidenceUrls}
                onChange={(e) => setEvidenceUrls(e.target.value)}
                placeholder="One URL per line, or comma/newline separated (https://...)"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
          <Link href="/backoffice/vendor-returns">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
