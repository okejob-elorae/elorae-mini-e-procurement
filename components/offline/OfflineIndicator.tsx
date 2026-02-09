'use client';

import { useState, useEffect } from 'react';
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
      toast.success('Back online');
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline');
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
      toast.error('Cannot sync while offline');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncPendingOperations();
      if (result.success > 0) {
        toast.success(`Synced ${result.success} operations`);
      }
      if (result.failed > 0) {
        toast.error(`Failed to sync ${result.failed} operations`);
      }
      if (result.success === 0 && result.failed === 0) {
        toast.info('Nothing to sync');
      }
      const status = await getSyncStatus();
      setPendingCount(status.pendingCount);
      setPendingPOCount(status.pendingPOCount || 0);
    } catch (error) {
      toast.error('Sync failed');
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
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            <span className="text-sm">
              {isOnline ? 'Online' : 'Offline'}
              {pendingCount + pendingPOCount > 0 && ` (${pendingCount + pendingPOCount} pending)`}
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
                ? `Click to sync ${pendingCount + pendingPOCount} pending operations`
                : 'All changes synced'
              : 'Working offline - changes will sync when connection is restored'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
