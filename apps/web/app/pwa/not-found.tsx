"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Segment-scoped 404 for everything under `/pwa`. Before this file existed, every PWA route's
 * `notFound()` call — `/pwa/bkm/[settlementId]`'s missing-or-not-yours branch included — fell
 * through to Next's bare default 404. In an installed PWA there is no browser chrome, so a
 * salesman who mistaps has no back button and no URL bar: a dead end standing at the counter with
 * the store owner watching. This gives every one of those routes a real way out instead of just
 * this task's own.
 */
export default function PwaNotFound() {
  const t = useTranslations("pwa.notFound");

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold">{t("title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("message")}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/pwa">{t("backHome")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
