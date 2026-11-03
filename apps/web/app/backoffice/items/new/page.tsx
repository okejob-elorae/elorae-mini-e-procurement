import { redirect } from 'next/navigation';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { aturanDariKolom } from "@/lib/items/rekomendasi-harga";
import { NewItemPageClient } from './NewItemPageClient';

export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const session = await auth();
  if (!session) redirect('/login');
  // Pasangan markup/margin bawaan dan bantalan margin bawaan (Pengaturan Jubelio): rekomendasi
  // harga di formulir menyebut kekurangannya dengan benar walau barang baru belum punya HPP.
  const bawaan = await prisma.jubelioPushDefaults.findFirst({
    select: { defaultMarginPercent: true, defaultPriceRuleBasis: true, defaultAdditionalCost: true },
  });
  return (
    <NewItemPageClient
      bawaanRekomendasi={{
        aturan: aturanDariKolom(bawaan?.defaultMarginPercent, bawaan?.defaultPriceRuleBasis),
        biaya: bawaan?.defaultAdditionalCost != null ? Number(bawaan.defaultAdditionalCost) : null,
      }}
      // Membuat barang = items:create (P76): centang saluran dikunci persis ketika simpan tidak boleh.
      bolehSimpan={hasPermission(session.user?.permissions ?? [], PERMISSIONS.ITEMS_CREATE)}
    />
  );
}
