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
  // The marketplace reference number. For Shopee it's the bare order SN
  // (salesorder_no is `SP-<ref>`); for TikTok/Tokopedia the settlement/excel
  // keys on THIS value while salesorder_no is `TT-<ref>-<suffix>`. The resolver
  // matches on either salesorder_no OR ref_no so both marketplaces resolve.
  ref_no?: string | null;
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

  /**
   * The general sales-order list — spans EVERY status (completed AND in-flight),
   * unlike the completed/cancel/failed buckets below. Returns order-shaped rows
   * ({ salesorder_id, salesorder_no, … }), so the resolver can read salesorder_id
   * directly. Both this and the bucket `q` search are undocumented (the OpenAPI
   * spec lists only page/pageSize on the list endpoints, and its purpose-built
   * `POST /wms/order/getOrderByNo/` is pick-flow-scoped → empty for settled
   * orders). See docs/ARCHITECTURE-NOTES.md "Before using or adding ANY Jubelio endpoint".
   */
  async listOrders(q: string, page = 1, pageSize = 20): Promise<JubelioSalesOrderListRow[]> {
    const body = await this.http.get<{ data: JubelioSalesOrderListRow[]; totalCount?: number }>(
      `/sales/orders/?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
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
   * Resolves a Jubelio salesorder_no to its salesorder_id.
   *
   * Primary: the general `/sales/orders/?q=` list, which spans ALL statuses —
   * it resolves in-flight orders (still being picked/shipped at settlement time)
   * that the completed/cancel/failed buckets miss. Falls back to those buckets
   * as belt-and-suspenders. Exact-matches on salesorder_no OR ref_no (the `q`
   * search is fuzzy and can return siblings): Shopee keys settlements on
   * salesorder_no (`SP-<ref>`), TikTok/Tokopedia on ref_no (salesorder_no is
   * `TT-<ref>-<suffix>`, so an exact salesorder_no match would miss). Returns
   * null if found nowhere.
   */
  async findSalesOrderIdByNo(salesorderNo: string): Promise<number | null> {
    const matches = (r: JubelioSalesOrderListRow): boolean =>
      r.salesorder_no === salesorderNo || r.ref_no === salesorderNo;

    const general = await this.listOrders(salesorderNo);
    const inGeneral = general.find(matches);
    if (inGeneral) return inGeneral.salesorder_id;

    const completed = await this.listCompletedOrders(salesorderNo);
    const inCompleted = completed.find(matches);
    if (inCompleted) return inCompleted.salesorder_id;

    const cancelled = await this.listCancelledOrders(salesorderNo);
    const inCancelled = cancelled.find(matches);
    if (inCancelled) return inCancelled.salesorder_id;

    const failed = await this.listFailedOrders(salesorderNo);
    const inFailed = failed.find(matches);
    if (inFailed) return inFailed.salesorder_id;

    return null;
  }
}
