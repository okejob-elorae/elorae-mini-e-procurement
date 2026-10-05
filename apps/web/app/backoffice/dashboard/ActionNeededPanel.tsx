"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { hasPermission } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format/rupiah";
import { totalActionDocuments, type ActionItem } from "@/lib/dashboard/action-items-shared";

/**
 * "What is waiting for me" — OPEN at the top of Beranda, not folded into a
 * button. Folded, the list was one click away from everyone and read by no one.
 *
 * Rows are links, not a single "open the queue" button: each row goes straight
 * to the filtered list where that specific work is done, so the operator never
 * has to translate a number into a destination.
 */
export function ActionNeededPanel({ items }: { items: ActionItem[] }) {
  const { data: session } = useSession();
  const t = useTranslations("dashboardActions");
  const permissions = session?.user?.permissions ?? [];

  // A row nobody can act on is noise — and worse, it points at a page that
  // would then refuse to open.
  const visible = items.filter(
    (item) => !item.permission || hasPermission(permissions, item.permission),
  );

  // Nothing to do: one calm line, not an empty box asking to be read.
  if (visible.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        {t("allClear")}
      </p>
    );
  }

  // Documents, not rows — a PO both overdue and still submitted counts once.
  const total = totalActionDocuments(visible);
  const hasOverdue = visible.some((item) => item.tone === "overdue");

  return (
    <section className="beranda-kartu" aria-labelledby="perlu-tindakan-judul">
      <h2
        id="perlu-tindakan-judul"
        className={cn(
          "flex items-center gap-1.5 text-sm font-semibold",
          hasOverdue ? "text-destructive" : "text-amber-700 dark:text-amber-300",
        )}
      >
        {hasOverdue ? (
          <AlertTriangle aria-hidden className="h-4 w-4" />
        ) : (
          <Clock aria-hidden className="h-4 w-4" />
        )}
        {t("title", { count: total })}
      </h2>
      <ul className="-mx-1.5 mt-2 grid gap-x-6 md:grid-cols-2">
        {visible.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="group flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-background/60 focus-visible:bg-background/60 focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  item.tone === "overdue" ? "bg-destructive" : "bg-amber-500",
                )}
              />
              <span className="min-w-0 flex-1 leading-snug">{t(item.labelKey as never)}</span>
              {item.amount != null && item.amount > 0 ? (
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatRupiah(item.amount)}
                </span>
              ) : null}
              <span
                className={cn(
                  "w-8 shrink-0 text-right font-semibold tabular-nums",
                  item.tone === "overdue" ? "text-destructive" : "text-amber-700 dark:text-amber-300",
                )}
              >
                {item.count}
              </span>
              <ArrowRight
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
