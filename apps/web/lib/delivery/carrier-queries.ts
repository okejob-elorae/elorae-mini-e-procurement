import { prisma } from "@elorae/db";
import type { Prisma } from "@elorae/db";

/**
 * Who may carry a SALESMAN_CARRY shipment: a non-system role holding both `deliveries:pod` and
 * `pwa:access`. The single definition behind the admin combobox and the writer's validation, so
 * the list can never offer a user the write then refuses.
 */
export function carrierEligibilityWhere(): Prisma.UserWhereInput {
  return {
    roleDefinition: {
      isSystem: false,
      AND: [
        { permissions: { some: { permission: { code: "deliveries:pod" } } } },
        { permissions: { some: { permission: { code: "pwa:access" } } } },
      ],
    },
  };
}

export async function listCarrierCandidates(): Promise<Array<{ id: string; name: string }>> {
  const users = await prisma.user.findMany({
    where: carrierEligibilityWhere(),
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

export async function isEligibleCarrier(
  client: Pick<typeof prisma, "user">,
  userId: string,
): Promise<boolean> {
  const count = await client.user.count({ where: { AND: [{ id: userId }, carrierEligibilityWhere()] } });
  return count > 0;
}
