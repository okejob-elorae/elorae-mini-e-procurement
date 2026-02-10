'use client';

import { useEffect, useRef, useState, useId, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { X, Camera } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  width?: number;
}

export function BarcodeScanner({ onScan, onError, onClose, width = 300 }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const id = useId();
  const elementId = 'barcode-scanner-' + id.replace(/:/g, '-');
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasError, setHasError] = useState(false);

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        scannerRef.current = null;
      }
    } catch (_err) {
      // Ignore stop errors
    }
  }, []);

  useEffect(() => {
    const initScanner = async () => {
      try {
        scannerRef.current = new Html5Qrcode(elementId);

        await scannerRef.current.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1
          },
          (decodedText) => {
            onScan(decodedText);
            stopScanner();
          },
          (_errorMessage) => {
            // Ignore continuous scanning errors (no barcode in frame)
          }
        );

        setIsInitialized(true);
      } catch (err: unknown) {
        console.error('Scanner init error:', err);
        setHasError(true);
        onError?.(err instanceof Error ? err.message : 'Failed to start camera');
      }
    };

    initScanner();

    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; onScan/onError are callbacks
  }, [elementId, stopScanner]);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-muted rounded-lg">
        <Camera className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground text-center">
          Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.
        </p>
        {onClose && (
          <Button variant="outline" onClick={onClose} className="mt-4">
            Tutup
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div 
        id={elementId} 
        style={{ width: width, height: width * 0.75 }}
        className="rounded-lg overflow-hidden bg-black"
      />
      {onClose && (
        <Button
          variant="destructive"
          size="icon"
          className="absolute top-2 right-2"
          onClick={() => {
            stopScanner();
            onClose();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      {!isInitialized && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <p className="text-white text-sm">Memuat kamera...</p>
        </div>
      )}
    </div>
  );
}

// Hook for using barcode scanner
export function useBarcodeScanner() {
  const [scannedValue, setScannedValue] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const startScanning = () => {
    setIsScanning(true);
    setScannedValue(null);
  };

  const stopScanning = () => {
    setIsScanning(false);
  };

  const handleScan = (value: string) => {
    setScannedValue(value);
    setIsScanning(false);
  };

  return {
    scannedValue,
    isScanning,
    startScanning,
    stopScanning,
    handleScan
  };
}
