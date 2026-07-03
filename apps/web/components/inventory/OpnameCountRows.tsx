"use client";

import { memo, useEffect, useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { CountStepperInput } from "@/components/inventory/CountStepperInput";
import { cn } from "@/lib/utils";

type OpnameItemCountRowProps = {
  rowId: string;
  itemName: string;
  sku: string;
  snapshotQty: number;
  value: string;
  highlighted: boolean;
  onCommit: (rowId: string, value: string) => void;
  onRowRef: (rowId: string, el: HTMLTableRowElement | null) => void;
};

export const OpnameItemCountRow = memo(function OpnameItemCountRow({
  rowId,
  itemName,
  sku,
  snapshotQty,
  value,
  highlighted,
  onCommit,
  onRowRef,
}: OpnameItemCountRowProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <TableRow
      ref={(el) => onRowRef(rowId, el)}
      className={cn(highlighted && "bg-primary/10 animate-pulse")}
    >
      <TableCell>
        <div className="font-medium leading-snug">{itemName}</div>
        {sku ? (
          <div className="text-muted-foreground font-mono text-xs mt-0.5">{sku}</div>
        ) : null}
      </TableCell>
      <TableCell>{snapshotQty}</TableCell>
      <TableCell>
        <CountStepperInput
          value={draft}
          onChange={setDraft}
          onBlur={() => onCommit(rowId, draft)}
          onStepChange={(next) => {
            setDraft(next);
            onCommit(rowId, next);
          }}
        />
      </TableCell>
    </TableRow>
  );
});

type OpnameRollCountRowProps = {
  rowId: string;
  rollCode: string;
  snapshotLength: number;
  value: string;
  highlighted: boolean;
  onCommit: (rowId: string, value: string) => void;
  onRowRef: (rowId: string, el: HTMLTableRowElement | null) => void;
};

export const OpnameRollCountRow = memo(function OpnameRollCountRow({
  rowId,
  rollCode,
  snapshotLength,
  value,
  highlighted,
  onCommit,
  onRowRef,
}: OpnameRollCountRowProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <TableRow
      ref={(el) => onRowRef(rowId, el)}
      className={cn(highlighted && "bg-primary/10 animate-pulse")}
    >
      <TableCell className="font-mono text-sm">{rollCode}</TableCell>
      <TableCell>{snapshotLength}</TableCell>
      <TableCell>
        <CountStepperInput
          value={draft}
          step={0.01}
          onChange={setDraft}
          onBlur={() => onCommit(rowId, draft)}
          onStepChange={(next) => {
            setDraft(next);
            onCommit(rowId, next);
          }}
        />
      </TableCell>
    </TableRow>
  );
});
