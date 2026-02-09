'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface PinAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (pin: string) => Promise<void>;
  action: string;
}

export function PinAuthModal({ isOpen, onClose, onConfirm, action }: PinAuthModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('PIN minimal 4 digit');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await onConfirm(pin);
      setPin('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'PIN tidak valid');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setPin('');
        setError('');
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Autentikasi Diperlukan</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Masukkan PIN Anda untuk {action}
          </p>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin((e.target?.value ?? '').replace(/\D/g, ''))}
            onKeyDown={handleKeyDown}
            placeholder="****"
            className="text-center text-2xl tracking-widest"
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setPin('');
                setError('');
                onClose();
              }} 
              className="flex-1"
              disabled={loading}
            >
              Batal
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={loading || pin.length < 4}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Memverifikasi...
                </>
              ) : (
                'Konfirmasi'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
