'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import type { ComboboxOption } from './types';
import { formatPlanNumber } from './types';

export type AllocationRow = {
  key: string;
  primary: string;
  secondary?: string;
  qty: string;
  notes?: string;
  readOnlyQty?: string;
};

type AllocationTableProps = {
  rows: AllocationRow[];
  primaryLabel: string;
  secondaryLabel?: string;
  qtyLabel: string;
  notesLabel?: string;
  primaryPlaceholder?: string;
  primaryOptions?: ComboboxOption[];
  disabled?: boolean;
  warning?: string | null;
  onChange: (rows: AllocationRow[]) => void;
  onSave: () => Promise<void>;
  saveLabel?: string;
};

export function AllocationTable({
  rows,
  primaryLabel,
  secondaryLabel,
  qtyLabel,
  notesLabel = 'Notes',
  primaryPlaceholder,
  primaryOptions,
  disabled,
  warning,
  onChange,
  onSave,
  saveLabel = 'Simpan',
}: AllocationTableProps) {
  const total = rows.reduce((sum, row) => sum + Number(row.readOnlyQty ?? (row.qty || 0)), 0);

  const updateRow = (key: string, patch: Partial<AllocationRow>) => {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2">
      {warning && (
        <p className="rounded-md bg-yellow-50 p-2 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          {warning}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left">{primaryLabel}</th>
              {secondaryLabel && <th className="px-3 py-2 text-left">{secondaryLabel}</th>}
              <th className="px-3 py-2 text-left">{qtyLabel}</th>
              {notesLabel && <th className="px-3 py-2 text-left">{notesLabel}</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b">
                <td className="px-3 py-2">
                  {primaryOptions ? (
                    <SearchableCombobox
                      options={primaryOptions}
                      value={row.primary}
                      onValueChange={(value) => updateRow(row.key, { primary: value })}
                      placeholder={primaryPlaceholder}
                      disabled={disabled}
                    />
                  ) : (
                    <Input
                      value={row.primary}
                      onChange={(e) => updateRow(row.key, { primary: e.target.value })}
                      placeholder={primaryPlaceholder}
                      disabled={disabled}
                    />
                  )}
                </td>
                {secondaryLabel && (
                  <td className="px-3 py-2">
                    <Input
                      value={row.secondary ?? ''}
                      onChange={(e) => updateRow(row.key, { secondary: e.target.value })}
                      disabled={disabled}
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    value={row.readOnlyQty ?? row.qty}
                    onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                    disabled={disabled || !!row.readOnlyQty}
                    readOnly={!!row.readOnlyQty}
                  />
                </td>
                {notesLabel && (
                  <td className="px-3 py-2">
                    <Input
                      value={row.notes ?? ''}
                      onChange={(e) => updateRow(row.key, { notes: e.target.value })}
                      disabled={disabled}
                    />
                  </td>
                )}
                <td className="px-2">
                  {!disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td colSpan={secondaryLabel ? 2 : 1} className="px-3 py-2">
                Total
              </td>
              <td className="px-3 py-2">{formatPlanNumber(total)}</td>
              {notesLabel && <td />}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...rows,
                { key: `new-${Date.now()}`, primary: '', secondary: '', qty: '0', notes: '' },
              ])
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            Tambah baris
          </Button>
          <Button type="button" size="sm" onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
