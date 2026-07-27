"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PustakaTab } from "@/components/lead-time/pustaka-tab";
import { PapanTab } from "@/components/lead-time/papan-tab";
import { SopTab } from "@/components/lead-time/sop-tab";

type TabKey = "pustaka" | "papan" | "sop";

type Props = {
  initialTab: TabKey;
  canManage: boolean;
};

function resolveTab(raw: string | null, fallback: TabKey): TabKey {
  if (raw === "papan" || raw === "sop" || raw === "pustaka") return raw;
  return fallback;
}

export function LeadTimePageClient({ initialTab, canManage }: Props) {
  const t = useTranslations("leadTime");
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pustaka">{t("tabs.pustaka")}</TabsTrigger>
          <TabsTrigger value="papan">{t("tabs.papan")}</TabsTrigger>
          <TabsTrigger value="sop">{t("tabs.sop")}</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
