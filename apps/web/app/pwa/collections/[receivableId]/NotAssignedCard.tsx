"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown instead of a bare 404 when the receivable exists but belongs to another collector, so a
 * push or a bookmark that went stale leaves a way back to the queue. Takes no receivable data on
 * purpose: nothing about another collector's receivable may reach this screen.
 */
export function NotAssignedCard() {
  const t = useTranslations("pwa.collections");

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="rounded-full bg-primary p-3 text-primary-foreground">
            <UserX className="h-8 w-8" />
          </div>
          <div>
            <p className="text-lg font-semibold">{t("notAssignedTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("notAssignedMessage")}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/pwa/collections">{t("backToQueue")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
