import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarArea } from "@/lib/stores/areas";
import { cekDuplikatUsulan, detailUsulan, semuaKodeToko } from "@/lib/stores/usulan-queries";
import { saranKodeToko } from "@/lib/stores/usulan-toko";
import { DetailUsulanClient } from "./DetailUsulanClient";

export const dynamic = "force-dynamic";

export default async function DetailUsulanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const u = await detailUsulan(id);
  if (!u) notFound();

  const bolehKelola = hasPermission(perms, PERMISSIONS.STORES_MANAGE);
  const menunggu = u.status === "PENDING";
  const [kandidat, area, salesmen, kode] = await Promise.all([
    // Dihitung ulang SEKARANG, bukan disalin dari saat diajukan: toko bisa saja
    // didaftarkan lewat jalur lain sejak itu. Usulan ini sendiri dan toko
    // hasilnya tidak dihitung sebagai kembarannya.
    cekDuplikatUsulan({ name: u.name, lat: u.lat, lng: u.lng }, { kecualiUsulanId: u.id, kecualiTokoId: u.store?.id ?? null }),
    menunggu && bolehKelola ? daftarArea() : Promise.resolve([]),
    menunggu && bolehKelola ? daftarSalesman() : Promise.resolve([]),
    menunggu && bolehKelola ? semuaKodeToko() : Promise.resolve([]),
  ]);
  const areaAktif = area.filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name }));

  return (
    <DetailUsulanClient
      usulan={{
        id: u.id,
        name: u.name,
        address: u.address,
        phone: u.phone,
        contactName: u.contactName,
        termsType: u.termsType,
        area: u.area ? `${u.area.code} — ${u.area.name}` : null,
        lat: u.lat,
        lng: u.lng,
        photoUrl: u.photoUrl,
        note: u.note,
        status: u.status,
        pengusul: u.pengusul,
        diajukan: formatDisplayDateTime(u.createdAt),
        reviewer: u.reviewer,
        diputuskan: u.reviewedAt ? formatDisplayDateTime(u.reviewedAt) : null,
        reviewNote: u.reviewNote,
        store: u.store,
      }}
      kandidat={kandidat.map(({ jenis, id: kid, code, name, address, aktif, namaMirip, jarakMeter }) => ({
        jenis,
        id: kid,
        code,
        name,
        address,
        aktif,
        namaMirip,
        jarakMeter,
      }))}
      bolehKelola={bolehKelola}
      formulir={
        menunggu && bolehKelola
          ? {
              area: areaAktif,
              salesmen,
              saranKode: saranKodeToko(kode),
              // Area usulan dipakai hanya bila masih aktif; pemegang bawaan = pengusul bila ia sales.
              groupId: u.groupId && areaAktif.some((a) => a.id === u.groupId) ? u.groupId : null,
              salesmanId: salesmen.some((s) => s.id === u.proposedById) ? u.proposedById : null,
            }
          : null
      }
    />
  );
}
