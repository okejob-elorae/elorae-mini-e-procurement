import { Prisma } from '@elorae/db';
import { prisma, usePostgres } from '@elorae/db';
import type { FilterTags } from "@elorae/db/pantone";
import { DEFAULT_FILTER_OPTIONS, FILTER_DIMENSIONS } from "@elorae/db/pantone";
import { COLOR_PAGE_SIZE } from '@/lib/production-colors/constants';
import type { FilterFacetCounts } from '@/components/production-colors/ColorsFilterBar';

export { COLOR_PAGE_SIZE };

export type PantoneColorRow = {
  tcx: string;
  name: string;
  hex: string;
  rgbR: number;
  rgbG: number;
  rgbB: number;
  groupName: string | null;
  filterTags: FilterTags;
};

export type ListPantoneFilters = {
  search?: string;
  tone?: string[];
  hue?: string[];
  temperature?: string[];
  tint?: string[];
};

function buildTagWhere(filters: ListPantoneFilters): Prisma.PantoneColorWhereInput[] {
  const and: Prisma.PantoneColorWhereInput[] = [];
  const dims: Array<keyof Pick<ListPantoneFilters, 'tone' | 'hue' | 'temperature' | 'tint'>> = [
    'tone',
    'hue',
    'temperature',
    'tint',
  ];
  for (const dim of dims) {
    const values = filters[dim];
    if (!values?.length) continue;
    and.push({
      /*
       * Prisma's JSON `path` is dialect-specific and the two spellings are not
       * interchangeable: MySQL takes a JSONPath string ("$.tone"), PostgreSQL
       * takes an array of keys (["tone"]). Passing the MySQL form to Postgres
       * fails at query time with PrismaClientValidationError, not at build, so
       * it only surfaces the moment someone clicks the filter.
       */
      OR: values.map((v) => ({
        filterTags: {
          path: usePostgres() ? [dim] : `$.${dim}`,
          array_contains: v,
        },
      })),
    });
  }
  return and;
}

/**
 * Fan-deck order: the sequence the physical TCX book is bound in.
 *
 * The grid used to sort by groupName then name — alphabetically — which is why
 * it looked shuffled: a swatch book is arranged so neighbouring colours are
 * neighbouring hues, and no colour library is ever read alphabetically.
 * 2,624 of 2,800 colours carry real book coordinates, and the sequence opens on
 * the whites exactly as the printed deck does.
 *
 * The 176 without coordinates sort last by lightness, so the tail still reads
 * as a gradient rather than a jumble.
 *
 * `nulls` is a PostgreSQL-only ordering option in Prisma. MySQL has no
 * equivalent and sorts NULLs first, which would hoist those 176 to the very
 * top — so the legacy dialect keeps the alphabetical order it always had
 * rather than silently getting a worse one.
 */
function buildBookOrder(): Prisma.PantoneColorOrderByWithRelationInput[] {
  if (!usePostgres()) {
    return [{ groupName: 'asc' }, { name: 'asc' }];
  }
  const asc = { sort: 'asc', nulls: 'last' } as const;
  return [
    { bookSection: asc },
    { bookPage: asc },
    { bookColumn: asc },
    { bookRow: asc },
    { labL: { sort: 'desc', nulls: 'last' } },
    { name: 'asc' },
  ];
}

export async function listPantoneColors(
  filters: ListPantoneFilters,
  opts: { page: number; pageSize: number }
): Promise<{ colors: PantoneColorRow[]; totalCount: number }> {
  const { page, pageSize } = opts;
  const search = filters.search?.trim();

  const where: Prisma.PantoneColorWhereInput = {
    AND: [
      ...buildTagWhere(filters),
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search } },
                { tcx: { contains: search } },
                { hex: { contains: search.replace('#', '') } },
              ],
            },
          ]
        : []),
    ],
  };

  const [rows, totalCount] = await Promise.all([
    prisma.pantoneColor.findMany({
      where,
      orderBy: buildBookOrder(),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        tcx: true,
        name: true,
        hex: true,
        rgbR: true,
        rgbG: true,
        rgbB: true,
        groupName: true,
        filterTags: true,
      },
    }),
    prisma.pantoneColor.count({ where }),
  ]);

  return {
    colors: rows.map((r) => ({
      ...r,
      filterTags: r.filterTags as FilterTags,
    })),
    totalCount,
  };
}

