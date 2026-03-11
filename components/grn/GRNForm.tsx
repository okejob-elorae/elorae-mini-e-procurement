'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, Loader2, Barcode, X } from 'lucide-react';
import { BarcodeScanner } from '@/components/scanners/BarcodeScanner';
import { createGRN, type GRNFormData } from '@/app/actions/grn';
import { getPOs } from '@/app/actions/purchase-orders';
import { getPOById } from '@/app/actions/purchase-orders';
import { getItems } from '@/app/actions/items';
import { getItemCategories } from '@/app/actions/item-categories';
import { savePendingGRN } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { FabricRollInput, FabricRackPreview } from '@/components/grn/FabricRollInput';

interface Supplier {
  id: string;
  code: string;
  name: string;
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
}

export function GRNForm({ suppliers, onSuccess }: GRNFormProps) {
  const { data: session } = useSession();
  const [poId, setPoId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [lines, setLines] = useState<LineRow[]>([
    { id: '0', itemId: '', itemType: '', sku: '', nameId: '', uomId: '', uomCode: '', qty: 0, unitCost: 0, rollValues: [] },
  ]);
  const [categoryId, setCategoryId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [photoUrls] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [poList, setPoList] = useState<Array<{ id: string; docNumber: string; supplierId: string }>>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [categories, setCategories] = useState<ItemCategoryOption[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [nextLineId, setNextLineId] = useState(1);
  const [errors, setErrors] = useState<{ supplierId?: string; lines?: string }>({});
  /** Number of existing GRNs for the selected PO (when loaded from PO). */
  const [poGrnCount, setPoGrnCount] = useState(0);

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
        const po = p as { id: string; docNumber: string; supplierId: string };
        return { id: po.id, docNumber: po.docNumber, supplierId: po.supplierId };
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
      setPoGrnCount(0);
      return;
    }
    (async () => {
      try {
        const po = await getPOById(poId);
        if (!po || !po.supplier) return;
        setSupplierId(po.supplierId);
        const grns = (po as { grns?: Array<{ id: string }> }).grns;
        setPoGrnCount(grns?.length ?? 0);
        const rows: LineRow[] = (po.items || []).map((line: { itemId: string; item: { sku: string; nameId: string; type?: string; uom: { id: string; code: string } }; qty: unknown; price: unknown; receivedQty?: unknown; uomId: string }, i: number) => ({
          id: `po-${i}`,
          itemId: line.itemId,
          itemType: line.item?.type ?? '',
          sku: line.item.sku,
          nameId: line.item.nameId,
          uomId: line.uomId || line.item.uom?.id,
          uomCode: line.item.uom?.code ?? '',
          qty: 0,
          unitCost: Number(line.price),
          rollValues: [],
          poOrderedQty: Number(line.qty),
          poAlreadyReceivedQty: line.receivedQty != null ? Number(line.receivedQty) : null,
        }));
        if (rows.length > 0) setLines(rows);
      } catch {
        toast.error('Failed to load PO details');
      }
    })();
  }, [poId]);

  const addLine = () => {
    setErrors((e) => ({ ...e, lines: undefined }));
    setLines((prev) => [
      ...prev,
      {
        id: `line-${nextLineId}`,
        itemId: '',
        itemType: '',
        sku: '',
        nameId: '',
        uomId: '',
        uomCode: '',
        qty: 0,
        unitCost: 0,
        rollValues: [],
      },
    ]);
    setNextLineId((n) => n + 1);
  };

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const setLineItem = (lineId: string, item: ItemOption | null) => {
    if (!item) return;
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
              rollValues: item.type === 'FABRIC' ? (r.rollValues ?? []) : undefined,
            }
          : r
      )
    );
  };

  const setLineQty = (lineId: string, qty: number) => {
    setLines((prev) =>
      prev.map((r) => (r.id === lineId ? { ...r, qty } : r))
    );
  };

  const parseRollValuesToLengths = (rollValues: string[]): number[] =>
    rollValues
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

  const setLineRollValues = (lineId: string, rollValues: string[]) => {
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== lineId) return r;
        const lengths = parseRollValuesToLengths(rollValues);
        return { ...r, rollValues, qty: lengths.reduce((sum, n) => sum + n, 0) };
      })
    );
  };

  const setLineUnitCost = (lineId: string, unitCost: number) => {
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
                ? {
                    ...r,
                    itemId: item.id,
                    sku: item.sku,
                    nameId: item.nameId,
                    uomId: item.uomId || (item.uom as { id?: string })?.id || '',
                    uomCode: item.uom?.code ?? '',
                  }
                : r
            );
          });
        }, 0);
      }
      setScanOpen(false);
      toast.success(`Added ${item.sku}`);
    } else {
      toast.error(`Item not found for: ${trimmed}`);
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
    setPhotoFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) ?? '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!session?.user?.id) {
      toast.error('You must be logged in');
      return;
    }
    const nextErrors: { supplierId?: string; lines?: string } = {};
    if (!supplierId) nextErrors.supplierId = 'Select a supplier';
    const validLines = lines.filter((l) => l.itemId && l.qty > 0 && l.unitCost >= 0);
    if (validLines.length === 0) nextErrors.lines = 'Add at least one item with qty and cost';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error('Please fix the errors below');
      return;
    }

    const offline = !isOnline();
    if (offline) {
      setIsLoading(true);
      try {
        const photoBase64 =
          photoFiles.length > 0
            ? await Promise.all(photoFiles.map(fileToBase64))
            : undefined;
        await savePendingGRN({
          poId: poId || undefined,
          supplierId,
          items: validLines.map((l) => {
            const lengths = l.itemType === 'FABRIC' ? parseRollValuesToLengths(l.rollValues ?? []) : [];
            const base = {
              itemId: l.itemId,
              sku: l.sku,
              name: l.nameId,
              qty: lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) : l.qty,
              unitCost: l.unitCost,
              uomId: l.uomId,
            };
            if (l.itemType === 'FABRIC' && lengths.length > 0) {
              return {
                ...base,
                rolls: lengths.map((length, idx) => ({
                  rollRef: `${l.sku || 'ROLL'}-${idx + 1}`,
                  length,
                })),
              };
            }
            return base;
          }),
          notes: notes || undefined,
          photoBase64,
          totalAmount: runningTotal,
          status: 'PENDING',
        });
        toast.success('Menyimpan lokal. Akan sinkron saat online.');
        onSuccess?.();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to save locally');
      } finally {
        setIsLoading(false);
      }
      return;
    }

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
        toast.error('Photo upload failed');
      }
    }

    setIsLoading(true);
    try {
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
            qty: l.itemType === 'FABRIC' && lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) : l.qty,
            unitCost: l.unitCost,
            uomId: l.uomId,
          };
        }),
        notes: notes || undefined,
        photoUrls: urls.length > 0 ? urls : undefined,
      };
      await createGRN(data, session.user.id);
      toast.success('Goods receipt created');
      onSuccess?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create GRN');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!isOnline() && (
        <Alert>
          <AlertDescription>
            Offline. GRN will be saved locally and synced when back online (Menyimpan lokal).
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Goods Receipt (GRN)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 w-full">
              <Label htmlFor="categoryId">Category (filter)</Label>
              <SearchableCombobox
                id="categoryId"
                options={[
                  { value: '__all__', label: 'All categories' },
                  ...categories.map((c) => ({
                    value: c.id,
                    label: (c.code ? `${c.code} - ` : '') + c.name,
                  })),
                ]}
                value={categoryId || '__all__'}
                onValueChange={(v) => setCategoryId(v === '__all__' ? '' : v)}
                placeholder="All categories"
                triggerClassName="min-h-[44px] w-full"
              />
            </div>
            <div className="space-y-2 w-full">
              <Label htmlFor="poId">PO Reference (optional)</Label>
              <SearchableCombobox
                id="poId"
                options={[
                  { value: '__none__', label: 'None' },
                  ...poList.map((po) => ({ value: po.id, label: po.docNumber })),
                ]}
                value={poId || '__none__'}
                onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
                placeholder="Select PO"
                triggerClassName="min-h-[44px] w-full"
              />
            </div>
            <div className="space-y-2 w-full">
              <Label htmlFor="supplierId">Supplier *</Label>
              <SearchableCombobox
                id="supplierId"
                options={suppliers.map((s) => ({ value: s.id, label: `${s.code} – ${s.name}` }))}
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v);
                  setErrors((e) => ({ ...e, supplierId: undefined }));
                }}
                placeholder="Select supplier"
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
              <Label>Line items</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setScanOpen(true)}
                >
                  <Barcode className="mr-2 h-4 w-4" />
                  Scan Barcode
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="min-h-[44px]">
                  <Plus className="mr-2 h-4 w-4" />
                  Add line
                </Button>
              </div>
            </div>
            {errors.lines && (
              <p className="text-sm text-destructive" role="alert">
                {errors.lines}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="min-w-[280px]">Roll lengths (fabric)</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead className="w-32">Unit cost</TableHead>
                    <TableHead className="w-32">Total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow>
                        <TableCell>
                          <SearchableCombobox
                            options={items
                              .filter((i) => !categoryId || i.categoryId === categoryId)
                              .map((i) => ({ value: i.id, label: `${i.sku} – ${i.nameId}` }))}
                            value={row.itemId}
                            onValueChange={(v) => {
                              const item = items.find((i) => i.id === v);
                              if (item) setLineItem(row.id, item);
                            }}
                            placeholder="Select item"
                            triggerClassName="min-h-[44px]"
                          />
                        </TableCell>
                        <TableCell>{row.uomCode || '-'}</TableCell>
                        <TableCell className="align-top">
                          {row.itemType === 'FABRIC' ? (
                            <FabricRollInput
                              value={row.rollValues ?? []}
                              onChange={(v) => setLineRollValues(row.id, v)}
                              uomCode={row.uomCode || 'MTR'}
                              poOrderedQty={row.poOrderedQty}
                              placeholder="100, 50, 100..."
                              showRackPreview={false}
                              aria-label={`Roll lengths for ${row.sku || 'fabric'}`}
                              className="min-w-[260px]"
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="min-h-[44px]"
                            value={row.qty || ''}
                            disabled={row.itemType === 'FABRIC'}
                            onChange={(e) => setLineQty(row.id, parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            className="min-h-[44px]"
                            value={row.unitCost || ''}
                            onChange={(e) => setLineUnitCost(row.id, parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell>
                          {((row.qty || 0) * (row.unitCost || 0)).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-[44px] min-w-[44px]"
                            onClick={() => removeLine(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {row.itemType === 'FABRIC' && (row.rollValues?.length ?? 0) > 0 && (() => {
                        const rollVals = row.rollValues ?? [];
                        const lengths = parseRollValuesToLengths(rollVals);
                        const totalLength = lengths.reduce((a, b) => a + b, 0);
                        const invalidCount = rollVals.length - lengths.length;
                        return (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/20 py-2">
                              <p className="text-sm text-muted-foreground mb-3">
                                {rollVals.length} roll{rollVals.length !== 1 ? 's' : ''}
                                {invalidCount > 0 && (
                                  <span className="text-destructive"> ({invalidCount} invalid)</span>
                                )}{' '}
                                · {totalLength.toLocaleString()} {row.uomCode || 'MTR'}
                                {row.poOrderedQty != null && Number.isFinite(row.poOrderedQty) && (
                                  <span className="ml-1">
                                    (Received {totalLength.toLocaleString()} / {Number(row.poOrderedQty).toLocaleString()} {row.uomCode || 'MTR'}
                                    {(row.poAlreadyReceivedQty != null && Number(row.poAlreadyReceivedQty) > 0) || poGrnCount > 0
                                      ? ` · Already received: ${Number(row.poAlreadyReceivedQty ?? 0).toLocaleString()} ${row.uomCode || 'MTR'} in ${poGrnCount} GRN${poGrnCount !== 1 ? 's' : ''}`
                                      : ''}
                                    )
                                  </span>
                                )}
                              </p>
                              <FabricRackPreview
                                rollValues={rollVals}
                                uomCode={row.uomCode || 'MTR'}
                                onRemoveRoll={(index) =>
                                  setLineRollValues(
                                    row.id,
                                    (row.rollValues ?? []).filter((_, i) => i !== index)
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })()}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm font-medium">Running total: Rp {runningTotal.toLocaleString()}</p>
          </div>

          <div className="space-y-2">
            <Label>Photos (optional)</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              className="min-h-[44px]"
            />
            {photoFiles.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">{photoFiles.length} file(s) selected</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                  {photoPreviewUrls.map((url, index) => (
                    <div
                      key={`${url}-${index}`}
                      className="relative aspect-square rounded-lg border bg-muted overflow-hidden group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- object URL preview, not a static asset */}
                      <img
                        src={url}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-7 w-7 opacity-90 group-hover:opacity-100"
                        onClick={() => removePhoto(index)}
                        aria-label="Remove photo"
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
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={isLoading} className="min-h-[44px] w-full sm:w-auto">
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating...
          </>
        ) : (
          'Create GRN'
        )}
      </Button>

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan barcode</DialogTitle>
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
