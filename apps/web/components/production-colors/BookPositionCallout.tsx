"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Copy, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePantoneBookPositionAction } from "@/app/actions/production-colors";
import type { PantoneDetail } from "@/components/production-colors/types";
import { toast } from "sonner";

type BookPosition = NonNullable<PantoneDetail["bookPosition"]>;

type BookPositionCalloutProps = {
  tcx: string;
  bookPosition: BookPosition | null;
  onPositionChange: (position: BookPosition | null) => void;
  onCopy: (text: string) => void;
};

export function BookPositionCallout({
  tcx,
  bookPosition,
  onPositionChange,
  onCopy,
}: BookPositionCalloutProps) {
  const t = useTranslations("productionColors");
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState("");
  const [column, setColumn] = useState("");
  const [row, setRow] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!editing) return;
    setPage(bookPosition ? String(bookPosition.page) : "");
    setColumn(bookPosition ? String(bookPosition.column) : "");
    setRow(bookPosition ? String(bookPosition.row) : "");
  }, [editing, bookPosition]);

  const displayValue = bookPosition
    ? t("bookPositionCalloutValue", {
        page: bookPosition.page,
        column: bookPosition.column,
        row: bookPosition.row,
      })
    : t("bookPositionEmpty");

  const startEdit = () => setEditing(true);

  const cancelEdit = () => setEditing(false);

  const savePosition = () => {
    startTransition(async () => {
      try {
        const parsedPage = parseInt(page, 10);
        const parsedColumn = parseInt(column, 10);
        const parsedRow = parseInt(row, 10);
        if (
          !Number.isInteger(parsedPage) ||
          parsedPage < 1 ||
          !Number.isInteger(parsedColumn) ||
          parsedColumn < 1 ||
          !Number.isInteger(parsedRow) ||
          parsedRow < 1
        ) {
          toast.error(t("bookPositionSaveError"));
          return;
        }

        const result = await updatePantoneBookPositionAction(tcx, {
          page: parsedPage,
          column: parsedColumn,
          row: parsedRow,
        });
        onPositionChange(
          result
            ? {
                section: result.section,
                page: result.page,
                column: result.column,
                row: result.row,
              }
            : null
        );
        setEditing(false);
        toast.success(t("bookPositionSaved"));
      } catch {
        toast.error(t("bookPositionSaveError"));
      }
    });
  };

  const clearPosition = () => {
    startTransition(async () => {
      try {
        await updatePantoneBookPositionAction(tcx, null);
        onPositionChange(null);
        setEditing(false);
        toast.success(t("bookPositionSaved"));
      } catch {
        toast.error(t("bookPositionSaveError"));
      }
    });
  };

  return (
    <div className="min-w-0 w-full max-w-full rounded-lg border border-amber-300/80 bg-amber-50/80 px-4 py-3 dark:border-amber-700/50 dark:bg-amber-950/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <BookOpen className="h-4 w-4 shrink-0" />
            {t("bookLocationTitle")}
          </div>

          {editing ? (
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="space-y-1">
                <Label htmlFor={`book-page-${tcx}`} className="text-xs">
                  {t("bookPositionPage")}
                </Label>
                <Input
                  id={`book-page-${tcx}`}
                  type="number"
                  min={1}
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  className="h-8 bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`book-col-${tcx}`} className="text-xs">
                  {t("bookPositionColumn")}
                </Label>
                <Input
                  id={`book-col-${tcx}`}
                  type="number"
                  min={1}
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                  className="h-8 bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`book-row-${tcx}`} className="text-xs">
                  {t("bookPositionRow")}
                </Label>
                <Input
                  id={`book-row-${tcx}`}
                  type="number"
                  min={1}
                  value={row}
                  onChange={(e) => setRow(e.target.value)}
                  className="h-8 bg-background"
                />
              </div>
            </div>
          ) : (
            <p className="text-base font-semibold text-amber-950 dark:text-amber-50">
              {displayValue}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelEdit}
                disabled={pending}
              >
                {t("bookPositionCancel")}
              </Button>
              {bookPosition && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={clearPosition}
                  disabled={pending}
                >
                  {t("bookPositionClear")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={savePosition}
                disabled={pending}
              >
                {t("bookPositionSave")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-amber-500 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                onClick={startEdit}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t("bookPositionEdit")}
              </Button>
              {bookPosition && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-amber-600 text-white hover:bg-amber-700"
                  onClick={() => onCopy(displayValue)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {t("bookPositionCopy")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
