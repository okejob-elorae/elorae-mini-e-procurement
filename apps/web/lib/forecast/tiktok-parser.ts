import * as XLSX from "xlsx";
import type { ParseResult, SalesHistoryRow, SalesHistoryRowStatus } from "./types";
import {
  cellString,
  deriveParentSku,
  parseIntSafe,
  parseNumber,
  parseVariation,
} from "./sku-utils";

const SHEET_NAME = "OrderSKUList";

function parseTikTokDate(value: string | null): Date | null {
  if (!value || value.trim() === "") return null;
  const [datePart, timePart] = value.trim().split(" ");
  const [day, month, year] = datePart.split("/");
  if (!day || !month || !year) return null;
  const time = timePart ?? "00:00:00";
  const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapTikTokStatus(
  orderStatus: string,
  cancelReturnType: string | null,
  returnedQty: number
): SalesHistoryRowStatus {
  if (orderStatus === "Dibatalkan") return "CANCELLED";
  if (returnedQty > 0) return "RETURNED";
  if (cancelReturnType && cancelReturnType.toLowerCase().includes("return")) {
    return "RETURNED";
  }
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

function isDescriptionRow(row: Record<string, unknown>): boolean {
  const orderId = cellString(getColumn(row, "Order ID"));
  if (!orderId) return true;
  const lower = orderId.toLowerCase();
  return lower.includes("platform unique") || lower.includes("order id");
}

export function parseTikTokExcel(buffer: Buffer): ParseResult {
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
    if (index === 0 && isDescriptionRow(row)) {
      return;
    }

    try {
      const orderId = cellString(getColumn(row, "Order ID"));
      if (!orderId || isDescriptionRow(row)) return;

      const orderStatus = cellString(getColumn(row, "Order Status"));
      const variantSku = cellString(getColumn(row, "Seller SKU"));
      if (!variantSku) {
        errors.push({ row: rowNumber, message: "Missing Seller SKU" });
        return;
      }

      const quantity = parseIntSafe(getColumn(row, "Quantity"), 0);
      const returnedQuantity = parseIntSafe(
        getColumn(row, "Sku Quantity of return"),
        0
      );
      const cancelReturnType =
        cellString(getColumn(row, "Cancelation/Return Type")) || null;
      const status = mapTikTokStatus(orderStatus, cancelReturnType, returnedQuantity);

      const orderDateRaw = cellString(getColumn(row, "Created Time"));
      const orderDate = parseTikTokDate(orderDateRaw);
      if (!orderDate) {
        errors.push({ row: rowNumber, message: "Invalid order date" });
        return;
      }

      const completedRaw = cellString(getColumn(row, "Delivered Time"));
      const completedDate = parseTikTokDate(completedRaw || null);

      const variation = cellString(getColumn(row, "Variation"));
      const { color, size } = parseVariation(variation || null);

      const unitPrice = parseNumber(getColumn(row, "SKU Unit Original Price"));
      const lineTotal = parseNumber(getColumn(row, "SKU Subtotal After Discount"));
      const unitPriceAfterDiscount =
        quantity > 0 ? lineTotal / quantity : unitPrice;
      const orderTotal = parseNumber(getColumn(row, "Order Amount"));

      rows.push({
        channel: "TIKTOK",
        orderId,
        status,
        variantSku,
        parentSku: deriveParentSku(variantSku),
        productName: cellString(getColumn(row, "Product Name")),
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
        province: cellString(getColumn(row, "Province")) || null,
        city: cellString(getColumn(row, "Regency and City")) || null,
        productCategory: cellString(getColumn(row, "Product Category")) || null,
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
