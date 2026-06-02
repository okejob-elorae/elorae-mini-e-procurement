import * as XLSX from "xlsx";
import type { ParseResult, SalesHistoryRow, SalesHistoryRowStatus } from "./types";
import {
  cellString,
  deriveParentSku,
  parseIntSafe,
  parseNumber,
  parseVariation,
} from "./sku-utils";

const SHEET_NAME = "orders";

function parseShopeeDate(value: string | null): Date | null {
  if (!value || value.trim() === "") return null;
  const normalized = value.trim().replace(" ", "T");
  const withSeconds = normalized.includes(":") && normalized.split(":").length === 2
    ? `${normalized}:00`
    : normalized;
  const d = new Date(`${withSeconds}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapShopeeStatus(
  statusPesanan: string,
  returnedQty: number
): SalesHistoryRowStatus {
  if (statusPesanan === "Batal") return "CANCELLED";
  if (returnedQty > 0) return "RETURNED";
  return "COMPLETED";
}

function getColumn(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in row) return row[name];
  }
  const keys = Object.keys(row);
  for (const name of names) {
    const found = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase());
    if (found) return row[found];
  }
  return undefined;
}

export function parseShopeeExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet =
    workbook.Sheets[SHEET_NAME] ??
    workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: `Sheet "${SHEET_NAME}" not found` }],
      totalParsed: 0,
      totalErrors: 1,
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const rows: SalesHistoryRow[] = [];
  const errors: { row: number; message: string }[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const orderId = cellString(getColumn(row, "No. Pesanan"));
      if (!orderId) return;

      const statusPesanan = cellString(getColumn(row, "Status Pesanan"));
      const variantSku = cellString(getColumn(row, "Nomor Referensi SKU"));
      if (!variantSku) {
        errors.push({ row: rowNumber, message: "Missing SKU" });
        return;
      }

      const quantity = parseIntSafe(getColumn(row, "Jumlah"), 0);
      const returnedQuantity = parseIntSafe(getColumn(row, "Returned quantity"), 0);
      const status = mapShopeeStatus(statusPesanan, returnedQuantity);

      const orderDateRaw = cellString(getColumn(row, "Waktu Pesanan Dibuat"));
      const orderDate = parseShopeeDate(orderDateRaw);
      if (!orderDate) {
        errors.push({ row: rowNumber, message: "Invalid order date" });
        return;
      }

      const completedRaw = cellString(getColumn(row, "Waktu Pesanan Selesai"));
      const completedDate = parseShopeeDate(completedRaw || null);

      const variation = cellString(getColumn(row, "Nama Variasi"));
      const { color, size } = parseVariation(variation || null);

      const unitPrice = parseNumber(getColumn(row, "Harga Awal"));
      const unitPriceAfterDiscount = parseNumber(getColumn(row, "Harga Setelah Diskon"));
      const lineTotal = parseNumber(getColumn(row, "Total Harga Produk"));
      const orderTotal = parseNumber(getColumn(row, "Total Pembayaran"));

      rows.push({
        channel: "SHOPEE",
        orderId,
        status,
        variantSku,
        parentSku: deriveParentSku(variantSku),
        productName: cellString(getColumn(row, "Nama Produk")),
        color,
        size,
        quantity,
        returnedQuantity,
        netQuantity: quantity - returnedQuantity,
        unitPrice,
        unitPriceAfterDiscount,
        lineTotal,
        orderTotal,
        orderDate,
        completedDate,
        province: cellString(getColumn(row, "Provinsi")) || null,
        city: cellString(getColumn(row, "Kota/Kabupaten")) || null,
        productCategory: null,
      });
    } catch (e) {
      errors.push({
        row: rowNumber,
        message: e instanceof Error ? e.message : "Parse error",
      });
    }
  });

  return {
    rows,
    errors,
    totalParsed: rows.length,
    totalErrors: errors.length,
  };
}
