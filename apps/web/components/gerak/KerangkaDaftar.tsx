"use client";

import { useTranslations } from "next-intl";

/**
 * Kerangka halaman daftar kantor selama halaman dimuat — satu bentuk yang sama
 * di mana-mana: judul, baris saringan, lalu kartu berisi baris tabel.
 *
 * Bentuknya sama dengan `app/backoffice/loading.tsx` (yang tampil saat
 * berpindah bagian), supaya perpindahan di dalam satu bagian — misalnya
 * kembali dari rincian ke daftar — tidak memperlihatkan bentuk lain. Kotaknya
 * `.skeleton-block`, yang diam bila gerak dikurangi.
 */
export function KerangkaDaftar({ baris = 7, saringan = true }: { baris?: number; saringan?: boolean }) {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      <div className="space-y-2" aria-hidden>
        <div className="skeleton-block h-7 w-56 rounded-md" />
        <div className="skeleton-block h-4 w-80 max-w-full rounded-md" />
      </div>

      {saringan ? (
        <div className="flex flex-wrap gap-3" aria-hidden>
          <div className="skeleton-block h-9 w-72 max-w-full rounded-md" />
          <div className="skeleton-block h-9 w-40 rounded-md" />
          <div className="skeleton-block h-9 w-40 rounded-md" />
        </div>
      ) : null}

      <div className="rounded-xl border bg-card p-4 shadow-sm" aria-hidden>
        <div className="skeleton-block mb-5 h-5 w-40 rounded-md" />
        <div className="space-y-3">
          {Array.from({ length: Math.max(1, baris) }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton-block h-4 w-28 rounded" />
              <div className="skeleton-block h-4 flex-1 rounded" />
              <div className="skeleton-block hidden h-4 w-24 rounded sm:block" />
              <div className="skeleton-block h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
