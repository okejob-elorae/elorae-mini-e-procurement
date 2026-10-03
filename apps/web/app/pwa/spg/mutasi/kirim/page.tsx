import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { aturanMutasi, dijanjikanMutasi, tujuanMutasi } from "@/lib/spg/mutasi-queries";
import { stokToko, tokoSpg } from "@/lib/spg/queries";
import { kunciBaris } from "@/lib/spg/stok";
import { getActiveVisit } from "@/lib/stores/queries";
import type { BarisPilihan } from "../../stok/barang-pilihan";
import { FormKirimMutasi } from "./FormKirimMutasi";

export const dynamic = "force-dynamic";

/**
 * Formulir mengajukan mutasi dari toko SPG ke toko lain. Barang dipilih dari
 * buku stok toko ini saja — yang tidak pernah ada di rak tidak bisa dikirim.
 * Tujuan disaring dengan aturan yang sama dengan penulisnya.
 */
export default async function SpgKirimMutasiPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const aturan = await aturanMutasi();
  const [stok, dijanjikan, tujuan, aktif] = await Promise.all([
    stokToko(toko.id),
    dijanjikanMutasi(toko.id),
    tujuanMutasi(toko.id, aturan),
    getActiveVisit(session.user.id),
  ]);

  const pilihan: (BarisPilihan & { dijanjikan: number })[] = stok.map((b) => {
    const kunci = kunciBaris(b.itemId, b.variantSku);
    return {
      kunci,
      itemId: b.itemId,
      sku: b.sku,
      variantSku: b.variantSku || null,
      kode: b.sku,
      nama: b.nama,
      varian: b.varian,
      barcode: null,
      stok: b.qty,
      dilacak: true,
      dijanjikan: dijanjikan.get(kunci) ?? 0,
    };
  });

  const kunjungan = aktif && aktif.storeId === toko.id ? { id: aktif.id, checkinAtMs: aktif.checkinAt.getTime() } : null;

  return (
    <FormKirimMutasi
      storeId={toko.id}
      kunjunganServer={kunjungan}
      namaToko={toko.name}
      aktif={aturan.aktif}
      modeSaldo={aturan.saldo}
      sudahCheckIn={kunjungan !== null}
      bukuAda={stok.length > 0}
      tujuan={tujuan.map((x) => ({ id: x.id, name: x.name, punyaSpg: x.punyaSpg, langsung: x.keputusan === "LANGSUNG" }))}
      pilihan={pilihan}
    />
  );
}
