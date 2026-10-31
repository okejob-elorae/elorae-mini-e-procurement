/**
 * Values in the audit-trail change table that need more than `nilaiTampil`:
 * money fields shown as rupiah, and status codes shown as their Indonesian
 * label instead of "BELUM → DIBAYAR". Pure: no React, translator passed in.
 */
import { humanizeAuditCode, type AuditLabelTranslator } from "./action-label";
import { STATUS_MAPS } from "@/lib/ui/status-map";

/*
 * Rule for money: the LAST segment of the field path, split into words
 * (camelCase and snake_case), holds a money word and no counting word.
 * `totalAmount`, `unitPrice`, `dpp`, `pph21` are money; `totalQty`,
 * `ppnRatePercent`, `creditDays` are not. Ambiguous Indonesian words such as
 * "jumlah" (amount OR count) are deliberately NOT money words.
 */
const KATA_UANG = new Set([
  "amount",
  "total",
  "subtotal",
  "price",
  "cost",
  "fee",
  "outstanding",
  "balance",
  "credit",
  "debit",
  "dpp",
  "pph",
  "ppn",
  "hpp",
  "cogs",
  "bruto",
  "neto",
  "gross",
  "harga",
  "nilai",
  "biaya",
  "saldo",
  "tagihan",
]);

const KATA_BUKAN_UANG = new Set([
  "qty",
  "quantity",
  "count",
  "pcs",
  "percent",
  "persen",
  "pct",
  "rate",
  "tarif",
  "ratio",
  "days",
  "hari",
  "bulan",
  "month",
  "year",
  "tahun",
  "id",
  "no",
  "nomor",
  "number",
  "code",
  "kode",
  "sku",
]);

function kataKolom(kunci: string): string[] {
  const akhir = kunci.split(".").at(-1) ?? "";
  return akhir
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/\d+$/, ""));
}

/** Whether a changed field holds money (shown as rupiah). */
export function kolomUang(kunci: string): boolean {
  const kata = kataKolom(kunci);
  if (kata.length === 0) return false;
  if (kata.some((w) => KATA_BUKAN_UANG.has(w))) return false;
  return kata.some((w) => KATA_UANG.has(w));
}

const POLA_ANGKA = /^-?\d+(\.\d+)?$/;

/** A money value as a number: a finite number or a decimal string ("2512886.50"). */
export function angkaUang(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && POLA_ANGKA.test(v.trim())) return Number(v.trim());
  return null;
}

const POLA_KODE = /^[A-Z][A-Z0-9_]*$/;

function kolomStatus(kunci: string): string | null {
  const akhir = kunci.split(".").at(-1) ?? "";
  return akhir === "status" || akhir === "tahap" || /Status$/.test(akhir) ? akhir : null;
}

/**
 * Where a status code of one document type is labelled, per field: message
 * namespaces whose `<CODE>` key is the label. The same code means different
 * things in different documents ("BELUM" is "Belum dibayar" on a KOL payment
 * term but "Belum disetor" on a tax), so lookups are always per document.
 */
const NAMESPACE_STATUS: Record<string, Record<string, readonly string[]>> = {
  // KOL payment-term audits are written against the collaboration (`KolBrief`).
  KolBrief: { status: ["kreatifRuang.termin.status", "kreatifRuang.bayar"], tahap: ["kreatifRuang.tahap"] },
};

/** Document types whose states live in the shared `status-map.ts` (labels in `statuses`). */
const PETA_STATUS_BERSAMA: Record<string, Record<string, keyof typeof STATUS_MAPS>> = {
  PurchaseOrder: { status: "purchaseOrder" },
  SalesOrder: { status: "salesOrder", fulfillmentStatus: "fulfillment" },
  WorkOrder: { status: "workOrder" },
  FieldSalesOrder: { status: "fieldSales", deliveryStatus: "delivery" },
  TaxInvoice: { status: "taxInvoice" },
};

/** Candidate message keys (root-relative, first that exists wins) for a status value. */
export function kandidatLabelStatus(
  entityType: string | null | undefined,
  kunci: string,
  nilai: unknown,
): string[] {
  const kolom = kolomStatus(kunci);
  if (!kolom || !entityType || typeof nilai !== "string" || !POLA_KODE.test(nilai)) return [];
  const hasil: string[] = [];
  for (const ns of NAMESPACE_STATUS[entityType]?.[kolom] ?? []) hasil.push(`${ns}.${nilai}`);
  const domain = PETA_STATUS_BERSAMA[entityType]?.[kolom];
  const meta = domain ? STATUS_MAPS[domain][nilai] : undefined;
  if (meta) hasil.push(`statuses.${meta.labelKey}`);
  return hasil;
}

/**
 * Readable label of a status value, or null when the value is not a status
 * code (then the caller shows it as usual). A code no table knows is spelled
 * as words ("MENUNGGU_GUDANG" → "Menunggu gudang") rather than shown raw.
 * `t` is a ROOT translator (`useTranslations()` without a namespace).
 */
export function labelNilaiStatus(
  t: AuditLabelTranslator,
  entityType: string | null | undefined,
  kunci: string,
  nilai: unknown,
): string | null {
  if (!kolomStatus(kunci) || typeof nilai !== "string" || !POLA_KODE.test(nilai)) return null;
  const kunciPesan = kandidatLabelStatus(entityType, kunci, nilai).find((k) => t.has(k));
  return kunciPesan ? t(kunciPesan) : humanizeAuditCode(nilai);
}
