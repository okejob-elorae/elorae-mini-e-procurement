"use client";

import type { DateRange } from "react-day-picker";

import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { cn } from "@/lib/utils";
import { dariDateLokal, keDateLokal } from "@/lib/tanggal-isian";

/**
 * Pemilih rentang untuk halaman yang menyimpan rentangnya sebagai `Date`.
 *
 * Dulu komponen sendiri (daftar pilihan cepat + "Terapkan"); sekarang
 * pembungkus `RentangTanggalInput`, supaya setiap rentang di aplikasi dipilih
 * dengan cara yang sama — tarik, dua ketukan, atau pilihan cepat — dan di HP
 * terbuka sebagai lembar dari bawah.
 *
 * Nilai keluarnya tetap tengah malam LOKAL di hari yang dipilih, sama seperti
 * sebelumnya (`formatDateOnly` pemanggil membacanya lewat getter lokal).
 */
export interface DateRangePickerProps {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  triggerClassName?: string;
  /** Show quick picks (last 7 days, this month, …). Default true. */
  showPresets?: boolean;
  /** Longest allowed range in days, both ends included. */
  maxDays?: number;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
  triggerClassName,
  showPresets = true,
  maxDays,
}: DateRangePickerProps) {
  return (
    <RentangTanggalInput
      id={id}
      dari={value?.from ? dariDateLokal(value.from) : ""}
      sampai={value?.to ? dariDateLokal(value.to) : ""}
      onChange={({ dari, sampai }) =>
        onChange(dari || sampai ? { from: keDateLokal(dari || sampai), to: keDateLokal(sampai || dari) } : undefined)
      }
      placeholder={placeholder}
      disabled={disabled}
      pilihanCepat={showPresets}
      maksHari={maxDays}
      aria-invalid={ariaInvalid}
      className={cn(triggerClassName, className)}
    />
  );
}
