'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getAvailableFabricRolls, suggestFabricRollAllocation } from '@/app/actions/production';
import { entryMatchesNeed, type RollEntry, type RollNeed } from '@/lib/production/roll-allocation';

type AvailableRoll = { rollId: string; rollCode: string; rollRef: string; remainingLength: number };
export type RollLine = RollNeed;
export type MaterialRollEntry = RollEntry & { itemId: string };

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const lineKey = (l: RollLine) => `${l.itemId}|${l.colorId === undefined ? '*' : l.colorId ?? '-'}`;
const colorKey = (l: RollLine) => (l.colorId === undefined ? '*' : l.colorId ?? '-');

/**
 * Roll allocation per material (#437) and per finished-good colour (#410): one section for every
 * line whose material has rolls on hand, grouped under the colour it is cut for, each with its
 * own best-fit suggestion. Ops keep one fabric item per colour, so a colour's section lists that
 * colour's fabric. A roll taken by one section is not offered to another. Materials without
 * rolls are not shown.
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
    (l) => (rollsByItem[l.itemId]?.length ?? 0) > 0 || value.some((e) => entryMatchesNeed(e, l))
  );
  if (shown.length === 0) return null;

  /** Best-fit rolls for one line, skipping rolls other sections hold, or null when it has none. */
  const suggestFor = async (line: RollLine, current: MaterialRollEntry[]): Promise<MaterialRollEntry[] | null> => {
    if (line.qty <= 0) return null;
    const label = line.colorName ? `${line.colorName} · ${line.itemName}` : line.itemName;
    const taken = current.filter((e) => e.itemId === line.itemId && !entryMatchesNeed(e, line)).map((e) => e.rollRef);
    const suggestion = await suggestFabricRollAllocation(line.itemId, line.qty, taken);
    if (suggestion.selected.length === 0) {
      toast.error(`No available rolls for ${label}`);
      return null;
    }
    if (suggestion.unallocated > 0) {
      toast.error(`${label}: insufficient roll stock, unallocated ${suggestion.unallocated.toFixed(2)}`);
    }
    return suggestion.selected.map((row) => ({
      itemId: line.itemId,
      ...(line.colorId !== undefined ? { colorId: line.colorId } : {}),
      rollRef: row.rollCode ?? row.rollRef,
      qty: row.qty,
    }));
  };

  const runSuggest = async (targets: RollLine[], key: string) => {
    setSuggesting(key);
    try {
      let next = value;
      let applied = 0;
      for (const line of targets) {
        const rows = await suggestFor(line, next);
        if (!rows) continue;
        next = [...next.filter((e) => !entryMatchesNeed(e, line)), ...rows];
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
  // A fabric cut for several colours usually means its BOM rule is not scoped per colour.
  const sharedFabrics = new Set(
    shown
      .filter((l) => l.itemType === 'FABRIC' && l.colorId !== undefined)
      .filter((l, _, all) => all.some((o) => o.itemId === l.itemId && o.colorId !== l.colorId))
      .map((l) => l.itemName)
  );
  const groups: Array<{ key: string; name: string | null; lines: RollLine[] }> = [];
  for (const line of shown) {
    const key = colorKey(line);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        name: line.colorId === undefined ? null : line.colorName ?? 'Warna tidak dikenali',
        lines: [],
      };
      groups.push(group);
    }
    group.lines.push(line);
  }

  const renderLine = (line: RollLine) => {
    const key = lineKey(line);
    const mine = value.filter((e) => entryMatchesNeed(e, line));
    const sum = mine.reduce((s, e) => s + e.qty, 0);
    // A roll held by any section of this material is not offered again.
    const available = (rollsByItem[line.itemId] ?? []).filter(
      (r) => !value.some((b) => b.itemId === line.itemId && (b.rollRef === r.rollCode || b.rollRef === r.rollRef))
    );
    const uom = line.uomCode ? ` ${line.uomCode}` : '';
    return (
      <div key={key} className="space-y-2 rounded-md border p-3">
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
                  {
                    itemId: line.itemId,
                    ...(line.colorId !== undefined ? { colorId: line.colorId } : {}),
                    rollRef: roll.rollCode || roll.rollRef,
                    qty: roll.remainingLength,
                    notes: '',
                  },
                ]);
              }
            }}
            placeholder="Add roll..."
            emptyMessage="No more rolls"
            triggerClassName="w-[280px] max-w-full"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => runSuggest([line], key)}
            disabled={line.qty <= 0 || suggesting != null}
          >
            {suggesting === key ? 'Suggesting...' : 'Suggest best-fit'}
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
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Alokasi per roll (opsional)</Label>
          <p className="text-xs text-muted-foreground">
            {description ?? 'Pilih roll utuh (whole rolls only) per warna dan bahan. Total per bagian minimal sama dengan kebutuhannya.'}
          </p>
        </div>
        {withRolls.length > 1 && (
          <Button type="button" variant="outline" size="sm" disabled={suggesting != null} onClick={() => runSuggest(withRolls, 'all')}>
            {suggesting === 'all' ? 'Suggesting...' : 'Suggest best-fit (all)'}
          </Button>
        )}
      </div>

      {sharedFabrics.size > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Kain dipakai untuk lebih dari satu warna: {[...sharedFabrics].join(', ')}. Cek aturan BOM per warna bila tiap warna punya kain sendiri.
        </p>
      )}

      {groups.map((group) =>
        group.name == null ? (
          <div key={group.key} className="space-y-3">
            {group.lines.map(renderLine)}
          </div>
        ) : (
          <div key={group.key} className="space-y-3">
            <p className="text-sm font-semibold">Warna: {group.name}</p>
            {group.lines.map(renderLine)}
          </div>
        )
      )}
    </div>
  );
}
