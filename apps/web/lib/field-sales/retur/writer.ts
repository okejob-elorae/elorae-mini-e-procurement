import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { FieldReturnError } from "./errors";
import { FIELD_RETURN_REASONS, type FieldReturnLineInput } from "./types";

type Line = FieldReturnLineInput;

/**
 * Line shape is validated here rather than trusted from the caller. `FieldReturnLine` has
 * NO database foreign key (relationMode = "prisma"), so an unchecked `itemId` is written
 * verbatim and the detail page — which includes the now-required `item` relation — throws
 * "Inconsistent query result" forever, with no UI path to repair the row.
 */
function assertLineShape(l: Line): void {
  if (typeof l?.itemId !== "string" || l.itemId.trim() === "") {
    throw new FieldReturnError("BAD_LINE_SHAPE");
  }
  if (typeof l.variantSku !== "string") throw new FieldReturnError("BAD_LINE_SHAPE");
  if (!FIELD_RETURN_REASONS.includes(l.reason)) throw new FieldReturnError("BAD_LINE_SHAPE");
  if (l.reasonNote !== undefined && l.reasonNote !== null && typeof l.reasonNote !== "string") {
    throw new FieldReturnError("BAD_LINE_SHAPE");
  }
}

export async function createFieldReturn(input: {
  storeId: string;
  visitId?: string | null;
  raisedById: string;
  transport: "SELF_CARRY" | "EXPEDITION";
  expeditionName?: string | null;
  resiNo?: string | null;
  notaPhotoUrl: string;
  notaPhotoR2Key: string;
  note?: string | null;
  lines: Line[];
}): Promise<{ returnId: string; docNo: string }> {
  if (input.lines.length === 0) throw new FieldReturnError("NO_LINES");
  for (const l of input.lines) {
    assertLineShape(l);
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new FieldReturnError("BAD_QTY");
    if (l.reason === "OTHER" && (l.reasonNote ?? "").trim() === "") {
      throw new FieldReturnError("MISSING_REASON_NOTE");
    }
  }
  if (input.transport === "EXPEDITION") {
    if ((input.expeditionName ?? "").trim() === "") {
      throw new FieldReturnError("MISSING_EXPEDITION_NAME");
    }
    if ((input.resiNo ?? "").trim() === "") throw new FieldReturnError("MISSING_RESI");
  }

  return runSerializable(async (tx) => {
    const store = await tx.store.findFirst({
      where: { id: input.storeId, isActive: true },
      select: { id: true },
    });
    if (!store) throw new FieldReturnError("STORE_NOT_FOUND");

    if (input.visitId) {
      const visit = await tx.storeVisit.findFirst({
        where: { id: input.visitId, storeId: input.storeId, userId: input.raisedById },
        select: { id: true },
      });
      if (!visit) throw new FieldReturnError("VISIT_NOT_OWNED");
    }

    const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
    const foundItems = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true },
    });
    if (foundItems.length !== itemIds.length) throw new FieldReturnError("ITEM_NOT_FOUND");

    const docNo = await generateDocNumber("FIELDRET", tx);
    const created = await tx.fieldReturn.create({
      data: {
        docNo,
        storeId: input.storeId,
        visitId: input.visitId ?? null,
        raisedById: input.raisedById,
        transport: input.transport,
        expeditionName: input.transport === "EXPEDITION" ? input.expeditionName?.trim() || null : null,
        resiNo: input.transport === "EXPEDITION" ? input.resiNo?.trim() || null : null,
        notaPhotoUrl: input.notaPhotoUrl,
        notaPhotoR2Key: input.notaPhotoR2Key,
        note: input.note?.trim() || null,
        lines: {
          create: input.lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            qty: l.qty,
            reason: l.reason,
            reasonNote: l.reasonNote?.trim() || null,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

    return { returnId: created.id, docNo: created.docNo };
  });
}
