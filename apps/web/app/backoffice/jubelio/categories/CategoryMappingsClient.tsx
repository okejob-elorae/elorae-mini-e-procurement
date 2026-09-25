"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Loader2, RefreshCw, Save, Tags } from "lucide-react";
import {
  fetchJubelioCategoryList,
  saveJubelioCategoryMappings,
  type CategoryMappingRow,
  type JubelioCategoryFlat,
} from "@/app/actions/jubelio-categories";

type Props = {
  initialRows: CategoryMappingRow[];
};

export function CategoryMappingsClient({ initialRows }: Props) {
  const t = useTranslations("jubelio.categories");
  const [rows, setRows] = useState<CategoryMappingRow[]>(initialRows);
  const [jubelioList, setJubelioList] = useState<JubelioCategoryFlat[]>([]);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const options = useMemo(
    () => jubelioList.map((c) => ({ value: String(c.id), label: c.path })),
    [jubelioList],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const list = await fetchJubelioCategoryList();
      setJubelioList(list);
      toast.success(t("loaded", { count: list.length }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (erpCategoryId: string, jubelioIdStr: string) => {
    const jubelioId = jubelioIdStr ? Number(jubelioIdStr) : null;
    setDraft((prev) => ({ ...prev, [erpCategoryId]: jubelioId }));
  };

  const dirtyEntries = Object.entries(draft).filter(([erpId, jubelioId]) => {
    const current = rows.find((r) => r.erpCategoryId === erpId)?.jubelioId ?? null;
    return jubelioId !== current && jubelioId !== null;
  });

  const handleSave = async () => {
    if (dirtyEntries.length === 0) return;
    setIsSaving(true);
    try {
      const mappings = dirtyEntries.map(([erpId, jubelioId]) => ({
        itemCategoryId: erpId,
        jubelioCategoryId: jubelioId as number,
      }));
      const result = await saveJubelioCategoryMappings(mappings);
      toast.success(t("saved", { count: result.saved }));
      setRows((prev) =>
        prev.map((r) => {
          const newId = draft[r.erpCategoryId];
          return newId !== undefined ? { ...r, jubelioId: newId } : r;
        }),
      );
      setDraft({});
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const pathForId = (id: number | null): string => {
    if (id == null) return "";
    return jubelioList.find((c) => c.id === id)?.path ?? `#${id}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
          {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {t("refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colErp")}</TableHead>
                  <TableHead>{t("colJubelio")}</TableHead>
                  <TableHead>{t("colPath")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t.rich("empty", {
                        link: (chunks) => (
                          <Link href="/backoffice/items/categories" className="underline underline-offset-2 hover:text-foreground">
                            {chunks}
                          </Link>
                        ),
                      })}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const draftId = draft[row.erpCategoryId];
                    const effectiveId = draftId !== undefined ? draftId : row.jubelioId;
                    return (
                      <TableRow key={row.erpCategoryId}>
                        <TableCell className="min-w-[180px] max-w-[280px] whitespace-normal font-medium">
                          {row.erpCode ? `${row.erpCode} — ${row.erpName}` : row.erpName}
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <SearchableCombobox
                            options={options}
                            value={effectiveId != null ? String(effectiveId) : ""}
                            onValueChange={(v) => handleSelect(row.erpCategoryId, v)}
                            placeholder={options.length === 0 ? t("placeholderNoOptions") : t("placeholder")}
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("noMatches")}
                            disabled={options.length === 0}
                            triggerClassName="w-full"
                          />
                        </TableCell>
                        <TableCell className="min-w-[200px] whitespace-normal break-words text-sm text-muted-foreground">
                          {pathForId(effectiveId)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {dirtyEntries.length === 0 ? t("noUnsaved") : t("unsaved", { count: dirtyEntries.length })}
          </p>
          <Button onClick={() => void handleSave()} disabled={isSaving || dirtyEntries.length === 0}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t("save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
