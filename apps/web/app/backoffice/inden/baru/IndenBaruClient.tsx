"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FormJendelaInden, type PilihanBarang } from "../FormJendelaInden";

/** Teks halaman diterjemahkan di klien: aplikasi ini tidak punya konfigurasi next-intl sisi server. */
export function IndenBaruClient({ pilihan }: { pilihan: PilihanBarang[] }) {
  const t = useTranslations("inden");
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/backoffice/inden">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader title={t("baruJudul")} />
      <FormJendelaInden pilihan={pilihan} />
    </div>
  );
}
