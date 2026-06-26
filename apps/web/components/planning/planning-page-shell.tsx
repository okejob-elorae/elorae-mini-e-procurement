"use client";

import { Lock, Unlock, Plus, Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PlanningPageShellProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  years: Array<{ id: string; year: number; isLocked: boolean; status?: "DRAFT" | "ACTIVE" }>;
  selectedYearId: string;
  onYearChange: (id: string) => void;
  createdByName?: string;
  planStatus?: "DRAFT" | "ACTIVE";
  isLocked?: boolean;
  isAdmin?: boolean;
  canManage?: boolean;
  newYear: string;
  onNewYearChange: (value: string) => void;
  onCreateYear: () => void;
  onToggleLock: () => void;
  onActivatePlan?: () => void;
  onReopenPlan?: () => void;
  onImportExcel: (file: File) => void;
  onDownloadTemplate: () => void;
  children: React.ReactNode;
};

const TAB_KEYS = ["grid", "dashboard", "rincian", "warna", "jahitan", "aksesoris"] as const;

export function PlanningPageShell({
  activeTab,
  onTabChange,
  years,
  selectedYearId,
  onYearChange,
  createdByName,
  planStatus,
  isLocked,
  isAdmin,
  canManage,
  newYear,
  onNewYearChange,
  onCreateYear,
  onToggleLock,
  onActivatePlan,
  onReopenPlan,
  onImportExcel,
  onDownloadTemplate,
  children,
}: PlanningPageShellProps) {
  const t = useTranslations("planning");
  const tt = useTranslations("planning.tabs");
  const tl = useTranslations("planning.lock");
  const tls = useTranslations("planning.status");
  const ta = useTranslations("planning.actions");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLocked && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {tl("lockedBanner")}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedYearId || ""} onValueChange={onYearChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("fields.year")} />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {canManage && (
              <>
                <Input
                  type="number"
                  min={2000}
                  max={3000}
                  value={newYear}
                  onChange={(e) => onNewYearChange(e.target.value)}
                  className="w-[120px]"
                  aria-label={t("fields.year")}
                />
                <Button type="button" variant="outline" onClick={onCreateYear}>
                  <Plus className="mr-2 h-4 w-4" />
                  {ta("add")} {t("fields.year")}
                </Button>
              </>
            )}

            {canManage && selectedYearId && (
              <>
                <Button type="button" variant="outline" onClick={onDownloadTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  {ta("downloadTemplate")}
                </Button>
                <label>
                  <Button type="button" variant="outline" asChild>
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      {ta("importExcel")}
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onImportExcel(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}

            {isAdmin && selectedYearId && (
              <Button type="button" variant="outline" onClick={onToggleLock}>
                {isLocked ? (
                  <Unlock className="mr-2 h-4 w-4" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                {isLocked ? tl("unlockPlan") : tl("lockPlan")}
              </Button>
            )}

            {canManage && selectedYearId && planStatus === "DRAFT" && onActivatePlan && (
              <Button type="button" onClick={onActivatePlan}>
                {tls("activate")}
              </Button>
            )}

            {canManage && selectedYearId && planStatus === "ACTIVE" && onReopenPlan && (
              <Button type="button" variant="outline" onClick={onReopenPlan}>
                {tls("reopenDraft")}
              </Button>
            )}

            {planStatus != null && (
              <Badge variant={planStatus === "ACTIVE" ? "default" : "outline"}>
                {planStatus === "ACTIVE" ? tls("active") : tls("draft")}
              </Badge>
            )}

            {isLocked != null && (
              <Badge variant={isLocked ? "destructive" : "outline"}>
                {isLocked ? tl("locked") : tl("unlocked")}
              </Badge>
            )}
          </div>

          {createdByName && (
            <p className="text-sm text-muted-foreground">
              {t("createdBy", { name: createdByName })}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="flex flex-wrap h-auto">
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {tt(key)}
            </TabsTrigger>
          ))}
        </TabsList>
        {children}
      </Tabs>
    </div>
  );
}

export function PlanningTabPanel({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return <TabsContent value={value}>{children}</TabsContent>;
}
