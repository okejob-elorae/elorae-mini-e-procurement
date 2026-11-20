import { z } from "zod";
import { prisma } from "@elorae/db";

export const createServiceTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
});

export const updateServiceTypeSchema = createServiceTypeSchema.partial();

export class ServiceTypeError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "IN_USE",
    message: string,
    readonly count = 0,
  ) {
    super(message);
    this.name = "ServiceTypeError";
  }
}

function rapikanKode(code: string): string {
  return code.trim().toUpperCase();
}

export async function createServiceType(input: z.infer<typeof createServiceTypeSchema>) {
  const validated = createServiceTypeSchema.parse({ ...input, code: rapikanKode(input.code ?? "") });
  const existing = await prisma.serviceType.findUnique({ where: { code: validated.code } });
  if (existing) throw new ServiceTypeError("DUPLICATE_CODE", "A service type with this code already exists");
  return prisma.serviceType.create({
    data: {
      code: validated.code,
      name: validated.name,
      isActive: validated.isActive,
      sortOrder: validated.sortOrder,
    },
  });
}

export async function updateServiceType(id: string, input: z.infer<typeof updateServiceTypeSchema>) {
  const validated = updateServiceTypeSchema.parse(
    input.code === undefined ? input : { ...input, code: rapikanKode(input.code) },
  );
  if (validated.code) {
    const existing = await prisma.serviceType.findFirst({
      where: { code: validated.code, id: { not: id } },
    });
    if (existing) throw new ServiceTypeError("DUPLICATE_CODE", "A service type with this code already exists");
  }
  return prisma.serviceType.update({ where: { id }, data: validated });
}

export async function deleteServiceType(id: string) {
  const inUse = await prisma.workOrderStep.count({ where: { serviceTypeId: id } });
  if (inUse > 0) throw new ServiceTypeError("IN_USE", "Cannot delete service type in use", inUse);
  await prisma.serviceType.delete({ where: { id } });
}
