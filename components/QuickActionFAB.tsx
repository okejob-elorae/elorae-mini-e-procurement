'use client';

import Link from 'next/link';
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
  { label: 'New Purchase Order', href: '/backoffice/purchase-orders/new', icon: ShoppingCart },
  { label: 'Create Work Order', href: '/backoffice/work-orders/new', icon: ClipboardList },
  { label: 'Create New Item', href: '/backoffice/items/new', icon: Package },
];

export function QuickActionFAB() {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
            aria-label="Quick actions"
          >
            <Zap className="h-6 w-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8}>
          <DropdownMenuLabel>Quick Action</DropdownMenuLabel>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <DropdownMenuItem key={action.href} asChild>
                <Link
                  href={action.href}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
