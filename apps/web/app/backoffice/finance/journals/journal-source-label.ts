import { humanizeAuditCode } from "@/lib/audit/action-label";

type Translator = {
  (key: string): string;
  has: (key: string) => boolean;
};

/**
 * Readable name of an auto-journal's `sourceType` (`SALESORDER_COGS` →
 * "HPP penjualan"). Takes the `financeJournals` translator; an unknown code
 * reads as a humanised spelling of itself rather than raw SNAKE_CASE.
 */
export function journalSourceLabel(t: Translator, sourceType: string | null | undefined): string {
  const code = (sourceType ?? "").trim();
  if (!code) return t("sourceAuto");
  const key = `sourceTypes.${code}`;
  if (/^[A-Za-z0-9_]+$/.test(code) && t.has(key)) return t(key);
  return humanizeAuditCode(code);
}
