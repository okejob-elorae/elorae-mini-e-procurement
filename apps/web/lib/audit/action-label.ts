/**
 * Readable labels for audit-log rows.
 *
 * `AuditLog.action` and `AuditLog.entityType` are stored as codes
 * (`CONTENT_PLAN_SWAPPED`, `ContentPlan`). Screens must never show those raw,
 * so every code a writer in this codebase emits has a key in the
 * `auditActions` message namespace, and anything unknown (an older row, a
 * code added later without a key) falls back to a humanised spelling of the
 * code itself rather than the SNAKE_CASE.
 *
 * Usage in a client component:
 *
 *   const tAuditActions = useTranslations("auditActions");
 *   auditActionLabel(tAuditActions, log.action, log.entityType); // "Rencana konten ditukar"
 *   auditEntityLabel(tAuditActions, log.entityType);             // "Rencana konten"
 *
 * Generic actions (`CREATE`, `UPDATE`, `PRINT`, …) are templates over the
 * entity: `CREATE` + `PlanYear` reads "Tahun rencana dibuat". Specific actions
 * carry their own subject and ignore the entity.
 */

/** The slice of a next-intl translator these helpers need. */
export type AuditLabelTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/** Only plain identifiers are looked up; a dot would be read as a nested path. */
const LOOKUP_SAFE = /^[A-Za-z0-9_]+$/;

/**
 * Turns a code into words: `CONTENT_PLAN_SWAPPED` → "Content plan swapped",
 * `ContentPlan` → "Content plan", `FGReceipt` → "FG receipt".
 *
 * All-caps codes are split on separators and lower-cased. Mixed-case codes are
 * split on case boundaries, keeping acronym runs (`GRN`, `FG`) intact.
 */
export function humanizeAuditCode(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (!raw) return "";

  const hasLower = /[a-z]/.test(raw);
  const words = hasLower
    ? raw
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    : raw
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((w) => w.toLowerCase());

  const sentence = words.map(singkatanPajak).join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Indonesian tax abbreviations keep their own spelling: "Dpp" read as a typo. */
const SINGKATAN_PAJAK: Record<string, string> = {
  dpp: "DPP",
  pph: "PPh",
  ppn: "PPN",
  npwp: "NPWP",
  nik: "NIK",
  nsfp: "NSFP",
  ntpn: "NTPN",
  hpp: "HPP",
};

/** `pph` → "PPh", `pph21` → "PPh 21"; any other word unchanged. Whole words only. */
function singkatanPajak(word: string): string {
  const m = /^([a-z]+)(\d*)$/.exec(word);
  const ganti = m ? SINGKATAN_PAJAK[m[1]] : undefined;
  if (!m || !ganti) return word;
  return m[2] ? `${ganti} ${m[2]}` : ganti;
}

/** Readable name of an entity type: `ContentPlan` → "Rencana konten". */
export function auditEntityLabel(
  t: AuditLabelTranslator,
  entityType: string | null | undefined,
): string {
  const code = (entityType ?? "").trim();
  if (!code) return "—";
  const key = `entities.${code}`;
  if (LOOKUP_SAFE.test(code) && t.has(key)) return t(key);
  return humanizeAuditCode(code);
}

/**
 * Readable label of an action, e.g. "Rencana konten ditukar".
 *
 * Pass the row's `entityType` so generic actions can name their subject
 * (`CREATE` + `PlanYear` → "Tahun rencana dibuat"); without it they read
 * "Data dibuat".
 */
export function auditActionLabel(
  t: AuditLabelTranslator,
  action: string | null | undefined,
  entityType?: string | null,
): string {
  const code = (action ?? "").trim();
  if (!code) return "—";
  const entity = entityType?.trim() ? auditEntityLabel(t, entityType) : t("unknownEntity");
  const key = `actions.${code}`;
  if (LOOKUP_SAFE.test(code) && t.has(key)) return t(key, { entity });
  return humanizeAuditCode(code);
}
