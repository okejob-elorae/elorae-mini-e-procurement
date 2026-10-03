"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";

export function JudulPengaturanSpg() {
  const t = useTranslations("settings.spg");
  return <PageHeader title={t("title")} description={t("subtitle")} />;
}
