export type SalesChannel = "SHOPEE" | "TIKTOK";

export type SalesHistoryRowStatus = "COMPLETED" | "CANCELLED" | "RETURNED";

export interface SalesHistoryRow {
  channel: SalesChannel;
  orderId: string;
  status: SalesHistoryRowStatus;
  variantSku: string;
  parentSku: string;
  productName: string;
  color: string | null;
  size: string | null;
  quantity: number;
  returnedQuantity: number;
  netQuantity: number;
  unitPrice: number;
  unitPriceAfterDiscount: number;
  lineTotal: number;
  orderTotal: number;
  orderDate: Date;
  completedDate: Date | null;
  province: string | null;
  city: string | null;
  productCategory: string | null;
}

export interface ParseResult {
  rows: SalesHistoryRow[];
  errors: { row: number; message: string }[];
  totalParsed: number;
  totalErrors: number;
}

export interface DemandRow {
  parentSku: string;
  productName: string;
  netQuantity: number;
  lineTotal: number;
  orderDate: Date;
  month: number;
  year: number;
}

export interface MonthlyDemand {
  parentSku: string;
  productName: string;
  year: number;
  month: number;
  totalQty: number;
  totalRevenue: number;
}

export interface ForecastParams {
  targetYear: number;
  growthFactorPercent: number;
  lookbackMonths: number;
  weightDecay: number;
}

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export interface ForecastArticle {
  parentSku: string;
  productName: string;
  abcClass: AbcClass;
  xyzClass: XyzClass;
  totalHistoricalQty: number;
  totalHistoricalRevenue: number;
  avgMonthlyDemand: number;
  coefficientOfVariation: number;
  seasonalIndices: number[];
  monthlyForecast: number[];
  annualForecast: number;
}
