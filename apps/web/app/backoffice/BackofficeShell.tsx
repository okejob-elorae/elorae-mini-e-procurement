'use client';

import { Fragment, useMemo, useRef, useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Settings,
  Menu,
  ChevronDown,
  ChevronRight,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Check,
  Search,
  Star,
  X,
  PanelLeftClose,
  PanelLeft,
  Loader2,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
import { hasPermission } from '@/lib/rbac';
import { bolehAnak, grupUntukRute, navItems } from '@/lib/nav/menu';
import { entriHalamanAktif, geserAgarTerlihat, geserKeJangkar, idJangkar } from '@/lib/nav/halaman-aktif';
import { grupTerbuka, saringNav, type ItemTerlabel } from '@/lib/nav/saring';
import { BAHASA, keadaanTema } from '@/lib/nav/tampilan-pengguna';
import { bacaFavorit, tulisFavorit, ubahFavorit, BATAS_FAVORIT } from '@/lib/nav/favorit';
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { QuickActionFAB } from '@/components/QuickActionFAB';
import { FcmRegistration } from '@/components/notifications/FcmRegistration';
import { deleteFcmToken } from "@/components/notifications/fcm-client";
import { NotificationIcon } from '@/components/notifications/NotificationIcon';
import { setupSyncListeners, syncReferenceData } from '@/lib/offline/sync';
import { useNamaPeran } from '@/app/backoffice/settings/rbac/pakai-nama-peran';
import { useLocaleContext } from '@/components/providers/LocaleProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const SIDEBAR_COLLAPSED_KEY = 'elorae.sidebar.collapsed';

/**
 * Sidebar badge counts, fetched after mount so navigation never blocks on them.
 * A failure resolves to an empty map: the shell must survive a bad count.
 */
/**
 * Lencana menu: total per GRUP, dan total per HALAMAN.
 *
 * Dua peta, bukan satu. Sebagian induk berbagi href dengan salah satu anaknya
 * sendiri — Produksi dan Plan Kerja dua-duanya `/backoffice/production/planning`
 * — jadi satu peta membuat anak itu mewarisi total seluruh grupnya dan memakai
 * lencana untuk pekerjaan yang ada di halaman lain.
 */
function useNavCounts(): { grup: Record<string, number>; halaman: Record<string, number> } {
  const [data, setData] = useState<{
    grup: Record<string, number>;
    halaman: Record<string, number>;
  }>({ grup: {}, halaman: {} });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/backoffice/nav-counts')
      .then((r) => (r.ok ? r.json() : { counts: {}, pages: {} }))
      .then((d) => {
        if (!cancelled) setData({ grup: d.counts ?? {}, halaman: d.pages ?? {} });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    // Merah tetap, bukan `bg-destructive`: di mode gelap token itu merah muda
    // terang, dan angka putih di atasnya hanya 2,9:1.
    <span className="ml-auto shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

// Susunan menu tinggal di `lib/nav/menu.ts` — juga dibaca lencana menu dan editor peran.
export { navItems, bolehAnak } from '@/lib/nav/menu';

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
  // Anak menang seri atas induknya (Laporan → Neraca Saldo, Data Master → Pemasok).
  const best = entriHalamanAktif(pathname, navItems);
  return best ? tNav(best.labelKey as never) : null;
}

function ThemeDropdownItems() {
  const { theme, setTheme, systemTheme } = useTheme();
  const tNav = useTranslations('navigation');
  // Centang hanya pada pilihan yang TERSIMPAN; "ikuti perangkat" menyebut tema perangkat sekarang.
  const { terpilih, perangkat } = keadaanTema(theme, systemTheme);
  const labelPerangkat =
    perangkat === 'light' ? tNav('temaPerangkatTerang') : perangkat === 'dark' ? tNav('temaPerangkatGelap') : tNav('temaPerangkat');
  return (
    <>
      <DropdownMenuItem onClick={() => setTheme('light')}>
        <Sun className="mr-2 h-4 w-4" />
        {tNav('temaTerang')}
        {terpilih === 'light' && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme('dark')}>
        <Moon className="mr-2 h-4 w-4" />
        {tNav('temaGelap')}
        {terpilih === 'dark' && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme('system')}>
        <Monitor className="mr-2 h-4 w-4" />
        {labelPerangkat}
        {terpilih === 'system' && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
    </>
  );
}

/** Pilihan bahasa di kepala halaman — nama bahasanya lengkap ("Bahasa Indonesia", bukan "Bahasa"). */
function PilihBahasa() {
  const { locale, setLocale } = useLocaleContext();
  const tNav = useTranslations('navigation');
  const terpilih = BAHASA.find((b) => b.kode === locale) ?? BAHASA[0];
  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as 'id' | 'en')}>
      <SelectTrigger className="w-auto" aria-label={tNav('bahasa')}>
        {/* Layar sempit: kodenya saja, supaya kepala halaman tidak meluap. */}
        <SelectValue>
          <span className="sm:hidden">{terpilih.kode.toUpperCase()}</span>
          <span className="hidden sm:inline">{terpilih.nama}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BAHASA.map((b) => (
          <SelectItem key={b.kode} value={b.kode}>
            {b.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Sidebar({
  className,
  permissions,
  userRole,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  className?: string;
  permissions: string[];
  /** Entri `adminOnly` hanya tampil bagi peran lama ADMIN. */
  userRole?: Role;
  onClose?: () => void;
  /** Menu samping ciut: ikon saja, grup dibuka sebagai menu tarik-turun. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const tNav = useTranslations('navigation');
  const navCounts = useNavCounts();
  const getOpenKeyFromPath = (path: string) => grupUntukRute(path);

  const [openNavKey, setOpenNavKey] = useState<string | null>(() => getOpenKeyFromPath(pathname));
  const [cari, setCari] = useState('');
  const [favorit, setFavorit] = useState<string[]>([]);
  const kotakCari = useRef<HTMLInputElement>(null);
  const daftarMenu = useRef<HTMLElement>(null);

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

  /*
   * Tautan aktif selalu terlihat. Di laptop 768–800 px menu terakhir sebuah
   * grup panjang (SPG, Tim Lapangan) berada di bawah tepi menu, jadi orang
   * tidak melihat di mana ia berada. Diulang sesudah animasi buka/tutup grup,
   * karena grup lain yang menutup menggeser posisinya.
   */
  useEffect(() => {
    const wadah = daftarMenu.current;
    if (!wadah) return;
    const geser = () => {
      const semua = wadah.querySelectorAll<HTMLElement>('[aria-current="page"]');
      const aktif = semua[semua.length - 1];
      if (!aktif) return;
      const d = geserAgarTerlihat(wadah.getBoundingClientRect(), aktif.getBoundingClientRect());
      if (d !== 0) wadah.scrollTop += d;
    };
    const bingkai = requestAnimationFrame(geser);
    const tunda = setTimeout(geser, 320);
    return () => {
      cancelAnimationFrame(bingkai);
      clearTimeout(tunda);
    };
  }, [pathname, openNavKey]);

  /** Yang boleh dilihat pengguna ini. Penyaringan izin selalu lebih dulu. */
  const terizinkan = useMemo(
    () =>
      navItems.filter((item) => {
        if ('adminOnly' in item && item.adminOnly && userRole !== Role.ADMIN) return false;
        if (item.children?.length) {
          const anakTerlihat = item.children.filter(
            (child) => bolehAnak(permissions, child.permission),
          );
          if (anakTerlihat.length === 0) return false;
          if (item.permission && hasPermission(permissions, item.permission)) return true;
          return anakTerlihat.some(
            (child) => child.permission !== undefined && bolehAnak(permissions, child.permission),
          );
        }
        return bolehAnak(permissions, item.permission);
      }),
    [permissions, userRole],
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
          .filter((c) => bolehAnak(permissions, c.permission))
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
    const semua: { href: string; label: string; icon: React.ElementType }[] = [];
    for (const item of terizinkan) {
      semua.push({ href: item.href, label: tNav(item.labelKey as never), icon: item.icon });
      for (const c of item.children ?? []) {
        if (!bolehAnak(permissions, c.permission)) continue;
        semua.push({ href: c.href, label: tNav(c.labelKey as never), icon: item.icon });
      }
    }
    return favorit
      .map((h) => semua.find((x) => x.href === h))
      .filter((x): x is { href: string; label: string; icon: React.ElementType } => Boolean(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tNav stabil per locale
  }, [favorit, terizinkan, permissions, sedangMencari]);

  const tombolCiut = onToggleCollapse ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
      onClick={onToggleCollapse}
      aria-label={collapsed ? tNav('expandSidebar') : tNav('collapseSidebar')}
      title={collapsed ? tNav('expandSidebar') : tNav('collapseSidebar')}
    >
      {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </Button>
  ) : null;

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <div data-menu-samping className={cn('flex flex-col h-full text-primary-foreground', className)}>
          <div className="flex flex-col items-center gap-2 px-2 py-3 border-b border-primary-foreground/20">
            <div className="w-10 h-10 bg-primary-foreground rounded-lg flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-lg">E</span>
            </div>
            {tombolCiut}
          </div>
          <nav ref={daftarMenu} className="flex-1 min-h-0 overflow-y-auto py-4 px-2 space-y-1">
            {terizinkan.map((item) => {
              const label = tNav(item.labelKey as never);
              const ada = (navCounts.grup[item.href] ?? 0) > 0;
              const titik = ada ? (
                <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-600" />
              ) : null;

              if (item.children?.length) {
                const anak = item.children.filter((child) => bolehAnak(permissions, child.permission));
                const aktif = anak
                  .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
                  .sort((a, b) => b.href.length - a.href.length)[0]?.href;
                const isParentActive = getOpenKeyFromPath(pathname) === item.href;
                return (
                  <DropdownMenu key={item.href}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'relative w-full h-10 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground',
                          isParentActive && 'bg-primary-foreground text-primary hover:bg-primary-foreground hover:text-primary',
                        )}
                        aria-label={label}
                      >
                        <item.icon aria-hidden className="h-[18px] w-5" strokeWidth={1.75} />
                        {titik}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-56">
                      <DropdownMenuLabel>{label}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {anak.map((child) => (
                        <DropdownMenuItem key={child.href} asChild>
                          <Link
                            href={child.href}
                            onClick={onClose}
                            aria-current={aktif === child.href ? 'page' : undefined}
                            className={cn(aktif === child.href && 'font-medium')}
                          >
                            <span className="flex-1 truncate">{tNav(child.labelKey as never)}</span>
                            <NavCountBadge count={navCounts.halaman[child.href] ?? 0} />
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }

              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-label={label}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex h-10 w-full items-center justify-center rounded-lg transition-colors',
                        isActive
                          ? 'bg-primary-foreground text-primary'
                          : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground',
                      )}
                    >
                      <item.icon aria-hidden className="h-[18px] w-5" strokeWidth={1.75} />
                      {titik}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div data-menu-samping className={cn('flex flex-col h-full text-primary-foreground', className)}>
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary-foreground/20">
        <div className="w-10 h-10 bg-primary-foreground rounded-lg flex items-center justify-center shrink-0">
          <span className="text-primary font-bold text-lg">E</span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-lg truncate">Elorae ERP</h1>
          <p className="text-xs text-primary-foreground/75">v1.0.0</p>
        </div>
        {tombolCiut}
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
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary-foreground/75" />
          <input
            ref={kotakCari}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCari('')}
            placeholder={tNav('cariMenu')}
            aria-label={tNav('cariMenu')}
            className="w-full rounded-lg bg-primary-foreground/10 py-2 pl-8 pr-8 text-sm text-primary-foreground outline-none transition-colors placeholder:text-primary-foreground/80 focus:bg-primary-foreground/[0.16]"
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
        <nav ref={daftarMenu} className="h-full overflow-y-auto py-4 px-3 space-y-1">
        {/* Sematan. Seseorang membuka tiga halaman yang sama sepanjang hari
            dan tiap kali harus membuka grupnya lagi. */}
        {barisFavorit.length > 0 && (
          <div className="mb-3 space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/80">
              {tNav('favorit')}
            </p>
            {barisFavorit.map((f) => (
              <div key={`fav-${f.href}`} className="group/fav relative">
                <Link
                  href={f.href}
                  onClick={onClose}
                  aria-current={pathname === f.href ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg py-2 pl-3 pr-9 text-sm transition-colors',
                    pathname === f.href
                      ? 'bg-primary-foreground text-primary'
                      : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground',
                  )}
                >
                  <f.icon aria-hidden className="h-[18px] w-5 shrink-0" strokeWidth={1.75} />
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
          <p className="px-3 py-6 text-center text-sm text-primary-foreground/80">
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
              className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/80"
            >
              {tNav(judulBagian as never)}
            </p>
          ) : null;

          if (hasChildren) {
            return (
              <Fragment key={item.href}>
                {bagian}
              <Collapsible
                // Saat mencari, grup yang lolos saringan terbuka — anak yang cocok langsung terlihat.
                open={grupTerbuka(item.href, openNavKey, sedangMencari, lolos.has(item.href))}
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
                  <item.icon aria-hidden className="h-[18px] w-5 shrink-0" strokeWidth={1.75} />
                  <span className="flex-1 text-left">{tNav(item.labelKey as any)}</span>
                  <NavCountBadge count={navCounts.grup[item.href] ?? 0} />
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
                              bolehAnak(permissions, child.permission),
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
                              aria-current={isChildActive ? 'page' : undefined}
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
                              <NavCountBadge count={navCounts.halaman[child.href] ?? 0} />
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
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-foreground text-primary'
                  : 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
              )}
            >
              <item.icon aria-hidden className="h-[18px] w-5 shrink-0" strokeWidth={1.75} />
              <span className="flex-1 text-left">{tNav(item.labelKey as any)}</span>
              <NavCountBadge count={navCounts.grup[item.href] ?? 0} />
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
  // Nama peran yang SAMA dengan Pengaturan → Pengguna dan Peran & izin (Keuangan, Admin pajak…);
  // `auth.roles` hanya mengenal enum lama dan menyebut PURCHASER "Pembeli".
  const namaPeran = useNamaPeran();
  const tAuth = useTranslations('auth');
  const tNav = useTranslations('navigation');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hanya ada di klien
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') setSidebarCollapsed(true);
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

  // Laci tertutup setiap kali halaman berganti, lewat jalan mana pun (tautan menu, sematan, tombol kembali).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- menutup laci saat rute berganti
    setMobileMenuOpen(false);
  }, [pathname]);

  /*
   * Jangkar `#…` di alamat (mis. Pengaturan → Salesman `#target`). Yang
   * menggulir di kantor adalah `<main>`, bukan dokumen, dan kartu tujuan sering
   * baru muncul sesudah kerangka muat diganti isi — jadi penggulir bawaan
   * peramban/Next tidak menemukannya. Ditunggu sampai elemennya ada (paling
   * lama 5 detik), lalu `<main>` digeser sampai jangkar di tepi atasnya.
   */
  const isiHalaman = useRef<HTMLElement>(null);
  useEffect(() => {
    const ikuti = () => {
      const id = idJangkar(window.location.hash);
      if (!id) return () => {};
      const geser = () => {
        const el = document.getElementById(id);
        const wadah = isiHalaman.current;
        if (!el || !wadah) return false;
        wadah.scrollTop += geserKeJangkar(wadah.getBoundingClientRect().top, el.getBoundingClientRect().top);
        return true;
      };
      // Diulang sekali sesudah isi di atasnya selesai dimuat (posisinya bisa bergeser).
      const ulang = setTimeout(geser, 700);
      if (geser()) return () => clearTimeout(ulang);
      const amati = new MutationObserver(() => {
        if (geser()) amati.disconnect();
      });
      amati.observe(document.body, { childList: true, subtree: true });
      const batas = setTimeout(() => amati.disconnect(), 5000);
      return () => {
        amati.disconnect();
        clearTimeout(batas);
        clearTimeout(ulang);
      };
    };
    let lepas = ikuti();
    const gantiHash = () => {
      lepas();
      lepas = ikuti();
    };
    window.addEventListener('hashchange', gantiHash);
    return () => {
      lepas();
      window.removeEventListener('hashchange', gantiHash);
    };
  }, [pathname]);

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
          'hidden lg:flex lg:flex-col shrink-0 border-r border-primary-foreground/10 bg-primary min-h-0 transition-[width] duration-200 ease-in-out',
          sidebarCollapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <Sidebar
          permissions={session.user.permissions}
          userRole={userRole}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </aside>

      {/* Main Content — min-h-0 so flex-1 + overflow-auto actually scroll inside the viewport */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <header className="h-16 shrink-0 border-b bg-card flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-4">
            {/* Laci menu HP: SATU lembar terkendali. Dulu ada dua — pemicunya membuka
                lembar yang tidak terkendali, sedangkan memilih halaman menutup lembar
                yang lain, jadi laci tetap menutupi halaman tujuan. */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon" aria-label={tNav('bukaMenu')}>
                  <Menu aria-hidden className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              {/* `text-primary-foreground`: tombol tutup lembar (X) mengikuti warna teks menu, terbaca di tema gelap maupun terang. */}
              <SheetContent side="left" className="p-0 w-64 bg-primary text-primary-foreground border-primary-foreground/10">
                <SheetTitle className="sr-only">{tNav('judulMenuSamping')}</SheetTitle>
                <SheetDescription className="sr-only">{tNav('keteranganMenuSamping')}</SheetDescription>
                <Sidebar
                  permissions={session.user.permissions}
                  userRole={userRole}
                  onClose={() => setMobileMenuOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <h2 className="text-lg font-semibold hidden sm:block">
              {pageLabel ?? tNav('dashboard')}
            </h2>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <QuickActionFAB />
            <NotificationIcon />
            <PilihBahasa />
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
                      {session.user.roleName ? namaPeran(session.user.roleName) : tRole(userRole as any)}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{tNav('akunSaya')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tNav('tema')}</DropdownMenuLabel>
                <ThemeDropdownItems />
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/backoffice/settings" className="flex items-center">
                    <Settings className="mr-2 h-4 w-4" />
                    {tNav('settings')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={signingOut}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (signingOut) return;
                    setSigningOut(true);
                    void deleteFcmToken().then(() => signOut({ callbackUrl: "/login" }));
                  }}
                  data-testid="sign-out"
                >
                  {signingOut ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  {tAuth('logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main ref={isiHalaman} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 lg:p-6">
          {children}
        </main>
        <FcmRegistration />
        {/* Sinyal dan antrean kantor → pulau status di tengah atas (dulu label "Online" di menu samping). */}
        <OfflineIndicator />
      </div>
    </div>
  );
}
