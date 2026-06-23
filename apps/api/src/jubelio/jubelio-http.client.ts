import { Injectable } from "@nestjs/common";
import { JubelioHttpService } from "./http.service";

export type JubelioReturnedOrderListRow = {
  salesorder_id: number;
  salesorder_no?: string;
  customer_name?: string;
  source_name?: string;
  store_name?: string;
  transaction_date?: string;
  created_date?: string;
  return_date?: string;
  status?: string;
  tracking_no?: string | null;
  [k: string]: unknown;
};

export type JubelioSalesOrderItem = {
  salesorder_detail_id?: number;
  item_id?: number;
  item_code: string;
  item_name: string;
  qty_in_base: string;
  unit_price?: string | number;
  amount?: string | number;
  is_canceled_item?: boolean | null;
  is_return_resolved?: boolean | null;
  reject_return_reason?: string | null;
  [k: string]: unknown;
};

export type JubelioSalesOrderDetail = {
  salesorder_id: number;
  salesorder_no?: string;
  source_name?: string;
  store_name?: string;
  customer_name?: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  internal_status?: string;
  wms_status?: string;
  is_canceled?: boolean | null;
  is_paid?: boolean | null;
  transaction_date?: string;
  created_date?: string;
  return_date?: string;
  items: JubelioSalesOrderItem[];
  [k: string]: unknown;
};

@Injectable()
export class JubelioHttpClient {
  constructor(private readonly http: JubelioHttpService) {}

  async getSalesOrder(salesorderId: number): Promise<JubelioSalesOrderDetail> {
    return this.http.get<JubelioSalesOrderDetail>(`/sales/orders/${salesorderId}`);
  }

  async listReturnedOrders(page = 1, pageSize = 100): Promise<JubelioReturnedOrderListRow[]> {
    const body = await this.http.get<{ data: JubelioReturnedOrderListRow[]; totalCount?: number }>(
      `/sales/orders/returned-list/?page=${page}&pageSize=${pageSize}`,
    );
    return body.data ?? [];
  }
}
