"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { DaftarIsiPengaturan } from "../DaftarIsiPengaturan";
import { DAFTAR_ISI_SPG, TAUTAN_TARGET_SPG } from "./daftar-isi";

/**
 * Kepala halaman + daftar isi Pengaturan → SPG (9 kartu). Tautan ke target
 * bulanan SPG hanya untuk yang bisa membuka Pengaturan → Salesman
 * (field_sales_orders:view).
 */
export function JudulPengaturanSpg({ bolehBukaTarget }: { bolehBukaTarget: boolean }) {
  const t = useTranslations("settings.spg");
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <DaftarIsiPengaturan
        label={t("toc.label")}
        kelompok={DAFTAR_ISI_SPG}
        kaki={
          bolehBukaTarget ? (
            <Link href={TAUTAN_TARGET_SPG} className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
              <Target className="h-4 w-4" aria-hidden />
              {t("toc.targetLink")}
            </Link>
          ) : null
        }
      />
    </div>
  );
}
