import type { BuildSuratKeluarOptions } from "@/lib/print/konsi-surat-keluar-html";

/** The Surat Keluar's static labels, shared by the legacy header print and the per-shipment print. */
export function buildSuratKeluarLabels(t: (key: string) => string): BuildSuratKeluarOptions["labels"] {
  return {
    title: t("print.suratKeluarTitle"),
    doc: t("print.docLabel"),
    store: t("print.storeLabel"),
    salesman: t("print.salesmanLabel"),
    date: t("print.dateLabel"),
    status: t("print.statusLabel"),
    no: t("print.colNo"),
    product: t("print.colProduct"),
    qty: t("print.colQty"),
    consignmentNote: t("print.consignmentNote"),
    handedBy: t("print.handedBy"),
    receivedBy: t("print.receivedBy"),
    issuedBy: t("print.issuedBy"),
  };
}
