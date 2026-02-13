'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { savePendingGRN } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

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
  uomId: string;
  uom?: { id?: string; code: string };
}

interface LineRow {
  id: string;
  itemId: string;
  sku: string;
  nameId: string;
  uomId: string;
  uomCode: string;
  qty: number;
  unitCost: number;
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
    { id: '0', itemId: '', sku: '', nameId: '', uomId: '', uomCode: '', qty: 0, unitCost: 0 },
  ]);
  const [notes, setNotes] = useState('');
  const [photoUrls, _setPhotoUrls] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [poList, setPoList] = useState<Array<{ id: string; docNumber: string; supplierId: string }>>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [nextLineId, setNextLineId] = useState(1);
  const [errors, setErrors] = useState<{ supplierId?: string; lines?: string }>({});

  const loadPOs = useCallback(async () => {
    try {
      const list = await getPOs({ status: 'SUBMITTED' });
      const part = await getPOs({ status: 'PARTIAL' });
      const combined = [...(list || []), ...(part || [])].map((p: { id: string; docNumber: string; supplierId: string }) => ({
        id: p.id,
        docNumber: p.docNumber,
        supplierId: p.supplierId,
      }));
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

  useEffect(() => {
    loadPOs();
    loadItems();
  }, [loadPOs, loadItems]);

  useEffect(() => {
    if (!poId) return;
    (async () => {
      try {
        const po = await getPOById(poId);
        if (!po || !po.supplier) return;
        setSupplierId(po.supplierId);
        const rows: LineRow[] = (po.items || []).map((line: { itemId: string; item: { sku: string; nameId: string; uom: { id: string; code: string } }; qty: unknown; price: unknown; uomId: string }, i: number) => ({
          id: `po-${i}`,
          itemId: line.itemId,
          sku: line.item.sku,
          nameId: line.item.nameId,
          uomId: line.uomId || line.item.uom?.id,
          uomCode: line.item.uom?.code ?? '',
          qty: Number(line.qty),
          unitCost: Number(line.price),
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
        sku: '',
        nameId: '',
        uomId: '',
        uomCode: '',
        qty: 0,
        unitCost: 0,
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
              sku: item.sku,
              nameId: item.nameId,
              uomId: item.uomId || (item.uom as { id?: string })?.id || '',
              uomCode: item.uom?.code ?? '',
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
          items: validLines.map((l) => ({
            itemId: l.itemId,
            sku: l.sku,
            name: l.nameId,
            qty: l.qty,
            unitCost: l.unitCost,
            uomId: l.uomId,
          })),
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
        items: validLines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitCost: l.unitCost,
          uomId: l.uomId,
        })),
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
              <Label htmlFor="poId">PO Reference (optional)</Label>
              <Select
                value={poId || '__none__'}
                onValueChange={(v) => setPoId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger id="poId" className="min-h-[44px] w-full">
                  <SelectValue placeholder="Select PO" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {poList.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.docNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 w-full">
              <Label htmlFor="supplierId">Supplier *</Label>
              <Select
                value={supplierId}
                onValueChange={(v) => { setSupplierId(v); setErrors((e) => ({ ...e, supplierId: undefined })); }}
              >
                <SelectTrigger
                  id="supplierId"
                  className={`min-h-[44px] w-full ${errors.supplierId ? 'border-destructive focus-visible:ring-destructive/20' : ''}`}
                  aria-invalid={!!errors.supplierId}
                >
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} – {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead className="w-32">Unit cost</TableHead>
                    <TableHead className="w-32">Total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Select
                          value={row.itemId || '__placeholder__'}
                          onValueChange={(v) => {
                            if (v === '__placeholder__') return;
                            const item = items.find((i) => i.id === v);
                            setLineItem(row.id, item || null);
                          }}
                        >
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__placeholder__">Select item</SelectItem>
                            {items.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.sku} – {i.nameId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.uomCode || '-'}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          className="min-h-[44px]"
                          value={row.qty || ''}
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
