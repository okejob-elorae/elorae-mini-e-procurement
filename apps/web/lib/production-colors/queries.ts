import { Prisma } from '@elorae/db';
import { prisma } from '@elorae/db';
import type { FilterTags } from '@/lib/pantone/classify';
import { COLOR_PAGE_SIZE } from '@/lib/production-colors/constants';

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
      OR: values.map((v) => ({
        filterTags: {
          path: `$.${dim}`,
          array_contains: v,
        },
      })),
    });
  }
  return and;
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
      orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
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
