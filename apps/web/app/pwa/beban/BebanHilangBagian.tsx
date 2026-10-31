"use client";

import { useTranslations } from "next-intl";
import { PackageX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format/rupiah";
import type { BebanHilangSaya } from "@/lib/spg/hilang-queries";
import { cn } from "@/lib/utils";

/**
 * Bagian "Barang hilang" di layar Beban saya: beban yang ditetapkan kantor ke
 * orang yang masuk — toko, tanggal, barang, nilai bagian SAYA, yang sudah
 * dipotong, dan sisanya. Tidak pernah memuat nilai satuan, total kejadian,
 * atau bagian orang lain (payload-nya pun tidak — lihat `bebanHilangSaya`).
 */
export function BebanHilangBagian({ hilang, maksPotongPersen }: { hilang: BebanHilangSaya[]; maksPotongPersen: number }) {
  const t = useTranslations("bebanHilangSaya");
  const terbuka = hilang.filter((h) => !h.lunas);
  const sisa = terbuka.reduce((n, h) => n + h.sisa, 0);

  return (
    <section className="space-y-3" aria-labelledby="judul-beban-hilang">
      <div className="space-y-1">
        <h2 id="judul-beban-hilang" className="text-lg font-semibold">
          {t("judul")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {terbuka.length > 0 ? t("ringkas", { n: terbuka.length, sisa: formatRupiah(sisa) }) : t("semuaLunas")}
        </p>
        {terbuka.length > 0 ? <p className="text-xs text-muted-foreground">{t("cara", { persen: maksPotongPersen })}</p> : null}
      </div>

      <div className="space-y-3">
        {hilang.map((h) => (
          <Card key={h.id} className={cn("py-0", !h.lunas && "border-destructive/40")}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <PackageX className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{h.toko ?? t("tanpaToko")}</span>
                  <span className="block text-xs text-muted-foreground">{t("ditetapkan", { tanggal: h.tanggal })}</span>
                </span>
              </div>

              <ul className="space-y-0.5 text-sm">
                {h.barang.map((b, i) => (
                  <li key={`${h.id}-${i}`} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">{b.nama}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{t("pcs", { n: b.qty })}</span>
                  </li>
                ))}
                {h.barangLain > 0 ? <li className="text-xs text-muted-foreground">{t("barangLain", { n: h.barangLain })}</li> : null}
              </ul>

              <dl className="space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t("bagianSaya")}</dt>
                  <dd className="font-semibold tabular-nums">{formatRupiah(h.nilai)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t("sudahDipotong")}</dt>
                  <dd className="tabular-nums">{formatRupiah(h.dipotong)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t("sisa")}</dt>
                  <dd className={cn("font-bold tabular-nums", h.sisa > 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                    {formatRupiah(h.sisa)}
                  </dd>
                </div>
              </dl>
              {h.keringananPersen ? <p className="text-xs text-muted-foreground">{t("keringanan", { persen: h.keringananPersen })}</p> : null}

              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-sm leading-relaxed",
                  h.lunas ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive",
                )}
              >
                {h.lunas ? t("lunas") : h.dipotong > 0 ? t("dicicil") : t("belumDipotong")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
