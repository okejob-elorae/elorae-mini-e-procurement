"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OpnameItemCountRow, OpnameRollCountRow } from "@/components/inventory/OpnameCountRows";
import { useBarcodeWedgeScanner } from "@/hooks/use-barcode-wedge-scanner";
import {
  getOpnameById,
  updateOpnameCounts,
  updateOpnameRollCounts,
} from "@/app/actions/stock-opname";

type OpnameDetail = NonNullable<Awaited<ReturnType<typeof getOpnameById>>>;

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function parseCount(value: string): number {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function StockOpnameCountPageClient({ opnameId }: { opnameId: string }) {
  const t = useTranslations("stockOpname");
  const [opname, setOpname] = useState<OpnameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [itemCounts, setItemCounts] = useState<Record<string, string>>({});
  const [rollCounts, setRollCounts] = useState<Record<string, string>>({});
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const registerRowRef = useCallback((rowId: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current[rowId] = el;
    else delete rowRefs.current[rowId];
  }, []);

  const commitItemCount = useCallback((rowId: string, value: string) => {
    setItemCounts((prev) => {
      if (prev[rowId] === value) return prev;
      return { ...prev, [rowId]: value };
    });
  }, []);

  const commitRollCount = useCallback((rowId: string, value: string) => {
    setRollCounts((prev) => {
      if (prev[rowId] === value) return prev;
      return { ...prev, [rowId]: value };
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOpnameById(opnameId);
      setOpname(data);
      if (data?.scope === "FABRIC" && Array.isArray(data.rolls)) {
        const init: Record<string, string> = {};
        for (const r of data.rolls as Array<{ id: string; countedLength?: number | null }>) {
          init[r.id] = r.countedLength != null ? String(r.countedLength) : "";
        }
        setRollCounts(init);
      } else if (Array.isArray(data?.items)) {
        const init: Record<string, string> = {};
        for (const r of data.items as Array<{ id: string; countedQty?: number | null }>) {
          init[r.id] = r.countedQty != null ? String(r.countedQty) : "";
        }
        setItemCounts(init);
      }
    } finally {
      setLoading(false);
    }
  }, [opnameId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightedRowId) return;
    const row = rowRefs.current[highlightedRowId];
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlightedRowId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedRowId]);

  const fabricGroups = useMemo(() => {
    if (!opname || opname.scope !== "FABRIC" || !Array.isArray(opname.rolls)) return [];
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const roll of opname.rolls as Array<Record<string, unknown>>) {
      const key = String(roll.itemName);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(roll);
    }
    return [...map.entries()];
  }, [opname]);

  const itemSkuIndex = useMemo(() => {
    if (!opname || opname.scope === "FABRIC" || !Array.isArray(opname.items)) {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    for (const row of opname.items as Array<{ id: string; variantSku?: string | null }>) {
      const sku = normalizeCode(String(row.variantSku ?? ""));
      if (sku) map.set(sku, row.id);
    }
    return map;
  }, [opname]);

  const rollCodeIndex = useMemo(() => {
    if (!opname || opname.scope !== "FABRIC" || !Array.isArray(opname.rolls)) {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    for (const roll of opname.rolls as Array<{ id: string; rollCode: string }>) {
      map.set(normalizeCode(String(roll.rollCode)), roll.id);
    }
    return map;
  }, [opname]);

  const handleScan = useCallback(
    (code: string) => {
      const normalized = normalizeCode(code);
      if (!normalized) return;

      if (opname?.scope === "FABRIC") {
        const rollId = rollCodeIndex.get(normalized);
        if (!rollId) {
          toast.error(t("scanNotFound", { code }));
          return;
        }
        setRollCounts((prev) => {
          const next = parseCount(prev[rollId] ?? "") + 1;
          return { ...prev, [rollId]: String(Math.round(next * 100) / 100) };
        });
        setHighlightedRowId(rollId);
        toast.success(t("scanMatchedRoll", { code }));
        return;
      }

      const itemId = itemSkuIndex.get(normalized);
      if (!itemId) {
        toast.error(t("scanNotFound", { code }));
        return;
      }
      setItemCounts((prev) => {
        const next = parseCount(prev[itemId] ?? "") + 1;
        return { ...prev, [itemId]: String(next) };
      });
      setHighlightedRowId(itemId);
      toast.success(t("scanMatchedSku", { code }));
    },
    [itemSkuIndex, opname?.scope, rollCodeIndex, t],
  );

  const { scanInputRef, onScanInputKeyDown, focusScanInput } = useBarcodeWedgeScanner({
    enabled: !loading && opname != null,
    onScan: handleScan,
  });

  useEffect(() => {
    if (!loading && opname) {
      focusScanInput();
    }
  }, [focusScanInput, loading, opname]);

  const saveItems = async () => {
    if (!opname || !Array.isArray(opname.items)) return;
    setSaving(true);
    try {
      const counts = (opname.items as Array<{ id: string }>)
        .filter((row) => itemCounts[row.id] !== "" && itemCounts[row.id] != null)
        .map((row) => ({
          opnameItemId: row.id,
          countedQty: Number(itemCounts[row.id]),
        }));
      const r = await updateOpnameCounts(opnameId, counts);
      if (!r.success) toast.error(r.error);
      else {
        toast.success(t("saved"));
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const saveRolls = async () => {
    if (!opname || !Array.isArray(opname.rolls)) return;
    setSaving(true);
    try {
      const counts = (opname.rolls as Array<{ id: string }>)
        .filter((row) => rollCounts[row.id] !== "" && rollCounts[row.id] != null)
        .map((row) => ({
          opnameRollId: row.id,
          countedLength: Number(rollCounts[row.id]),
        }));
      const r = await updateOpnameRollCounts(opnameId, counts);
      if (!r.success) toast.error(r.error);
      else {
        toast.success(t("saved"));
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !opname) {
    return <p className="text-muted-foreground py-8">{loading ? "Loading..." : "Not found"}</p>;
  }

  const isFabric = opname.scope === "FABRIC";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("count")}</h1>
          <p className="text-muted-foreground">{String(opname.docNumber)}</p>
        </div>
        <Link href={`/backoffice/inventory/stock-opname/${opnameId}`}>
          <Button variant="outline">Back</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1">
              <label htmlFor="opname-scan-input" className="text-sm font-medium flex items-center gap-2">
                <ScanLine className="h-4 w-4" />
                {isFabric ? t("scanRollLabel") : t("scanSkuLabel")}
              </label>
              <Input
                id="opname-scan-input"
                ref={scanInputRef}
                placeholder={isFabric ? t("scanRollPlaceholder") : t("scanSkuPlaceholder")}
                onKeyDown={onScanInputKeyDown}
                autoComplete="off"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">{t("scanHint")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={focusScanInput}>
              {t("focusScanner")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isFabric ? (
        <div className="space-y-4">
          {fabricGroups.map(([itemName, rolls]) => (
            <Collapsible key={itemName} defaultOpen>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer">
                    <CardTitle>{itemName}</CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Roll</TableHead>
                          <TableHead>{t("snapshot")}</TableHead>
                          <TableHead>{t("counted")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rolls.map((roll) => {
                          const rowId = String(roll.id);
                          return (
                            <OpnameRollCountRow
                              key={rowId}
                              rowId={rowId}
                              rollCode={String(roll.rollCode)}
                              snapshotLength={Number(roll.snapshotLength)}
                              value={rollCounts[rowId] ?? ""}
                              highlighted={highlightedRowId === rowId}
                              onCommit={commitRollCount}
                              onRowRef={registerRowRef}
                            />
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
          <Button onClick={saveRolls} disabled={saving}>
            {t("saveCounts")}
          </Button>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>{t("snapshot")}</TableHead>
                  <TableHead>{t("counted")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(opname.items as Array<Record<string, unknown>>).map((row) => {
                  const rowId = String(row.id);
                  return (
                    <OpnameItemCountRow
                      key={rowId}
                      rowId={rowId}
                      itemName={String(row.itemName)}
                      sku={String(row.variantSku ?? "").trim()}
                      snapshotQty={Number(row.snapshotQty)}
                      value={itemCounts[rowId] ?? ""}
                      highlighted={highlightedRowId === rowId}
                      onCommit={commitItemCount}
                      onRowRef={registerRowRef}
                    />
                  );
                })}
              </TableBody>
            </Table>
            <Button className="mt-4" onClick={saveItems} disabled={saving}>
              {t("saveCounts")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
