'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Barcode, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { BarcodeScanner } from '@/components/scanners/BarcodeScanner';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getWorkOrderById, issueMaterials } from '@/app/actions/production';
import { getItemsByType } from '@/app/actions/items';
import { getItemAvgCosts } from '@/app/actions/inventory';
import { ItemType } from '@prisma/client';

interface PlanRow {
  itemId: string;
  itemName: string;
  uomId: string;
  uomCode?: string;
  plannedQty: number;
  issuedQty: number;
  availableStock?: number;
}

interface IssueLine {
  itemId: string;
  itemName: string;
  uomId: string;
  qty: number;
  maxQty: number;
  unitPrice?: number;
}

export default function WorkOrderIssuePage() {
  const t = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [materials, setMaterials] = useState<Array<{ id: string; sku: string; nameId: string; uom: { id: string } }>>([]);
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [issueType, setIssueType] = useState<'FABRIC' | 'ACCESSORIES'>('FABRIC');
  const [isPartial, setIsPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [itemAvgCosts, setItemAvgCosts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id) return;
    Promise.all([getWorkOrderById(id), getItemsByType(ItemType.FABRIC)])
      .then(([woData, fabricItems]) => {
        setWO(woData);
        setMaterials((fabricItems as any) || []);
        const plan = (woData?.consumptionPlan as any[]) || [];
        const ids = [
          ...new Set(
            (plan as { itemId?: string }[])
              .map((p) => p.itemId)
              .filter((id): id is string => typeof id === 'string')
          )
        ];
        if (ids.length > 0) {
          getItemAvgCosts(ids).then(setItemAvgCosts);
        }
      })
      .catch(() => {
        toast.error(t('failedToLoadData'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
  }, [id, router]);

  const plan = (wo?.consumptionPlan as any[]) || [];
  const planWithRemaining: PlanRow[] = plan.map((p: any) => ({
    itemId: p.itemId,
    itemName: p.itemName,
    uomId: p.uomId ?? '',
    uomCode: p.uomCode,
    plannedQty: Number(p.plannedQty ?? 0),
    issuedQty: Number(p.issuedQty ?? 0),
    availableStock: undefined
  }));

  const addLine = (itemId?: string) => {
    const p = planWithRemaining.find((x) => x.itemId === itemId || !itemId);
    if (!p) return;
    const existing = lines.find((l) => l.itemId === p.itemId);
    if (existing) return;
    const remaining = p.plannedQty - p.issuedQty;
    const defaultPrice = itemAvgCosts[p.itemId];
    setLines((prev) => [
      ...prev,
      {
        itemId: p.itemId,
        itemName: p.itemName,
        uomId: p.uomId,
        qty: remaining > 0 ? Math.min(1, remaining) : 0,
        maxQty: remaining,
        unitPrice: defaultPrice != null && defaultPrice > 0 ? defaultPrice : undefined,
      }
    ]);
  };

  const updateLineQty = (itemId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, qty: Math.max(0, qty) }
          : l
      )
    );
  };

  const removeLine = (itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  };

  const updateLinePrice = (itemId: string, unitPrice: number | '') => {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, unitPrice: unitPrice === '' ? undefined : unitPrice }
          : l
      )
    );
  };

  const handleScan = (skuOrId: string) => {
    const bySku = materials.find((m) => m.sku === skuOrId);
    const byId = planWithRemaining.find((p) => p.itemId === skuOrId);
    const itemId = bySku?.id ?? byId?.itemId;
    if (itemId) addLine(itemId);
    setScanOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !wo || lines.length === 0) return;
    const valid = lines.filter((l) => l.qty > 0);
    if (valid.length === 0) {
      toast.error(t('addAtLeastOneLine'));
      return;
    }
    setIsSubmitting(true);
    try {
      await issueMaterials(
        {
          woId: String(wo.id),
          issueType,
          isPartial,
          items: valid.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            uomId: l.uomId,
            ...(l.unitPrice != null && l.unitPrice > 0 ? { unitPrice: l.unitPrice } : {}),
          }))
        },
        session.user.id
      );
      toast.success(t('materialsIssued'));
      router.push(`/backoffice/work-orders/${id}`);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('failedToIssue'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !wo) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/backoffice/work-orders/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Issue Materials</h1>
          <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Material Plan</CardTitle>
            <CardDescription>{tWO('plannedVsIssued')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">{tWO('estimatedConsumptionPerPcs')}</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planWithRemaining.map((p) => (
                  <TableRow key={p.itemId}>
                    <TableCell>{p.itemName}</TableCell>
                    <TableCell className="text-right">
                      {p.plannedQty.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.issuedQty.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {(p.plannedQty - p.issuedQty).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issue Form</CardTitle>
            <CardDescription>
              Add materials to issue. Use barcode to quick-add.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Issue Type</Label>
                <Select
                  value={issueType}
                  onValueChange={(v) => setIssueType(v as 'FABRIC' | 'ACCESSORIES')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FABRIC">Fabric</SelectItem>
                    <SelectItem value="ACCESSORIES">Accessories</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="partial"
                  checked={isPartial}
                  onCheckedChange={(c) => setIsPartial(!!c)}
                />
                <Label htmlFor="partial">Partial / split allocation</Label>
              </div>
              <div className="flex items-center gap-2">
                <Label>Add material</Label>
                <SearchableCombobox
                  options={planWithRemaining
                    .filter((p) => !lines.some((l) => l.itemId === p.itemId))
                    .map((p) => ({
                      value: p.itemId,
                      label: `${p.itemName} (remaining ${(p.plannedQty - p.issuedQty).toLocaleString()})`,
                    }))}
                  value=""
                  onValueChange={(itemId) => addLine(itemId)}
                  placeholder="Select material"
                  triggerClassName="w-[200px]"
                />
                <Dialog open={scanOpen} onOpenChange={setScanOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="icon">
                      <Barcode className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Scan Barcode</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner
                      onScan={handleScan}
                      onClose={() => setScanOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
              {lines.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price (optional)</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.itemId}>
                        <TableCell>{l.itemName}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.qty === 0 ? '' : l.qty}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLineQty(l.itemId, v === '' ? 0 : Number(v));
                            }}
                            className="w-24 text-right"
                            placeholder={l.maxQty > 0 ? `max ${l.maxQty}` : 'over-issue ok'}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder={itemAvgCosts[l.itemId] != null ? String(itemAvgCosts[l.itemId]) : 'Avg cost'}
                            value={l.unitPrice ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLinePrice(l.itemId, v === '' ? '' : Number(v));
                            }}
                            className="w-28 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(l.itemId)}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Button type="submit" disabled={isSubmitting || lines.length === 0}>
                {isSubmitting ? 'Issuing...' : 'Issue Materials'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
