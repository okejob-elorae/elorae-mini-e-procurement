/**
 * RBAC (Role-Based Access Control) utilities
 * Permission checking, route mapping, and authorization helpers
 */

/**
 * Check if user has a specific permission
 * @param permissions - Array of permission codes from session
 * @param code - Permission code to check (e.g., "suppliers:create")
 * @returns true if user has permission (wildcard '*' grants all)
 */
export function hasPermission(permissions: string[], code: string): boolean {
  if (!permissions || permissions.length === 0) return false;
  // Wildcard grants all permissions
  if (permissions.includes('*')) return true;
  return permissions.includes(code);
}

/**
 * Check if user can access any permission for a module
 * @param permissions - Array of permission codes from session
 * @param module - Module name (e.g., "suppliers")
 * @returns true if user has any permission for the module
 */
export function canAccess(permissions: string[], module: string): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes('*')) return true;
  return permissions.some(p => p.startsWith(`${module}:`));
}

/**
 * Server-side helper that throws 403 if user lacks permission
 * Use in API routes and server actions
 * @param permissions - Array of permission codes from session
 * @param code - Required permission code
 * @throws {Error} with status 403 if permission denied
 */
export function requirePermission(permissions: string[], code: string): void {
  if (!hasPermission(permissions, code)) {
    const error = new Error('Forbidden: Insufficient permissions');
    (error as any).status = 403;
    throw error;
  }
}

/**
 * Route-to-permission mapping for proxy (auth/redirect layer)
 * Maps URL paths to required permission codes
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  // Frontend routes
  '/backoffice/dashboard': 'dashboard:view',
  '/backoffice/items': 'items:view',
  '/backoffice/suppliers': 'suppliers:view',
  '/backoffice/suppliers/types': 'supplier_types:view',
  '/backoffice/purchase-orders': 'purchase_orders:view',
  '/backoffice/supplier-payments': 'supplier_payments:view',
  '/backoffice/inventory': 'inventory:view',
  '/backoffice/sales-orders': 'sales_orders:view',
  '/backoffice/sales-orders/[id]/pick-list': 'sales_orders:view',
  '/backoffice/sales-orders/[id]/packing-slip': 'sales_orders:view',
  '/backoffice/fulfillment': 'sales_orders:view',
  '/backoffice/work-orders': 'work_orders:view',
  '/backoffice/work-orders/nota-register': 'nota_register:view',
  '/backoffice/forecast': 'forecast:view',
  '/backoffice/forecast/import': 'forecast:manage',
  '/backoffice/production/planning': 'production_planning:view',
  '/backoffice/production/colors': 'production_colors:view',
  '/backoffice/vendor-returns': 'vendor_returns:view',
  '/backoffice/returns': 'sales_returns:view',
  '/backoffice/returns/[id]': 'sales_returns:view',
  '/backoffice/reports/hpp': 'reports_hpp:view',
  '/backoffice/audit-trail': 'audit_trail:view',
  '/backoffice/settings/documents': 'settings_documents:view',
  '/backoffice/settings/tax': 'settings_tax:view',
  '/backoffice/settings/uom': 'settings_uom:view',
  '/backoffice/settings/security': 'settings_security:view',
  '/backoffice/settings/rbac': 'settings_rbac:view',
  '/backoffice/jubelio/admin': 'jubelio_admin:view',
  '/backoffice/jubelio/settings': 'settings_security:view',
  '/backoffice/jubelio/categories': 'settings_security:view',
  '/backoffice/jubelio/migration': 'settings_security:view',
  '/backoffice/jubelio/couriers': 'settings_security:view',
  '/backoffice/finance/coa': 'coa:view',
  // API routes
  '/api/suppliers': 'suppliers:view',
  '/api/supplier-types': 'supplier_types:view',
  '/api/items': 'items:view',
  '/api/uoms': 'settings_uom:view',
  '/api/production/colors': 'production_colors:view',
  '/api/notifications': 'dashboard:view', // All authenticated users can view their notifications
};

/**
 * Backoffice UI routes in preferred order (for redirect when user has no dashboard:view)
 */
const BACKOFFICE_ROUTES_ORDER: string[] = [
  '/backoffice/dashboard',
  '/backoffice/items',
  '/backoffice/suppliers',
  '/backoffice/purchase-orders',
  '/backoffice/supplier-payments',
  '/backoffice/inventory',
  '/backoffice/work-orders',
  '/backoffice/sales-orders',
  '/backoffice/fulfillment',
  '/backoffice/forecast',
  '/backoffice/production/planning',
  '/backoffice/production/colors',
  '/backoffice/vendor-returns',
  '/backoffice/reports/hpp',
  '/backoffice/audit-trail',
  '/backoffice/jubelio/admin',
  '/backoffice/jubelio/settings',
  '/backoffice/jubelio/categories',
  '/backoffice/jubelio/migration',
  '/backoffice/jubelio/couriers',
  '/backoffice/settings/documents',
  '/backoffice/settings/tax',
  '/backoffice/settings/uom',
  '/backoffice/settings/security',
  '/backoffice/settings/rbac',
];

/**
 * First backoffice route the user is allowed to access, or null
 */
