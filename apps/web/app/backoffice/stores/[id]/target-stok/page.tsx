import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseItemVariants } from "@/lib/items/variants";
import { kunciStok } from "@/lib/konsinyasi/isi-ulang";
import { labelVarian, nilaiStokToko } from "@/lib/konsinyasi/stok-di-toko";
import { TargetStokClient, type BlokTarget } from "./TargetStokClient";

export const dynamic = "force-dynamic";

/**
 * Editor target stok min/maks per ukuran untuk satu toko.
 *
 * Yang tampil: setiap barang yang pernah ada di toko ini (menurut sumber stok
 * toko itu) atau yang sudah bertarget — lengkap dengan SEMUA ukurannya, karena
 * ukuran yang belum pernah dikirim justru yang paling mungkin perlu target.
 */
export default async function TargetStokPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const { id } = await params;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) redirect(`/backoffice/stores/${id}`);

  const store = await prisma.store.findUnique({ where: { id }, select: { id: true, name: true, code: true, termsType: true } });
  if (!store) notFound();

  const penilaian = (await nilaiStokToko([store.id])).get(store.id);
  const baris = penilaian?.baris ?? [];
  const itemIds = [...new Set(baris.map((b) => b.itemId))];
  const items = itemIds.length
    ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, nameId: true, variants: true } })
    : [];
  const perKunci = new Map(baris.map((b) => [kunciStok(b.itemId, b.variantSku), b]));

  const blok: BlokTarget[] = items
    .map((i) => {
      const skuVarian = parseItemVariants(i.variants)
        .map((v) => (v.sku ?? "").trim())
        .filter(Boolean);
      // Ukuran dari master + ukuran yang tercatat di toko/target (bisa saja SKU
      // lama yang sudah tidak ada di master — targetnya tetap harus bisa diatur).
      const semua = new Set<string>(skuVarian.length ? skuVarian : [""]);
      for (const b of baris) if (b.itemId === i.id) semua.add(b.variantSku);
      return {
        itemId: i.id,
        sku: i.sku,
        nama: i.nameId,
        baris: [...semua].map((variantSku) => {
          const b = perKunci.get(kunciStok(i.id, variantSku));
          return {
            variantSku,
            label: labelVarian(i.variants, variantSku),
            qty: b ? b.qty : null,
            soldLast30: b?.soldLast30 ?? 0,
            perkiraan: b?.perkiraan ?? false,
            minQty: b?.target?.minQty ?? null,
            maxQty: b?.target?.maxQty ?? null,
          };
        }),
      };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama));

  return (
    <TargetStokClient
      store={{ id: store.id, name: store.name, code: store.code, termsType: store.termsType }}
      source={penilaian?.source ?? "TITIPAN"}
      blok={blok}
    />
  );
}
