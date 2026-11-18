import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { ViraWidget } from "@/components/vira/ViraWidget";
import { BackofficeShell } from "./BackofficeShell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const enabled = !!session?.user && hasPermission(session.user.permissions ?? [], "vira:use");

  return (
    <>
      <BackofficeShell>{children}</BackofficeShell>
      <ViraWidget enabled={enabled} />
    </>
  );
}
