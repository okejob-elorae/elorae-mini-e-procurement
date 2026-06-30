"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CountStepperInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Fired on +/- clicks (immediate commit). Falls back to onChange when omitted. */
  onStepChange?: (value: string) => void;
  step?: number;
  min?: number;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
};

function parseCount(value: string): number {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCount(value: number, step: number): string {
  if (step < 1) {
    return String(Math.round(value * 100) / 100);
  }
  return String(Math.round(value));
}

export function CountStepperInput({
  value,
  onChange,
  onBlur,
  onStepChange,
  step = 1,
  min = 0,
  className,
  inputClassName,
  disabled = false,
}: CountStepperInputProps) {
  const applyStep = (delta: number) => {
    const next = Math.max(min, parseCount(value) + delta);
    const formatted = formatCount(next, step);
    (onStepChange ?? onChange)(formatted);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        disabled={disabled}
        onClick={() => applyStep(-step)}
        aria-label="Decrease count"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        step={step < 1 ? "0.01" : "1"}
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn("h-8 w-20 text-center px-1", inputClassName)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        disabled={disabled}
        onClick={() => applyStep(step)}
        aria-label="Increase count"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
