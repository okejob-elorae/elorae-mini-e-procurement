'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const DEFAULT_SEPARATORS = [',', ' ', '\n'];

export interface TagsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Characters that commit the current text as a new tag. Default: comma, space, newline */
  separator?: string | string[];
  /** Allow duplicate tags. Default: false */
  allowDuplicates?: boolean;
  /** Max number of tags. When reached, adding is disabled. */
  maxTags?: number;
  className?: string;
  inputClassName?: string;
  /** Remove last tag when input is empty and user presses Backspace */
  removeOnBackspace?: boolean;
  /** Add tags on paste (split by comma/newline). Default: true */
  addOnPaste?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

function normalizeSeparators(separator?: string | string[]): string[] {
  if (separator == null) return DEFAULT_SEPARATORS;
  if (Array.isArray(separator)) return separator;
  return separator.split('').filter(Boolean);
}

export function TagsInput({
  value,
  onChange,
  onValueChange,
  placeholder = 'Add tag...',
  disabled = false,
  separator,
  allowDuplicates = false,
  maxTags,
  className,
  inputClassName,
  removeOnBackspace = true,
  addOnPaste = true,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: TagsInputProps) {
  const [inputValue, setInputValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const separators = React.useMemo(() => normalizeSeparators(separator), [separator]);

  const notifyChange = React.useCallback(
    (next: string[]) => {
      onChange(next);
      onValueChange?.(next);
    },
    [onChange, onValueChange]
  );

  const addTag = React.useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (!tag) return;
      const isDuplicate = !allowDuplicates && value.includes(tag);
      if (isDuplicate) return;
      if (maxTags != null && value.length >= maxTags) return;
      notifyChange([...value, tag]);
      setInputValue('');
    },
    [value, allowDuplicates, maxTags, notifyChange]
  );

  const removeTag = React.useCallback(
    (tag: string) => {
      notifyChange(value.filter((t) => t !== tag));
    },
    [value, notifyChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
      return;
    }
    if (separators.includes(e.key)) {
      e.preventDefault();
      addTag(inputValue);
      return;
    }
    if (removeOnBackspace && e.key === 'Backspace' && !inputValue && value.length > 0) {
      e.preventDefault();
      notifyChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!addOnPaste) return;
    const pasted = e.clipboardData.getData('text');
    const parts = pasted.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return;
    e.preventDefault();
    const next = [...value];
    for (const part of parts) {
      if (maxTags != null && next.length >= maxTags) break;
      if (!allowDuplicates && next.includes(part)) continue;
      next.push(part);
    }
    if (next.length > value.length) {
      notifyChange(next);
      setInputValue('');
    }
  };

  const isLimitReached = maxTags != null && value.length >= maxTags;

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-base shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
      role="group"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
    >
      {value.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="gap-1 pr-1 font-normal"
        >
          <span className="max-w-48 truncate" title={tag}>
            {tag}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-4 rounded-full hover:bg-secondary/80"
            disabled={disabled}
            aria-label={`Remove ${tag}`}
            onClick={() => removeTag(tag)}
          >
            <X className="size-3" />
          </Button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled || isLimitReached}
        className={cn(
          'min-w-32 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground',
          'file:text-foreground selection:bg-primary selection:text-primary-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
          inputClassName
        )}
        aria-invalid={undefined}
      />
    </div>
  );
}
