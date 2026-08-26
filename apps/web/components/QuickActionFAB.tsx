'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Zap, ShoppingCart, ClipboardList, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const actions = [
  { labelKey: 'newPO', href: '/backoffice/purchase-orders/new', icon: ShoppingCart },
  { labelKey: 'newWO', href: '/backoffice/work-orders/new', icon: ClipboardList },
  { labelKey: 'newItem', href: '/backoffice/items/new', icon: Package },
];

/**
 * Quick actions, in the header rather than floating over the page.
 *
 * It used to be a fixed button in the bottom-right corner, which is exactly
 * where every list puts its pagination — so it sat on top of "Next" and
 * swallowed the click. Padding the page bottom only cleared it while scrolled
 * to the very end; mid-scroll and on short pages the collision came back,
 * measured with elementFromPoint on three controls at once.
 *
 * A header button cannot collide with anything, and it is where the primary
 * action lives in the rest of this product family.
 */
export function QuickActionFAB() {
  const t = useTranslations('quickActions');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 no-print" aria-label={t('quickAction')}>
          <Zap className="h-4 w-4" />
          <span className="hidden sm:inline">{t('quickAction')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuLabel>{t('quickAction')}</DropdownMenuLabel>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <DropdownMenuItem key={action.href} asChild>
              <Link href={action.href} className="flex cursor-pointer items-center gap-2">
                <Icon className="h-4 w-4" />
                {t(action.labelKey as never)}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
