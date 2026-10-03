import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { logout } from "../../actions";
import { LainnyaSpgClient } from "./LainnyaSpgClient";

export const dynamic = "force-dynamic";

export default async function LainnyaSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  return (
    <LainnyaSpgClient nama={session.user.name ?? session.user.email ?? ""} toko={toko.name} tokoId={toko.id} onLogout={logout} />
  );
}
