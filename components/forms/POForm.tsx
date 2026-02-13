'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { poSchema, poItemSchema } from '@/lib/validations';
import { getItems } from '@/app/actions/items';
import { getCachedItems } from '@/lib/offline/db';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { OfflinePOButton } from '@/components/offline/OfflinePOButton';
import { isOnline } from '@/lib/offline/sync';
import { useLocale } from 'next-intl';

type POFormData = z.infer<typeof poSchema>;
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
}

interface POFormProps {
  initialData?: {
    supplierId?: string;
    etaDate?: Date | null;
    notes?: string;
    terms?: string;
    items?: Array<{
      itemId: string;
      item: {
        sku: string;
        nameId: string;
        uom: { id: string; code: string };
      };
      qty: number;
      price: number;
      uomId: string;
      notes?: string;
    }>;
  };
  suppliers: Supplier[];
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

export function POForm({
  initialData,
  suppliers,
  onSubmit,
  onSaveLocally,
  isLoading = false,
}: POFormProps) {
  const locale = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [lineItems, setLineItems] = useState<Array<POItemData & { id: string }>>(
    initialData?.items?.map((item, idx) => ({
      id: `line-${idx}`,
      itemId: item.itemId,
      qty: Number(item.qty),
      price: Number(item.price),
      uomId: item.uomId,
      notes: item.notes,
    })) || [{ id: 'line-0', itemId: '', qty: 0, price: 0, uomId: '' }]
  );
  const [searchQuery, setSearchQuery] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<POFormData>({
    resolver: zodResolver(poSchema),
    defaultValues: {
      supplierId: initialData?.supplierId || '',
      etaDate: initialData?.etaDate ?? null,
      notes: initialData?.notes || '',
      terms: initialData?.terms || '',
      items: initialData?.items?.map(item => ({
        itemId: item.itemId,
        qty: Number(item.qty),
        price: Number(item.price),
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
              }))
            );
            return;
          }
        }

        const data = await getItems({ isActive: true });
        const list = Array.isArray(data) ? data : (data as { items: unknown[] }).items;
        const mapped: Item[] = list.map((row: unknown) => {
          const r = row as { id: string; sku: string; nameId: string; nameEn: string; uomId?: string; uom?: { id?: string; code: string } };
          return {
            id: r.id,
            sku: r.sku,
            nameId: r.nameId,
            nameEn: r.nameEn,
            uom: { id: r.uomId ?? r.uom?.id ?? '', code: r.uom?.code ?? '' },
          };
        });
        setItems(mapped);
      } catch (_error) {
        toast.error('Failed to load items');
      }
    };

    loadItems();
  }, []);

  // Keep form state in sync with line items so validation and submit see current data
  useEffect(() => {
    setValue(
      'items',
      lineItems.map(({ id: _lineId, ...item }) => ({
        itemId: item.itemId ?? '',
        qty: item.qty ?? 0,
        price: item.price ?? 0,
        uomId: item.uomId ?? '',
        notes: item.notes ?? '',
      })),
      { shouldValidate: false }
    );
  }, [lineItems, setValue]);

  const addLineItem = () => {
    setLineItems([...lineItems, { id: `line-${Date.now()}`, itemId: '', qty: 0, price: 0, uomId: '' }]);
  };

  const removeLineItem = (idParam: string) => {
    if (lineItems.length === 1) {
      toast.error('At least one line item is required');
      return;
    }
    setLineItems(lineItems.filter((item) => item.id !== idParam));
  };

  const updateLineItem = (idParam: string, field: keyof POItemData, value: any) => {
    const updated = lineItems.map((item) => {
      if (item.id === idParam) {
        const updatedItem = { ...item, [field]: value };
        // Auto-set UOM when item is selected
        if (field === 'itemId' && value) {
          const selectedItem = items.find((i) => i.id === value);
          if (selectedItem) {
            updatedItem.uomId = selectedItem.uom.id;
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

  const calculateGrandTotal = () => {
    return lineItems.reduce((sum, item) => sum + calculateLineTotal(item.qty, item.price), 0);
  };

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
      toast.error('Please add at least one valid line item');
      return;
    }

    // Check ETA date
    if (data.etaDate && new Date(data.etaDate) < new Date()) {
      toast.warning('ETA date is in the past');
    }

    await onSubmit({
      ...data,
      items: validItems.map(({ id: _id, ...item }) => item),
    });
  };

  const handleSaveLocally = handleSubmit(async (data) => {
    if (!onSaveLocally) return;

    const enrichedItems = data.items.map((line) => {
      const source = items.find((i) => i.id === line.itemId);
      return {
        ...line,
        sku: source?.sku,
        itemName: source?.nameId,
        uomCode: source?.uom.code,
      };
    });

    const totalAmount = data.items.reduce((sum, line) => sum + line.qty * line.price, 0);
    const supplier = suppliers.find((s) => s.id === data.supplierId);

    await onSaveLocally(data, { enrichedItems, totalAmount, supplier });
  });

  const onValidationError = (err: Record<string, { message?: string }>) => {
    const first = Object.values(err)[0];
    console.log(first);
    toast.error(first?.message ?? 'Perbaiki data form');
  };

  const handleSubmitForm = handleSubmit(onFormSubmit, onValidationError);

  const etaDate = watch('etaDate');
  const isETAPast = etaDate && new Date(etaDate) < new Date();

  return (
    <form onSubmit={handleSubmitForm} className="space-y-6">
      {/* Offline Indicator */}
      <OfflineIndicator />

      {/* Supplier and ETA */}
      <Card>
        <CardHeader>
          <CardTitle>Supplier & Delivery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="supplierId">Supplier *</Label>
              <Select
                value={watch('supplierId')}
                onValueChange={(value) => setValue('supplierId', value, { shouldValidate: true })}
              >
                <SelectTrigger
                  id="supplierId"
                  aria-invalid={!!errors.supplierId}
                  className={`w-full ${errors.supplierId ? 'border-destructive focus-visible:ring-destructive/20' : ''}`}
                >
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.code} - {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.supplierId && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.supplierId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="etaDate">ETA Date</Label>
              <Input
                id="etaDate"
                type="date"
                aria-invalid={!!errors.etaDate}
                className={errors.etaDate ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                value={
                  (() => {
                    const v = watch('etaDate');
                    if (!v) return '';
                    const d = v instanceof Date ? v : new Date(v);
                    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
                  })()
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  setValue('etaDate', raw ? new Date(raw + 'T00:00:00') : null, {
                    shouldValidate: true,
                  });
                }}
              />
              {errors.etaDate && (
                <p className="text-sm text-destructive" role="alert">
                  {errors.etaDate.message}
                </p>
              )}
              {isETAPast && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    ETA date is in the past. Please verify.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
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
                placeholder="Search items by SKU or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Price (IDR)</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((lineItem) => {
                  const selectedItem = items.find((i) => i.id === lineItem.itemId);
                  const lineTotal = calculateLineTotal(lineItem.qty, lineItem.price);

                  return (
                    <TableRow key={lineItem.id}>
                      <TableCell>
                        <Select
                          value={lineItem.itemId}
                          onValueChange={(value) => updateLineItem(lineItem.id, 'itemId', value)}
                        >
                          <SelectTrigger className="max-w-[16rem] min-w-0 **:data-[slot=select-value]:truncate">
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredItems.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.sku} - {getItemDisplayName(item)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                      <TableCell className="text-right font-medium">
                        Rp {lineTotal.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={lineItem.notes || ''}
                          onChange={(e) =>
                            updateLineItem(lineItem.id, 'notes', e.target.value)
                          }
                          placeholder="Optional"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(lineItem.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Grand Total */}
          <div className="flex justify-end">
            <div className="text-right space-y-1">
              <p className="text-sm text-muted-foreground">Grand Total</p>
              <p className="text-2xl font-bold">
                Rp {calculateGrandTotal().toLocaleString('id-ID')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes and Terms */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              {...register('notes')}
              placeholder="Additional notes..."
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
            <Label htmlFor="terms">Payment Terms</Label>
            <Textarea
              id="terms"
              {...register('terms')}
              placeholder="Payment terms..."
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

      {/* Submit Button */}
      <div className="flex justify-end gap-2">
        {onSaveLocally ? (
          <OfflinePOButton
            onSaveLocally={handleSaveLocally}
            onSubmit={handleSubmitForm}
            disabled={isLoading}
            isLoading={isLoading}
          />
        ) : (
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initialData ? 'Update PO' : 'Create PO'}
          </Button>
        )}
      </div>
    </form>
  );
}
