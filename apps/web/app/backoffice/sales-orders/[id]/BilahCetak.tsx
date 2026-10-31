"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bilah layar di atas lembar cetak (daftar ambil, slip kemas). Lembar memanggil
 * dialog cetak sendiri saat dibuka; bila dialog itu ditutup, tanpa bilah ini
 * tidak ada jalan untuk mencetak lagi atau kembali ke pesanan. Tidak ikut
 * tercetak (di luar `.print-root`, dan disembunyikan `print:hidden`).
 */
export function BilahCetak({ orderId }: { orderId: string }) {
  const t = useTranslations("salesOrdersPrint");
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/backoffice/sales-orders/${orderId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembaliKePesanan")}
        </Link>
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="mr-2 h-4 w-4" />
        {t("cetakLagi")}
      </Button>
    </div>
  );
}
