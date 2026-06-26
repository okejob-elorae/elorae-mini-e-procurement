"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColorsBrowseClient } from "@/components/production-colors/ColorsBrowseClient";
import { BookBrowseClient } from "@/components/production-colors/BookBrowseClient";
import { PhotoAnalyzerWorkspace } from "@/components/production-colors/PhotoAnalyzerWorkspace";
import type {
  ColorFiltersState,
  FilterFacetCounts,
} from "@/components/production-colors/ColorsFilterBar";
import type { PantoneSwatch } from "@/components/production-colors/types";
import type {
  BookPageSwatch,
  BookSectionMeta,
} from "@/lib/production-colors/book-queries";

export type ProductionColorsTab = "all" | "book" | "favorites" | "photo-analyzer";

const TAB_KEYS: ProductionColorsTab[] = [
  "all",
  "book",
  "favorites",
  "photo-analyzer",
];

const TITLE_KEYS: Record<
  ProductionColorsTab,
  "titleAll" | "titleBook" | "titleFavorites" | "titlePhotoAnalyzer"
> = {
  all: "titleAll",
  book: "titleBook",
  favorites: "titleFavorites",
  "photo-analyzer": "titlePhotoAnalyzer",
};

const BROWSE_PARAM_KEYS = [
  "search",
  "tone",
  "hue",
  "temperature",
  "tint",
  "page",
] as const;

const BOOK_PARAM_KEYS = ["section", "page", "tcx", "jump"] as const;

type BrowseProps = {
  tab: "all" | "favorites";
  initialColors: PantoneSwatch[];
  totalCount: number;
  page: number;
  initialFilters: ColorFiltersState;
  facetCounts: FilterFacetCounts;
};

type BookProps = {
  sections: BookSectionMeta[];
  section: number;
  page: number;
  swatches: BookPageSwatch[];
  favoriteTcxSet: string[];
  highlightTcx: string | null;
  positionedCount: number;
};

type ProductionColorsPageClientProps = {
  tab: ProductionColorsTab;
  browseProps: BrowseProps | null;
  bookProps: BookProps | null;
};

export function ProductionColorsPageClient({
  tab,
  browseProps,
  bookProps,
}: ProductionColorsPageClientProps) {
  const t = useTranslations("productionColors");
  const tt = useTranslations("productionColors.tabs");
  const searchParams = useSearchParams();
  const router = useRouter();

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    if (value === "photo-analyzer") {
      for (const key of BROWSE_PARAM_KEYS) {
        params.delete(key);
      }
      for (const key of BOOK_PARAM_KEYS) {
        params.delete(key);
      }
    }
    if (value === "book") {
      for (const key of BROWSE_PARAM_KEYS) {
        params.delete(key);
      }
    }
    if (value === "all" || value === "favorites") {
      for (const key of BOOK_PARAM_KEYS) {
        params.delete(key);
      }
    }
    const qs = params.toString();
    router.replace(
      qs ? `/backoffice/production/colors?${qs}` : "/backoffice/production/colors"
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t(TITLE_KEYS[tab])}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {tt(
                key === "photo-analyzer"
                  ? "photoAnalyzer"
                  : key === "book"
                    ? "book"
                    : key
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all" className="mt-6">
          {browseProps?.tab === "all" && <ColorsBrowseClient {...browseProps} />}
        </TabsContent>

        <TabsContent value="book" className="mt-6">
          {bookProps && <BookBrowseClient {...bookProps} />}
        </TabsContent>

        <TabsContent value="favorites" className="mt-6">
          {browseProps?.tab === "favorites" && (
            <ColorsBrowseClient {...browseProps} />
          )}
        </TabsContent>

        <TabsContent value="photo-analyzer" className="mt-6">
          {tab === "photo-analyzer" && <PhotoAnalyzerWorkspace />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
