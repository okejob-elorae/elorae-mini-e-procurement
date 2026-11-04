"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VendorPaymentsClosedNotice } from "../VendorPaymentsClosedNotice";

/** What used to be the new vendor payment form: Vendor Billing takes no new payments, so it says where to pay instead. */
export function VendorPaymentsClosedPage({ canPay }: { canPay: boolean }) {
  const t = useTranslations("vendorPayments");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/vendor-payments">
          <Button variant="ghost" size="icon" aria-label={t("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <VendorPaymentsClosedNotice canPay={canPay} />
    </div>
  );
}
