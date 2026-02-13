'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  Package,
  ClipboardList,
  RotateCcw,
  FileText,
  Settings,
  Menu,
  ChevronDown,
  LogOut,
  User,
  Sun,
  Moon,
  Monitor,
  Check,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Role } from '@/lib/constants/enums';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { QuickActionFAB } from '@/components/QuickActionFAB';
import { setupSyncListeners, syncReferenceData } from '@/lib/offline/sync';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslations } from 'next-intl';

interface NavItem {
  labelKey: string;
  href: string;
  icon: React.ElementType;
  roles: Role[];
}

const navItems: NavItem[] = [
  {
    labelKey: 'dashboard',
    href: '/backoffice/dashboard',
    icon: LayoutDashboard,
    roles: [Role.ADMIN, Role.PURCHASER, Role.WAREHOUSE, Role.PRODUCTION, Role.USER],
  },
  {
    labelKey: 'suppliers',
    href: '/backoffice/suppliers',
    icon: Users,
    roles: [Role.ADMIN, Role.PURCHASER],
  },
  {
    labelKey: 'items',
    href: '/backoffice/items',
    icon: Package,
    roles: [Role.ADMIN, Role.PURCHASER, Role.WAREHOUSE],
  },
  {
    labelKey: 'purchaseOrders',
    href: '/backoffice/purchase-orders',
    icon: ShoppingCart,
    roles: [Role.ADMIN, Role.PURCHASER],
  },
  {
    labelKey: 'inventory',
    href: '/backoffice/inventory',
    icon: Package,
    roles: [Role.ADMIN, Role.WAREHOUSE],
  },
  {
    labelKey: 'workOrders',
    href: '/backoffice/work-orders',
    icon: ClipboardList,
    roles: [Role.ADMIN, Role.WAREHOUSE, Role.PRODUCTION],
  },
  {
    labelKey: 'vendorReturns',
    href: '/backoffice/vendor-returns',
    icon: RotateCcw,
    roles: [Role.ADMIN, Role.WAREHOUSE, Role.PRODUCTION],
  },
  {
    labelKey: 'auditTrail',
    href: '/backoffice/audit-trail',
    icon: FileText,
    roles: [Role.ADMIN],
  },
  {
    labelKey: 'settings',
    href: '/backoffice/settings',
    icon: Settings,
    roles: [Role.ADMIN],
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
  role,
  onClose,
}: {
  className?: string;
  role: Role;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const tNav = useTranslations('navigation');

  const filteredItems = navItems.filter((item) =>
    item.roles.includes(role)
  );

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center gap-3 px-4 py-4 border-b">
        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-lg">E</span>
        </div>
        <div>
          <h1 className="font-bold text-lg">Elorae ERP</h1>
          <p className="text-xs text-muted-foreground">v1.0.0</p>
        </div>
      </div>

      <nav className="flex-1 overflow-auto py-4 px-3 space-y-1">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              {tNav(item.labelKey as any)}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        <OfflineIndicator />
      </div>
    </div>
  );
}

export default function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tRole = useTranslations('auth.roles');
  const tNav = useTranslations('navigation');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    setupSyncListeners();
    syncReferenceData();
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
    <div className="min-h-screen flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 border-r bg-card">
        <Sidebar role={userRole} />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <Sidebar role={userRole} onClose={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-4">
            <Sheet>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64">
                <Sidebar role={userRole} onClose={() => setMobileMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <h2 className="text-lg font-semibold hidden sm:block">
              {tNav('dashboard')} - {session.user.name || session.user.email}
            </h2>
          </div>

          <div className="flex items-center gap-4">
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
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
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
        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
        <QuickActionFAB />
      </div>
    </div>
  );
}
