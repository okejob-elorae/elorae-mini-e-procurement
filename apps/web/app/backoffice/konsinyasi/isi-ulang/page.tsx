import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDate } from "@/lib/date-only";
import { indeksLakuPerArea, saranPindah, type LakuDiToko } from "@/lib/konsinyasi/isi-ulang";
import { nilaiStokToko } from "@/lib/konsinyasi/stok-di-toko";
import { IsiUlangClient, type BarisTidakLaku, type TokoIsiUlang } from "./IsiUlangClient";

export const dynamic = "force-dynamic";

/**
 * Ringkasan isi ulang semua toko konsinyasi dan toko ber-SPG — baca saja.
 *
 * Isinya dua pertanyaan kantor: toko mana yang stoknya sudah menyentuh
 * minimum (berapa baris dan potong yang perlu dikirim), dan barang mana yang
 * diam di rak 60 hari padahal laku di toko lain se-area.
 */
export default async function IsiUlangPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");
  const sekarang = new Date();

  // Toko ber-SPG ikut walau PUTUS: buku stoknya sama-sama bisa dinilai.
  const spg = await prisma.user.findMany({
    where: { assignedStoreId: { not: null } },
    select: { assignedStoreId: true },
    distinct: ["assignedStoreId"],
  });
  const idSpg = spg.map((s) => s.assignedStoreId).filter((x): x is string => !!x);
  const toko = await prisma.store.findMany({
    where: { isActive: true, OR: [{ termsType: "KONSI" }, ...(idSpg.length ? [{ id: { in: idSpg } }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, termsType: true, groupId: true, group: { select: { code: true, name: true } } },
  });
  const penilaian = await nilaiStokToko(
    toko.map((s) => s.id),
    sekarang,
  );
  const adaSpg = new Set(idSpg);

  // Penjualan 60 hari per toko × barang (ukuran dijumlah) — bahan saran pindah.
  const laku: LakuDiToko[] = [];
  for (const s of toko) {
    const perBarang = new Map<string, number>();
    for (const b of penilaian.get(s.id)?.baris ?? []) perBarang.set(b.itemId, (perBarang.get(b.itemId) ?? 0) + b.soldLast60);
    for (const [itemId, terjual60] of perBarang) laku.push({ storeId: s.id, groupId: s.groupId, itemId, terjual60 });
  }
  const indeks = indeksLakuPerArea(laku);
  const namaToko = new Map(toko.map((s) => [s.id, s.name]));

  const daftar: TokoIsiUlang[] = toko.map((s) => {
    const n = penilaian.get(s.id);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      termsType: s.termsType,
      spg: adaSpg.has(s.id),
      area: s.group ? `${s.group.code} — ${s.group.name}` : null,
      source: n?.source ?? "TITIPAN",
      ringkas: n?.ringkas ?? { sku: 0, pcs: 0, minus: 0, hampirHabis: 0, tidakLaku: 0, barisIsiUlang: 0, pcsIsiUlang: 0, adaTarget: false },
      isiUlang: (n?.baris ?? [])
        .filter((b) => b.saranQty > 0)
        .map((b) => ({ nama: b.nama, varian: b.varian, qty: b.qty, saranQty: b.saranQty, kurangGudang: b.kurangGudang })),
    };
  });

  const tidakLaku: BarisTidakLaku[] = toko.flatMap((s) =>
    (penilaian.get(s.id)?.baris ?? [])
      .filter((b) => b.tanda.includes("TIDAK_LAKU"))
      .map((b) => {
        const tujuan = saranPindah(indeks, { storeId: s.id, groupId: s.groupId }, b.itemId);
        return {
          kunci: `${s.id}::${b.itemId}::${b.variantSku}`,
          storeId: s.id,
          storeName: s.name,
          nama: b.nama,
          varian: b.varian,
          qty: b.qty,
          perkiraan: b.perkiraan,
          terakhirLaku: b.lastSaleAt ? formatDisplayDate(b.lastSaleAt) : null,
          tujuan: tujuan ? { storeId: tujuan.storeId, storeName: namaToko.get(tujuan.storeId) ?? tujuan.storeId, terjual60: tujuan.terjual60 } : null,
        };
      }),
  );

  return (
    <IsiUlangClient
      toko={daftar}
      tidakLaku={tidakLaku}
      bolehAturTarget={hasPermission(perms, PERMISSIONS.STORES_MANAGE)}
    />
  );
}
