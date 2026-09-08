"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Segment-scoped error boundary for everything under `/pwa`, the sibling of `not-found.tsx`
 * beside it and there for the same reason: an installed PWA has no browser chrome, so a thrown
 * error that falls through to Next's default error page is an unescapable dead end with no back
 * button and no URL bar. It is reachable on the BKM route in particular — `Receivable.delivery`
 * is a REQUIRED relation under `relationMode = "prisma"`, so there is no database FK behind it
 * and a dangling `deliveryId` makes the read itself throw `Inconsistent query result` rather
 * than resolving to null. Retry first (the failure may be transient), then a way back to `/pwa`
 * for the case where it is not.
 *
 * Next requires this file to be a client component and hands it `reset` to re-render the
 * segment. `error.digest` — the server-side correlation id — goes to the console rather than
 * onto the screen: a salesman at a counter can do nothing with it, and it is the only handle
 * anyone has on the matching server log afterwards.
 */
export default function PwaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("pwa.error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="rounded-full bg-muted p-3">
            <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold">{t("title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("message")}</p>
          </div>
          <Button type="button" size="lg" className="w-full" onClick={() => reset()}>
            {t("retry")}
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href="/pwa">{t("backHome")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
