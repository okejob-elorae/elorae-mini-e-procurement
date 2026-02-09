'use client';

import { getETAStatus, ETAStatus } from '@/lib/eta-alerts';
import { POStatus } from '@/lib/constants/enums';
import { Badge } from '@/components/ui/badge';

interface ETABadgeProps {
  etaDate: Date | null;
  status: POStatus;
}

export function ETABadge({ etaDate, status }: ETABadgeProps) {
  const { status: alertStatus, message } = getETAStatus(etaDate, status);
  
  const colors: Record<ETAStatus, string> = {
    normal: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    danger: 'bg-red-100 text-red-800 border-red-200',
    completed: 'bg-gray-100 text-gray-800 border-gray-200'
  };
  
  return (
    <Badge 
      variant="outline" 
      className={colors[alertStatus]}
    >
      {message}
    </Badge>
  );
}
