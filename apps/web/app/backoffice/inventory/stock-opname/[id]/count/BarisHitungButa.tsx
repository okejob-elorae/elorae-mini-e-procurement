"use client";

import { memo, useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { CountStepperInput } from "@/components/inventory/CountStepperInput";
import { cn } from "@/lib/utils";

/*
 * Baris layar hitung opname gudang — hitungan BUTA: angka sistem (snapshot)
 * tidak ditampilkan, supaya penghitung mencatat yang ada di rak, bukan
 * mencocokkan dengan angka. Angka sistem dan selisihnya tampil di halaman
 * persetujuan opname.
 */

/**
 * Isian yang sedang diketik; mengikuti nilai tersimpan setiap kali nilai itu
 * berubah (mis. +1 dari pemindai) — tanpa setState di dalam efek.
 */
function useDraf(value: string) {
  const [nilai, ubah] = useState(value);
  const [asal, setAsal] = useState(value);
  if (asal !== value) {
    setAsal(value);
    ubah(value);
  }
  return { nilai, ubah };
}

type BarisBarangProps = {
  rowId: string;
  itemName: string;
  sku: string;
  value: string;
  highlighted: boolean;
  onCommit: (rowId: string, value: string) => void;
  onRowRef: (rowId: string, el: HTMLTableRowElement | null) => void;
};

export const BarisHitungBarang = memo(function BarisHitungBarang({
  rowId,
  itemName,
  sku,
  value,
  highlighted,
  onCommit,
  onRowRef,
}: BarisBarangProps) {
  const draft = useDraf(value);

  return (
    <TableRow ref={(el) => onRowRef(rowId, el)} className={cn(highlighted && "bg-primary/10 animate-pulse")}>
      <TableCell>
        <div className="font-medium leading-snug">{itemName}</div>
        {sku ? <div className="text-muted-foreground font-mono text-xs mt-0.5">{sku}</div> : null}
      </TableCell>
      <TableCell>
        <CountStepperInput
          value={draft.nilai}
          onChange={draft.ubah}
          onBlur={() => onCommit(rowId, draft.nilai)}
          onStepChange={(next) => {
            draft.ubah(next);
            onCommit(rowId, next);
          }}
        />
      </TableCell>
    </TableRow>
  );
});

type BarisRolProps = {
  rowId: string;
  rollCode: string;
  value: string;
  highlighted: boolean;
  onCommit: (rowId: string, value: string) => void;
  onRowRef: (rowId: string, el: HTMLTableRowElement | null) => void;
};

export const BarisHitungRol = memo(function BarisHitungRol({
  rowId,
  rollCode,
  value,
  highlighted,
  onCommit,
  onRowRef,
}: BarisRolProps) {
  const draft = useDraf(value);

  return (
    <TableRow ref={(el) => onRowRef(rowId, el)} className={cn(highlighted && "bg-primary/10 animate-pulse")}>
      <TableCell className="font-mono text-sm">{rollCode}</TableCell>
      <TableCell>
        <CountStepperInput
          value={draft.nilai}
          step={0.01}
          onChange={draft.ubah}
          onBlur={() => onCommit(rowId, draft.nilai)}
          onStepChange={(next) => {
            draft.ubah(next);
            onCommit(rowId, next);
          }}
        />
      </TableCell>
    </TableRow>
  );
});
