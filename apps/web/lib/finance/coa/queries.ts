import { prisma, type ChartAccount } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

type Row = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  depth: number;
  isActive: boolean;
  parentId: string | null;
};

export type CoaTreeNode = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  depth: number;
  isActive: boolean;
  isLeaf: boolean;
  isPostable: boolean;
  children: CoaTreeNode[];
};

export function buildTree(rows: Row[]): CoaTreeNode[] {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const nodesById = new Map<string, CoaTreeNode>();
  for (const r of sorted) {
    nodesById.set(r.id, { ...r, isLeaf: true, isPostable: false, children: [] });
  }
  const roots: CoaTreeNode[] = [];
  for (const r of sorted) {
    const node = nodesById.get(r.id)!;
    if (r.parentId) {
      const parent = nodesById.get(r.parentId);
      if (parent) {
        parent.children.push(node);
        parent.isLeaf = false;
      } else {
        // Orphan (parent filtered out by includeInactive=false) — promote to root.
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }
  // Final pass: derive isPostable now that children are linked.
  function recompute(node: CoaTreeNode): void {
    node.isPostable = node.isLeaf && node.isActive;
    for (const child of node.children) recompute(child);
  }
  for (const root of roots) recompute(root);
  return roots;
}

export async function getCoaTree(opts?: { includeInactive?: boolean }): Promise<CoaTreeNode[]> {
  const where = opts?.includeInactive ? {} : { isActive: true };
  const rows = await prisma.chartAccount.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      depth: true,
      isActive: true,
      parentId: true,
    },
    orderBy: { code: "asc" },
  });
  return buildTree(rows as Row[]);
}

export async function getAccount(id: string): Promise<ChartAccount | null> {
  return prisma.chartAccount.findUnique({ where: { id } });
}

export async function getPostableAccounts(): Promise<Array<{ id: string; code: string; name: string; type: AccountType }>> {
  // Postable = leaf (children.length === 0) AND active.
  // Single query: fetch all active rows + parentIds, filter to those NOT appearing as a parentId of another row.
  const all = await prisma.chartAccount.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, type: true, parentId: true },
  });
  const parentIds = new Set(all.map((a) => a.parentId).filter(Boolean) as string[]);
  return all
    .filter((a) => !parentIds.has(a.id))
    .map(({ id, code, name, type }) => ({ id, code, name, type: type as AccountType }));
}
