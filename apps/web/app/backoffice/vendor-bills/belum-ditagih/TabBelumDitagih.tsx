"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

const TAB = ["belum", "permintaan", "tidak-perlu"] as const;

/** Kepala halaman "Invoice belum ditagih": tab dan saringan pemasok (URL, `replace` supaya Kembali tidak berjalan lewat saringan). */
export function TabBelumDitagih({
  tab,
  pemasok,
  pemasokList,
  children,
}: {
  tab: (typeof TAB)[number];
  pemasok: string | null;
  pemasokList: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  const t = useTranslations("vendorBills.belumDitagih");
  const router = useRouter();
  const href = (o: { tab?: string; pemasok?: string | null }) => {
    const p = new URLSearchParams();
    p.set("tab", o.tab ?? tab);
    const s = o.pemasok === undefined ? pemasok : o.pemasok;
    if (s) p.set("pemasok", s);
    return `/backoffice/vendor-bills/belum-ditagih?${p.toString()}`;
  };
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/backoffice/vendor-bills" aria-label={t("kembali")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader title={t("judul")} description={t("subjudul")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {TAB.map((x) => (
          <Button key={x} asChild size="sm" variant={tab === x ? "default" : "outline"}>
            <Link replace href={href({ tab: x })}>
              {t(`tab.${x}`)}
            </Link>
          </Button>
        ))}
        <div className="ml-auto w-[260px]">
          <SearchableCombobox
            options={[{ value: "", label: t("semuaPemasok") }, ...pemasokList.map((p) => ({ value: p.id, label: p.label }))]}
            value={pemasok ?? ""}
            onValueChange={(v) => router.replace(href({ pemasok: v || null }))}
            placeholder={t("semuaPemasok")}
            triggerClassName="w-full"
          />
        </div>
      </div>
      {children}
    </div>
  );
}
