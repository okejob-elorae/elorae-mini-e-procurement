import { prisma } from '@elorae/db';
import { KUNCI_TINTA_DASAR, bacaTintaDasar, type TintaDasar } from './tinta-dasar';

export async function ambilTintaDasar(): Promise<TintaDasar[]> {
  const baris = await prisma.systemSetting.findUnique({
    where: { key: KUNCI_TINTA_DASAR },
    select: { value: true },
  });
  return bacaTintaDasar(baris?.value ?? null);
}
