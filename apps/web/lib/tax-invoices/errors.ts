export type TaxInvoiceErrorCode = "NOT_FOUND" | "INVALID_STATE" | "INVALID_REQUEST" | "CONFLICT" | "REASON_TOO_LONG";

/**
 * Every transition copies its reason into `AuditLog.reason`, a bare `String?` — MySQL
 * `VARCHAR(191)` — so 191 is the real ceiling even though `TaxInvoice.reason` itself is
 * `@db.Text`. The writer refuses anything longer with `REASON_TOO_LONG` before it opens a
 * transaction; the dialog caps its field at the same figure. This module stays import-free so the
 * client component can read the constant.
 */
export const MAX_TAX_INVOICE_REASON_LENGTH = 191;

export class TaxInvoiceError extends Error {
  constructor(public code: TaxInvoiceErrorCode) {
    super(code);
    this.name = "TaxInvoiceError";
  }
}

/** Kode layar untuk nomor seri faktur pajak (NSFP) yang ditolak penulis. */
export type KodeNomorFaktur = "NOMOR_FAKTUR_GANDA" | "NOMOR_FAKTUR_FORMAT";

export type PenolakanNomorFaktur = {
  code: KodeNomorFaktur;
  /** Hanya pada NOMOR_FAKTUR_GANDA: nota pengiriman yang sudah memegang nomor itu. */
  dipakaiDeliveryId: string | null;
};

/**
 * `NomorFakturError` (lib/tax-invoices/writer.ts) membawa `code` INVALID_REQUEST
 * yang generik; `sebab`-nya yang membedakan format vs ganda. Dibaca dari bentuknya,
 * bukan lewat `instanceof` kelas penulis, supaya aksi tidak perlu mengimpor penulis
 * hanya untuk kelas galatnya. Selain itu → null (bukan penolakan nomor).
 */
export function penolakanNomorFaktur(e: unknown): PenolakanNomorFaktur | null {
  if (!(e instanceof TaxInvoiceError) || e.code !== "INVALID_REQUEST") return null;
  const { sebab, dipakai } = e as TaxInvoiceError & { sebab?: unknown; dipakai?: unknown };
  if (sebab === "FORMAT") return { code: "NOMOR_FAKTUR_FORMAT", dipakaiDeliveryId: null };
  if (sebab !== "GANDA") return null;
  const deliveryId =
    typeof dipakai === "object" && dipakai !== null && typeof (dipakai as { deliveryId?: unknown }).deliveryId === "string"
      ? (dipakai as { deliveryId: string }).deliveryId
      : null;
  return { code: "NOMOR_FAKTUR_GANDA", dipakaiDeliveryId: deliveryId };
}
