'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { enGB, id as idLocale } from 'date-fns/locale';
import { getNotificationHref } from '@/lib/notifications/navigation';
import { tampilanLonceng, type Penerjemah } from '@/lib/notifications/tampilan-lonceng';
import { formatRupiah } from '@/lib/format/rupiah';
import { cn } from '@/lib/utils';
import {
  dariHalamanPertama,
  tandaiSatuDibaca,
  tandaiSemuaDibaca,
  tempelHalaman,
  type ItemLonceng,
  type JawabanLonceng,
  type KeadaanLonceng,
} from './keadaan-lonceng';
import { kabarBaru, type PenandaKabar } from '@/lib/pulau/kabar-baru';
import { kabarNotifikasi } from '@/lib/pulau/pulau';

export const NOTIFICATION_RECEIVED_EVENT = 'notification-received';

export type NotificationItem = ItemLonceng;

function NotificationInbox({
  items,
  onItemClick,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  t,
  penerjemah,
  localeWaktu,
}: {
  items: NotificationItem[];
  onItemClick: (item: NotificationItem) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  t: (key: string) => string;
  /** Judul/isi dalam bahasa pembaca — kalimat Inggris tersimpan diterjemahkan per jenis. */
  penerjemah: Penerjemah;
  localeWaktu: typeof idLocale;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
        {t('notifications.empty')}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <ul className="flex flex-col gap-0">
        {items.map((item) => {
          const isUnread = !item.readAt;
          const teks = tampilanLonceng(item, penerjemah);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onItemClick(item)}
                className={cn(
                  "w-full border-b px-4 py-3 text-left transition-colors",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  isUnread && "bg-muted",
                )}
              >
                <p className="font-medium text-foreground">{teks.judul}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{teks.isi}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: localeWaktu })}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="flex flex-col items-center gap-2 px-4 py-3">
          {loadMoreFailed && (
            <p role="alert" className="text-center text-sm text-destructive">
              {t('notifications.loadMoreFailed')}
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t('common.loading') : t('notifications.loadMore')}
          </Button>
        </div>
      )}
    </ScrollArea>
  );
}

