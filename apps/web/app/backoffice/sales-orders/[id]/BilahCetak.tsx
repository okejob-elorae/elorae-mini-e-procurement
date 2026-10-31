"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logPrintQuietly } from "@/lib/audit/log-print-quietly";

/**
 * Bilah layar di atas lembar cetak (daftar ambil, slip kemas). Lembar memanggil
 * dialog cetak sendiri saat dibuka; bila dialog itu ditutup, tanpa bilah ini
 * tidak ada jalan untuk mencetak lagi atau kembali ke pesanan. Tidak ikut
 * tercetak (di luar `.print-root`, dan disembunyikan `print:hidden`).
 *
 * "Cetak lagi" mencatat jejak PRINT seperti cetakan pertama saat lembar dibuka,
 * jadi setiap cetak ulang terhitung di log audit.
 */
export function BilahCetak({
  orderId,
  entityType,
}: {
  orderId: string;
  entityType: "SalesOrderPickList" | "SalesOrderPackingSlip";
}) {
  const t = useTranslations("salesOrdersPrint");
  const cetakLagi = () => {
    logPrintQuietly(entityType, orderId);
    window.print();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/backoffice/sales-orders/${orderId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembaliKePesanan")}
        </Link>
      </Button>
      <Button size="sm" onClick={cetakLagi}>
        <Printer className="mr-2 h-4 w-4" />
        {t("cetakLagi")}
      </Button>
    </div>
  );
}
