import { cache } from "react";
import { prisma } from "@elorae/db";

/**
 * Toko tetap milik SPG, atau null untuk salesman keliling.
 *
 * SPG dikenali dari `User.assignedStoreId`, bukan dari izinnya — sesi/JWT tidak
 * membawa kolom itu (lihat callback di `lib/auth.ts`). Di-cache per permintaan:
 * layout `/pwa` dan halaman berandanya sama-sama menanyakannya.
 */
export const ambilTokoTetap = cache(async (userId: string): Promise<string | null> => {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  return me?.assignedStoreId ?? null;
});
