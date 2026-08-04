import type { AccountType } from "@/lib/constants/enums";
import type { BalanceRow } from "./balances";

export type RollupNode = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  depth: number;
  debit: number;
  credit: number;
  signed: number;
  subtotal: number;
  children: RollupNode[];
};

/**
 * Builds the parent/child tree for the given account types and computes each
 * node's subtotal as its own signed balance plus every descendant's. A row
 * whose parent is not in the filtered set becomes a root, so a type filter
 * can never drop a balance out of the report.
 */
export function buildRollup(rows: BalanceRow[], types: AccountType[]): RollupNode[] {
  const wanted = new Set(types);
  const scoped = rows.filter((r) => wanted.has(r.type));

  const nodes = new Map<string, RollupNode>();
  for (const row of scoped) {
    nodes.set(row.accountId, {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      depth: row.depth,
      debit: row.debit,
      credit: row.credit,
      signed: row.signed,
      subtotal: 0,
      children: [],
    });
  }

  const roots: RollupNode[] = [];
  for (const row of scoped) {
    const node = nodes.get(row.accountId)!;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortByCode = (a: RollupNode, b: RollupNode) => a.code.localeCompare(b.code);
  const toCents = (value: number): number => Math.round(value * 100);
  const resolve = (node: RollupNode): number => {
    node.children.sort(sortByCode);
    const childTotal = node.children.reduce((sum, child) => sum + toCents(resolve(child)), 0);
    node.subtotal = (toCents(node.signed) + childTotal) / 100;
    return node.subtotal;
  };

  roots.sort(sortByCode);
  for (const root of roots) resolve(root);

  return roots;
}
