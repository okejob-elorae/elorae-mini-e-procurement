'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale } from '@/lib/i18n/date-fns-locale';
import { getNotificationHref } from '@/lib/notifications/navigation';
import { cn } from '@/lib/utils';

export const NOTIFICATION_RECEIVED_EVENT = 'notification-received';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

function NotificationInbox({
  items,
  onItemClick,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  t,
}: {
  items: NotificationItem[];
  onItemClick: (item: NotificationItem) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  t: (key: string) => string;
}) {
  const dateLocale = getDateFnsLocale(useLocale());
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
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: dateLocale })}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="flex flex-col items-center gap-2 p-3">
          {loadMoreFailed && (
            <p className="text-xs text-destructive">{t("notifications.loadMoreError")}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : t("notifications.loadMore")}
          </Button>
        </div>
      )}
    </ScrollArea>
  );
}

export function NotificationIcon() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendTestLoading, setSendTestLoading] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const json: NotificationsResponse = await res.json();
        setData(json);
        setLoadMoreFailed(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoadMore = async () => {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error("failed");
      const json: NotificationsResponse = await res.json();
      setData((prev) => {
        if (!prev) return json;
        /* A refetch landed mid-flight and reset page 1: appending would skip the rows between. */
        if (prev.nextCursor !== cursor) return prev;
        const known = new Set(prev.items.map((i) => i.id));
        return {
          items: [...prev.items, ...json.items.filter((i) => !known.has(i.id))],
          nextCursor: json.nextCursor,
          unreadCount: json.unreadCount,
        };
      });
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) {
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
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i
              ),
              unreadCount: Math.max(0, prev.unreadCount - 1),
            }
          : null
      );
    } catch {
      // ignore
    }
    setOpen(false);
    if (href) {
      router.push(href);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((i) => ({ ...i, readAt: new Date().toISOString() })),
                unreadCount: 0,
              }
            : null
        );
      }
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
              aria-label={`${unreadCount} unread notifications`}
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
              onLoadMore={handleLoadMore}
              t={(key) => t(key)}
            />
          )}
        </div>
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
      </SheetContent>
    </Sheet>
  );
}
