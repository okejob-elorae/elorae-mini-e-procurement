'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { WifiOff, Wifi, Loader2 } from 'lucide-react';
import { isOnline } from '@/lib/offline/sync';

interface OfflinePOButtonProps {
  onSaveLocally: () => Promise<void>;
  onSubmit: () => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
}

export function OfflinePOButton({ 
  onSaveLocally, 
  onSubmit,
  disabled,
  isLoading = false
}: OfflinePOButtonProps) {
  const [isOnlineState, setIsOnlineState] = useState(true);

  useEffect(() => {
    setIsOnlineState(isOnline());
    
    const handleOnline = () => setIsOnlineState(true);
    const handleOffline = () => setIsOnlineState(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleClick = async () => {
    if (isOnlineState) {
      await onSubmit();
    } else {
      await onSaveLocally();
    }
  };

  return (
    <Button 
      onClick={handleClick} 
      disabled={disabled || isLoading}
      variant={isOnlineState ? "default" : "secondary"}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Menyimpan...
        </>
      ) : isOnlineState ? (
        <>
          <Wifi className="w-4 h-4 mr-2" />
          Simpan & Kirim
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 mr-2" />
          Simpan Lokal
        </>
      )}
    </Button>
  );
}
