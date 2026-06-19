import { prisma } from "@elorae/db";

export async function getSalesReturnById(id: string) {
  return prisma.salesReturn.findUnique({
    where: { id },
    include: {
      salesOrder: { select: { id: true, salesorderNo: true } },
      decidedBy: { select: { name: true, email: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { sku: true, nameId: true, nameEn: true } },
          decidedBy: { select: { name: true } },
        },
      },
    },
  });
}

export type SalesReturnDetail = NonNullable<Awaited<ReturnType<typeof getSalesReturnById>>>;