export function getFirstAllowedBackofficeRoute(permissions: string[]): string | null {
  if (!permissions?.length) return null;
  for (const route of BACKOFFICE_ROUTES_ORDER) {
    const perm = ROUTE_PERMISSIONS[route];
    if (perm && hasPermission(permissions, perm)) return route;
  }
  return null;
}

/**
 * Get required permission for a route path
 * Checks exact match first, then prefix match for nested routes
 * @param pathname - URL pathname
 * @returns Permission code or null if no permission required
 */
export function getRequiredPermission(pathname: string): string | null {
  // Exact match first
  if (ROUTE_PERMISSIONS[pathname]) {
    return ROUTE_PERMISSIONS[pathname];
  }

  // Check prefix matches (for nested routes like /backoffice/suppliers/[id])
  const sortedRoutes = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);
  for (const route of sortedRoutes) {
    if (pathname.startsWith(route)) {
      return ROUTE_PERMISSIONS[route];
    }
  }

  return null;
}

/**
 * Permission code constants for type safety
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',
  // Suppliers
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_EDIT: 'suppliers:edit',
  SUPPLIERS_DELETE: 'suppliers:delete',
  SUPPLIERS_APPROVE: 'suppliers:approve',
  // Supplier Types
  SUPPLIER_TYPES_VIEW: 'supplier_types:view',
  SUPPLIER_TYPES_CREATE: 'supplier_types:create',
  SUPPLIER_TYPES_EDIT: 'supplier_types:edit',
  SUPPLIER_TYPES_DELETE: 'supplier_types:delete',
  // Items
  ITEMS_VIEW: 'items:view',
  ITEMS_CREATE: 'items:create',
  ITEMS_EDIT: 'items:edit',
  ITEMS_DELETE: 'items:delete',
  // Sales Orders
  SALES_ORDERS_VIEW: 'sales_orders:view',
  SALES_ORDERS_FULFILL: 'sales_orders:fulfill',
  // Purchase Orders
  PURCHASE_ORDERS_VIEW: 'purchase_orders:view',
  PURCHASE_ORDERS_CREATE: 'purchase_orders:create',
  PURCHASE_ORDERS_EDIT: 'purchase_orders:edit',
  PURCHASE_ORDERS_APPROVE: 'purchase_orders:approve',
  // Supplier Payments
  SUPPLIER_PAYMENTS_VIEW: 'supplier_payments:view',
  SUPPLIER_PAYMENTS_CREATE: 'supplier_payments:create',
  SUPPLIER_PAYMENTS_EDIT: 'supplier_payments:edit',
  // Inventory
  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_MANAGE: 'inventory:manage',
  // Work Orders
  WORK_ORDERS_VIEW: 'work_orders:view',
  WORK_ORDERS_CREATE: 'work_orders:create',
  WORK_ORDERS_MANAGE: 'work_orders:manage',
  // Nota Register
  NOTA_REGISTER_VIEW: 'nota_register:view',
  // Production Colors (Pantone TCX)
  PRODUCTION_COLORS_VIEW: 'production_colors:view',
  // S&OP Forecast
  FORECAST_VIEW: 'forecast:view',
  FORECAST_MANAGE: 'forecast:manage',
  // Production Planning (Plan Kerja)
  PRODUCTION_PLANNING_VIEW: 'production_planning:view',
  PRODUCTION_PLANNING_MANAGE: 'production_planning:manage',
  // Vendor Returns
  VENDOR_RETURNS_VIEW: 'vendor_returns:view',
  VENDOR_RETURNS_CREATE: 'vendor_returns:create',
  VENDOR_RETURNS_MANAGE: 'vendor_returns:manage',
  // Reports
  REPORTS_HPP_VIEW: 'reports_hpp:view',
  // Audit Trail
  AUDIT_TRAIL_VIEW: 'audit_trail:view',
  // Settings
  SETTINGS_DOCUMENTS_VIEW: 'settings_documents:view',
  SETTINGS_DOCUMENTS_MANAGE: 'settings_documents:manage',
  SETTINGS_TAX_VIEW: 'settings_tax:view',
  SETTINGS_TAX_MANAGE: 'settings_tax:manage',
  SETTINGS_UOM_VIEW: 'settings_uom:view',
  SETTINGS_UOM_MANAGE: 'settings_uom:manage',
  SETTINGS_SECURITY_VIEW: 'settings_security:view',
  SETTINGS_SECURITY_MANAGE: 'settings_security:manage',
  SETTINGS_RBAC_VIEW: 'settings_rbac:view',
  SETTINGS_RBAC_MANAGE: 'settings_rbac:manage',
  // Sales Returns
  SALES_RETURNS_VIEW: 'sales_returns:view',
  SALES_RETURNS_DECIDE: 'sales_returns:decide',
  // Jubelio admin — admin-only. Not granted to non-admin roles; only the
  // wildcard '*' (system/admin role) satisfies it.
  JUBELIO_ADMIN_VIEW: 'jubelio_admin:view',
  // Chart of Accounts
  COA_VIEW: 'coa:view',
  COA_MANAGE: 'coa:manage',
} as const;
