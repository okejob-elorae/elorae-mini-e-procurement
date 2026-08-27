import type { AccountType } from "@/lib/constants/enums";
import { isDebitNormal } from "@/lib/finance/journals/normal-side";
import type { CoaTreeNode } from "./queries";

export type CoaTreeNodeWithBalance = CoaTreeNode & {
  balance: number;
  children: CoaTreeNodeWithBalance[];
};

export type BalanceSide = "Dr" | "Cr";

/**
 * Leaf balance = signed amount from the map (default 0).
 * Parent balance = sum of children's balances (post-order).
 */
export function attachRolledUpBalances(
  tree: CoaTreeNode[],
  balanceById: Record<string, number>,
): CoaTreeNodeWithBalance[] {
  function walk(node: CoaTreeNode): CoaTreeNodeWithBalance {
    const children = node.children.map(walk);
    const balance = node.isLeaf
      ? (balanceById[node.id] ?? 0)
      : children.reduce((sum, c) => sum + c.balance, 0);
    return { ...node, children, balance };
  }
  return tree.map(walk);
}

/**
 * Drop inactive nodes for display after roll-up on the full tree.
 * Keeps each remaining node's precomputed `balance` (includes inactive descendants).
 * Inactive parents with visible descendants are kept so hierarchy stays intact.
 */
export function pruneInactiveForDisplay(
  nodes: CoaTreeNodeWithBalance[],
): CoaTreeNodeWithBalance[] {
  const out: CoaTreeNodeWithBalance[] = [];
  for (const n of nodes) {
    const children = pruneInactiveForDisplay(n.children);
    if (!n.isActive) {
      if (children.length === 0) continue;
      // Keep structural isLeaf; only children list changes for display.
      out.push({ ...n, children });
      continue;
    }
    out.push({ ...n, children });
  }
  return out;
}

/**
 * Absolute amount + Dr/Cr from the account's normal side and signed balance.
 * Debit-normal: balance >= 0 → Dr, else Cr.
 * Credit-normal: balance >= 0 → Cr, else Dr.
 */
export function balanceSide(type: AccountType, balance: number): BalanceSide {
  if (isDebitNormal(type)) {
    return balance >= 0 ? "Dr" : "Cr";
  }
  return balance >= 0 ? "Cr" : "Dr";
}

export function absoluteBalance(balance: number): number {
  return Math.abs(balance);
}
