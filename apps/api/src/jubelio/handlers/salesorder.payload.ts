export type SalesOrderLine = {
  item_id: number;
  item_code: string;
  item_group_id: number;
  item_name?: string;
  qty: string | number;
  is_canceled_item?: boolean | null;
  salesorder_detail_id: number;
};

export type SalesOrderPayload = {
  action?: string;
  salesorder_id: number;
  salesorder_no?: string;
  channel_status?: string;
  internal_status?: string;
  is_canceled?: boolean | null;
  items?: SalesOrderLine[];
};
