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

export type JubelioSalesOrderListRow = {
  salesorder_id: number;
  salesorder_no?: string;
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

  async listCompletedOrders(q: string, page = 1, pageSize = 20): Promise<JubelioSalesOrderListRow[]> {
    const body = await this.http.get<{ data: JubelioSalesOrderListRow[]; totalCount?: number }>(
      `/sales/orders/completed/?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
    );
    return body.data ?? [];
  }

  async listCancelledOrders(q: string, page = 1, pageSize = 20): Promise<JubelioSalesOrderListRow[]> {
    const body = await this.http.get<{ data: JubelioSalesOrderListRow[]; totalCount?: number }>(
      `/sales/orders/cancel/?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
    );
    return body.data ?? [];
  }

  async listFailedOrders(q: string, page = 1, pageSize = 20): Promise<JubelioSalesOrderListRow[]> {
    const body = await this.http.get<{ data: JubelioSalesOrderListRow[]; totalCount?: number }>(
      `/sales/orders/failed/?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
    );
    return body.data ?? [];
  }

  /**
   * Resolves a Jubelio salesorder_no to its salesorder_id by searching the
   * completed → cancelled → failed lists in order (an order can only be in one
   * of these). Returns null if not found in any list.
   */
  async findSalesOrderIdByNo(salesorderNo: string): Promise<number | null> {
    const completed = await this.listCompletedOrders(salesorderNo);
    const inCompleted = completed.find((r) => r.salesorder_no === salesorderNo);
    if (inCompleted) return inCompleted.salesorder_id;

    const cancelled = await this.listCancelledOrders(salesorderNo);
    const inCancelled = cancelled.find((r) => r.salesorder_no === salesorderNo);
    if (inCancelled) return inCancelled.salesorder_id;

    const failed = await this.listFailedOrders(salesorderNo);
    const inFailed = failed.find((r) => r.salesorder_no === salesorderNo);
    if (inFailed) return inFailed.salesorder_id;

    return null;
  }
}
