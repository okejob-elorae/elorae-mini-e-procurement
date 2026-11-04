"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/** Layar gudang dibuka dari menu Inventori di dashboard — dan harus bisa kembali ke sana. */
export function TautanDashboard() {
  const t = useTranslations("pwaGudang");
  return (
    <Link
      href="/backoffice"
      className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("kembaliBeranda")}
    </Link>
  );
}
