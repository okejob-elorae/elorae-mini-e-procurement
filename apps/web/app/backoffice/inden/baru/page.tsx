import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pilihanBarangInden } from "@/lib/field-sales/inden-queries";
import { IndenBaruClient } from "./IndenBaruClient";

export const dynamic = "force-dynamic";

export default async function IndenBaruPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");
  // Membuat pre-order = keputusan atas pesanan toko; yang hanya boleh melihat kembali ke daftar.
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) redirect("/backoffice/inden");

  return <IndenBaruClient pilihan={await pilihanBarangInden()} />;
}
