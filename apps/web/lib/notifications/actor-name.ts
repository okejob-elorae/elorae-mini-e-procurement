import { prisma } from "@elorae/db";

/**
 * Resolve display name for the actor (for "by X" in notification body).
 */
export async function getActorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) return "Unknown";
  return (user.name?.trim() || user.email) ?? "Unknown";
}
