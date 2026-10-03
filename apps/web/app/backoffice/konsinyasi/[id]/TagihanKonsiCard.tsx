"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TagihanSiklus } from "@/lib/konsinyasi/queries";

/** Tanpa tanda — tandanya ditulis di depan baris (− potongan, + beban). */
const rupiah = (n: number) => `Rp ${Math.round(Math.abs(n)).toLocaleString("id-ID")}`;
const uang = (n: number) => `${Math.round(n) < 0 ? "−" : ""}${rupiah(n)}`;

/**
 * Ringkasan tagihan siklus ke toko: laku resmi − potongan promo ditanggung
 * Elorae + beban barang hilang ke toko. Sebelum dikunci hanya potongan promo
 * yang sudah ada (dihitung langsung dari nota SPG).
 */
export function TagihanKonsiCard({ tagihan }: { tagihan: TagihanSiklus }) {
  const t = useTranslations("konsinyasi.tagihan");
  const promoBerubah = tagihan.beku && Math.round(tagihan.promoEloraeSekarang) !== Math.round(tagihan.promoElorae);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="max-w-xl space-y-2 text-sm">
          <Baris label={t("sold")}>
            {tagihan.lakuResmi === null ? <Redup>{t("notLocked")}</Redup> : uang(tagihan.lakuResmi)}
          </Baris>
          <Baris label={t("promo")} keterangan={tagihan.beku ? t("promoFrozen") : t("promoLive")}>
            {tagihan.promoElorae === 0 ? rupiah(0) : `${tagihan.promoElorae > 0 ? "−" : "+"} ${rupiah(tagihan.promoElorae)}`}
          </Baris>
          <Baris label={t("loss")}>
            {tagihan.bebanHilang === null ? (
              <Redup>{t("atLock")}</Redup>
            ) : tagihan.bebanHilang === 0 ? (
              rupiah(0)
            ) : (
              `+ ${rupiah(tagihan.bebanHilang)}`
            )}
          </Baris>
          <Baris label={t("total")} tebal className="border-t pt-2">
            {tagihan.total === null ? <Redup>{t("totalAfterLock")}</Redup> : uang(tagihan.total)}
          </Baris>
        </dl>

        {promoBerubah && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{t("promoChanged", { value: uang(tagihan.promoEloraeSekarang) })}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("storeShare")}</p>
      </CardContent>
    </Card>
  );
}

function Baris({
  label,
  keterangan,
  tebal,
  className,
  children,
}: {
  label: string;
  keterangan?: string;
  tebal?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn(tebal ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {keterangan && <span className="block text-xs font-normal text-muted-foreground">{keterangan}</span>}
      </dt>
      <dd className={cn("shrink-0 text-right tabular-nums", tebal && "text-base font-semibold")}>{children}</dd>
    </div>
  );
}

function Redup({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-normal text-muted-foreground">{children}</span>;
}
