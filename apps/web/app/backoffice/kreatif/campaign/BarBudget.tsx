"use client";

import { useTranslations } from "next-intl";
import { rupiahTeks, type KeadaanBudget } from "@/lib/creative/angka-konten";
import { lebarBarBudget } from "@/lib/creative/campaign-aturan";
import { cn } from "@/lib/utils";

const WARNA: Record<Exclude<KeadaanBudget, "TANPA_BUDGET">, string> = {
  AMAN: "bg-emerald-500",
  HAMPIR: "bg-amber-500",
  LEWAT: "bg-red-500",
};

/**
 * Bar budget ala lampu lalu lintas: hijau di bawah 80%, kuning mulai 80%,
 * merah bila terpakai melebihi budget ("lebih Rp X"). Tanpa budget: teks saja.
 */
export function BarBudget({
  budget,
  className,
}: {
  budget: { keadaan: KeadaanBudget; persen: number | null; sisa: number | null };
  className?: string;
}) {
  const t = useTranslations("kreatifRuang.campaign");
  if (budget.keadaan === "TANPA_BUDGET") {
    return <span className={cn("text-xs text-muted-foreground", className)}>{t("budgetBelum")}</span>;
  }
  const lebar = lebarBarBudget(budget.persen);
  const lewat = budget.keadaan === "LEWAT";
  return (
    <div className={cn("min-w-28 space-y-1", className)}>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(lebar)}
        aria-label={t("budgetAria", { persen: Math.round(budget.persen ?? 0) })}
      >
        <div className={cn("h-full rounded-full", WARNA[budget.keadaan])} style={{ width: `${lebar}%` }} />
      </div>
      <p className={cn("text-xs tabular-nums", lewat ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
        {lewat
          ? t("budgetLebih", { nilai: rupiahTeks(Math.abs(budget.sisa ?? 0)) })
          : t("budgetSisa", { nilai: rupiahTeks(budget.sisa ?? 0) })}
      </p>
    </div>
  );
}

/**
 * ROAS berwarna: hijau ≥ 1, merah di bawahnya. "—" bila belum ada biaya atau
 * belum ada penjualan sama sekali — merah "0×" sebelum ada data penjualan hanya
 * menakut-nakuti (kelemahan KOL Manager §6.15).
 */
export function TeksRoas({ roas, gmv, locale }: { roas: number | null; gmv: number; locale: string }) {
  if (roas === null || gmv <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-medium tabular-nums", roas >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
      {roas.toLocaleString(locale === "en" ? "en-GB" : "id-ID", { maximumFractionDigits: 2 })}×
    </span>
  );
}
