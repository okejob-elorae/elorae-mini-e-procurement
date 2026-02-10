import { Role, SupplierType, ItemType, POStatus, WOStatus } from '@prisma/client';

export interface SupplierFormData {
  name: string;
  type: SupplierType;
  categoryId?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  bankAccountName?: string;
}

export interface SupplierWithCategory {
  id: string;
  code: string;
  name: string;
  type: SupplierType;
  category?: {
    id: string;
    nameId: string;
    nameEn: string;
  } | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccountEnc: string | null;
  bankAccountName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrderFormData {
  supplierId: string;
  etaDate?: Date;
  notes?: string;
  items: {
    itemId: string;
    qty: number;
    price: number;
    notes?: string;
  }[];
}

export interface WorkOrderFormData {
  vendorId: string;
  outputMode: 'GENERIC' | 'SKU';
  plannedQty: number;
  notes?: string;
}

export interface StockAdjustmentFormData {
  itemId: string;
  qtyChange: number;
  reason: string;
}

export interface UserSession {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  roles: Role[];
}

export interface SyncStatus {
  pendingCount: number;
  isOnline: boolean;
  lastSync?: Date;
}

export { Role, SupplierType, ItemType, POStatus, WOStatus };
