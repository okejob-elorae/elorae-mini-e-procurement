import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaParamPerforma } from "@/lib/creative/performa";
import { daftarPerformaVideo } from "@/lib/creative/performa-queries";
import { PerformaClient } from "./PerformaClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Kreatif → Performa video: views, like, komentar, share, simpan, dan ER per
 * video TikTok KOL dan afiliasi, dibaca ekstensi pemantau. Saringan, urutan,
 * dan halaman tinggal di alamat; daftar dan ringkasannya dihitung di server
 * (sampai puluhan ribu video). Melihat: `creative:view`; Tempel link:
 * `creative:manage`.
 */
export default async function PerformaPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const param = bacaParamPerforma(await searchParams);
  const data = await daftarPerformaVideo(param);
  return (
    <PerformaClient
      param={{ ...param, halaman: data.halaman }}
      data={data}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}
