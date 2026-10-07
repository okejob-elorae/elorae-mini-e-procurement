"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { denganParam } from "./halaman";

/** Jeda ketik sebelum daftar dimuat ulang. */
const JEDA_MS = 350;

/**
 * Kotak cari untuk daftar yang disaring di server (`?cari=`).
 *
 * Menulis ke alamat dengan `replace` — "Kembali" tidak berjalan mundur melewati
 * setiap huruf — dan selalu kembali ke halaman 1.
 */
export function KotakCari({
  nilai,
  placeholder,
  label,
  className,
}: {
  nilai: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [teks, setTeks] = useState(nilai);
  const terakhir = useRef(nilai);

  useEffect(() => {
    const k = teks.trim();
    if (k === terakhir.current) return;
    const id = window.setTimeout(() => {
      terakhir.current = k;
      router.replace(denganParam(pathname, searchParams, { cari: k, halaman: null }), { scroll: false });
    }, JEDA_MS);
    return () => window.clearTimeout(id);
  }, [teks, pathname, router, searchParams]);

  return (
    <div className={className ?? "relative w-full max-w-sm"}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={teks}
        onChange={(e) => setTeks(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}
