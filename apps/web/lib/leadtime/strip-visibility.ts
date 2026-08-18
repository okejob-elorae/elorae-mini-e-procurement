export type LeadTimeDocType = "PO" | "WO";

/** Hide the strip only when the document was cancelled (or a WO still in draft). CLOSED/OVER POs stay visible. */
export function shouldHideLiveStrip(docType: LeadTimeDocType, status: string): boolean {
  if (docType === "PO") {
    return status === "CANCELLED";
  }
  return status === "DRAFT" || status === "CANCELLED";
}

/** WO completed stays summary-only. CLOSED/OVER POs still render the step chain. */
export function shouldCollapseToCompletedSummary(
  docType: LeadTimeDocType,
  status: string
): boolean {
  return docType === "WO" && status === "COMPLETED";
}
