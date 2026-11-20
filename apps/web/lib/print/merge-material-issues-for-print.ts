/**
 * Merge several MaterialIssue print payloads into one Surat Jalan (qty-only).
 * Doc numbers are joined; type is single or mixed. Order: FABRIC then ACCESSORIES,
 * then issuedAt ascending within a type.
 */

import type { MaterialIssuePrintLine } from "@/lib/print/material-issue-html";

export type MaterialIssuePrintPayload = {
  docNumber: string;
  issueType: string;
  issuedAt: Date | string;
  woDocNumber: string;
  vendorName: string;
  lines: MaterialIssuePrintLine[];
};

export type MergeMaterialIssuesTypeLabels = {
  fabric: string;
  accessories: string;
  mixed: string;
};

function typeRank(issueType: string): number {
  if (issueType === "FABRIC") return 0;
  if (issueType === "ACCESSORIES") return 1;
  return 2;
}

function asTime(v: Date | string): number {
  return new Date(v).getTime();
}

export function mergeMaterialIssuesForPrint(
  issues: MaterialIssuePrintPayload[],
  typeLabels: MergeMaterialIssuesTypeLabels
): MaterialIssuePrintPayload | null {
  if (issues.length === 0) return null;

  const sorted = [...issues].sort((a, b) => {
    const byType = typeRank(a.issueType) - typeRank(b.issueType);
    if (byType !== 0) return byType;
    return asTime(a.issuedAt) - asTime(b.issuedAt);
  });

  const types = new Set(sorted.map((i) => i.issueType));
  let issueTypeLabel: string;
  if (types.size === 1) {
    const only = sorted[0].issueType;
    issueTypeLabel =
      only === "FABRIC"
        ? typeLabels.fabric
        : only === "ACCESSORIES"
          ? typeLabels.accessories
          : only;
  } else {
    issueTypeLabel = typeLabels.mixed;
  }

  const issuedAt = sorted.reduce(
    (earliest, i) => (asTime(i.issuedAt) < asTime(earliest) ? i.issuedAt : earliest),
    sorted[0].issuedAt
  );

  return {
    docNumber: sorted.map((i) => i.docNumber).join(", "),
    issueType: issueTypeLabel,
    issuedAt,
    woDocNumber: sorted[0].woDocNumber,
    vendorName: sorted[0].vendorName,
    lines: sorted.flatMap((i) => i.lines),
  };
}
