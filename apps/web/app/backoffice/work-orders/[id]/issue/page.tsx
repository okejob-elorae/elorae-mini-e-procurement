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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { BarcodeScanner } from '@/components/scanners/BarcodeScanner';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getAvailableFabricRolls,
  getWorkOrderById,
  issueMaterials,
  suggestFabricRollAllocation,
} from '@/app/actions/production';
import { getItemsByType } from '@/app/actions/items';
import { getItemAvgCosts } from '@/app/actions/inventory';
import { ItemType } from '@/lib/constants/enums';

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

type RollPick = { rollRef: string; qty: number; notes?: string };

function plannedRollsStillAvailable(
  woData: { rollBreakdown?: unknown } | null | undefined,
  available: Array<{ rollCode: string; rollRef: string; remainingLength: number }>
): RollPick[] {
  const planned = Array.isArray(woData?.rollBreakdown)
    ? (woData.rollBreakdown as Array<{ rollRef?: string; notes?: string }>)
    : [];
  const out: RollPick[] = [];
  for (const row of planned) {
    const ref = (row.rollRef ?? "").trim();
    if (!ref) continue;
    const live = available.find((r) => r.rollCode === ref || r.rollRef === ref);
    if (!live || live.remainingLength <= 0) continue;
    out.push({
      rollRef: ref,
      qty: live.remainingLength,
      notes: typeof row.notes === "string" ? row.notes : "",
    });
  }
  return out;
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
  const [rollBreakdown, setRollBreakdown] = useState<Array<{ rollRef: string; qty: number; notes?: string }>>([]);
  const [availableRolls, setAvailableRolls] = useState<Array<{ rollId: string; rollCode: string; rollRef: string; remainingLength: number }>>([]);
  const [addRollValue, setAddRollValue] = useState("");
  const [isSuggestingRolls, setIsSuggestingRolls] = useState(false);

  const [availableRollsReady, setAvailableRollsReady] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id, router drive fetch
  }, [id, router]);

  const consumptionMaterialId =
    wo && typeof wo === "object" && "consumptionMaterialId" in wo
      ? String((wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? "")
      : "";

  useEffect(() => {
    if (!wo) {
      setAvailableRolls([]);
      setAvailableRollsReady(false);
      return;
    }
    if (!consumptionMaterialId || issueType !== "FABRIC") {
      setAvailableRolls([]);
      setAvailableRollsReady(true);
      return;
    }
    let cancelled = false;
    setAvailableRollsReady(false);
    getAvailableFabricRolls(consumptionMaterialId)
      .then((rows) => {
        if (cancelled) return;
        setAvailableRolls(rows);
        setAvailableRollsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableRolls([]);
        setAvailableRollsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wo, consumptionMaterialId, issueType]);

  useEffect(() => {
    if (!wo || !availableRollsReady || issueType !== "FABRIC") return;
    setRollBreakdown((prev) => {
      if (prev.length > 0) return prev;
      return plannedRollsStillAvailable(
        wo as { rollBreakdown?: unknown },
        availableRolls
      );
    });
  }, [wo, availableRolls, availableRollsReady, issueType]);

  const plan = (wo?.consumptionPlan as any[]) || [];
  const isFabricItem = (itemId: string) =>
    consumptionMaterialId.length > 0 && itemId === consumptionMaterialId;
  const planWithRemaining: PlanRow[] = plan.map((p: any) => ({
    itemId: p.itemId,
    itemName: p.itemName,
    uomId: p.uomId ?? '',
    uomCode: p.uomCode,
    plannedQty: Number(p.plannedQty ?? 0),
    issuedQty: Number(p.issuedQty ?? 0),
    availableStock: undefined
  }));

  const switchIssueType = (nextType: "FABRIC" | "ACCESSORIES") => {
    if (nextType === issueType) return;
    if (lines.length > 0) {
      toast.info("Issue type changed. Cleared staged lines to keep the payload consistent.");
      setLines([]);
    }
    setIssueType(nextType);
    if (nextType !== "FABRIC") {
      setRollBreakdown([]);
    }
  };

  const addLine = (itemId?: string) => {
    const p = planWithRemaining.find((x) => x.itemId === itemId || !itemId);
    if (!p) return;
    const existing = lines.find((l) => l.itemId === p.itemId);
    if (existing) return;
    const remaining = p.plannedQty - p.issuedQty;
    const defaultPrice = itemAvgCosts[p.itemId];
    const nextLine = {
      itemId: p.itemId,
      itemName: p.itemName,
      uomId: p.uomId,
      qty: remaining > 0 ? Math.min(1, remaining) : 0,
      maxQty: remaining,
      unitPrice: defaultPrice != null && defaultPrice > 0 ? Math.round(defaultPrice * 100) / 100 : undefined,
    };
    const nextType = isFabricItem(p.itemId) ? "FABRIC" : "ACCESSORIES";
    if (nextType !== issueType) {
      switchIssueType(nextType);
      setLines([nextLine]);
      return;
    }
    setLines((prev) => [...prev, nextLine]);
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

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const updateLinePrice = (itemId: string, unitPrice: number | '') => {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, unitPrice: unitPrice === '' ? undefined : round2(unitPrice) }
          : l
      )
    );
  };

  const autoFillRemaining = () => {
    const withRemaining = planWithRemaining.filter((p) => {
      const remaining = p.plannedQty - p.issuedQty;
      if (remaining <= 0) return false;
      return issueType === "FABRIC" ? isFabricItem(p.itemId) : !isFabricItem(p.itemId);
    });
    if (withRemaining.length === 0) {
      toast.info("No remaining qty to issue for this type.");
      return;
    }
    setLines(
      withRemaining.map((p) => {
        const remaining = p.plannedQty - p.issuedQty;
        const defaultPrice = itemAvgCosts[p.itemId];
        return {
          itemId: p.itemId,
          itemName: p.itemName,
          uomId: p.uomId,
          qty: remaining,
          maxQty: remaining,
          unitPrice: defaultPrice != null && defaultPrice > 0 ? Math.round(defaultPrice * 100) / 100 : undefined,
        };
      })
    );
    toast.success(withRemaining.length === 1 ? '1 line filled.' : `${withRemaining.length} lines filled with remaining qty.`);
  };

  const handleScan = (skuOrId: string) => {
    const bySku = materials.find((m) => m.sku === skuOrId);
    const byId = planWithRemaining.find((p) => p.itemId === skuOrId);
    const itemId = bySku?.id ?? byId?.itemId;
    if (itemId) addLine(itemId);
    setScanOpen(false);
  };

  const fabricIssueQty = lines
    .filter((l) => isFabricItem(l.itemId) && l.qty > 0)
    .reduce((sum, l) => sum + l.qty, 0);
  const rollSum = rollBreakdown.reduce((sum, row) => sum + row.qty, 0);
  const rollValid =
    issueType !== "FABRIC" ||
    fabricIssueQty <= 0 ||
    rollBreakdown.length === 0 ||
    rollSum + 1e-6 >= fabricIssueQty;

  const addRollBySelection = (roll: {
    rollId: string;
    rollCode: string;
    rollRef: string;
    remainingLength: number;
  }) => {
    setRollBreakdown((prev) => [
      ...prev,
      { rollRef: roll.rollCode || roll.rollRef, qty: roll.remainingLength, notes: "" },
    ]);
  };
  const removeRollRow = (i: number) => {
    setRollBreakdown((prev) => prev.filter((_, idx) => idx !== i));
  };
  const updateRollNotes = (i: number, notes: string) => {
    setRollBreakdown((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], notes };
      return next;
    });
  };
  const handleSuggestRolls = async () => {
    if (!consumptionMaterialId || fabricIssueQty <= 0) return;
    setIsSuggestingRolls(true);
    try {
      const suggestion = await suggestFabricRollAllocation(
        consumptionMaterialId,
        fabricIssueQty
      );
      if (suggestion.selected.length === 0) {
        toast.error("No available fabric rolls found");
        return;
      }
      setRollBreakdown(
        suggestion.selected.map((row) => ({
          rollRef: row.rollCode ?? row.rollRef,
          qty: row.qty,
        }))
      );
      if (suggestion.unallocated > 0) {
        toast.error(`Insufficient roll stock, unallocated: ${suggestion.unallocated.toFixed(2)}`);
      } else {
        toast.success("Best-fit roll suggestion applied");
      }
    } catch {
      toast.error("Failed to suggest roll allocation");
    } finally {
      setIsSuggestingRolls(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !wo || lines.length === 0) return;
    const valid = lines.filter((l) => l.qty > 0);
    if (valid.length === 0) {
      toast.error(t('addAtLeastOneLine'));
      return;
    }
    const fabricQty = valid
      .filter((l) => isFabricItem(l.itemId))
      .reduce((sum, l) => sum + l.qty, 0);
    const rollSum = rollBreakdown.reduce((sum, row) => sum + row.qty, 0);
    if (issueType === "FABRIC" && fabricQty > 0 && rollBreakdown.length > 0 && rollSum + 1e-6 < fabricQty) {
      toast.error(
        `Total roll (${rollSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}) is less than issued fabric qty (${fabricQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}).`
      );
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
          })),
          ...(issueType === "FABRIC" && rollBreakdown.length > 0
            ? { rollBreakdown }
            : {}),
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={issueType === "FABRIC" ? "default" : "outline"}
                    onClick={() => switchIssueType("FABRIC")}
                  >
                    Fabric
                  </Button>
                  <Button
                    type="button"
                    variant={issueType === "ACCESSORIES" ? "default" : "outline"}
                    onClick={() => switchIssueType("ACCESSORIES")}
                  >
                    Accessories
                  </Button>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="partial"
                  checked={isPartial}
                  onCheckedChange={(c) => setIsPartial(!!c)}
                />
                <Label htmlFor="partial">Partial / split allocation</Label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                <Button type="button" variant="secondary" onClick={autoFillRemaining}>
                  Auto-fill remaining
                </Button>
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
                            placeholder={itemAvgCosts[l.itemId] != null ? Number(itemAvgCosts[l.itemId]).toFixed(2) : 'Avg cost'}
                            value={l.unitPrice != null ? l.unitPrice.toFixed(2) : ''}
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
              {issueType === "FABRIC" && consumptionMaterialId && (
                <div className="space-y-2 border-t pt-4">
                  <Label>Alokasi per roll (opsional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Pilih roll utuh. Total allocated minimal sama dengan qty kain yang di-issue.
                  </p>
                  {rollBreakdown.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Roll / Ref</TableHead>
                            <TableHead className="text-right">Qty (whole roll)</TableHead>
                            <TableHead>Notes</TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rollBreakdown.map((row, i) => (
                            <TableRow key={`${row.rollRef}-${i}`}>
                              <TableCell className="font-medium">{row.rollRef}</TableCell>
                              <TableCell className="text-right">
                                {Number(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={row.notes ?? ""}
                                  onChange={(e) => updateRollNotes(i, e.target.value)}
                                  placeholder="Optional"
                                  className="h-8"
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeRollRow(i)}
                                >
                                  ×
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <SearchableCombobox
                      options={availableRolls
                        .filter((r) => !rollBreakdown.some((b) => b.rollRef === r.rollCode || b.rollRef === r.rollRef))
                        .map((r) => ({
                          value: r.rollId,
                          label: `${r.rollCode} — ${r.remainingLength.toLocaleString()} remaining`,
                        }))}
                      value={addRollValue}
                      onValueChange={(value) => {
                        const roll = availableRolls.find((r) => r.rollId === value);
                        if (roll) {
                          addRollBySelection(roll);
                          setAddRollValue("");
                        }
                      }}
                      placeholder="Add roll..."
                      emptyMessage="No more rolls"
                      triggerClassName="w-[280px]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSuggestRolls()}
                      disabled={!consumptionMaterialId || fabricIssueQty <= 0 || isSuggestingRolls}
                    >
                      {isSuggestingRolls ? "Suggesting..." : "Suggest best-fit"}
                    </Button>
                  </div>
                  {rollBreakdown.length > 0 && (
                    <p className="text-sm">
                      Total allocated: {rollSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}.
                      {fabricIssueQty > 0
                        ? rollSum >= fabricIssueQty - 1e-6
                          ? ` +${(rollSum - fabricIssueQty).toLocaleString(undefined, { maximumFractionDigits: 2 })} over`
                          : ` ${(rollSum - fabricIssueQty).toLocaleString(undefined, { maximumFractionDigits: 2 })} short`
                        : ""}
                    </p>
                  )}
                  {!rollValid && (
                    <p className="text-sm text-destructive">
                      Total roll ({rollSum.toLocaleString(undefined, { maximumFractionDigits: 4 })}) kurang dari qty kain yang di-issue ({fabricIssueQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}).
                    </p>
                  )}
                </div>
              )}
              <Button type="submit" disabled={isSubmitting || lines.length === 0 || !rollValid}>
                {isSubmitting ? 'Issuing...' : 'Issue Materials'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