export async function getPantoneColorByTcx(tcx: string) {
  return prisma.pantoneColor.findUnique({ where: { tcx } });
}

export async function listFavoriteTcxForUser(userId: string): Promise<string[]> {
  const rows = await prisma.pantoneColorFavorite.findMany({
    where: { userId },
    select: { tcx: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => r.tcx);
}

export async function listFavoriteColors(
  userId: string,
  filters: ListPantoneFilters,
  opts: { page: number; pageSize: number }
): Promise<{ colors: PantoneColorRow[]; totalCount: number }> {
  const tcxList = await listFavoriteTcxForUser(userId);
  if (!tcxList.length) {
    return { colors: [], totalCount: 0 };
  }

  const search = filters.search?.trim();
  const where: Prisma.PantoneColorWhereInput = {
    tcx: { in: tcxList },
    AND: [
      ...buildTagWhere(filters),
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search } },
                { tcx: { contains: search } },
              ],
            },
          ]
        : []),
    ],
  };

  const [rows, totalCount] = await Promise.all([
    prisma.pantoneColor.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: {
        tcx: true,
        name: true,
        hex: true,
        rgbR: true,
        rgbG: true,
        rgbB: true,
        groupName: true,
        filterTags: true,
      },
    }),
    prisma.pantoneColor.count({ where }),
  ]);

  return {
    colors: rows.map((r) => ({
      ...r,
      filterTags: r.filterTags as FilterTags,
    })),
    totalCount,
  };
}

export async function getFavoriteTcxSet(
  userId: string,
  tcxCodes: string[]
): Promise<Set<string>> {
  if (!tcxCodes.length) return new Set();
  const rows = await prisma.pantoneColorFavorite.findMany({
    where: { userId, tcx: { in: tcxCodes } },
    select: { tcx: true },
  });
  return new Set(rows.map((r) => r.tcx));
}

export async function isFavorite(userId: string, tcx: string): Promise<boolean> {
  const row = await prisma.pantoneColorFavorite.findUnique({
    where: { userId_tcx: { userId, tcx } },
  });
  return !!row;
}

export async function toggleFavorite(
  userId: string,
  tcx: string
): Promise<{ favorited: boolean }> {
  const existing = await prisma.pantoneColorFavorite.findUnique({
    where: { userId_tcx: { userId, tcx } },
  });
  if (existing) {
    await prisma.pantoneColorFavorite.delete({
      where: { userId_tcx: { userId, tcx } },
    });
    return { favorited: false };
  }
  await prisma.pantoneColorFavorite.create({
    data: { userId, tcx },
  });
  return { favorited: true };
}

export async function countFavorites(userId: string): Promise<number> {
  return prisma.pantoneColorFavorite.count({ where: { userId } });
}

function emptyFacetCounts(): FilterFacetCounts {
  const counts = {} as FilterFacetCounts;
  for (const dim of FILTER_DIMENSIONS) {
    counts[dim] = {};
    for (const opt of DEFAULT_FILTER_OPTIONS[dim]) {
      counts[dim][opt] = 0;
    }
  }
  return counts;
}

export async function getPantoneFilterFacetCounts(opts?: {
  userId?: string;
}): Promise<FilterFacetCounts> {
  const counts = emptyFacetCounts();

  const rows = opts?.userId
    ? await prisma.pantoneColor.findMany({
        where: {
          favorites: { some: { userId: opts.userId } },
        },
        select: { filterTags: true },
      })
    : await prisma.pantoneColor.findMany({
        select: { filterTags: true },
      });

  for (const row of rows) {
    const tags = row.filterTags as FilterTags;
    for (const dim of FILTER_DIMENSIONS) {
      for (const value of tags[dim] ?? []) {
        if (value in counts[dim]) {
          counts[dim][value] += 1;
        }
      }
    }
  }

  return counts;
}
