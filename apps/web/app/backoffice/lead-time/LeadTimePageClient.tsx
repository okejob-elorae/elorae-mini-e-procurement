"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { PustakaTab } from "@/components/lead-time/pustaka-tab";
import { PapanTab } from "@/components/lead-time/papan-tab";
import { SopTab } from "@/components/lead-time/sop-tab";
import { HariKerjaTab } from "@/components/lead-time/hari-kerja-tab";

export type TabKey = "pustaka" | "papan" | "sop" | "hari-kerja";

type Props = {
  initialTab: TabKey;
  canManage: boolean;
  /** Hari kerja & libur produksi: `production_planning:manage` ATAU `lead_time:manage`. */
  bolehAturKalender: boolean;
};

function resolveTab(raw: string | null, fallback: TabKey): TabKey {
  if (raw === "papan" || raw === "sop" || raw === "pustaka" || raw === "hari-kerja") return raw;
  return fallback;
}

export function LeadTimePageClient({ initialTab, canManage, bolehAturKalender }: Props) {
  const t = useTranslations("leadTime");
  const tJadwal = useTranslations("jadwalProduksi");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = resolveTab(searchParams.get("tab"), initialTab);

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pustaka">{t("tabs.pustaka")}</TabsTrigger>
          <TabsTrigger value="papan">{t("tabs.papan")}</TabsTrigger>
          <TabsTrigger value="sop">{t("tabs.sop")}</TabsTrigger>
          <TabsTrigger value="hari-kerja">{tJadwal("hariKerja.tab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pustaka">
          <PustakaTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="papan">
          <PapanTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="sop">
          <SopTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="hari-kerja">
          <HariKerjaTab bolehUbah={bolehAturKalender} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
