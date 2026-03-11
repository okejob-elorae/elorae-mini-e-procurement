'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

const ROLLS_PER_RACK = 25;

export function parseLength(s: string): number | null {
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** Parse roll value strings to valid numeric lengths (for use in FabricRackPreview). */
export function parseRollValuesToLengths(rollValues: string[]): number[] {
  return rollValues.map(parseLength).filter((n): n is number => n !== null);
}

export interface FabricRackPreviewProps {
  rollValues: string[];
  uomCode: string;
  /** Called with the index in rollValues to remove when a roll circle is clicked. */
  onRemoveRoll?: (rollValuesIndex: number) => void;
  disabled?: boolean;
  className?: string;
}

/** Build valid lengths and their source indices in rollValues. */
function validLengthsWithSource(rollValues: string[]): { length: number; sourceIndex: number }[] {
  const out: { length: number; sourceIndex: number }[] = [];
  rollValues.forEach((v, i) => {
    const n = parseLength(v);
    if (n !== null) out.push({ length: n, sourceIndex: i });
  });
  return out;
}

/** Renders racks as symmetric 5x5 grids of circular rolls. Click a circle to remove it. Desktop: 4 racks per row. */
export function FabricRackPreview({
  rollValues,
  uomCode,
  onRemoveRoll,
  disabled = false,
  className,
}: FabricRackPreviewProps) {
  const validWithSource = React.useMemo(
    () => validLengthsWithSource(rollValues),
    [rollValues]
  );
  const racks = React.useMemo(
    () => chunk(validWithSource, ROLLS_PER_RACK),
    [validWithSource]
  );

  if (racks.length === 0) return null;

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1', className)}>
      {racks.map((rack, rackIndex) => {
        return (
          <Card key={rackIndex} className="overflow-hidden">
            <CardContent className="p-2">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Rack {rackIndex + 1}
              </p>
              <div className="grid grid-cols-5 grid-rows-5 gap-1 justify-items-center">
                {Array.from({ length: ROLLS_PER_RACK }, (_, i) => {
                  const item = rack[i];
                  const length = item?.length;
                  const sourceIndex = item?.sourceIndex;
                  const label =
                    length != null && sourceIndex != null
                      ? `#${rackIndex * ROLLS_PER_RACK + i + 1} · ${length} ${uomCode} (click to remove)`
                      : '';
                  const canRemove = !disabled && length != null && onRemoveRoll != null;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-center rounded-full border border-border bg-muted/50 size-7 shrink-0',
                        length != null ? 'text-[10px] leading-tight' : '',
                        canRemove &&
                          'cursor-pointer hover:bg-destructive/20 hover:border-destructive/50 transition-colors'
                      )}
                      title={label || undefined}
                      role={canRemove ? 'button' : undefined}
                      tabIndex={canRemove ? 0 : undefined}
                      onClick={
                        canRemove && sourceIndex != null
                          ? () => onRemoveRoll(sourceIndex)
                          : undefined
                      }
                      onKeyDown={
                        canRemove && sourceIndex != null
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onRemoveRoll(sourceIndex);
                              }
                            }
                          : undefined}
                    >
                      {length != null ? (
                        <span className="truncate w-full px-0.5 text-center" title={label}>
                          {length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-[10px]">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export interface FabricRollInputProps {
  /** Each string is one roll length as entered (e.g. "100", "50"). Duplicates allowed. */
  value: string[];
  onChange: (value: string[]) => void;
  uomCode: string;
  /** PO ordered qty for this line – show "Received X / Y UOM" when set */
  poOrderedQty?: number | null;
  disabled?: boolean;
  placeholder?: string;
  /** When false, only input + summary are rendered; use FabricRackPreview in a row below. */
  showRackPreview?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function FabricRollInput({
  value,
  onChange,
  uomCode,
  poOrderedQty,
  disabled = false,
  placeholder = '100, 50, 100...',
  showRackPreview = false,
  id,
  'aria-label': ariaLabel,
  className,
}: FabricRollInputProps) {
  const [inputValue, setInputValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addTokens = React.useCallback(
    (raw: string) => {
      const parts = raw.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return;
      onChange([...value, ...parts]);
      setInputValue('');
    },
    [value, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTokens(inputValue);
      return;
    }
    if (e.key === ',' || e.key === ' ' || e.key === '\n') {
      e.preventDefault();
      addTokens(inputValue);
      return;
    }
    if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    const parts = pasted.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return;
    e.preventDefault();
    onChange([...value, ...parts]);
    setInputValue('');
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className={cn(
          'flex min-h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1.5 text-base shadow-xs transition-[color,box-shadow]',
          'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
          'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
          disabled && 'pointer-events-none opacity-50'
        )}
        role="group"
        aria-label={ariaLabel}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground',
            'file:text-foreground selection:bg-primary selection:text-primary-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
      </div>

      {/* 5x5 rack preview (optional; when false, render FabricRackPreview in a row below) */}
      {showRackPreview && value.length > 0 && (
        <FabricRackPreview rollValues={value} uomCode={uomCode} />
      )}
    </div>
  );
}
