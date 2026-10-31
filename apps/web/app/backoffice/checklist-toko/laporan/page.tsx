import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rentangLaporan } from "@/lib/salesman/checklist-toko";
import { daftarTemplateChecklist, laporanChecklist } from "@/lib/salesman/checklist-queries";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarArea } from "@/lib/stores/areas";
import { LaporanChecklistClient } from "./LaporanChecklistClient";

export const dynamic = "force-dynamic";

type Cari = { dari?: string; sampai?: string; area?: string; salesman?: string; template?: string };

const satu = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 64 ? x : null);

/**
 * Laporan eksekusi toko: skor daftar periksa terakhir per toko, tren lima
 * hasil terakhir, dan pertanyaan yang paling sering gagal. `stores:view`.
 */
export default async function LaporanChecklistPage({ searchParams }: { searchParams: Promise<Cari> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const cari = await searchParams;
  const r = rentangLaporan(cari.dari, cari.sampai, new Date());
  const saring = { area: satu(cari.area), salesman: satu(cari.salesman), template: satu(cari.template) };
  const [data, area, salesman, templat] = await Promise.all([
    laporanChecklist({ dari: r.dari, sampai: r.sampai, groupId: saring.area, salesmanId: saring.salesman, templateId: saring.template }),
    daftarArea(),
    daftarSalesman(),
    daftarTemplateChecklist(),
  ]);

  return (
    <LaporanChecklistClient
      data={data}
      saring={{ dari: r.dariStr, sampai: r.sampaiStr, ...saring }}
      pilihan={{
        area: area.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
        salesman: salesman.map((s) => ({ id: s.id, label: s.nama })),
        template: templat.map((t) => ({ id: t.id, label: t.nama })),
      }}
    />
  );
}
