'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getSyncStatus, syncPendingOperations } from '@/lib/offline/sync';
import { toast } from 'sonner';

export function OfflineIndicator() {
  const tToasts = useTranslations('toasts');
  const tOffline = useTranslations('offline');
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPOCount, setPendingPOCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      const status = await getSyncStatus();
      setIsOnline(status.isOnline);
      setPendingCount(status.pendingCount);
      setPendingPOCount(status.pendingPOCount || 0);
    };

    checkStatus();

    const handleOnline = () => {
      setIsOnline(true);
      toast.success(tToasts('backOnline'));
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning(tToasts('youAreOffline'));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(checkStatus, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const handleSync = async () => {
    if (!isOnline) {
      toast.error(tToasts('cannotSyncWhileOffline'));
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncPendingOperations();
      if (result.success > 0) {
        toast.success(tToasts('syncedOperations', { count: result.success }));
      }
      if (result.failed > 0) {
        toast.error(tToasts('failedToSyncOperations', { count: result.failed }));
      }
      if (result.success === 0 && result.failed === 0) {
        toast.info(tToasts('nothingToSync'));
      }
      const status = await getSyncStatus();
      setPendingCount(status.pendingCount);
      setPendingPOCount(status.pendingPOCount || 0);
    } catch (_error) {
      toast.error(tToasts('syncFailed'));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleSync}
            disabled={isSyncing || !isOnline}
          >
            {isOnline ? (
              <Wifi className="h-4 w-4 text-green-500 dark:text-green-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            <span className="text-sm">
              {isOnline ? tOffline('online') : tOffline('offline')}
              {pendingCount + pendingPOCount > 0 && ` (${pendingCount + pendingPOCount} ${tOffline('pending')})`}
            </span>
            {pendingCount + pendingPOCount > 0 && isOnline && (
              <RefreshCw className={`h-3 w-3 ml-auto ${isSyncing ? 'animate-spin' : ''}`} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isOnline
              ? pendingCount + pendingPOCount > 0
                ? tOffline('clickToSyncPending', { count: pendingCount + pendingPOCount })
                : tOffline('allChangesSynced')
              : tOffline('workingOfflineMessage')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
