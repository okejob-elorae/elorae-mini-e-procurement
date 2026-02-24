'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { createVendorReturn } from '@/app/actions/vendor-returns';
import { getWorkOrders } from '@/app/actions/production';
import { getItems } from '@/app/actions/items';
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

interface ItemOption {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
}

type LineType = 'FABRIC' | 'ACCESSORIES' | 'FG_REJECT';
type Condition = 'GOOD' | 'DAMAGED' | 'DEFECTIVE';

interface FormLine {
  type: LineType;
  itemId: string;
  qty: string;
  reason: string;
  condition: Condition;
  referenceIssueId?: string;
}

export default function NewVendorReturnPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [vendors, setVendors] = useState<Supplier[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [woId, setWoId] = useState<string>('__none__');
  const [vendorId, setVendorId] = useState<string>('');
  const [lines, setLines] = useState<FormLine[]>([
    { type: 'FABRIC', itemId: '', qty: '', reason: '', condition: 'GOOD' }
  ]);
  const [evidenceUrls, setEvidenceUrls] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      try {
        const [suppliersRes, woList, itemsRes] = await Promise.all([
          fetch('/api/suppliers'),
          getWorkOrders(),
          getItems({ isActive: true })
        ]);
        if (suppliersRes.ok) {
          const data = await suppliersRes.json();
          setVendors((data as Supplier[]) || []);
        }
        setWorkOrders(
          (woList as { id: string; docNumber: string }[]).map((w) => ({
            id: w.id,
            docNumber: w.docNumber
          }))
        );
        const raw =
          Array.isArray(itemsRes) ? itemsRes : (itemsRes as { items?: unknown[] })?.items ?? [];
        const itemList: ItemOption[] = Array.isArray(raw)
          ? raw
              .filter(
                (i): i is Record<'id' | 'sku' | 'nameId' | 'nameEn', string> =>
                  typeof i === 'object' &&
                  i !== null &&
                  'id' in i &&
                  'sku' in i &&
                  'nameId' in i &&
                  'nameEn' in i
              )
              .map((i) => ({ id: i.id, sku: i.sku, nameId: i.nameId, nameEn: i.nameEn }))
          : [];
        setItems(itemList);
      } catch {
        toast.error('Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { type: 'FABRIC', itemId: '', qty: '', reason: '', condition: 'GOOD' }
    ]);
  };

  const removeLine = (index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateLine = (index: number, field: keyof FormLine, value: string) => {
    setLines((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, [field]: value } : line
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) return;

    const parsedLines: VendorReturnLineInput[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const qty = Number(l.qty);
      if (!l.itemId || !(qty > 0) || (l.reason?.trim().length ?? 0) < 3) {
        toast.error(`Line ${i + 1}: item, qty > 0, and reason (min 3 chars) required`);
        return;
      }
      parsedLines.push({
        type: l.type,
        itemId: l.itemId,
        qty,
        reason: l.reason.trim(),
        condition: l.condition as Condition,
        referenceIssueId: l.referenceIssueId || undefined
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

      await createVendorReturn(
        {
          woId: woId === '__none__' ? undefined : woId,
          vendorId,
          lines: parsedLines,
          evidenceUrls: urls.length > 0 ? urls : undefined
        },
        session.user.id
      );
      toast.success('Vendor return created');
      router.replace('/backoffice/vendor-returns');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
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
          <h1 className="text-2xl font-bold">New Vendor Return</h1>
          <p className="text-muted-foreground">Create a return to vendor (fabric, accessories, or FG reject)</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
            <CardDescription>Vendor and optional work order</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Vendor *</Label>
                <Select value={vendorId} onValueChange={setVendorId} required>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.code} – {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Work Order (optional)</Label>
                <Select value={woId} onValueChange={setWoId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {workOrders.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.docNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Lines</CardTitle>
                <CardDescription>Type, item, qty, condition, reason</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Add line
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
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
                    <TableRow key={i}>
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
                        <Select
                          value={line.itemId}
                          onValueChange={(v) => updateLine(i, 'itemId', v)}
                        >
                          <SelectTrigger className="min-w-[180px]">
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((it) => (
                              <SelectItem key={it.id} value={it.id}>
                                {it.sku} – {it.nameId || it.nameEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0.0001}
                          step="any"
                          value={line.qty}
                          onChange={(e) => updateLine(i, 'qty', e.target.value)}
                          placeholder="0"
                        />
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
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Total value is calculated on save from current average cost.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence (optional)</CardTitle>
            <CardDescription>One URL per line, or comma/newline separated</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={evidenceUrls}
              onChange={(e) => setEvidenceUrls(e.target.value)}
              placeholder="https://..."
            />
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Return'}
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
