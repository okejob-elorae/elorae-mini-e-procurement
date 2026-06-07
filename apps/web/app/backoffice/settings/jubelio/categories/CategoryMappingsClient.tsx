"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Loader2, RefreshCw, Save } from "lucide-react";
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
      toast.success(`Loaded ${list.length} categories from Jubelio`);
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
      toast.success(`Saved ${result.saved} mapping${result.saved === 1 ? "" : "s"}`);
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Jubelio category mappings</CardTitle>
              <CardDescription>
                Map each Elorae ItemCategory to a Jubelio category. Click Refresh to load
                the latest list from Jubelio (~1000 categories).
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh categories
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ERP category</TableHead>
                  <TableHead>Jubelio category</TableHead>
                  <TableHead>Current path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No ERP categories. Create one first.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const draftId = draft[row.erpCategoryId];
                    const effectiveId = draftId !== undefined ? draftId : row.jubelioId;
                    return (
                      <TableRow key={row.erpCategoryId}>
                        <TableCell className="font-medium">
                          {row.erpCode ? `${row.erpCode} — ${row.erpName}` : row.erpName}
                        </TableCell>
                        <TableCell>
                          <SearchableCombobox
                            options={options}
                            value={effectiveId != null ? String(effectiveId) : ""}
                            onValueChange={(v) => handleSelect(row.erpCategoryId, v)}
                            placeholder={options.length === 0 ? "Click Refresh first" : "Select Jubelio category"}
                            searchPlaceholder="Search by path..."
                            emptyMessage="No matches"
                            disabled={options.length === 0}
                            triggerClassName="w-full"
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
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
        <CardContent className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {dirtyEntries.length === 0 ? "No unsaved changes" : `${dirtyEntries.length} unsaved change(s)`}
          </p>
          <Button onClick={() => void handleSave()} disabled={isSaving || dirtyEntries.length === 0}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save mappings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
