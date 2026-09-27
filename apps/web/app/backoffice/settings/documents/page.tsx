"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  getDocNumberConfigs,
  updateDocNumberConfig,
  type DocNumberConfigRow,
  type UpdateDocNumberConfigResult,
} from "@/app/actions/settings/doc-numbers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DOC_TYPE_GROUP_ORDER, docTypesInGroup, type DocTypeValue } from "@/lib/doc-numbers/doc-type-groups";
import {
  findPrefixConflict,
  PREFIX_MAX_LENGTH,
  RESET_PERIODS,
  validateDocNumberConfigInput,
} from "@/lib/doc-numbers/validate";

type RowEdit = { prefix: string; resetPeriod: string; padding: string };

const baseline = (config: DocNumberConfigRow): RowEdit => ({
  prefix: config.prefix,
  resetPeriod: config.resetPeriod,
  padding: String(config.padding),
});

export default function DocumentNumbersSettingsPage() {
  const t = useTranslations("documents");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [configs, setConfigs] = useState<DocNumberConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [savingType, setSavingType] = useState<DocTypeValue | null>(null);
  const [edits, setEdits] = useState<Partial<Record<DocTypeValue, RowEdit>>>({});

  /**
   * A failed load swaps the tables for the error card: editable rows built from defaults would
   * overwrite the real reset period and padding on save.
   */
  const loadConfigs = useCallback(async (): Promise<void> => {
    try {
      setConfigs(await getDocNumberConfigs());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;
    void loadConfigs().finally(() => setIsLoading(false));
  }, [status, router, loadConfigs]);

  const handleRetry = async () => {
    setIsRetrying(true);
    await loadConfigs();
    setIsRetrying(false);
  };

  /* Every code gets every param: an ICU placeholder left without a value throws, an unused value is ignored. */
  const errorMessage = (code: string, conflictsWith?: string): string =>
    t(`err.${code}`, {
      max: PREFIX_MAX_LENGTH,
      docType: conflictsWith ? t(`docTypes.${conflictsWith}`) : "",
    });

  const current = (docType: DocTypeValue, config: DocNumberConfigRow): RowEdit => edits[docType] ?? baseline(config);
  const isDirty = (docType: DocTypeValue, config: DocNumberConfigRow): boolean => {
    const edit = edits[docType];
    if (!edit) return false;
    const base = baseline(config);
    return edit.prefix !== base.prefix || edit.resetPeriod !== base.resetPeriod || edit.padding !== base.padding;
  };

  const setField = (docType: DocTypeValue, config: DocNumberConfigRow, field: keyof RowEdit, value: string) => {
    setEdits((prev) => ({ ...prev, [docType]: { ...(prev[docType] ?? baseline(config)), [field]: value } }));
  };

  const handleSave = async (docType: DocTypeValue, config: DocNumberConfigRow) => {
    const e = current(docType, config);
    const input = { docType, prefix: e.prefix, resetPeriod: e.resetPeriod, padding: Number(e.padding) };
    const parsed = validateDocNumberConfigInput(input);
    if (!parsed.ok) {
      toast.error(errorMessage(parsed.code));
      return;
    }
    /* Instant feedback only; the server action re-checks against the database and is the enforcement. */
    const clash = findPrefixConflict(docType, parsed.value.prefix, configs);
    if (clash) {
      toast.error(errorMessage("DUPLICATE_PREFIX", clash));
      return;
    }
    const { prefix, resetPeriod, padding } = parsed.value;
    setSavingType(docType);
    try {
      let res: UpdateDocNumberConfigResult;
      try {
        res = await updateDocNumberConfig(docType, parsed.value);
      } catch {
        toast.error(tToasts("failedToSave"));
        return;
      }
      if (!res.ok) {
        toast.error(errorMessage(res.code, res.code === "DUPLICATE_PREFIX" ? res.conflictsWith : undefined));
        return;
      }
      toast.success(tToasts("saved"));
      /* The write has committed: show it now, so a failed refetch below cannot read as a failed save. */
      setConfigs((prev) => prev.map((c) => (c.docType === docType ? { ...c, prefix, resetPeriod, padding } : c)));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      try {
        setConfigs(await getDocNumberConfigs());
      } catch {
        toast.error(t("refreshError"));
      }
    } finally {
      setSavingType(null);
    }
  };

  if (status === "loading" || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageDescription")}</p>
      </div>

      {loadFailed ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">{t("loadErrorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("loadErrorMessage")}</p>
            </div>
            <Button variant="outline" className="h-10" onClick={handleRetry} disabled={isRetrying}>
              {isRetrying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("loadErrorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {DOC_TYPE_GROUP_ORDER.map((group, groupIndex) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle>{t(`groups.${group}`)}</CardTitle>
                {groupIndex === 0 && <CardDescription>{t("tableDescription")}</CardDescription>}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("documentType")}</TableHead>
                      <TableHead>{t("prefix")}</TableHead>
                      <TableHead>{t("resetPeriod")}</TableHead>
                      <TableHead>{t("padding")}</TableHead>
                      <TableHead className="w-[100px]">{t("lastNumber")}</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docTypesInGroup(group).map((docType) => {
                      const label = t(`docTypes.${docType}`);
                      const config = configs.find((x) => x.docType === docType);
                      /* The load seeds every type, so this row should not occur; never fabricate editable values for it. */
                      if (!config) {
                        return (
                          <TableRow key={docType}>
                            <TableCell className="font-medium">
                              {label}
                              <div className="text-xs text-muted-foreground">{docType}</div>
                            </TableCell>
                            <TableCell colSpan={5} className="text-muted-foreground">
                              {t("notConfigured")}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const e = current(docType, config);
                      return (
                        <TableRow key={docType}>
                          <TableCell className="font-medium">
                            {label}
                            <div className="text-xs text-muted-foreground">{docType}</div>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={e.prefix}
                              onChange={(ev) => setField(docType, config, "prefix", ev.target.value)}
                              maxLength={PREFIX_MAX_LENGTH}
                              aria-label={`${label} ${t("prefix")}`}
                              className="max-w-[120px]"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={e.resetPeriod}
                              onValueChange={(v) => setField(docType, config, "resetPeriod", v)}
                            >
                              <SelectTrigger
                                aria-label={`${label} ${t("resetPeriod")}`}
                                className="w-[140px]"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {RESET_PERIODS.map((period) => (
                                  <SelectItem key={period} value={period}>
                                    {t(`resetPeriods.${period}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              max={8}
                              value={e.padding}
                              onChange={(ev) => setField(docType, config, "padding", ev.target.value)}
                              aria-label={`${label} ${t("padding")}`}
                              className="w-20"
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {config.lastNumber > 0 ? config.lastNumber : t("notIssued")}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              onClick={() => handleSave(docType, config)}
                              disabled={!isDirty(docType, config) || savingType !== null}
                            >
                              {savingType === docType ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                t("save")
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
