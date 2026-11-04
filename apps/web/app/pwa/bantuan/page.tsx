import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { BantuanHp } from "./BantuanHp";

export const dynamic = "force-dynamic";

export default async function BantuanHpPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice/bantuan");
  const spg = (await ambilTokoTetap(session.user.id)) !== null;
  return (
    <BantuanHp
      kembaliKe={spg ? "/pwa/spg/lainnya" : "/pwa/lainnya"}
      bagian={spg ? ["pwaBersama", "pwaSpg"] : ["pwaBersama", "pwaSalesman"]}
    />
  );
}
