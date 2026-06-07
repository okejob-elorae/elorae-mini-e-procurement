import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

type JubelioCategoryRaw = {
  category_id: number;
  category_name: string;
  parent_id: number | null;
  has_children: boolean;
};

export type JubelioCategoryFlat = {
  id: number;
  name: string;
  path: string;
  isLeaf: boolean;
};

export type SaveMappingInput = {
  itemCategoryId: string;
  jubelioCategoryId: number;
};

@Injectable()
export class JubelioCategoriesService {
  private readonly logger = new Logger(JubelioCategoriesService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async fetchAll(): Promise<JubelioCategoryFlat[]> {
    // Jubelio's /inventory/categories/item-categories/ returns the full tree in a single
    // response and ignores `page` / `pageSize` query params. Pagination here is a no-op
    // and would loop forever (length always >= pageSize). Single call only.
    const all = await this.http.get<JubelioCategoryRaw[]>(
      "/inventory/categories/item-categories/",
    );

    const byId = new Map<number, JubelioCategoryRaw>(all.map((c) => [c.category_id, c]));
    const pathCache = new Map<number, string>();

    const computePath = (id: number): string => {
      const cached = pathCache.get(id);
      if (cached !== undefined) return cached;
      const node = byId.get(id);
      if (!node) return "";
      if (node.parent_id == null || !byId.has(node.parent_id)) {
        if (node.parent_id != null && !byId.has(node.parent_id)) {
          this.logger.warn(`Orphan parent_id=${node.parent_id} for category ${id}`);
        }
        pathCache.set(id, node.category_name);
        return node.category_name;
      }
      const parentPath = computePath(node.parent_id);
      const path = `${parentPath} > ${node.category_name}`;
      pathCache.set(id, path);
      return path;
    };

    return all
      .map((c) => ({
        id: c.category_id,
        name: c.category_name,
        path: computePath(c.category_id),
        isLeaf: !c.has_children,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async saveMappings(rows: SaveMappingInput[]): Promise<{ saved: number }> {
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.jubelioCategoryId)) {
        throw new Error(`Duplicate jubelioCategoryId in input: ${r.jubelioCategoryId}`);
      }
      seen.add(r.jubelioCategoryId);
    }

    const ops = rows.map((r) =>
      this.prisma.jubelioCategoryMapping.upsert({
        where: { itemCategoryId: r.itemCategoryId },
        create: { itemCategoryId: r.itemCategoryId, jubelioCategoryId: r.jubelioCategoryId },
        update: { jubelioCategoryId: r.jubelioCategoryId },
      }),
    );
    await this.prisma.$transaction(ops);

    return { saved: rows.length };
  }
}
