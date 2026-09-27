"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  getDocNumberConfigs,
  updateDocNumberConfig,
  type DocNumberConfigRow,
} from "@/app/actions/settings/doc-numbers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DOC_TYPE_GROUP_ORDER, docTypesInGroup, type DocTypeValue } from "@/lib/doc-numbers/doc-type-groups";
import { PREFIX_MAX_LENGTH, RESET_PERIODS, validateDocNumberConfigInput } from "@/lib/doc-numbers/validate";

type RowEdit = { prefix: string; resetPeriod: string; padding: string };

export default function DocumentNumbersSettingsPage() {
  const t = useTranslations("documents");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [configs, setConfigs] = useState<DocNumberConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingType, setSavingType] = useState<DocTypeValue | null>(null);
  const [edits, setEdits] = useState<Partial<Record<DocTypeValue, RowEdit>>>({});

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;
    getDocNumberConfigs()
      .then(setConfigs)
      .catch(() => toast.error(t("loadError")))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const stored = (docType: DocTypeValue): RowEdit => {
    const c = configs.find((x) => x.docType === docType);
    return { prefix: c?.prefix ?? "", resetPeriod: c?.resetPeriod ?? "YEARLY", padding: String(c?.padding ?? 4) };
  };
  const current = (docType: DocTypeValue): RowEdit => edits[docType] ?? stored(docType);
  const isDirty = (docType: DocTypeValue): boolean => {
    const edit = edits[docType];
    if (!edit) return false;
    const base = stored(docType);
    return edit.prefix !== base.prefix || edit.resetPeriod !== base.resetPeriod || edit.padding !== base.padding;
  };

  const setField = (docType: DocTypeValue, field: keyof RowEdit, value: string) => {
    setEdits((prev) => ({ ...prev, [docType]: { ...current(docType), [field]: value } }));
  };

  const handleSave = async (docType: DocTypeValue) => {
    const e = current(docType);
    const input = { docType, prefix: e.prefix, resetPeriod: e.resetPeriod, padding: Number(e.padding) };
    const parsed = validateDocNumberConfigInput(input);
    if (!parsed.ok) {
      toast.error(t(`err.${parsed.code}`));
      return;
    }
    setSavingType(docType);
    try {
      const res = await updateDocNumberConfig(docType, parsed.value);
      if (!res.ok) {
        toast.error(t(`err.${res.code}`));
        return;
      }
      toast.success(tToasts("saved"));
      setConfigs(await getDocNumberConfigs());
      setEdits((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
    } catch {
      toast.error(tToasts("failedToSave"));
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
                    const c = configs.find((x) => x.docType === docType);
                    const e = current(docType);
                    return (
                      <TableRow key={docType}>
                        <TableCell className="font-medium">
                          {t(`docTypes.${docType}`)}
                          <div className="text-xs text-muted-foreground">{docType}</div>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={e.prefix}
                            onChange={(ev) => setField(docType, "prefix", ev.target.value)}
                            maxLength={PREFIX_MAX_LENGTH}
                            aria-label={`${t(`docTypes.${docType}`)} ${t("prefix")}`}
                            className="max-w-[120px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={e.resetPeriod}
                            onValueChange={(v) => setField(docType, "resetPeriod", v)}
                          >
                            <SelectTrigger className="w-[140px]">
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
                            onChange={(ev) => setField(docType, "padding", ev.target.value)}
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c && c.lastNumber > 0 ? c.lastNumber : t("notIssued")}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => handleSave(docType)}
                            disabled={!isDirty(docType) || savingType !== null}
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
    </div>
  );
}
