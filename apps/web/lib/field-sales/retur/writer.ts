import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { FieldReturnError } from "./errors";

type Line = {
  itemId: string;
  variantSku: string;
  qty: number;
  reason: "DAMAGED" | "UNSOLD" | "EXPIRED" | "OTHER";
  reasonNote?: string | null;
};

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
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new FieldReturnError("BAD_QTY");
    if (l.reason === "OTHER" && (l.reasonNote ?? "").trim() === "") {
      throw new FieldReturnError("MISSING_REASON_NOTE");
    }
  }
  if (input.transport === "EXPEDITION" && (input.resiNo ?? "").trim() === "") {
    throw new FieldReturnError("MISSING_RESI");
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

    const docNo = await generateDocNumber("RET", tx);
    const created = await tx.fieldReturn.create({
      data: {
        docNo,
        storeId: input.storeId,
        visitId: input.visitId ?? null,
        raisedById: input.raisedById,
        transport: input.transport,
        expeditionName: input.expeditionName?.trim() || null,
        resiNo: input.resiNo?.trim() || null,
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
