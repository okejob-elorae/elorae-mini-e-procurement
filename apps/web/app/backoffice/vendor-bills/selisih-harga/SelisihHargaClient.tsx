"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { BarisSelisihHarga } from "@/lib/vendor-billing/koreksi-utang-queries";
import type { KonteksKoreksi } from "@/lib/vendor-billing/koreksi-utang-konteks";
import { KoreksiUtangCard } from "../[id]/KoreksiUtangCard";

/** Daftar selisih harga invoice, dikelompokkan per tagihan (bentuk daftar backoffice: tab, kartu, kosong di dalam kartu). */
export function SelisihHargaClient({
  status,
  baris,
  konteks,
  canDecide,
  peranBelumDipetakan,
}: {
  status: "MENUNGGU" | "DIPUTUSKAN";
  baris: BarisSelisihHarga[];
  konteks: Record<string, KonteksKoreksi>;
  canDecide: boolean;
  peranBelumDipetakan: string[];
}) {
  const t = useTranslations("vendorBills.selisih");
  const perTagihan = new Map<string, BarisSelisihHarga[]>();
  for (const b of baris) perTagihan.set(b.billId, [...(perTagihan.get(b.billId) ?? []), b]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/backoffice/vendor-bills" aria-label={t("kembali")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader title={t("halamanJudul")} description={t("halamanIsi")} />
      </div>
      <div className="flex gap-2">
        {(["MENUNGGU", "DIPUTUSKAN"] as const).map((s) => (
          <Button key={s} asChild size="sm" variant={status === s ? "default" : "outline"}>
            <Link replace href={`/backoffice/vendor-bills/selisih-harga?status=${s}`}>
              {t(`tab.${s}`)}
            </Link>
          </Button>
        ))}
      </div>
      {perTagihan.size === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              {t("halamanJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Scale} title={status === "MENUNGGU" ? t("kosongMenunggu") : t("kosongDiputuskan")} />
          </CardContent>
        </Card>
      ) : (
        [...perTagihan].map(([billId, rows]) => (
          <div key={billId} className="space-y-2">
            <p className="text-sm">
              <Link className="font-medium hover:underline" href={`/backoffice/vendor-bills/${billId}`}>
                {rows[0].billDocNumber}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {rows[0].supplierName} · {t("invoiceNo", { no: rows[0].vendorInvoiceNo })} · {rows[0].billDate}
              </span>
            </p>
            <KoreksiUtangCard koreksi={rows} konteks={konteks} qtyBaris={{}} canDecide={canDecide} peranBelumDipetakan={peranBelumDipetakan} />
          </div>
        ))
      )}
    </div>
  );
}
