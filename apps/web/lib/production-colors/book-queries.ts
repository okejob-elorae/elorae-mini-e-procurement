import { prisma } from "@elorae/db";
import { normalizeTcxCode, sectionFromTcx } from "@elorae/db/pantone/book-index";

export type BookSectionMeta = {
  section: number;
  pageMin: number;
  pageMax: number;
  positionedCount: number;
};

export type BookPageSwatch = {
  tcx: string;
  name: string;
  hex: string;
  bookColumn: number;
  bookRow: number;
};

export type BookPosition = {
  tcx: string;
  section: number;
  page: number;
  column: number;
  row: number;
};

export async function countPositionedPantoneColors(): Promise<number> {
  return prisma.pantoneColor.count({
    where: { bookPage: { not: null } },
  });
}

export async function listBookSections(): Promise<BookSectionMeta[]> {
  const rows = await prisma.pantoneColor.groupBy({
    by: ["bookSection"],
    where: { bookSection: { not: null }, bookPage: { not: null } },
    _min: { bookPage: true },
    _max: { bookPage: true },
    _count: { tcx: true },
  });

  return rows
    .filter((r) => r.bookSection != null)
    .map((r) => ({
      section: r.bookSection!,
      pageMin: r._min.bookPage ?? 1,
      pageMax: r._max.bookPage ?? 1,
      positionedCount: r._count.tcx,
    }))
    .sort((a, b) => a.section - b.section);
}

export async function listPantoneColorsOnBookPage(
  section: number,
  page: number
): Promise<BookPageSwatch[]> {
  const rows = await prisma.pantoneColor.findMany({
    where: {
      bookSection: section,
      bookPage: page,
      bookColumn: { not: null },
      bookRow: { not: null },
    },
    orderBy: [{ bookRow: "asc" }, { bookColumn: "asc" }],
    select: {
      tcx: true,
      name: true,
      hex: true,
      bookColumn: true,
      bookRow: true,
    },
  });

  return rows.map((r) => ({
    tcx: r.tcx,
    name: r.name,
    hex: r.hex,
    bookColumn: r.bookColumn!,
    bookRow: r.bookRow!,
  }));
}

export async function findBookPosition(
  tcxOrRaw: string
): Promise<BookPosition | null> {
  const tcx = normalizeTcxCode(tcxOrRaw) ?? tcxOrRaw.trim();
  const row = await prisma.pantoneColor.findUnique({
    where: { tcx },
    select: {
      tcx: true,
      bookSection: true,
      bookPage: true,
      bookColumn: true,
      bookRow: true,
    },
  });

  if (
    !row ||
    row.bookSection == null ||
    row.bookPage == null ||
    row.bookColumn == null ||
    row.bookRow == null
  ) {
    return null;
  }

  return {
    tcx: row.tcx,
    section: row.bookSection,
    page: row.bookPage,
    column: row.bookColumn,
    row: row.bookRow,
  };
}

export async function resolveBookViewState(opts: {
  section?: number;
  page?: number;
  jumpTcx?: string;
}): Promise<{
  sections: BookSectionMeta[];
  section: number;
  page: number;
  swatches: BookPageSwatch[];
  highlightTcx: string | null;
  positionedCount: number;
}> {
  const positionedCount = await countPositionedPantoneColors();
  const sections = await listBookSections();

  if (!sections.length) {
    return {
      sections: [],
      section: opts.section ?? 11,
      page: opts.page ?? 1,
      swatches: [],
      highlightTcx: null,
      positionedCount: 0,
    };
  }

  let highlightTcx: string | null = null;
  let section = opts.section;
  let page = opts.page;

  if (opts.jumpTcx?.trim()) {
    const pos = await findBookPosition(opts.jumpTcx);
    if (pos) {
      section = pos.section;
      page = pos.page;
      highlightTcx = pos.tcx;
    }
  }

  const defaultSection = sections[0]!.section;
  const picked =
    sections.find((s) => s.section === section) ?? sections[0]!;
  const resolvedSection = picked.section;
  const resolvedPage = Math.min(
    Math.max(page ?? picked.pageMin, picked.pageMin),
    picked.pageMax
  );

  const swatches = await listPantoneColorsOnBookPage(
    resolvedSection,
    resolvedPage
  );

  return {
    sections,
    section: resolvedSection,
    page: resolvedPage,
    swatches,
    highlightTcx,
    positionedCount,
  };
}

export type BookPositionInput = {
  page: number;
  column: number;
  row: number;
};

function parseBookCoordinate(value: unknown, field: string): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseInt(value.trim(), 10)
        : NaN;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${field}`);
  }
  return n;
}

export async function updatePantoneBookPosition(
  tcx: string,
  position: BookPositionInput | null
): Promise<BookPosition | null> {
  const normalized = normalizeTcxCode(tcx);
  if (!normalized) {
    throw new Error("Invalid TCX code");
  }

  const existing = await prisma.pantoneColor.findUnique({
    where: { tcx: normalized },
    select: { tcx: true },
  });
  if (!existing) {
    throw new Error("Color not found");
  }

  if (position == null) {
    await prisma.pantoneColor.update({
      where: { tcx: normalized },
      data: {
        bookSection: null,
        bookPage: null,
        bookColumn: null,
        bookRow: null,
      },
    });
    return null;
  }

  const page = parseBookCoordinate(position.page, "page");
  const column = parseBookCoordinate(position.column, "column");
  const row = parseBookCoordinate(position.row, "row");
  const section = sectionFromTcx(normalized);
  if (section == null) {
    throw new Error("Cannot derive book section from TCX");
  }

  await prisma.pantoneColor.update({
    where: { tcx: normalized },
    data: {
      bookSection: section,
      bookPage: page,
      bookColumn: column,
      bookRow: row,
    },
  });

  return {
    tcx: normalized,
    section,
    page,
    column,
    row,
  };
}
