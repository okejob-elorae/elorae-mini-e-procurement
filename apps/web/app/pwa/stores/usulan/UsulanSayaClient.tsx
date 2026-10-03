"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dinamis } from "@/lib/i18n/dinamis";

import { TautanKembali } from "@/app/pwa/TautanKembali";
export type BarisUsulanSaya = {
  id: string;
  name: string;
  address: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  termsType: "PUTUS" | "KONSI" | null;
  areaCode: string | null;
  reviewNote: string | null;
  /** Toko hasil persetujuan — null bila belum disetujui atau tokonya sudah tidak ada. */
  storeId: string | null;
  storeCode: string | null;
  diajukan: string;
  diputuskan: string | null;
};

const NADA: Record<BarisUsulanSaya["status"], string> = {
  PENDING: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  APPROVED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  REJECTED: "bg-destructive/10 text-destructive",
};

/**
 * Daftar usulan toko baru milik salesman ini: menunggu, disetujui (menaut ke
 * tokonya), atau ditolak (dengan alasan admin — satu-satunya tempat ia tahu
 * kenapa).
 */
export function UsulanSayaClient({ baris }: { baris: BarisUsulanSaya[] }) {
  const t = useTranslations("pwa.usulanToko");
  const td = dinamis(t);

  const alasan = (b: BarisUsulanSaya) => {
    if (b.status === "REJECTED") return td("why_REJECTED", { reason: b.reviewNote ?? "—" });
    if (b.status === "APPROVED") return b.storeCode ? td("why_APPROVED", { code: b.storeCode }) : t("why_APPROVED_gone");
    return t("why_PENDING");
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/stores" />
      </Button>

      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("summary", { count: baris.length })}</p>
        </div>
        <Button asChild className="w-full">
          <Link href="/pwa/stores/baru">
            <Plus className="h-4 w-4" />
            {t("new")}
          </Link>
        </Button>
      </header>

      {baris.length === 0 ? (
        <section className="beranda-kartu text-center text-sm text-muted-foreground">{t("empty")}</section>
      ) : (
        <ul className="anim-stagger space-y-3">
          {baris.map((b) => (
            <li key={b.id} className="beranda-kartu space-y-2">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Store className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{b.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{b.address}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      t("sentOn", { date: b.diajukan }),
                      b.termsType ? td(`type${b.termsType}`) : null,
                      b.areaCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", NADA[b.status])}>
                  {td(`status_${b.status}`)}
                </span>
              </div>
              <p className={cn("rounded-lg px-3 py-2 text-sm leading-relaxed", NADA[b.status])}>
                {alasan(b)}
                {b.diputuskan ? <span className="block text-xs opacity-80">{t("decidedOn", { date: b.diputuskan })}</span> : null}
              </p>
              {b.status === "APPROVED" && b.storeId ? (
                <Button asChild variant="outline" className="w-full justify-between">
                  <Link href={`/pwa/stores/${b.storeId}`}>
                    {t("openStore")}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
