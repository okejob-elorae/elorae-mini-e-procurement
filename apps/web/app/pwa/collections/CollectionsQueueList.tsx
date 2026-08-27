"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type CollectionQueueItem = {
  receivableId: string;
  storeName: string;
  docNo: string;
  outstandingAmount: number;
  dueDateIso: string;
  daysOverdue: number;
  pendingSubmittedAmount: number;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function CollectionsQueueList({ rows }: { rows: CollectionQueueItem[] }) {
  const t = useTranslations("pwa.collections");
  const tNav = useTranslations("pwa.nav");

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t("count", { count: rows.length })}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const collectable = r.outstandingAmount - r.pendingSubmittedAmount;
            const overdue = r.daysOverdue > 0;
            return (
              <li key={r.receivableId}>
                <Link
                  href={`/pwa/collections/${r.receivableId}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <div className="rounded-full bg-primary p-2 shrink-0">
                    <Wallet className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium leading-tight">{r.storeName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.docNo}</p>
                    <p className="truncate text-xs text-muted-foreground mt-0.5">
                      {t("colOutstanding")}: {formatRupiah(collectable)}
                    </p>
                  </div>
                  <Badge
                    variant={overdue ? "destructive" : "secondary"}
                    className={cn("shrink-0 text-[10px] px-1.5 py-0", !overdue && "text-muted-foreground")}
                  >
                    {overdue ? `${r.daysOverdue}d` : t("notYetDue")}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
