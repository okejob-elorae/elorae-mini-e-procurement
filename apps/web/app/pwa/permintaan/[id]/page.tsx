import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { izinJarakJauh } from "@/lib/field-sales/jarak-jauh-toko";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianPermintaanMasuk } from "@/lib/spg/permintaan-salesman";
import { getActiveVisit } from "@/lib/stores/queries";
import { RincianPermintaanClient } from "./RincianPermintaanClient";

export const dynamic = "force-dynamic";

/**
 * Satu permintaan SPG di HP salesman. Terbuka untuk pemegang tokonya (dan
 * kantor, `stores:manage`); permintaan toko orang lain sama dengan tidak ada.
 *
 * "Buat pesanan" membuka katalog toko dengan keranjang terisi dari permintaan
 * ini (`?isi=permintaan:<id>`). Katalog hanya menerima pesanan dengan
 * kunjungan aktif di toko itu, atau sebagai pesanan jarak jauh bila aturan
 * pemilik mengizinkan — keduanya dinilai DI SINI supaya salesman tahu sebelum
 * mengisi keranjang.
 */
export default async function RincianPermintaanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");
  const userId = session.user.id;

  const { id } = await params;
  const kelola = hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE);
  const r = await rincianPermintaanMasuk(id, userId, { kelolaSemua: kelola });
  if (!r) notFound();

  const terbuka = r.status === "BARU" || r.status === "DIPROSES";
  const bisaPesan = terbuka && r.pemegang && !r.pesanan;
  const aktif = bisaPesan ? await getActiveVisit(userId) : null;
  const diToko = aktif?.storeId === r.toko.id;
  const jarakJauh = bisaPesan && !diToko ? await izinJarakJauh(r.toko.id, userId) : null;

  return (
    <RincianPermintaanClient
      // Tanggal diformat di server (WIB) — format di klien bisa berbeda antara Node dan Safari.
      rincian={{
        ...r,
        dibuatLabel: formatDisplayDateTime(r.dibuat),
        ditanganiLabel: r.ditangani.pada ? formatDisplayDateTime(r.ditangani.pada) : null,
      }}
      bolehUbah={terbuka && (r.pemegang || kelola)}
      pesan={bisaPesan ? { diToko, jarakJauh: jarakJauh?.boleh ?? false } : null}
    />
  );
}
