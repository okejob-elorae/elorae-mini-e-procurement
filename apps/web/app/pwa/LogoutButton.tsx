"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  clearOfflineState,
  countUnsynced,
  discardFailedPhotos,
  firstPendingPhotoStoreId,
  logoutBlockReason,
  type UnsyncedCounts,
} from "@/lib/pwa/offline/clear-on-logout";
import { flushPendingOrders } from "@/lib/pwa/offline/sync";
import { flushPendingPhotos } from "@/lib/pwa/offline/photo-sync";
import { flushPendingCompletions } from "@/lib/pwa/offline/completion-sync";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logout } from "./actions";

export function LogoutButton() {
  const tAuth = useTranslations("auth");
  const t = useTranslations("pwa.logout");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<UnsyncedCounts | null>(null);
  const [photoStoreId, setPhotoStoreId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const showDialog = async () => {
    const current = await countUnsynced();
    setCounts(current);
    setPhotoStoreId(current.photos > 0 ? await firstPendingPhotoStoreId() : null);
    setOffline(!navigator.onLine);
    setConfirmDiscard(false);
    setOpen(true);
  };

  const doLogout = async () => {
    setBusy(true);
    try {
      const result = await clearOfflineState();
      if (result === "blocked") {
        await showDialog();
        toast.error(t("queueChanged"));
        setBusy(false);
        return;
      }
    } catch {
      setBusy(false);
      toast.error(t("clearFailed"), {
        action: { label: t("retry"), onClick: () => void doLogout() },
      });
      return;
    }
    await logout();
  };

  const discard = async () => {
    setDiscarding(true);
    try {
      await discardFailedPhotos();
      await showDialog();
      toast.success(t("discarded"));
    } catch {
      toast.error(t("discardError"));
    } finally {
      setDiscarding(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await flushPendingOrders();
      await flushPendingPhotos();
      await flushPendingCompletions();
    } catch {
      toast.error(t("syncFailed"));
    }
    try {
      const next = await countUnsynced();
      setCounts(next);
      setPhotoStoreId(next.photos > 0 ? await firstPendingPhotoStoreId() : null);
      setOffline(!navigator.onLine);
      setConfirmDiscard(false);
      if (logoutBlockReason(next) === null) {
        setOpen(false);
        toast.success(t("allSynced"));
      }
    } finally {
      setSyncing(false);
    }
  };

  const failedPhotos = counts?.failedPhotos ?? 0;
  const busyDialog = syncing || discarding;

  const rows = [
    { key: "orders", count: counts?.orders ?? 0, href: "/pwa/orders/pending" },
    { key: "completions", count: counts?.completions ?? 0, href: "/pwa/deliveries/pending" },
    { key: "photos", count: counts?.photos ?? 0, href: photoStoreId ? `/pwa/stores/${photoStoreId}` : "/pwa/stores" },
  ].filter((row) => row.count > 0);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={tAuth("logout")}
        disabled={busy}
        onClick={() => void doLogout()}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busyDialog && setOpen(next)}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t(`queue.${row.key}`)}</p>
                  <p className="text-xs text-muted-foreground">{t("itemCount", { count: row.count })}</p>
                </div>
                <Button asChild variant="outline" size="sm" className="min-h-10 shrink-0">
                  <Link href={row.href} onClick={() => setOpen(false)}>{t("review")}</Link>
                </Button>
              </li>
            ))}
          </ul>
          {failedPhotos > 0 && (
            <div className="space-y-2 rounded-md border border-destructive/40 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t("failedPhotosTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("itemCount", { count: failedPhotos })}
                </p>
              </div>
              {confirmDiscard ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("discardConfirmTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("discardConfirmBody")}</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="destructive"
                      className="min-h-10 w-full sm:w-auto"
                      disabled={discarding}
                      onClick={() => void discard()}
                    >
                      {discarding && <Loader2 className="h-4 w-4 animate-spin" />}
                      {discarding ? t("discarding") : t("discardConfirm")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 w-full sm:w-auto"
                      disabled={discarding}
                      onClick={() => setConfirmDiscard(false)}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10 w-full border-destructive/50 text-destructive hover:text-destructive"
                  disabled={busyDialog}
                  onClick={() => setConfirmDiscard(true)}
                >
                  {t("discardAction", { count: failedPhotos })}
                </Button>
              )}
            </div>
          )}
          {offline && <p className="text-sm text-muted-foreground">{t("offlineHint")}</p>}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="min-h-10 w-full sm:w-auto"
              disabled={offline || busyDialog}
              onClick={() => void syncNow()}
            >
              {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
              {syncing ? t("syncing") : t("syncNow")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 w-full sm:w-auto"
              disabled={busyDialog}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
