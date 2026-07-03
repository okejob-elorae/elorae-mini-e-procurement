"use client";

import { useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookPageGrid } from "@/components/production-colors/BookPageGrid";
import { PantoneColorDetailDialog } from "@/components/production-colors/PantoneColorDetailDialog";
import type { BookSectionMeta, BookPageSwatch } from "@/lib/production-colors/book-queries";

type BookBrowseClientProps = {
  sections: BookSectionMeta[];
  section: number;
  page: number;
  swatches: BookPageSwatch[];
  favoriteTcxSet: string[];
  highlightTcx?: string | null;
  positionedCount: number;
};

function buildBookQueryString(opts: {
  section: number;
  page: number;
  jumpTcx?: string;
}): string {
  const params = new URLSearchParams();
  params.set("tab", "book");
  params.set("section", String(opts.section));
  params.set("page", String(opts.page));
  if (opts.jumpTcx?.trim()) {
    params.set("tcx", opts.jumpTcx.trim());
  }
  return `?${params.toString()}`;
}

export function BookBrowseClient({
  sections,
  section,
  page,
  swatches,
  favoriteTcxSet,
  highlightTcx,
  positionedCount,
}: BookBrowseClientProps) {
  const t = useTranslations("productionColors");
  const router = useRouter();
  const pathname = usePathname();
  const [jumpInput, setJumpInput] = useState("");
  const [detailTcx, setDetailTcx] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const favoriteSet = new Set(favoriteTcxSet);
  const sectionMeta =
    sections.find((s) => s.section === section) ?? sections[0];
  const pageMin = sectionMeta?.pageMin ?? 1;
  const pageMax = sectionMeta?.pageMax ?? 1;

  const navigate = useCallback(
    (opts: { section: number; page: number; jumpTcx?: string }) => {
      router.push(`${pathname}${buildBookQueryString(opts)}`);
    },
    [pathname, router]
  );

  const openDetail = (tcx: string) => {
    setDetailTcx(tcx);
    setDetailOpen(true);
  };

  if (positionedCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("bookEmptyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("bookEmptyBody")}</p>
          <p className="font-mono text-xs">{t("bookImportHint")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1.5 min-w-[140px]">
              <label className="text-xs font-medium text-muted-foreground">
                {t("bookSection")}
              </label>
              <Select
                value={String(section)}
                onValueChange={(value) =>
                  navigate({
                    section: parseInt(value, 10),
                    page: sections.find((s) => s.section === parseInt(value, 10))
                      ?.pageMin ?? 1,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.section} value={String(s.section)}>
                      {t("bookSectionOption", { section: s.section })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={page <= pageMin}
                onClick={() => navigate({ section, page: page - 1 })}
                aria-label={t("bookPrevPage")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[7rem] text-center text-sm font-medium tabular-nums">
                {t("bookPageLabel", { page, pageMax })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={page >= pageMax}
                onClick={() => navigate({ section, page: page + 1 })}
                aria-label={t("bookNextPage")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <form
              className="flex flex-1 min-w-[200px] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!jumpInput.trim()) return;
                navigate({ section, page, jumpTcx: jumpInput.trim() });
              }}
            >
              <Input
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                placeholder={t("bookJumpPlaceholder")}
                className="font-mono"
              />
              <Button type="submit" variant="secondary">
                <Search className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">{t("bookJump")}</span>
              </Button>
            </form>
          </div>

          <p className="text-sm text-muted-foreground">
            {t("bookPositionedCount", { count: positionedCount })}
          </p>
        </CardContent>
      </Card>

      <BookPageGrid
        swatches={swatches}
        favoriteTcxSet={favoriteSet}
        highlightTcx={highlightTcx}
        onSelect={openDetail}
      />

      <PantoneColorDetailDialog
        tcx={detailTcx}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSelectSimilar={(tcx) => {
          setDetailTcx(tcx);
          setDetailOpen(true);
        }}
        onGoToBook={(pos) => {
          setDetailOpen(false);
          navigate({
            section: pos.section,
            page: pos.page,
            jumpTcx: pos.tcx,
          });
        }}
      />
    </div>
  );
}
