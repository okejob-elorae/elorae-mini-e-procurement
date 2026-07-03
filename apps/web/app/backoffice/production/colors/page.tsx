import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import {
  listPantoneColors,
  listFavoriteColors,
  getFavoriteTcxSet,
  getPantoneFilterFacetCounts,
  COLOR_PAGE_SIZE,
} from "@/lib/production-colors/queries";
import { resolveBookViewState } from "@/lib/production-colors/book-queries";
import { parseBookSearchParams } from "@/lib/production-colors/book-url-params";
import { parseColorSearchParams } from "@/lib/production-colors/url-params";
import {
  ProductionColorsPageClient,
  type ProductionColorsTab,
} from "@/components/production-colors/ProductionColorsPageClient";

export const dynamic = "force-dynamic";

function parseTab(raw?: string): ProductionColorsTab {
  if (raw === "book" || raw === "favorites" || raw === "photo-analyzer") {
    return raw;
  }
  return "all";
}

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default function ProductionColorsPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[200px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      }
    >
      <ProductionColorsPageContent {...props} />
    </Suspense>
  );
}

async function ProductionColorsPageContent({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const tab = parseTab(sp.tab);

  if (tab === "photo-analyzer") {
    return (
      <ProductionColorsPageClient
        tab={tab}
        browseProps={null}
        bookProps={null}
      />
    );
  }

  if (tab === "book") {
    const { section, page, jumpTcx } = parseBookSearchParams(sp);
    const bookState = await resolveBookViewState({ section, page, jumpTcx });
    const favoriteSet = await getFavoriteTcxSet(
      session.user.id,
      bookState.swatches.map((s) => s.tcx)
    );

    return (
      <ProductionColorsPageClient
        tab={tab}
        browseProps={null}
        bookProps={{
          sections: bookState.sections,
          section: bookState.section,
          page: bookState.page,
          swatches: bookState.swatches,
          favoriteTcxSet: [...favoriteSet],
          highlightTcx: bookState.highlightTcx,
          positionedCount: bookState.positionedCount,
        }}
      />
    );
  }

  const { filters, page, filterState } = parseColorSearchParams(sp);

  if (tab === "favorites") {
    const [{ colors, totalCount }, facetCounts] = await Promise.all([
      listFavoriteColors(session.user.id, filters, {
        page,
        pageSize: COLOR_PAGE_SIZE,
      }),
      getPantoneFilterFacetCounts({ userId: session.user.id }),
    ]);

    return (
      <ProductionColorsPageClient
        tab={tab}
        browseProps={{
          tab: "favorites",
          initialColors: colors.map((c) => ({
            tcx: c.tcx,
            name: c.name,
            hex: c.hex,
            groupName: c.groupName,
            isFavorite: true,
          })),
          totalCount,
          page,
          initialFilters: filterState,
          facetCounts,
        }}
        bookProps={null}
      />
    );
  }

  const [{ colors, totalCount }, facetCounts] = await Promise.all([
    listPantoneColors(filters, {
      page,
      pageSize: COLOR_PAGE_SIZE,
    }),
    getPantoneFilterFacetCounts(),
  ]);

  const favoriteSet = await getFavoriteTcxSet(
    session.user.id,
    colors.map((c) => c.tcx)
  );

  return (
    <ProductionColorsPageClient
      tab="all"
      browseProps={{
        tab: "all",
        initialColors: colors.map((c) => ({
          tcx: c.tcx,
          name: c.name,
          hex: c.hex,
          groupName: c.groupName,
          isFavorite: favoriteSet.has(c.tcx),
        })),
        totalCount,
        page,
        initialFilters: filterState,
        facetCounts,
      }}
      bookProps={null}
    />
  );
}
