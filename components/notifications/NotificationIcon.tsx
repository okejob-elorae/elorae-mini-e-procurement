'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
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
  unreadCount: number;
}

function NotificationInbox({
  items,
  onItemClick,
  t,
}: {
  items: NotificationItem[];
  onItemClick: (item: NotificationItem) => void;
  t: (key: string) => string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
        {t('notifications.empty')}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <ul className="flex flex-col gap-0">
        {items.map((item) => {
          const href = getNotificationHref(item.type, item.data);
          const isUnread = !item.readAt;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onItemClick(item)}
                className={cn(
                  'w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent',
                  isUnread && 'bg-accent/50'
                )}
              >
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
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

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const json: NotificationsResponse = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
    } catch (_) {
      // ignore
    }
    setOpen(false);
    if (href) {
      router.push(href);
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
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t('notifications.title')}</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : (
          <NotificationInbox
            items={data?.items ?? []}
            onItemClick={handleItemClick}
            t={(key) => t(key)}
          />
        )}
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
