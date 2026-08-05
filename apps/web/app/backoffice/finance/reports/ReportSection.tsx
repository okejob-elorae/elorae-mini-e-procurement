"use client";

import type { RollupNode } from "@/lib/finance/reports/rollup";
import { TableCell, TableRow } from "@/components/ui/table";

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function nodeRows(nodes: RollupNode[], level: number): React.ReactNode[] {
  return nodes.flatMap((node) => [
    <TableRow key={node.accountId}>
      <TableCell style={{ paddingLeft: `${level * 20 + 12}px` }}>
        <span className="font-mono text-xs text-muted-foreground mr-2">{node.code}</span>
        {node.name}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatRupiah(node.subtotal)}</TableCell>
    </TableRow>,
    ...nodeRows(node.children, level + 1),
  ]);
}

type Props = {
  title: string;
  nodes: RollupNode[];
  total: number;
  totalLabel: string;
  emptyLabel: string;
};

/**
 * One statement section: indented account rows followed by a bold subtotal.
 * Shared by Laba Rugi and Neraca so both read identically.
 */
export function ReportSection({ title, nodes, total, totalLabel, emptyLabel }: Props) {
  return (
    <>
      <TableRow className="bg-muted/40">
        <TableCell colSpan={2} className="font-semibold uppercase text-xs tracking-wide">
          {title}
        </TableCell>
      </TableRow>
      {nodes.length === 0 ? (
        <TableRow>
          <TableCell colSpan={2} className="pl-6 text-muted-foreground text-sm">
            {emptyLabel}
          </TableCell>
        </TableRow>
      ) : (
        nodeRows(nodes, 0)
      )}
      <TableRow className="font-semibold">
        <TableCell className="pl-3">{totalLabel}</TableCell>
        <TableCell className="text-right tabular-nums">{formatRupiah(total)}</TableCell>
      </TableRow>
    </>
  );
}
