'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getAvailableFabricRolls, suggestFabricRollAllocation } from '@/app/actions/production';
import type { RollEntry } from '@/lib/production/roll-allocation';

type AvailableRoll = { rollId: string; rollCode: string; rollRef: string; remainingLength: number };
export type RollLine = { itemId: string; itemName: string; uomCode?: string; qty: number };
export type MaterialRollEntry = RollEntry & { itemId: string };

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Roll allocation per material (#437): one section for every line whose material has rolls on
 * hand — each colour's fabric, or an accessory bought in rolls — with its own best-fit
 * suggestion for the quantity that line needs. Materials without rolls are not shown.
 */
export function MaterialRollAllocation({
  lines,
  value,
  onChange,
  description,
}: {
  lines: RollLine[];
  value: MaterialRollEntry[];
  onChange: (next: MaterialRollEntry[]) => void;
  description?: string;
}) {
  const [rollsByItem, setRollsByItem] = useState<Record<string, AvailableRoll[]>>({});
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const itemKey = [...new Set(lines.map((l) => l.itemId))].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = itemKey ? itemKey.split(',') : [];
    Promise.all(
      ids.map((id) =>
        getAvailableFabricRolls(id)
          .then((rows) => [id, rows] as const)
          .catch(() => [id, [] as AvailableRoll[]] as const)
      )
    ).then((pairs) => {
      if (!cancelled) setRollsByItem(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [itemKey]);

  const shown = lines.filter(
    (l) => (rollsByItem[l.itemId]?.length ?? 0) > 0 || value.some((e) => e.itemId === l.itemId)
  );
  if (shown.length === 0) return null;

  /** Best-fit rolls for one line, or null when it has none (the reason is toasted). */
  const suggestFor = async (line: RollLine): Promise<MaterialRollEntry[] | null> => {
    if (line.qty <= 0) return null;
    const suggestion = await suggestFabricRollAllocation(line.itemId, line.qty);
    if (suggestion.selected.length === 0) {
      toast.error(`No available rolls for ${line.itemName}`);
      return null;
    }
    if (suggestion.unallocated > 0) {
      toast.error(`${line.itemName}: insufficient roll stock, unallocated ${suggestion.unallocated.toFixed(2)}`);
    }
    return suggestion.selected.map((row) => ({ itemId: line.itemId, rollRef: row.rollCode ?? row.rollRef, qty: row.qty }));
  };

  const runSuggest = async (targets: RollLine[], key: string) => {
    setSuggesting(key);
    try {
      let next = value;
      let applied = 0;
      for (const line of targets) {
        const rows = await suggestFor(line);
        if (!rows) continue;
        next = [...next.filter((e) => e.itemId !== line.itemId), ...rows];
        applied += 1;
      }
      if (applied > 0) {
        onChange(next);
        toast.success('Best-fit roll suggestion applied');
      }
    } catch {
      toast.error('Failed to suggest roll allocation');
    } finally {
      setSuggesting(null);
    }
  };

  const withRolls = shown.filter((l) => (rollsByItem[l.itemId]?.length ?? 0) > 0);

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Alokasi per roll (opsional)</Label>
          <p className="text-xs text-muted-foreground">
            {description ?? 'Pilih roll utuh (whole rolls only) per bahan. Total per bahan minimal sama dengan kebutuhannya.'}
          </p>
        </div>
        {withRolls.length > 1 && (
          <Button type="button" variant="outline" size="sm" disabled={suggesting != null} onClick={() => runSuggest(withRolls, 'all')}>
            {suggesting === 'all' ? 'Suggesting...' : 'Suggest best-fit (all)'}
          </Button>
        )}
      </div>

      {shown.map((line) => {
        const mine = value.filter((e) => e.itemId === line.itemId);
        const sum = mine.reduce((s, e) => s + e.qty, 0);
        const available = (rollsByItem[line.itemId] ?? []).filter(
          (r) => !mine.some((b) => b.rollRef === r.rollCode || b.rollRef === r.rollRef)
        );
        const uom = line.uomCode ? ` ${line.uomCode}` : '';
        return (
          <div key={line.itemId} className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              {line.itemName}
              <span className="font-normal text-muted-foreground"> — butuh {fmt(line.qty)}{uom}</span>
            </p>
            {mine.length > 0 && (
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
                    {mine.map((row) => (
                      <TableRow key={row.rollRef}>
                        <TableCell className="font-medium">{row.rollRef}</TableCell>
                        <TableCell className="text-right">{fmt(Number(row.qty))}</TableCell>
                        <TableCell>
                          <Input
                            value={row.notes ?? ''}
                            onChange={(e) =>
                              onChange(value.map((v) => (v === row ? { ...v, notes: e.target.value } : v)))
                            }
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
                            onClick={() => onChange(value.filter((v) => v !== row))}
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
                options={available.map((r) => ({
                  value: r.rollId,
                  label: `${r.rollCode} — ${r.remainingLength.toLocaleString()} remaining`,
                }))}
                value=""
                onValueChange={(rollId) => {
                  const roll = available.find((r) => r.rollId === rollId);
                  if (roll) {
                    onChange([
                      ...value,
                      { itemId: line.itemId, rollRef: roll.rollCode || roll.rollRef, qty: roll.remainingLength, notes: '' },
                    ]);
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
                onClick={() => runSuggest([line], line.itemId)}
                disabled={line.qty <= 0 || suggesting != null}
              >
                {suggesting === line.itemId ? 'Suggesting...' : 'Suggest best-fit'}
              </Button>
            </div>
            {mine.length > 0 && (
              <p className={sum + 1e-6 < line.qty ? 'text-sm text-destructive' : 'text-sm'}>
                Total allocated: {fmt(sum)}{uom}.
                {sum + 1e-6 >= line.qty ? ` +${fmt(sum - line.qty)} over` : ` ${fmt(sum - line.qty)} short`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
