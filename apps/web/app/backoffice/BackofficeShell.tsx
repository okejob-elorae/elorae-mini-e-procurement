'use client';

import { Fragment, useMemo, useRef, useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Megaphone,
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
  FolderArchive,
  Handshake,
  Search,
  Star,
  X,
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
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { saringNav, type ItemTerlabel } from '@/lib/nav/saring';
import { bacaFavorit, tulisFavorit, ubahFavorit, BATAS_FAVORIT } from '@/lib/nav/favorit';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { QuickActionFAB } from '@/components/QuickActionFAB';
import { FcmRegistration } from '@/components/notifications/FcmRegistration';
import { NotificationIcon } from '@/components/notifications/NotificationIcon';
import { setupSyncListeners, syncReferenceData } from '@/lib/offline/sync';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

/**
 * Sidebar badge counts, fetched after mount so navigation never blocks on them.
 * A failure resolves to an empty map: the shell must survive a bad count.
 */
function useNavCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    fetch('/api/backoffice/nav-counts')
      .then((r) => (r.ok ? r.json() : { counts: {} }))
      .then((data) => {
        if (!cancelled) setCounts(data.counts ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return counts;
}

function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

interface NavChild {
  labelKey: string;
  href: string;
  permission?: string;
}

interface NavItem {
  labelKey: string;
  href: string;
  /** Kept for callers outside the sidebar; the sidebar itself renders `emoji`. */
  icon: React.ElementType;
  /** Sidebar glyph. Emoji reads faster than a line icon in a scanned list. */
  emoji: string;
  permission: string; // Permission code required to view this nav item
  /**
   * Judul pemisah di atas entri ini. Ditulis pada entri PERTAMA tiap bagian;
   * yang berikutnya membiarkannya kosong dan ikut bagian di atasnya.
   */
  section?: string;
  children?: NavChild[];
}

/**
 * Susunan menu samping.
 *
 * DIKELOMPOKKAN MENURUT LINGKUP PEKERJAAN, dan itu bukan soal kerapian.
 * Sebelumnya modul piutang menambahkan delapan entri DATAR di tingkat atas —
 * piutang, kontrabon, pelunasan, retur toko, beban, arsip, dasbor, konsinyasi —
 * sehingga daftarnya jadi dua puluh baris tanpa hierarki. Daftar sepanjang itu
 * berhenti dibaca; orang menghafal posisi, lalu tersesat begitu ada yang
 * bergeser.
 *
 * `section` memberi judul pemisah. Satu bagian dibiarkan tanpa judul (Beranda)
 * karena ia bukan kelompok, melainkan titik berangkat.
 *
 * SETIAP ANAK WAJIB PUNYA `permission` SENDIRI. Anak tanpa izin terlihat oleh
 * siapa pun yang lolos izin INDUKNYA, jadi memindahkannya ke induk lain diam-
 * diam mengubah siapa yang bisa melihatnya. Izin yang tertulis di sini persis
 * izin induk lamanya, supaya pengelompokan ulang ini tidak menggeser satu pun
 * hak akses.
 */
const navItems: NavItem[] = [
  {
    labelKey: 'dashboard',
    href: '/backoffice/dashboard',
    emoji: '📊',
    icon: LayoutDashboard,
    permission: PERMISSIONS.DASHBOARD_VIEW,
  },

  // ── Operasional ────────────────────────────────────────────────────────────
  {
    section: 'secOperations',
    labelKey: 'navGroupMasterData',
    href: '/backoffice/suppliers',
    emoji: '🗂️',
    icon: Building2,
    permission: PERMISSIONS.SUPPLIERS_VIEW,
    children: [
      { labelKey: 'masterSuppliers', href: '/backoffice/suppliers', permission: PERMISSIONS.SUPPLIERS_VIEW },
      { labelKey: 'supplierType', href: '/backoffice/suppliers/types', permission: PERMISSIONS.SUPPLIER_TYPES_VIEW },
      { labelKey: 'masterStores', href: '/backoffice/stores', permission: PERMISSIONS.STORES_VIEW },
      { labelKey: 'navItemsAll', href: '/backoffice/items', permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: 'navItemsCategory', href: '/backoffice/items/categories', permission: PERMISSIONS.ITEMS_VIEW },
      { labelKey: 'leadTime', href: '/backoffice/lead-time', permission: PERMISSIONS.LEAD_TIME_VIEW },
    ],
  },
  {
    section: 'secOperations',
    labelKey: 'inventory',
    href: '/backoffice/inventory',
    emoji: '📦',
    icon: Package,
    permission: PERMISSIONS.INVENTORY_VIEW,
    children: [
      { labelKey: 'inventory', href: '/backoffice/inventory', permission: PERMISSIONS.INVENTORY_VIEW },
      { labelKey: 'navStockOpname', href: '/backoffice/inventory/stock-opname', permission: PERMISSIONS.INVENTORY_OPNAME_VIEW },
      { labelKey: 'navStockReconciliation', href: '/backoffice/inventory/reconciliation', permission: PERMISSIONS.INVENTORY_RECONCILIATION_VIEW },
    ],
  },
  {
    section: 'secOperations',
    labelKey: 'sales',
    href: '/backoffice/sales-orders',
    emoji: '🛒',
    icon: Store,
    permission: PERMISSIONS.SALES_ORDERS_VIEW,
    children: [
      { labelKey: 'navSalesOrders', href: '/backoffice/sales-orders', permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: 'navFulfillment', href: '/backoffice/fulfillment', permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: 'navSalesReturns', href: '/backoffice/returns', permission: PERMISSIONS.SALES_ORDERS_VIEW },
      { labelKey: 'navFieldSalesOrders', href: '/backoffice/field-sales-orders', permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW },
      { labelKey: 'navCanvassing', href: '/backoffice/canvassing', permission: PERMISSIONS.CANVASSING_MANAGE },
      { labelKey: 'navVanSales', href: '/backoffice/van-sales', permission: PERMISSIONS.CANVASSING_MANAGE },
      { labelKey: 'navSpgSales', href: '/backoffice/spg-sales', permission: PERMISSIONS.SPG_SALES_VIEW },
      { labelKey: 'promos', href: '/backoffice/promos', permission: PERMISSIONS.PROMOS_VIEW },
    ],
  },
  {
    section: 'secOperations',
    labelKey: 'production',
    href: '/backoffice/production/planning',
    emoji: '🏭',
    icon: CalendarDays,
    permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW,
    children: [
      { labelKey: 'navForecast', href: '/backoffice/forecast', permission: PERMISSIONS.FORECAST_VIEW },
      { labelKey: 'navProductionPlanning', href: '/backoffice/production/planning', permission: PERMISSIONS.PRODUCTION_PLANNING_VIEW },
      { labelKey: 'navProductionColors', href: '/backoffice/production/colors', permission: PERMISSIONS.PRODUCTION_COLORS_VIEW },
      { labelKey: 'purchaseOrders', href: '/backoffice/purchase-orders', permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
      { labelKey: 'supplierPayment', href: '/backoffice/supplier-payments', permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW },
      { labelKey: 'navWorkOrdersList', href: '/backoffice/work-orders', permission: PERMISSIONS.WORK_ORDERS_VIEW },
      { labelKey: 'registerNotaCmt', href: '/backoffice/work-orders/nota-register', permission: PERMISSIONS.NOTA_REGISTER_VIEW },
      { labelKey: 'vendorReturns', href: '/backoffice/vendor-returns', permission: PERMISSIONS.VENDOR_RETURNS_VIEW },
    ],
  },

  // ── Piutang & konsinyasi ───────────────────────────────────────────────────
  // Berdiri sebagai bagiannya sendiri, bukan diselipkan ke Keuangan: orang yang
  // mengerjakannya berbeda (sales melapor, admin keuangan memverifikasi, gudang
  // menghitung), dan izinnya pun terpisah.
  {
    section: 'secReceivables',
    labelKey: 'navGroupReceivables',
    href: '/backoffice/pelunasan-dasbor',
    emoji: '🧾',
    icon: FileText,
    permission: PERMISSIONS.RECEIVABLES_VIEW,
    children: [
      { labelKey: 'dasborPelunasan', href: '/backoffice/pelunasan-dasbor', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'receivables', href: '/backoffice/piutang', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'collections', href: '/backoffice/kontrabon', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'payments', href: '/backoffice/pelunasan', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'storeReturns', href: '/backoffice/retur-toko', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'bebanSelisih', href: '/backoffice/beban-selisih', permission: PERMISSIONS.RECEIVABLES_VIEW },
      { labelKey: 'arsipRetur', href: '/backoffice/arsip-retur', permission: PERMISSIONS.RECEIVABLES_VIEW },
    ],
  },
  {
    section: 'secReceivables',
    labelKey: 'konsinyasi',
    href: '/backoffice/konsinyasi',
    emoji: '🤝',
    icon: Handshake,
    permission: PERMISSIONS.CONSIGNMENT_VIEW,
  },

  // ── Kreatif ────────────────────────────────────────────────────────────────
  // Bagiannya sendiri, bukan anak Penjualan: orang yang merencanakan konten
  // Instagram bukan orang yang menyetujui pesanan lapangan, dan tidak satu pun
  // dari mereka boleh mewarisi layar yang lain hanya karena keduanya menyentuh
  // kata "marketing". Izinnya pun terpisah.
  {
    section: 'secCreative',
    labelKey: 'navGroupCreative',
    href: '/backoffice/kreatif/konten',
    emoji: '🎬',
    icon: Megaphone,
    permission: PERMISSIONS.CREATIVE_VIEW,
    children: [
      { labelKey: 'navContentCalendar', href: '/backoffice/kreatif/konten', permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: 'navKolBrief', href: '/backoffice/kreatif/brief', permission: PERMISSIONS.CREATIVE_VIEW },
      { labelKey: 'navKolDirectory', href: '/backoffice/kreatif/kol', permission: PERMISSIONS.CREATIVE_VIEW },
    ],
  },

  // ── Keuangan ───────────────────────────────────────────────────────────────
  // Dipecah dua: yang MENCATAT dan yang MEMBACA. Sebelas anak dalam satu daftar
  // tidak lagi bisa dipindai, dan keduanya memang pekerjaan yang berbeda.
  {
    section: 'secFinance',
    labelKey: 'navGroupLedger',
    href: '/backoffice/finance/journals',
    emoji: '📒',
    icon: Wallet,
    permission: PERMISSIONS.JOURNALS_VIEW,
    children: [
      { labelKey: 'navFinanceJournals', href: '/backoffice/finance/journals', permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: 'navCoa', href: '/backoffice/finance/coa', permission: PERMISSIONS.COA_VIEW },
      { labelKey: 'navFinanceAccountMapping', href: '/backoffice/finance/account-mapping', permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: 'navFinanceCashFlowSections', href: '/backoffice/finance/cash-flow-sections', permission: PERMISSIONS.JOURNALS_VIEW },
      { labelKey: 'navFinanceSettlements', href: '/backoffice/finance/settlements', permission: PERMISSIONS.SETTLEMENTS_VIEW },
      { labelKey: 'navFakturPajak', href: '/backoffice/finance/faktur-pajak', permission: PERMISSIONS.TAX_INVOICES_VIEW },
    ],
  },
  {
    section: 'secFinance',
    labelKey: 'navGroupReports',
    href: '/backoffice/finance/reports/trial-balance',
    emoji: '📈',
    icon: BarChart2,
    permission: PERMISSIONS.FINANCE_REPORTS_VIEW,
    children: [
      { labelKey: 'navFinanceTrialBalance', href: '/backoffice/finance/reports/trial-balance', permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: 'navFinanceIncomeStatement', href: '/backoffice/finance/reports/income-statement', permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: 'navFinanceBalanceSheet', href: '/backoffice/finance/reports/balance-sheet', permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: 'navFinanceCashFlow', href: '/backoffice/finance/reports/cash-flow', permission: PERMISSIONS.FINANCE_REPORTS_VIEW },
      { labelKey: 'hppReport', href: '/backoffice/reports/hpp', permission: PERMISSIONS.REPORTS_HPP_VIEW },
    ],
  },

  // ── Sistem ─────────────────────────────────────────────────────────────────
  {
    section: 'secSystem',
    labelKey: 'jubelio',
    href: '/backoffice/jubelio/admin',
    emoji: '🔌',
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
    section: 'secSystem',
    labelKey: 'navGroupArchive',
    href: '/backoffice/archive',
    emoji: '🗄️',
    icon: FolderArchive,
    permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
    children: [
      { labelKey: 'archive', href: '/backoffice/archive', permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
      { labelKey: 'auditTrail', href: '/backoffice/audit-trail', permission: PERMISSIONS.AUDIT_TRAIL_VIEW },
    ],
  },
  {
    section: 'secSystem',
    labelKey: 'settings',
    href: '/backoffice/settings',
    emoji: '⚙️',
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_SECURITY_VIEW,
  },
];

/**
 * Grup mana yang harus terbuka untuk sebuah rute — DITURUNKAN dari `navItems`.
 *
 * Dulu ini daftar `startsWith` yang ditulis tangan, salinan kedua dari pohon
 * menu yang harus diperbarui setiap kali ada rute baru. Yang lupa diperbarui
 * tidak pernah gagal dengan berisik: grupnya cuma tidak terbuka, dan orang
 * mengira menunya hilang.
 *
 * Kecocokan TERPANJANG menang, supaya `/backoffice/items/categories` menunjuk
 * anaknya sendiri dan bukan induk yang kebetulan berawalan sama.
 */
function petaBuka(path: string): string | null {
  let terbaik: { panjang: number; induk: string } | null = null;
  for (const item of navItems) {
    if (!item.children?.length) continue;
    for (const anak of item.children) {
      if (path !== anak.href && !path.startsWith(`${anak.href}/`)) continue;
      if (!terbaik || anak.href.length > terbaik.panjang) {
        terbaik = { panjang: anak.href.length, induk: item.href };
      }
    }
  }
  return terbaik?.induk ?? null;
}

/**
 * Title of the page actually open.
 *
 * The header hardcoded the dashboard label, so every screen in the app
 * announced itself as "Beranda" — the one place that always tells you where
 * you are was always wrong. Resolved against the same nav tree the sidebar
 * renders, longest match first so a child route beats its parent.
 */
function useCurrentPageLabel(): string | null {
  const pathname = usePathname();
  const tNav = useTranslations('navigation');
  let best: { href: string; key: string } | null = null;
  for (const item of navItems) {
    for (const candidate of [
      { href: item.href, key: item.labelKey },
      ...(item.children ?? []).map((c) => ({ href: c.href, key: c.labelKey })),
    ]) {
      if (candidate.href === '#' || candidate.href === '') continue;
      if (pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)) {
        if (!best || candidate.href.length > best.href.length) best = candidate;
      }
    }
  }
  return best ? tNav(best.key as never) : null;
}

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
}: {
  className?: string;
  permissions: string[];
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const tNav = useTranslations('navigation');
  const navCounts = useNavCounts();
  const getOpenKeyFromPath = (path: string) => petaBuka(path);

  const [openNavKey, setOpenNavKey] = useState<string | null>(() => getOpenKeyFromPath(pathname));
  const [cari, setCari] = useState('');
  const [favorit, setFavorit] = useState<string[]>([]);
  const kotakCari = useRef<HTMLInputElement>(null);

  /*
   * Sematan dibaca SETELAH terpasang, bukan saat state dibuat.
   *
   * `localStorage` tidak ada di server, jadi membacanya sebagai nilai awal
   * `useState` membuat gambaran server dan klien berbeda — React mengeluh
   * ketidakcocokan hidrasi dan membuang seluruh hasil server.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hanya ada di klien
    setFavorit(bacaFavorit());
  }, []);

  const sematkan = (href: string) => {
    const { daftar, hasil } = ubahFavorit(favorit, href);
    if (hasil === 'penuh') {
      toast.error(tNav('favoritPenuh', { batas: BATAS_FAVORIT }));
      return;
    }
    setFavorit(daftar);
    tulisFavorit(daftar);
  };

  useEffect(() => {
    const key = getOpenKeyFromPath(pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync nav open state to pathname
    if (key) setOpenNavKey(key);
  }, [pathname]);

  /** Yang boleh dilihat pengguna ini. Penyaringan izin selalu lebih dulu. */
  const terizinkan = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.children?.length) {
          const anakTerlihat = item.children.filter(
            (child) => !child.permission || hasPermission(permissions, child.permission),
          );
          if (anakTerlihat.length === 0) return false;
          if (hasPermission(permissions, item.permission)) return true;
          return anakTerlihat.some(
            (child) => child.permission && hasPermission(permissions, child.permission),
          );
        }
        return hasPermission(permissions, item.permission);
      }),
    [permissions],
  );

  /*
   * Label yang SUDAH diterjemahkan diserahkan ke penyaring, bukan kunci i18n.
   * Orang mencari pada teks yang mereka baca — "Piutang", bukan "receivables".
   */
  const berlabel: ItemTerlabel[] = useMemo(
    () =>
      terizinkan.map((item) => ({
        href: item.href,
        label: tNav(item.labelKey as never),
        anak: (item.children ?? [])
          .filter((c) => !c.permission || hasPermission(permissions, c.permission))
          .map((c) => ({ href: c.href, label: tNav(c.labelKey as never) })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tNav stabil per locale
    [terizinkan, permissions],
  );

  const sedangMencari = cari.trim().length > 0;
  const hasilCari = useMemo(() => saringNav(berlabel, cari), [berlabel, cari]);

  /** href → hasil saringnya, supaya render tidak menyaring ulang tiap baris. */
  const lolos = useMemo(() => new Map(hasilCari.map((h) => [h.item.href, h])), [hasilCari]);

  const filteredItems = useMemo(
    () => terizinkan.filter((i) => lolos.has(i.href)),
    [terizinkan, lolos],
  );

  /**
   * Halaman yang disematkan, dalam bentuk siap gambar.
   *
   * Dicari di seluruh pohon — induk maupun anak — karena orang menyematkan
   * halaman, dan halaman bisa berada di kedua tingkat. Sematan yang menunjuk
   * rute yang sudah tidak ada, atau yang izinnya dicabut, hilang sendiri di
   * sini alih-alih jadi tautan mati.
   */
  const barisFavorit = useMemo(() => {
    if (favorit.length === 0 || sedangMencari) return [];
    const semua: { href: string; label: string; emoji: string }[] = [];
    for (const item of terizinkan) {
      semua.push({ href: item.href, label: tNav(item.labelKey as never), emoji: item.emoji });
      for (const c of item.children ?? []) {
        if (c.permission && !hasPermission(permissions, c.permission)) continue;
        semua.push({ href: c.href, label: tNav(c.labelKey as never), emoji: item.emoji });
      }
    }
    return favorit
      .map((h) => semua.find((x) => x.href === h))
      .filter((x): x is { href: string; label: string; emoji: string } => Boolean(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tNav stabil per locale
  }, [favorit, terizinkan, permissions, sedangMencari]);

  return (
    <div className={cn('flex flex-col h-full text-primary-foreground', className)}>
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary-foreground/20">
        <div className="w-10 h-10 bg-primary-foreground rounded-lg flex items-center justify-center">
          <span className="text-primary font-bold text-lg">E</span>
        </div>
        <div>
          <h1 className="font-bold text-lg">Elorae ERP</h1>
          <p className="text-xs text-primary-foreground/60">v1.0.0</p>
        </div>
      </div>

      {/*
        * The nav list scrolls on short viewports (768px cuts off the last two
        * items). Without a cue nothing tells you more menus exist below, so the
        * wrapper fades the bottom edge — the scroll itself was never broken,
        * only invisible.
        */}
      {/* Kotak cari. Menu ini berisi 53 tautan dalam 11 grup yang sebagian
          besar tertutup — menemukan sesuatu berarti menebak grupnya, dan
          tebakan itu salah separuh waktu. */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary-foreground/50" />
          <input
            ref={kotakCari}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCari('')}
            placeholder={tNav('cariMenu')}
            aria-label={tNav('cariMenu')}
            className="w-full rounded-lg bg-primary-foreground/10 py-2 pl-8 pr-8 text-sm text-primary-foreground outline-none transition-colors placeholder:text-primary-foreground/40 focus:bg-primary-foreground/[0.16]"
          />
          {cari && (
            <button
              type="button"
              onClick={() => {
                setCari('');
                kotakCari.current?.focus();
              }}
              aria-label={tNav('bersihkanCari')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-primary-foreground/60 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <nav className="h-full overflow-y-auto py-4 px-3 space-y-1">
        {/* Sematan. Seseorang membuka tiga halaman yang sama sepanjang hari
            dan tiap kali harus membuka grupnya lagi. */}
        {barisFavorit.length > 0 && (
          <div className="mb-3 space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/45">
              {tNav('favorit')}
            </p>
            {barisFavorit.map((f) => (
              <div key={`fav-${f.href}`} className="group/fav relative">
                <Link
                  href={f.href}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 rounded-lg py-2 pl-3 pr-9 text-sm transition-colors',
                    pathname === f.href
                      ? 'bg-primary-foreground text-primary'
                      : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground',
                  )}
                >
                  <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                    {f.emoji}
                  </span>
                  <span className="flex-1 truncate text-left">{f.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => sematkan(f.href)}
                  aria-label={tNav('lepasSematan')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-primary-foreground/60 opacity-0 transition-opacity hover:text-primary-foreground group-hover/fav:opacity-100 focus-visible:opacity-100"
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
            ))}
            <div className="!mt-3 border-t border-primary-foreground/15" />
          </div>
        )}

        {sedangMencari && filteredItems.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-primary-foreground/50">
            {tNav('cariKosong', { kueri: cari.trim() })}
          </p>
        )}
        {filteredItems.map((item, i) => {
          const hasChildren = item.children && item.children.length > 0;
          /*
           * Judul bagian digambar dari entri PERTAMA yang benar-benar terlihat
           * di bagian itu — bukan dari entri yang menuliskannya di data. Kalau
           * yang menuliskannya kebetulan tersaring izin, judulnya akan hilang
           * bersamanya dan sisa bagian itu menggantung di bawah judul bagian
           * SEBELUMNYA, yang lebih menyesatkan daripada tanpa judul sama sekali.
           */
          const judulBagian =
            item.section && item.section !== filteredItems[i - 1]?.section ? item.section : null;
          const pathOpenKey = getOpenKeyFromPath(pathname);
          const isParentActive = hasChildren
            ? pathOpenKey === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

          const bagian = judulBagian ? (
            <p
              key={`sec-${judulBagian}`}
              className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/45"
            >
              {tNav(judulBagian as never)}
            </p>
          ) : null;

          if (hasChildren) {
            return (
              <Fragment key={item.href}>
                {bagian}
              <Collapsible
                open={openNavKey === item.href}
                onOpenChange={(open) => setOpenNavKey(open ? item.href : null)}
                className="group/collapsible"
              >
                <CollapsibleTrigger
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors [&[data-state=open]>svg:last-of-type]:rotate-90',
                    isParentActive
                      ? 'bg-primary-foreground text-primary'
                      : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
                  )}
                >
                  <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                    {item.emoji}
                  </span>
                  <span className="flex-1 text-left">{tNav(item.labelKey as any)}</span>
                  <NavCountBadge count={navCounts[item.href] ?? 0} />
                  <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-primary-foreground/20 pl-3">
                    {(() => {
                      /*
                       * Saat mencari, hanya anak yang cocok yang digambar.
                       * Menampilkan seluruh isi grup yang kebetulan punya satu
                       * anak cocok memaksa orang mencari lagi dengan mata.
                       */
                      const lolosAnak = lolos.get(item.href)?.anak;
                      const visibleChildren = sedangMencari
                        ? item.children!.filter((c) => lolosAnak?.some((a) => a.href === c.href))
                        : item.children!.filter(
                            (child) =>
                              !child.permission || hasPermission(permissions, child.permission),
                          );
                      return visibleChildren.map((child) => {
                        // Prefer the longest matching child href so nested routes
                        // (e.g. /work-orders/nota-register) don't also light up the parent list item.
                        const matching = visibleChildren
                          .filter(
                            (c) =>
                              pathname === c.href || pathname.startsWith(`${c.href}/`)
                          )
                          .sort((a, b) => b.href.length - a.href.length);
                        const isChildActive = matching[0]?.href === child.href;
                        return (
                          <div key={child.href} className="group/anak relative">
                            <Link
                              href={child.href}
                              onClick={onClose}
                              className={cn(
                                'flex items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-sm transition-colors',
                                isChildActive
                                  ? 'font-medium text-primary-foreground'
                                  : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
                              )}
                            >
                              <span className="flex-1 truncate">{tNav(child.labelKey as any)}</span>
                              {/* Lencana ikut turun ke anaknya. Angka di induk saja
                                  menyebut ADA pekerjaan tanpa menyebut DI MANA, dan
                                  orang harus membuka delapan anak untuk mencarinya. */}
                              <NavCountBadge count={navCounts[child.href] ?? 0} />
                            </Link>
                            {/* Muncul saat disentuh saja — tombol bintang di 53
                                baris sekaligus membuat menunya jadi papan tombol. */}
                            <button
                              type="button"
                              onClick={() => sematkan(child.href)}
                              aria-label={tNav(
                                favorit.includes(child.href) ? 'lepasSematan' : 'sematkan',
                              )}
                              className={cn(
                                'absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-primary-foreground/50 transition-opacity hover:text-primary-foreground',
                                favorit.includes(child.href)
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover/anak:opacity-100 focus-visible:opacity-100',
                              )}
                            >
                              <Star
                                className={cn(
                                  'h-3 w-3',
                                  favorit.includes(child.href) && 'fill-current',
                                )}
                              />
                            </button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              </Fragment>
            );
          }

          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Fragment key={item.href}>
              {bagian}
            <Link
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-foreground text-primary'
                  : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
              )}
            >
              <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                {item.emoji}
              </span>
              <span className="flex-1 text-left">{tNav(item.labelKey as any)}</span>
              <NavCountBadge count={navCounts[item.href] ?? 0} />
            </Link>
            </Fragment>
          );
        })}
        </nav>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-primary to-transparent"
        />
      </div>

      <div className="p-4 border-t border-primary-foreground/20 [&_button]:text-primary-foreground [&_button]:hover:bg-primary-foreground/10 [&_button]:hover:text-primary-foreground">
        <OfflineIndicator />
      </div>
    </div>
  );
}

export function BackofficeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageLabel = useCurrentPageLabel();
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
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-primary-foreground/10 bg-primary min-h-0">
        <Sidebar permissions={session.user.permissions} />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-primary border-primary-foreground/10">
          <Sidebar permissions={session.user.permissions} onClose={() => setMobileMenuOpen(false)} />
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
              <SheetContent side="left" className="p-0 w-64 bg-primary border-primary-foreground/10">
                <Sidebar permissions={session.user.permissions} onClose={() => setMobileMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <h2 className="text-lg font-semibold hidden sm:block">
              {pageLabel ?? tNav('dashboard')}
            </h2>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <QuickActionFAB />
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
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 lg:p-6">
          {children}
        </main>
        <FcmRegistration />
      </div>
    </div>
  );
}
