/**
 * Soft hint only — the mark-created dialog shows a muted note when this returns `false`, never
 * blocks submission. DJP has changed the real e-Faktur number format before and will again; a
 * hard regex would strand real work with no override. Import-free for the same reason as
 * `status-display.ts` beside it — a client component uses this directly.
 */
const DJP_PATTERN = /^\d{3}\.\d{3}-\d{2}\.\d{8}$/;

export function looksLikeDjpInvoiceNumber(value: string): boolean {
  return DJP_PATTERN.test(value.trim());
}
