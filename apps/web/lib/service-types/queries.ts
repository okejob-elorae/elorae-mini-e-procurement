import { prisma } from "@elorae/db";
import type { Prisma } from "@elorae/db";

export async function listServiceTypes(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
  withUsage?: boolean;
}) {
  const where: Prisma.ServiceTypeWhereInput = opts?.activeOnly ? { isActive: true } : {};
  const pageSize = opts?.pageSize ?? 0;
  const page = opts?.page ?? 1;

  if (pageSize > 0) {
    const [data, totalCount] = await Promise.all([
      prisma.serviceType.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        include: opts?.withUsage ? { _count: { select: { steps: true } } } : undefined,
      }),
      prisma.serviceType.count({ where }),
    ]);
    return { data, totalCount };
  }

  return prisma.serviceType.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

export async function getServiceTypeById(id: string) {
  return prisma.serviceType.findUnique({ where: { id } });
}
