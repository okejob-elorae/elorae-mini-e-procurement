"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { bacaAngkaIsian } from "@/lib/purchase-orders/rincian-warna";
import { cn } from "@/lib/utils";

/**
 * Isian angka yang toleran koma ("0,27") untuk kalkulator PO. Selama diketik,
 * teksnya dibiarkan apa adanya; setiap teks yang terbaca langsung dikirim ke
 * `onUbah`, jadi angka lain di baris yang sama ikut berubah sambil mengetik.
 * Kosong dikirim sebagai 0.
 */
export function InputAngka({
  nilai,
  onUbah,
  className,
  ...rest
}: {
  nilai: number | null | undefined;
  onUbah: (n: number) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [teks, setTeks] = useState<string | null>(null);
  const tampil = teks ?? (nilai == null || nilai === 0 ? "" : String(nilai));
  return (
    <Input
      {...rest}
      inputMode="decimal"
      autoComplete="off"
      className={cn("tabular-nums", className)}
      value={tampil}
      onFocus={() => setTeks(tampil)}
      onChange={(e) => {
        const v = e.target.value;
        setTeks(v);
        if (!v.trim()) {
          onUbah(0);
          return;
        }
        const n = bacaAngkaIsian(v);
        if (n != null) onUbah(n);
      }}
      onBlur={() => setTeks(null)}
    />
  );
}
