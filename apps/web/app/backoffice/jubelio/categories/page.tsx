import { getJubelioCategoryMappings } from "@/app/actions/jubelio-categories";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { CategoryMappingsClient } from "./CategoryMappingsClient";

export default async function JubelioCategoriesPage() {
  const [rows, session] = await Promise.all([getJubelioCategoryMappings(), auth()]);
  // The page opens with settings_security:view; saving needs :manage, the same permission
  // saveJubelioCategoryMappings enforces, so a view-only user sees the controls locked and why.
  const bolehUbah = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE);
  return <CategoryMappingsClient initialRows={rows} bolehUbah={bolehUbah} />;
}
