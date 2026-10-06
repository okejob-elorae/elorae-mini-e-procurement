import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarArea } from "@/lib/stores/areas";
import { listStores } from "@/lib/stores/queries";
import { bacaKelas } from "@/lib/stores/kelas-toko";
import { listPendingStoreChangeStoreIds } from "@/lib/store-changes/queries";
import { jumlahUsulanMenunggu } from "@/lib/stores/usulan-queries";
import { idTokoPerubahanMenunggu } from "@/lib/dashboard/antrean-kantor";
import { StoreListClient } from "./StoreListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    showInactive?: string;
    page?: string;
    pageSize?: string;
    area?: string;
    sales?: string;
    kelas?: string;
    /** "menunggu": hanya toko yang perubahan datanya menunggu ditinjau (tautan Beranda). */
    perubahan?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export default async function StoresPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const search = sp.search?.trim() ?? "";
  const showInactive = sp.showInactive === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);
  const area = sp.area?.trim() || "";
  const sales = sp.sales?.trim() || "";
  // Saringan kelas: A/B/C, atau "TANPA" untuk toko yang belum diberi kelas.
  const kelas = sp.kelas === "TANPA" ? "TANPA" : bacaKelas(sp.kelas) ?? "";
  const perubahan = sp.perubahan === "menunggu";

  const saring: Parameters<typeof listStores>[0] = {
    search: search || undefined,
    groupId: area || undefined,
    salesmanId: sales || undefined,
    storeClass: kelas || undefined,
  };
  const [idPerubahan, areas, salesmen] = await Promise.all([idTokoPerubahanMenunggu(), daftarArea(), daftarSalesman()]);
  /*
   * Saringan perubahan: toko aktif maupun nonaktif — angka Beranda menghitung
   * setiap permintaan yang menunggu (paling banyak satu per toko). Hanya di
   * saringan ini seluruh toko dibaca, lalu disaring dan dipotong per halaman.
   */
  const { items, totalCount } = perubahan
    ? await (async () => {
        const menunggu = new Set(idPerubahan);
        const semua = (await listStores({ ...saring, activeOnly: false })).items.filter((s) => menunggu.has(s.id));
        return { items: semua.slice((page - 1) * pageSize, page * pageSize), totalCount: semua.length };
      })()
    : await listStores({ ...saring, activeOnly: !showInactive }, { page, pageSize });

  const [pendingSet, usulanMenunggu] = await Promise.all([
    listPendingStoreChangeStoreIds(items.map((s) => s.id)),
    jumlahUsulanMenunggu(),
  ]);

  // Nama pemegang: dari daftar sales, ditambah pemegang yang perannya sudah
  // bukan sales lagi — tokonya tetap harus menyebut siapa yang memegang.
  const namaPemegang: Record<string, string> = Object.fromEntries(salesmen.map((s) => [s.id, s.nama]));
  const belumDikenal = [...new Set(items.map((s) => s.salesmanId).filter((id): id is string => !!id && !namaPemegang[id]))];
  if (belumDikenal.length) {
    const lain = await prisma.user.findMany({ where: { id: { in: belumDikenal } }, select: { id: true, name: true, email: true } });
    for (const u of lain) namaPemegang[u.id] = u.name ?? u.email;
  }

  return (
    <StoreListClient
      stores={items}
      totalCount={totalCount}
      search={search}
      showInactive={showInactive}
      page={page}
      pageSize={pageSize}
      pendingStoreIds={Array.from(pendingSet)}
      areas={areas}
      salesmen={salesmen}
      namaPemegang={namaPemegang}
      areaFilter={area}
      salesFilter={sales}
      kelasFilter={kelas}
      bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)}
      usulanMenunggu={usulanMenunggu}
      perubahanMenunggu={perubahan}
      jumlahPerubahan={idPerubahan.length}
    />
  );
}
