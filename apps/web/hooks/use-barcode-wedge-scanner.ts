"use client";

import { useCallback, useEffect, useRef } from "react";

type UseBarcodeWedgeScannerOptions = {
  enabled?: boolean;
  onScan: (code: string) => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * Captures keyboard-wedge barcode scanner input (keystrokes + Enter).
 * Use the returned scan input when focused, or scan globally when no field is focused.
 */
export function useBarcodeWedgeScanner({
  enabled = true,
  onScan,
}: UseBarcodeWedgeScannerOptions) {
  const bufferRef = useRef("");
  const scanInputRef = useRef<HTMLInputElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const emitScan = useCallback((code: string) => {
    const trimmed = code.trim();
    if (trimmed.length > 0) {
      onScanRef.current(trimmed);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target === scanInputRef.current) {
        return;
      }

      if (isEditableTarget(e.target)) {
        bufferRef.current = "";
        return;
      }

      if (e.key === "Enter") {
        if (bufferRef.current.length > 0) {
          e.preventDefault();
          emitScan(bufferRef.current);
          bufferRef.current = "";
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, emitScan]);

  const onScanInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        emitScan(e.currentTarget.value);
        e.currentTarget.value = "";
      }
    },
    [emitScan],
  );

  const focusScanInput = useCallback(() => {
    scanInputRef.current?.focus();
  }, []);

  return { scanInputRef, onScanInputKeyDown, focusScanInput };
}