export function NotificationIcon() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  // Tombol uji kirim hanya untuk admin sistem — alat pemeriksa, bukan pekerjaan.
  const bolehUji = (session?.user?.permissions ?? []).includes('*');
  const penerjemah: Penerjemah = {
    t: (kunci, nilai) => t(kunci as never, nilai as never),
    has: (kunci) => t.has(kunci as never),
    rupiah: formatRupiah,
  };
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<KeadaanLonceng | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendTestLoading, setSendTestLoading] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  /*
   * `generasi` naik setiap kali halaman pertama dimuat ulang (panel dibuka,
   * notifikasi baru masuk); hanya muatan terbaru yang boleh menulis daftar.
   * `lanjut` ikut naik, dan juga naik saat "Tandai semua dibaca": halaman
   * lanjutan yang sedang dimuat lalu dibuang — kursornya milik daftar lama
   * (menempelkannya bisa melompati baris), atau barisnya terbaca sebelum
   * penandaan dan akan tampil "belum dibaca" di samping lencana nol.
   */
  const generasi = useRef(0);
  const lanjut = useRef(0);
  /** Halaman pertama sedang dimuat (dipakai "Tandai semua dibaca"). */
  const memuatPertama = useRef(false);
  /*
   * Pulau status: notifikasi yang masuk SESUDAH halaman dibuka dikabarkan di
   * kapsul tengah atas ("1 notifikasi baru · <judul>"). Muatan pertama hanya
   * patokan, jadi notifikasi lama tidak pernah dimunculkan saat halaman dimuat.
   */
  const penandaKabar = useRef<PenandaKabar | null>(null);
  const kabarkanBaru = useRef<(baru: NotificationItem[]) => void>(() => {});

  const fetchNotifications = useCallback(async () => {
    const gen = ++generasi.current;
    lanjut.current += 1;
    memuatPertama.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (res.ok && gen === generasi.current) {
        const json: JawabanLonceng = await res.json();
        // Muatan yang lebih baru bisa dimulai selama jawaban ini dibaca.
        if (gen === generasi.current) {
          setData(dariHalamanPertama(json));
          setLoadMoreFailed(false);
          const hasil = kabarBaru(penandaKabar.current, json.items);
          penandaKabar.current = hasil.penanda;
          if (hasil.baru.length > 0) kabarkanBaru.current(hasil.baru);
        }
      }
    } catch {
      // Tanpa sinyal: daftar lama tetap tampil.
    } finally {
      if (gen === generasi.current) {
        memuatPertama.current = false;
        setLoading(false);
      }
    }
  }, []);

  const loadMore = async () => {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMore) return;
    const gen = lanjut.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(cursor)}`);
      if (gen !== lanjut.current) return;
      if (!res.ok) {
        setLoadMoreFailed(true);
        return;
      }
      const json: JawabanLonceng = await res.json();
      if (gen !== lanjut.current) return;
      setData((prev) => (prev ? tempelHalaman(prev, json) : prev));
    } catch {
      if (gen === lanjut.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mengambil dari server (sistem luar) saat terpasang
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- panel dibuka = baca ulang dari server
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  useEffect(() => {
    const handler = () => fetchNotifications();
    window.addEventListener(NOTIFICATION_RECEIVED_EVENT, handler);
    return () => window.removeEventListener(NOTIFICATION_RECEIVED_EVENT, handler);
  }, [fetchNotifications]);

  const handleItemClick = async (item: NotificationItem) => {
    const href = getNotificationHref(item.type, item.data);
    try {
      await fetch(`/api/notifications/${item.id}/read`, { method: 'PATCH' });
      setData((prev) => (prev ? tandaiSatuDibaca(prev, item.id, new Date().toISOString()) : null));
    } catch {
      // ignore
    }
    setOpen(false);
    if (href) {
      router.push(href);
    }
  };

  /*
   * Endpoint-nya menandai SEMUA milik pengguna, bukan hanya yang termuat — jadi
   * lencana boleh langsung nol, dan halaman yang dimuat sesudahnya pun terbaca.
   */
  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (res.ok) {
        lanjut.current += 1;
        setData((prev) => (prev ? tandaiSemuaDibaca(prev, new Date().toISOString()) : null));
        // Halaman pertama yang sedang dimuat bisa terbaca server SEBELUM penandaan
        // dan menimpa lencana nol dengan angka lama — muat ulang sesudahnya.
        if (memuatPertama.current) void fetchNotifications();
      }
    } catch {
      // Gagal tersambung: tidak ada yang berubah di server, daftar dibiarkan.
    } finally {
      setMarkAllLoading(false);
    }
  };

  const handleSendTest = async () => {
    setSendTestLoading(true);
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' });
      if (res.ok) {
        await fetchNotifications();
      }
    } finally {
      setSendTestLoading(false);
    }
  };

  // Selalu memakai penerjemah dan pengendali klik terbaru (fetchNotifications stabil).
  useEffect(() => {
    kabarkanBaru.current = (baru) => {
      if (open) return; // Panelnya sedang terbuka — notifikasinya sudah terlihat di sana.
      const terbaru = baru[0];
      const bukaDaftar = () => setOpen(true);
      kabarNotifikasi({
        judul: tampilanLonceng(terbaru, penerjemah).judul,
        jumlah: baru.length,
        // Satu notifikasi bertujuan: buka langsung (sekaligus tandai dibaca).
        // Tanpa tujuan, atau kapsulnya menyebut lebih dari satu: buka daftarnya.
        diketuk: getNotificationHref(terbaru.type, terbaru.data) ? () => void handleItemClick(terbaru) : bukaDaftar,
        semua: { diketuk: bukaDaftar },
      });
    };
  });

  const unreadCount = data?.unreadCount ?? 0;
  const badgeLabel = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 px-1 text-xs"
              aria-label={t('notifications.unreadAria', { count: unreadCount })}
            >
              {badgeLabel}
            </Badge>
          )}
          <span className="sr-only">{t('notifications.title')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex h-full w-full flex-col sm:max-w-sm">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{t('notifications.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('notifications.keterangan')}</SheetDescription>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                disabled={markAllLoading}
              >
                {t('notifications.markAllRead')}
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : (
            <NotificationInbox
              items={data?.items ?? []}
              onItemClick={handleItemClick}
              hasMore={Boolean(data?.nextCursor)}
              loadingMore={loadingMore}
              loadMoreFailed={loadMoreFailed}
              onLoadMore={() => void loadMore()}
              t={(key) => t(key)}
              penerjemah={penerjemah}
              localeWaktu={locale === 'en' ? enGB : idLocale}
            />
          )}
        </div>
        {bolehUji ? (
          <div className="border-t p-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleSendTest}
              disabled={sendTestLoading}
            >
              {sendTestLoading ? t('common.loading') : t('notifications.sendTest')}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
