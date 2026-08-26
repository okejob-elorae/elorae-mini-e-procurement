'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { hasPermission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import type { ActionItem } from '@/lib/dashboard/action-items';

/**
 * "What is waiting for me", above the KPI cards that answer "how are we doing".
 *
 * Rows are links, not a single "open the queue" button: the whole point is that
 * each row goes straight to the screen where that specific work is done, so the
 * operator never has to translate a number into a destination.
 */
export function ActionNeededPanel({ items }: { items: ActionItem[] }) {
  const { data: session } = useSession();
  const t = useTranslations('dashboardActions');
  const permissions = session?.user?.permissions ?? [];

  // A row nobody can act on is noise — and worse, it points at a page that
  // would then refuse to open.
  const visible = items.filter(
    (item) => !item.permission || hasPermission(permissions, item.permission),
  );

  if (visible.length === 0) {
    return (
      <Card className="border-emerald-600/25 bg-emerald-500/[0.06]">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = visible.reduce((sum, item) => sum + item.count, 0);
  const hasOverdue = visible.some((item) => item.tone === 'overdue');

  return (
    <Card
      className={cn(
        'overflow-hidden',
        hasOverdue
          ? 'border-destructive/35 bg-destructive/[0.04]'
          : 'border-amber-600/30 bg-amber-500/[0.05]',
      )}
    >
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-3">
          {hasOverdue ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          ) : (
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div className="min-w-0">
            <h2
              className={cn(
                'text-base font-semibold',
                hasOverdue ? 'text-destructive' : 'text-amber-700 dark:text-amber-300',
              )}
            >
              {t('title', { count: total })}
            </h2>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>

        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
          {visible.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey as never)}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    item.tone === 'overdue'
                      ? 'text-destructive'
                      : 'text-amber-700 dark:text-amber-300',
                  )}
                >
                  {item.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
