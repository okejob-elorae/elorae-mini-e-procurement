'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { toast } from 'sonner';
import { createWorkOrder, getMaterialPlan } from '@/app/actions/production';
import { getItemsByType } from '@/app/actions/items';
import { ItemType } from '@prisma/client';

interface TailorSupplier {
  id: string;
  code: string;
  name: string;
  type?: { id: string; code: string; name: string } | null;
}

interface FinishedGood {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  uom: { id: string; code: string };
}

interface MaterialPlanRow {
  itemId: string;
  itemName: string;
  uomCode: string;
  qtyRequired: number;
  wastePercent: number;
  plannedQty: number;
  availableStock: number;
  shortage: number;
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [tailors, setTailors] = useState<TailorSupplier[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [materialPlan, setMaterialPlan] = useState<MaterialPlanRow[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isLoadingFG, setIsLoadingFG] = useState(true);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [vendorId, setVendorId] = useState('');
  const [finishedGoodId, setFinishedGoodId] = useState('');
  const [outputMode, setOutputMode] = useState<'GENERIC' | 'SKU'>('GENERIC');
  const [plannedQty, setPlannedQty] = useState<string>('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [suppliersRes, fgList] = await Promise.all([
          fetch('/api/suppliers'),
          getItemsByType(ItemType.FINISHED_GOOD)
        ]);
        if (suppliersRes.ok) {
          const data = await suppliersRes.json();
          setTailors(
            (data as TailorSupplier[]).filter((s: TailorSupplier) => s.type?.code === 'TAILOR')
          );
        }
        setFinishedGoods((fgList as FinishedGood[]) || []);
      } catch (e) {
        toast.error('Failed to load data');
      } finally {
        setIsLoadingSuppliers(false);
        setIsLoadingFG(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!finishedGoodId || !plannedQty || Number(plannedQty) <= 0) {
      setMaterialPlan([]);
      return;
    }
    let cancelled = false;
    setIsLoadingPlan(true);
    getMaterialPlan(finishedGoodId, Number(plannedQty))
      .then((plan) => {
        if (!cancelled) setMaterialPlan(plan);
      })
      .catch(() => {
        if (!cancelled) {
          setMaterialPlan([]);
          toast.error('Failed to load material plan');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [finishedGoodId, plannedQty]);

  const hasShortage = materialPlan.some((m) => m.shortage > 0);
  const canSubmit =
    session?.user?.id &&
    vendorId &&
    finishedGoodId &&
    plannedQty &&
    Number(plannedQty) > 0 &&
    !hasShortage &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !session?.user?.id) return;
    setIsSubmitting(true);
    try {
      const wo = await createWorkOrder(
        {
          vendorId,
          finishedGoodId,
          outputMode,
          plannedQty: Number(plannedQty),
          targetDate: targetDate ? new Date(targetDate) : undefined,
          notes: notes.trim() || undefined
        },
        session.user.id
      );
      toast.success('Work Order created');
      router.push(`/backoffice/work-orders/${wo.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create WO');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/work-orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Work Order</h1>
          <p className="text-muted-foreground">
            Create a work order for production
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Work Order</CardTitle>
            <CardDescription>
              Select vendor (tailor) and finished good. Material needs are
              calculated from BOM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Vendor (Tailor)</Label>
                <Select
                  value={vendorId}
                  onValueChange={setVendorId}
                  disabled={isLoadingSuppliers}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {tailors.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Finished Good</Label>
                <Select
                  value={finishedGoodId}
                  onValueChange={setFinishedGoodId}
                  disabled={isLoadingFG}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select finished good" />
                  </SelectTrigger>
                  <SelectContent>
                    {finishedGoods.map((fg) => (
                      <SelectItem key={fg.id} value={fg.id}>
                        {fg.nameId} ({fg.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Output Mode</Label>
                <Select
                  value={outputMode}
                  onValueChange={(v) => setOutputMode(v as 'GENERIC' | 'SKU')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERIC">Generic (pieces)</SelectItem>
                    <SelectItem value="SKU">SKU (by variant)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Planned Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
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

        {materialPlan.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Material Plan</CardTitle>
              <CardDescription>
                Required materials from BOM. Creation is blocked if any shortage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingPlan ? (
                <div className="py-8 text-center text-muted-foreground">
                  Loading plan...
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="text-right">
                          Qty Required (waste %)
                        </TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Shortage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {materialPlan.map((m) => (
                        <TableRow
                          key={m.itemId}
                          className={
                            m.shortage > 0 ? 'bg-destructive/10' : undefined
                          }
                        >
                          <TableCell className="font-medium">
                            {m.itemName}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.plannedQty.toLocaleString()} {m.uomCode} (
                            {m.wastePercent}%)
                          </TableCell>
                          <TableCell className="text-right">
                            {m.availableStock.toLocaleString()} {m.uomCode}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.shortage > 0 ? (
                              <span className="text-destructive font-medium">
                                -{m.shortage.toLocaleString()} {m.uomCode}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {hasShortage && (
                <p className="mt-4 text-sm text-destructive">
                  Stok tidak mencukupi. Tambah stok atau kurangi qty rencana.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-4">
          <Button type="submit" disabled={!canSubmit}>
            {isSubmitting ? 'Creating...' : 'Create Work Order'}
          </Button>
          <Link href="/backoffice/work-orders">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
