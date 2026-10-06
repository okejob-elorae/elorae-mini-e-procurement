"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, BellRing, Loader2, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { registerFcmToken } from "@/components/notifications/fcm-client";

type PushState = "checking" | "hidden" | "default" | "pending" | "enabled" | "denied" | "failed" | "unsupported";

const PWA_SCOPE = "/pwa/";

/**
 * The only place the PWA asks for notification permission — from a button press, which iOS
 * requires and which keeps the prompt out of the salesman's way on load. Hidden where push can
 * never work: no Notification/Push API (an iOS tab that is not installed) or no `/pwa/` service
 * worker (dev, where Serwist builds none).
 */
export function EnablePushCard() {
  const t = useTranslations("pwa.notifications.push");
  const [state, setState] = useState<PushState>("checking");

  useEffect(() => {
    const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) {
      setState("hidden");
      return;
    }
    let cancelled = false;
    navigator.serviceWorker
      .getRegistration(PWA_SCOPE)
      .then((reg) => {
        if (cancelled) return;
        if (!reg) {
          setState("hidden");
          return;
        }
        const permission = Notification.permission;
        setState(permission === "granted" ? "enabled" : permission === "denied" ? "denied" : "default");
      })
      .catch(() => {
        if (!cancelled) setState("hidden");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setState("pending");
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      setState("failed");
      return;
    }
    if (permission === "denied") {
      setState("denied");
      return;
    }
    if (permission !== "granted") {
      setState("default");
      return;
    }
    const { outcome } = await registerFcmToken({ serviceWorkerScope: PWA_SCOPE });
    setState(outcome === "registered" ? "enabled" : outcome);
  }

  if (state === "checking" || state === "hidden") return null;

  if (state === "enabled") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BellRing className="h-4 w-4 shrink-0" />
        {t("enabled")}
      </p>
    );
  }

  if (state === "denied" || state === "unsupported") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t(state)}</span>
      </p>
    );
  }

  const pending = state === "pending";
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-full bg-primary p-2 text-primary-foreground">
            <Bell className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("title")}</p>
            <p className="text-sm text-muted-foreground">{t("body")}</p>
          </div>
        </div>
        {state === "failed" && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("failed")}</span>
          </div>
        )}
        <Button
          className="h-11 w-full"
          variant={state === "failed" ? "outline" : "default"}
          onClick={handleEnable}
          disabled={pending}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("enabling")}
            </>
          ) : state === "failed" ? (
            t("retry")
          ) : (
            t("enable")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
