"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { FavoriteButton } from "@/components/production-colors/FavoriteButton";
import {
  BOOK_GRID_COLUMNS,
  BOOK_GRID_ROWS,
} from "@/lib/production-colors/book-constants";
import type { BookPageSwatch } from "@/lib/production-colors/book-queries";
import { cn } from "@/lib/utils";

type BookPageGridProps = {
  swatches: BookPageSwatch[];
  favoriteTcxSet: Set<string>;
  highlightTcx?: string | null;
  onSelect: (tcx: string) => void;
};

type GridCell =
  | { kind: "empty" }
  | { kind: "swatch"; swatch: BookPageSwatch };

export function BookPageGrid({
  swatches,
  favoriteTcxSet,
  highlightTcx,
  onSelect,
}: BookPageGridProps) {
  const t = useTranslations("productionColors");

  const cells = useMemo(() => {
    const grid: GridCell[] = Array.from(
      { length: BOOK_GRID_COLUMNS * BOOK_GRID_ROWS },
      () => ({ kind: "empty" })
    );

    for (const swatch of swatches) {
      const col = swatch.bookColumn;
      const row = swatch.bookRow;
      if (
        col < 1 ||
        col > BOOK_GRID_COLUMNS ||
        row < 1 ||
        row > BOOK_GRID_ROWS
      ) {
        continue;
      }
      const index = (row - 1) * BOOK_GRID_COLUMNS + (col - 1);
      grid[index] = { kind: "swatch", swatch };
    }

    return grid;
  }, [swatches]);

  return (
    <div
      className="grid gap-1 rounded-lg border bg-muted/30 p-2"
      style={{
        gridTemplateColumns: `repeat(${BOOK_GRID_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${BOOK_GRID_ROWS}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((cell, index) => {
        if (cell.kind === "empty") {
          return (
            <div
              key={`empty-${index}`}
              className="aspect-[4/5] rounded-sm border border-dashed border-muted-foreground/15 bg-background/40"
              aria-hidden
            />
          );
        }

        const { swatch } = cell;
        const highlighted = highlightTcx === swatch.tcx;

        return (
          <div
            key={swatch.tcx}
            role="button"
            tabIndex={0}
            title={`${swatch.tcx} — ${swatch.name}`}
            onClick={() => onSelect(swatch.tcx)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(swatch.tcx);
              }
            }}
            className={cn(
              "group relative aspect-[4/5] cursor-pointer overflow-hidden rounded-sm border text-left",
              "hover:ring-2 hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              highlighted && "ring-2 ring-primary shadow-md"
            )}
          >
            <div
              className="absolute inset-0"
              style={{ backgroundColor: swatch.hex }}
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <p className="truncate font-mono text-[9px] text-white">
                {swatch.tcx}
              </p>
            </div>
            <FavoriteButton
              tcx={swatch.tcx}
              initialFavorited={favoriteTcxSet.has(swatch.tcx)}
              className="absolute right-0.5 top-0.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 bg-black/20 hover:bg-black/30"
            />
            <span className="sr-only">
              {t("bookSwatchLabel", { tcx: swatch.tcx, name: swatch.name })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
