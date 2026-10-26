"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Bell, ChevronRight, Loader2, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDateFnsLocale } from "@/lib/i18n/date-fns-locale";
import { getNotificationHref } from "@/lib/notifications/navigation";
import { EnablePushCard } from "./EnablePushCard";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type Props = {
  initialItems: NotificationItem[];
  initialNextCursor: string | null;
  initialUnreadCount: number;
};

export function NotificationsList({ initialItems, initialNextCursor, initialUnreadCount }: Props) {
  const t = useTranslations("pwa.notifications");
  const tNav = useTranslations("pwa.nav");
  const dateLocale = getDateFnsLocale(useLocale());
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(nextCursor)}`);
      if (!res.ok) throw new Error("failed");
      const json: { items: NotificationItem[]; nextCursor: string | null; unreadCount: number } = await res.json();
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.id));
        return [...prev, ...json.items.filter((i) => !known.has(i.id))];
      });
      setNextCursor(json.nextCursor);
      setUnreadCount(json.unreadCount);
      setActionError(null);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)));
    setUnreadCount((n) => Math.max(0, n - 1));
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      if (!res.ok) throw new Error("failed");
      setActionError(null);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: null } : i)));
      setUnreadCount((n) => n + 1);
      setActionError(t("offlineError"));
    }
  }

  async function handleItemClick(item: NotificationItem) {
    if (!item.readAt) await markRead(item.id);
    const href = getNotificationHref(item.type, item.data, "pwa");
    if (href) router.push(href);
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    const previousUnread = unreadCount;
    const markedIds = new Set(items.filter((i) => !i.readAt).map((i) => i.id));
    setUnreadCount(0);
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      setActionError(null);
    } catch {
      setItems((prev) => prev.map((i) => (markedIds.has(i.id) ? { ...i, readAt: null } : i)));
      setUnreadCount(previousUnread);
      setActionError(t("offlineError"));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm" className="h-10">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </Button>
      </header>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
          {unreadCount > 0 && (
            <p className="text-xs text-muted-foreground">{t("unreadCount", { count: unreadCount })}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={handleMarkAllRead} disabled={markingAll}>
            {markingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : t("markAllRead")}
          </Button>
        )}
      </div>

      <EnablePushCard />

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Bell className="h-8 w-8" />
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={getNotificationHref(item.type, item.data, "pwa") ?? "/pwa/notifications"}
              onClick={(e) => {
                e.preventDefault();
                handleItemClick(item);
              }}
              className="block"
            >
              <Card className={item.readAt ? undefined : "border-primary/40 bg-primary/5"}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="shrink-0 rounded-full bg-primary p-2 text-primary-foreground">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: dateLocale })}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
          {nextCursor && (
            <div className="space-y-2">
              {loadMoreError && <p className="text-center text-xs text-destructive">{t("loadMoreError")}</p>}
              <Button variant="outline" className="h-11 w-full" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
