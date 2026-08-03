"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { CartLine } from "@/lib/field-sales/cart";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Bottom sheet for the per-line "Ajukan Harga" affordance on the putus review — the salesman
 * cannot set the price directly, only ask for a requested price + reason; the office decides
 * the final price at approve (see docs/superpowers/specs/2026-07-30-field-sales-price-appeal-design.md).
 */
export function AppealPriceSheet({
  line,
  open,
  onOpenChange,
  onSave,
  onClear,
}: {
  line: CartLine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (requestedUnitPrice: number, appealReason: string) => void;
  onClear: () => void;
}) {
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (line && open) {
      setPrice(line.requestedUnitPrice != null ? String(line.requestedUnitPrice) : "");
      setReason(line.appealReason ?? "");
    }
  }, [line, open]);

  const parsedPrice = Number(price);
  const priceValid = price.trim() !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0;
  const reasonValid = reason.trim().length > 0;
  const canSave = priceValid && reasonValid;
  const hasExistingAppeal = line?.requestedUnitPrice != null;
  const label = line?.variantLabel ? `${line.nameId} ${line.variantLabel}` : line?.nameId ?? "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        {line && (
          <>
            <SheetHeader className="border-b pb-3">
              <SheetTitle>Ajukan Harga</SheetTitle>
              <SheetDescription>{label}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <p className="text-sm text-muted-foreground">
                Harga toko saat ini:{" "}
                <span className="font-medium text-foreground tabular-nums">{rupiah(line.unitPrice)}</span> / pcs
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="appeal-price">Harga yang diajukan</Label>
                <Input
                  id="appeal-price"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  placeholder="Contoh: 30000"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                {price.trim() !== "" && !priceValid && (
                  <p className="text-xs text-destructive">Harga harus lebih dari 0.</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="appeal-reason">Alasan pengajuan</Label>
                <Textarea
                  id="appeal-reason"
                  placeholder="Contoh: pelanggan minta harga grosir"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Wajib diisi — jadi pertimbangan kantor saat menyetujui.</p>
              </div>
            </div>

            <SheetFooter className="flex-row gap-2 border-t pt-3">
              {hasExistingAppeal && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-11"
                  onClick={() => {
                    onClear();
                    onOpenChange(false);
                  }}
                >
                  Batalkan
                </Button>
              )}
              <Button
                type="button"
                className="flex-1 h-11"
                disabled={!canSave}
                onClick={() => {
                  onSave(parsedPrice, reason.trim());
                  onOpenChange(false);
                }}
              >
                Simpan
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
