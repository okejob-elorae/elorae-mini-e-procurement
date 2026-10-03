"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ItemMenuBawah = {
  kunci: string;
  href: string;
  ikon: LucideIcon;
  label: string;
  /** Titik oranye + teks untuk pembaca layar, mis. "2 kiriman belum terkirim". */
  titik?: string | null;
};

/**
 * Tampilan menu bawah PWA — dipakai menu salesman dan menu SPG.
 *
 * Tab aktif ditandai pil berwarna di belakang ikon, bukan teks berwarna: teks
 * limau di atas latar krem nyaris tak terbaca.
 */
export function MenuBawah({ label, item, aktif }: { label: string; item: ItemMenuBawah[]; aktif: string | null }) {
  return (
    <nav
      aria-label={label}
      className={cn("sticky bottom-0 z-20 grid border-t bg-background/95 backdrop-blur", item.length === 5 ? "grid-cols-5" : "grid-cols-4")}
      /* Aman dari bilah gestur iPhone. Tanpa ini tombol paling bawah tertutup
         garis home dan meleset saat ditekan. */
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {item.map(({ kunci, href, ikon: Ikon, label: teks, titik }) => {
        const menyala = aktif === kunci;
        return (
          <Link
            key={kunci}
            href={href}
            aria-current={menyala ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 py-1.5 text-[11px] transition-colors",
              menyala ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                menyala && "bg-primary text-primary-foreground",
              )}
            >
              <Ikon className={cn("h-5 w-5", menyala && "stroke-[2.25]")} aria-hidden />
              {titik ? (
                <span aria-hidden className="absolute right-2 top-0 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-background" />
              ) : null}
            </span>
            {teks}
            {titik ? <span className="sr-only">{titik}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
