import { Injectable } from "@nestjs/common";
import { JubelioHttpService } from "./http.service";

export type JubelioSalesReturnListRow = {
  return_id?: number;
  return_no?: string;
  salesorder_id?: number;
  salesorder_detail_id?: number;
  item_id?: number;
  item_code: string;
  item_name: string;
  qty_in_base: string;
  customer_name?: string;
  salesorder_no?: string;
  source_name?: string;
  transaction_date?: string;
  reject_return_reason?: string;
  is_return_resolved?: boolean | null;
  [k: string]: unknown;
};

export type JubelioSalesReturnDetailItem = {
  return_detail_id?: number;
  item_id?: number;
  salesorder_detail_id?: number;
  item_code: string;
  item_name: string;
  qty_in_base: string;
  unit_price?: string | number;
  subtotal?: string | number;
  return_reason?: string;
  evidence_urls?: Array<{ url: string; kind?: "photo" | "video" }>;
  [k: string]: unknown;
};

export type JubelioSalesReturnDetail = {
  return_id: number;
  return_no?: string;
  salesorder_id?: number;
  source_name?: string;
  salesorder_no?: string;
  customer_name?: string;
  items: JubelioSalesReturnDetailItem[];
  [k: string]: unknown;
};

@Injectable()
export class JubelioHttpClient {
  constructor(private readonly http: JubelioHttpService) {}

  async getSalesReturn(returnId: number): Promise<JubelioSalesReturnDetail> {
    return this.http.get<JubelioSalesReturnDetail>(`/sales-returns/${returnId}`);
  }

  async listUnprocessedReturns(): Promise<JubelioSalesReturnListRow[]> {
    const body = await this.http.get<{ data: JubelioSalesReturnListRow[] }>(
      "/sales-returns/unprocessed",
    );
    return body.data ?? [];
  }
}
