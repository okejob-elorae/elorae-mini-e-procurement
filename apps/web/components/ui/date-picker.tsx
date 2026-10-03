"use client";

import { TanggalInput } from "@/components/ui/tanggal-input";
import { coerceToDate } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { dariDateLokal, keDateLokal } from "@/lib/tanggal-isian";

/**
 * Pemilih satu tanggal untuk formulir yang menyimpan nilainya sebagai `Date`.
 * Pembungkus `TanggalInput`, supaya tampilannya sama dengan setiap isian
 * tanggal lain (lembar dari bawah di HP, "Hari ini", pilihan bulan/tahun).
 * Nilai keluarnya tetap tengah malam LOKAL, seperti sebelumnya.
 */
export interface DatePickerProps {
  value?: Date | null;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  triggerClassName?: string;
  fromDate?: Date;
  toDate?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
  triggerClassName,
  fromDate,
  toDate,
}: DatePickerProps) {
  const terpilih = coerceToDate(value ?? undefined);
  return (
    <TanggalInput
      id={id}
      value={terpilih ? dariDateLokal(terpilih) : ""}
      onChange={(e) => onChange(keDateLokal(e.target.value))}
      min={fromDate ? dariDateLokal(fromDate) : undefined}
      max={toDate ? dariDateLokal(toDate) : undefined}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      className={cn(triggerClassName, className)}
    />
  );
}
