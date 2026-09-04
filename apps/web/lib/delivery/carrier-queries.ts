import { prisma } from "@elorae/db";

export async function listCarrierCandidates(): Promise<Array<{ id: string; name: string }>> {
  const users = await prisma.user.findMany({
    where: {
      roleDefinition: {
        isSystem: false,
        AND: [
          { permissions: { some: { permission: { code: "deliveries:pod" } } } },
          { permissions: { some: { permission: { code: "pwa:access" } } } },
        ],
      },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}
