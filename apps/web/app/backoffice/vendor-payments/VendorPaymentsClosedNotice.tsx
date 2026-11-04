"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Vendor Billing takes no new payments (`createVendorPayment` refuses them): where they are made instead. */
export function VendorPaymentsClosedNotice({ canPay }: { canPay: boolean }) {
  const t = useTranslations("vendorPayments");
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>{t("closedTitle")}</AlertTitle>
      <AlertDescription>
        <p>{t("closedBody")}</p>
        <Link href={canPay ? "/backoffice/supplier-payments/baru" : "/backoffice/supplier-payments"}>
          <Button size="sm" variant="outline" className="mt-1">
            {t("openSupplierPayments")}
          </Button>
        </Link>
      </AlertDescription>
    </Alert>
  );
}
