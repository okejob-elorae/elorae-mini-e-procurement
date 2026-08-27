'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Building2,
  Package,
  FileText,
  Settings,
  Menu,
  ChevronDown,
  ChevronRight,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Check,
  CalendarDays,
  Activity,
  Store,
  Wallet,
  BarChart2,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Role } from '@/lib/constants/enums';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { QuickActionFAB } from '@/components/QuickActionFAB';
import { FcmRegistration } from '@/components/notifications/FcmRegistration';
import { NotificationIcon } from '@/components/notifications/NotificationIcon';
import { setupSyncListeners, syncReferenceData } from '@/lib/offline/sync';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslations } from 'next-intl';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const SIDEBAR_COLLAPSED_KEY = 'elorae.sidebar.collapsed';

interface NavChild {
  labelKey: string;
  href: string;
  permission?: string;
}

interface NavItem {
  labelKey: string;
  href: string;
  icon: React.ElementType;
  permission: string; // Permission code required to view this nav item
  children?: NavChild[];
}

const navItems: NavItem[] = [
  {
    labelKey: 'dashboard',
    href: '/backoffice/dashboard',
    icon: LayoutDashboard,
    permission: PERMISSIONS.DASHBOARD_VIEW,
  },
  {
    labelKey: 'suppliers',
    href: '/backoffice/suppliers',
    icon: Building2,
    permission: PERMISSIONS.SUPPLIERS_VIEW,
    children: [
      {
        labelKey: 'masterSuppliers',
        href: '/backoffice/suppliers',
        permission: PERMISSIONS.SUPPLIERS_VIEW,
      },
      {
        labelKey: 'supplierType',
        href: '/backoffice/suppliers/types',
        permission: PERMISSIONS.SUPPLIER_TYPES_VIEW,
      },
      {
        labelKey: 'masterStores',
        href: '/backoffice/stores',
        permission: PERMISSIONS.STORES_VIEW,
      },
      {
        labelKey: "storeStocktakes",
        href: "/backoffice/store-stocktakes",
        permission: PERMISSIONS.STORES_MANAGE,
      },
      {
        labelKey: 'leadTime',
        href: '/backoffice/lead-time',
        permission: PERMISSIONS.LEAD_TIME_VIEW,
      },
    ],
  },
  {
    labelKey: 'items',
    href: '/backoffice/items',
    icon: Package,
    permission: PERMISSIONS.ITEMS_VIEW,
    children: [
      { labelKey: 'navItemsAll', href: '/backoffice/items' },
      { labelKey: 'navItemsCategory', href: '/backoffice/items/categories' },
    ],
  },
  {
    labelKey: 'inventory',
    href: '/backoffice/inventory',
    icon: Package,
    permission: PERMISSIONS.INVENTORY_VIEW,
    children: [
      { labelKey: 'inventory', href: '/backoffice/inventory' },
      {
        labelKey: 'navStockOpname',
        href: '/backoffice/inventory/stock-opname',
        permission: PERMISSIONS.INVENTORY_OPNAME_VIEW,
      },
      {
        labelKey: 'navStockReconciliation',
        href: '/backoffice/inventory/reconciliation',
        permission: PERMISSIONS.INVENTORY_RECONCILIATION_VIEW,
      },
    ],
  },
  {
    labelKey: 'sales',
    href: '/backoffice/sales-orders',
    icon: Store,
    permission: PERMISSIONS.SALES_ORDERS_VIEW,
    children: [
      { labelKey: 'navSalesOrders', href: '/backoffice/sales-orders' },
      { labelKey: 'navFulfillment', href: '/backoffice/fulfillment' },
      { labelKey: 'navSalesReturns', href: '/backoffice/returns' },
      {
        labelKey: 'navFieldSalesOrders',
        href: '/backoffice/field-sales-orders',
        permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW,
      },
      {
        labelKey: 'navFieldReturns',
        href: '/backoffice/field-returns',
        permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW,
      },
      {
        labelKey: 'navCanvassing',
        href: '/backoffice/canvassing',
        permission: PERMISSIONS.CANVASSING_MANAGE,
      },
      {
        labelKey: 'navVanSales',
        href: '/backoffice/van-sales',
        permission: PERMISSIONS.CANVASSING_MANAGE,
      },
      {
        labelKey: 'navSpgSales',
        href: '/backoffice/spg-sales',
        permission: PERMISSIONS.SPG_SALES_VIEW,
      },
      {
        labelKey: 'promos',
        href: '/backoffice/promos',
        permission: PERMISSIONS.PROMOS_VIEW,
      },
    ],
  },
  {
    labelKey: 'finance',
    href: '#',
    icon: Wallet,
    permission: PERMISSIONS.COA_VIEW,
    children: [
      { labelKey: 'navCoa', href: '/backoffice/finance/coa', permission: PERMISSIONS.COA_VIEW },
      {
        labelKey: 'navFinanceSettlements',
        href: '/backoffice/finance/settlements',
        permission: PERMISSIONS.SETTLEMENTS_VIEW,
      },
      {
        labelKey: 'navFinanceJournals',
        href: '/backoffice/finance/journals',
        permission: PERMISSIONS.JOURNALS_VIEW,
      },
      {
        labelKey: 'navFinanceAccountMapping',
        href: '/backoffice/finance/account-mapping',
        permission: PERMISSIONS.JOURNALS_VIEW,
      },
      {
        labelKey: 'navFinanceTrialBalance',
        href: '/backoffice/finance/reports/trial-balance',
        permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
      },
      {
        labelKey: 'navFinanceIncomeStatement',
        href: '/backoffice/finance/reports/income-statement',
        permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
      },
      {
        labelKey: 'navFinanceBalanceSheet',
        href: '/backoffice/finance/reports/balance-sheet',
        permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
      },
      {
        labelKey: 'navFinanceCashFlow',
        href: '/backoffice/finance/reports/cash-flow',
        permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
      },
      {
        labelKey: 'navFinanceCashFlowSections',
        href: '/backoffice/finance/cash-flow-sections',
        permission: PERMISSIONS.JOURNALS_VIEW,
      },
      {
        labelKey: 'navFakturPajak',
        href: '/backoffice/finance/faktur-pajak',
        permission: PERMISSIONS.TAX_INVOICES_VIEW,
      },
      {
        labelKey: "navFinancePiutang",
        href: "/backoffice/finance/piutang",
        permission: PERMISSIONS.RECEIVABLES_VIEW,
      },
      {
        labelKey: "navFinancePayments",
        href: "/backoffice/finance/payments",
        permission: PERMISSIONS.PAYMENTS_MANAGE,
      },
    ],
  },
  {
    labelKey: 'production',
    href: '/backoffice/production/planning',
    icon: CalendarDays,
    permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW,
    children: [
      {
        labelKey: 'navForecast',
        href: '/backoffice/forecast',
        permission: PERMISSIONS.FORECAST_VIEW,
      },
      {
        labelKey: 'navProductionPlanning',
        href: '/backoffice/production/planning',
        permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW,
      },
      {
        labelKey: 'navProductionColors',
        href: '/backoffice/production/colors',
        permission: PERMISSIONS.PRODUCTION_COLORS_VIEW,
      },
      {
        labelKey: 'purchaseOrders',
        href: '/backoffice/purchase-orders',
        permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
      },
      {
        labelKey: 'supplierPayment',
        href: '/backoffice/supplier-payments',
        permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW,
      },
      {
        labelKey: 'navWorkOrdersList',
        href: '/backoffice/work-orders',
        permission: PERMISSIONS.WORK_ORDERS_VIEW,
      },
      {
        labelKey: 'registerNotaCmt',
        href: '/backoffice/work-orders/nota-register',
        permission: PERMISSIONS.NOTA_REGISTER_VIEW,
      },
      {
        labelKey: 'vendorReturns',
        href: '/backoffice/vendor-returns',
        permission: PERMISSIONS.VENDOR_RETURNS_VIEW,
      },
    ],
  },
  {
    labelKey: 'reports',
    href: '/backoffice/reports/hpp',
    icon: BarChart2,
    permission: PERMISSIONS.REPORTS_HPP_VIEW,
    children: [
      { labelKey: 'hppReport', href: '/backoffice/reports/hpp' },
    ],
  },
  {
    labelKey: 'auditTrail',
    href: '/backoffice/audit-trail',
    icon: FileText,
    permission: PERMISSIONS.AUDIT_TRAIL_VIEW,
  },
  {
    labelKey: 'jubelio',
    href: '/backoffice/jubelio/admin',
    icon: Activity,
    permission: PERMISSIONS.JUBELIO_ADMIN_VIEW,
    children: [
      { labelKey: 'navJubelioAdmin', href: '/backoffice/jubelio/admin', permission: PERMISSIONS.JUBELIO_ADMIN_VIEW },
      { labelKey: 'navJubelioSettings', href: '/backoffice/jubelio/settings', permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: 'navJubelioCategories', href: '/backoffice/jubelio/categories', permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: 'navJubelioMigration', href: '/backoffice/jubelio/migration', permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
      { labelKey: 'navJubelioCouriers', href: '/backoffice/jubelio/couriers', permission: PERMISSIONS.SETTINGS_SECURITY_VIEW },
    ],
  },
  {
    labelKey: 'settings',
    href: '/backoffice/settings',
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_SECURITY_VIEW, // Settings hub - check any settings permission
  },
];

function ThemeDropdownItems() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const current = theme ?? 'system';
  const isLight = current === 'light' || (current === 'system' && resolvedTheme === 'light');
  const isDark = current === 'dark' || (current === 'system' && resolvedTheme === 'dark');
  const isSystem = current === 'system';
  return (
    <>
      <DropdownMenuItem onClick={() => setTheme('light')}>
        <Sun className="mr-2 h-4 w-4" />
        Light
        {isLight && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme('dark')}>
        <Moon className="mr-2 h-4 w-4" />
        Dark
        {isDark && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme('system')}>
        <Monitor className="mr-2 h-4 w-4" />
        System
        {isSystem && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
    </>
  );
}

function Sidebar({
  className,
  permissions,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  className?: string;
  permissions: string[];
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const tNav = useTranslations('navigation');
  const getOpenKeyFromPath = (path: string) => {
    if (
      path.startsWith('/backoffice/suppliers') ||
      path.startsWith('/backoffice/lead-time') ||
      path.startsWith('/backoffice/stores') ||
      path.startsWith('/backoffice/store-stocktakes')
    ) {
      return '/backoffice/suppliers';
    }
    if (path.startsWith('/backoffice/items')) return '/backoffice/items';
    if (path.startsWith('/backoffice/inventory')) return '/backoffice/inventory';
    if (
      path.startsWith('/backoffice/forecast') ||
      path.startsWith('/backoffice/production') ||
      path.startsWith('/backoffice/purchase-orders') ||
      path.startsWith('/backoffice/supplier-payments') ||
      path.startsWith('/backoffice/work-orders') ||
      path.startsWith('/backoffice/vendor-returns')
    ) {
      return '/backoffice/production/planning';
    }
    if (path.startsWith('/backoffice/jubelio')) return '/backoffice/jubelio/admin';
    if (path.startsWith('/backoffice/finance')) return '#';
    if (path.startsWith('/backoffice/reports')) return '/backoffice/reports/hpp';
    if (
      path.startsWith('/backoffice/sales-orders') ||
      path.startsWith('/backoffice/fulfillment') ||
      path.startsWith('/backoffice/returns') ||
      path.startsWith('/backoffice/field-sales-orders') ||
      path.startsWith('/backoffice/field-returns') ||
      path.startsWith('/backoffice/canvassing') ||
      path.startsWith('/backoffice/van-sales') ||
      path.startsWith('/backoffice/spg-sales') ||
      path.startsWith('/backoffice/promos')
    ) {
      return '/backoffice/sales-orders';
    }
    return null;
  };
  const [openNavKey, setOpenNavKey] = useState<string | null>(() => getOpenKeyFromPath(pathname));

  useEffect(() => {
    const key = getOpenKeyFromPath(pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync nav open state to pathname
    if (key) setOpenNavKey(key);
  }, [pathname]);

  const filteredItems = navItems.filter((item) => {
    if (item.children?.length) {
      const visibleChildren = item.children.filter(
        (child) => !child.permission || hasPermission(permissions, child.permission)
      );
      if (visibleChildren.length === 0) return false;
      if (hasPermission(permissions, item.permission)) return true;
      return visibleChildren.some(
        (child) => child.permission && hasPermission(permissions, child.permission)
      );
    }
    return hasPermission(permissions, item.permission);
  });

  function visibleChildrenOf(item: NavItem): NavChild[] {
    return (item.children ?? []).filter(
      (child) => !child.permission || hasPermission(permissions, child.permission)
    );
  }

  function isChildActive(child: NavChild, siblings: NavChild[]): boolean {
    const matching = siblings
      .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
      .sort((a, b) => b.href.length - a.href.length);
    return matching[0]?.href === child.href;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn('flex flex-col h-full text-sidebar-foreground', className)}>
        <div
          className={cn(
            'flex items-center border-b border-sidebar-foreground/20',
            collapsed ? 'flex-col gap-2 px-2 py-3' : 'gap-3 px-4 py-4'
          )}
        >
          <div className="w-10 h-10 bg-sidebar-foreground rounded-lg flex items-center justify-center shrink-0">
            <span className="text-sidebar font-bold text-lg">E</span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-lg truncate">Elorae ERP</h1>
              <p className="text-xs text-sidebar-foreground/60">v1.0.0</p>
            </div>
          )}
          {onToggleCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
              onClick={onToggleCollapse}
              aria-label={collapsed ? tNav('expandSidebar') : tNav('collapseSidebar')}
              title={collapsed ? tNav('expandSidebar') : tNav('collapseSidebar')}
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        <nav
          className={cn(
            'flex-1 min-h-0 overflow-y-auto py-4 space-y-1',
            collapsed ? 'px-2' : 'px-3'
          )}
        >
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const hasChildren = item.children && item.children.length > 0;
            const pathOpenKey = getOpenKeyFromPath(pathname);
            const isParentActive = hasChildren
              ? pathOpenKey === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const label = tNav(item.labelKey as any);

            if (hasChildren) {
              const children = visibleChildrenOf(item);

              if (collapsed) {
                return (
                  <DropdownMenu key={item.href}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'w-full h-10 text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground',
                              isParentActive && 'bg-sidebar-foreground text-sidebar hover:bg-sidebar-foreground hover:text-sidebar'
                            )}
                            aria-label={label}
                          >
                            <Icon className="w-5 h-5" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent side="right" align="start" className="w-56">
                      <DropdownMenuLabel>{label}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {children.map((child) => (
                        <DropdownMenuItem key={child.href} asChild>
                          <Link
                            href={child.href}
                            onClick={onClose}
                            className={cn(
                              isChildActive(child, children) && 'font-medium'
                            )}
                          >
                            {tNav(child.labelKey as any)}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }

              return (
                <Collapsible
                  key={item.href}
                  open={openNavKey === item.href}
                  onOpenChange={(open) => setOpenNavKey(open ? item.href : null)}
                  className="group/collapsible"
                >
                  <CollapsibleTrigger
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors [&[data-state=open]>svg:last-of-type]:rotate-90',
                      isParentActive
                        ? 'bg-sidebar-foreground text-sidebar'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="flex-1 text-left">{label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-foreground/20 pl-3">
                      {children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            isChildActive(child, children)
                              ? 'font-medium text-sidebar-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'
                          )}
                        >
                          {tNav(child.labelKey as any)}
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-label={label}
                      className={cn(
                        'flex h-10 w-full items-center justify-center rounded-lg transition-colors',
                        isActive
                          ? 'bg-sidebar-foreground text-sidebar'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-foreground text-sidebar'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'
                )}
              >
                <Icon className="w-5 h-5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            'border-t border-sidebar-foreground/20 [&_button]:text-sidebar-foreground [&_button]:hover:bg-sidebar-foreground/10 [&_button]:hover:text-sidebar-foreground',
            collapsed
              ? 'p-2 [&_button]:justify-center [&_button_span]:hidden [&_button_svg:last-child]:hidden'
              : 'p-4'
          )}
        >
          <OfflineIndicator />
        </div>
      </div>
    </TooltipProvider>
  );
}

export function BackofficeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const tRole = useTranslations('auth.roles');
  const tNav = useTranslations('navigation');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') setSidebarCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    setupSyncListeners();
    syncReferenceData();
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("backoffice-shell");
    return () => {
      document.documentElement.classList.remove("backoffice-shell");
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const userRole = session.user.role as Role;
  const userInitials = session.user.name
    ? session.user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : session.user.email?.[0].toUpperCase() || 'U';

  return (
    <div className="h-dvh flex overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex lg:flex-col shrink-0 border-r border-sidebar-border bg-sidebar min-h-0 transition-[width] duration-200 ease-in-out',
          sidebarCollapsed ? 'w-[4.25rem]' : 'w-64'
        )}
      >
        <Sidebar
          permissions={session.user.permissions}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
          <Sidebar
            permissions={session.user.permissions}
            onClose={() => setMobileMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content — min-h-0 so flex-1 + overflow-auto actually scroll inside the viewport */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <header className="h-16 shrink-0 border-b bg-card flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-4">
            <Sheet>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
                <Sidebar
                  permissions={session.user.permissions}
                  onClose={() => setMobileMenuOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <h2 className="text-lg font-semibold hidden sm:block">
              {tNav('dashboard')} - {session.user.name || session.user.email}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <NotificationIcon />
            <LanguageSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium">{session.user.name || session.user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {tRole(userRole as any)}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <ThemeDropdownItems />
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/backoffice/settings" className="flex items-center">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} data-testid="sign-out">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 lg:p-6">{children}</main>
        <QuickActionFAB />
        <FcmRegistration />
      </div>
    </div>
  );
}
