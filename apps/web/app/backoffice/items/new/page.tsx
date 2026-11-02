import { redirect } from 'next/navigation';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { NewItemPageClient } from './NewItemPageClient';

export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const session = await auth();
  if (!session) redirect('/login');
  // Margin dan biaya tambahan bawaan (Pengaturan Jubelio): rekomendasi harga di formulir menyebut
  // kekurangannya dengan benar walau barang baru belum punya HPP.
  const bawaan = await prisma.jubelioPushDefaults.findFirst({
    select: { defaultMarginPercent: true, defaultAdditionalCost: true },
  });
  return (
    <NewItemPageClient
      bawaanRekomendasi={{
        margin: bawaan?.defaultMarginPercent != null ? Number(bawaan.defaultMarginPercent) : null,
        biaya: bawaan?.defaultAdditionalCost != null ? Number(bawaan.defaultAdditionalCost) : null,
      }}
    />
  );
}
