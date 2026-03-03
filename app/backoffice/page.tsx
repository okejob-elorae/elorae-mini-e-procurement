import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getFirstAllowedBackofficeRoute } from '@/lib/rbac';

export default async function BackofficePage() {
  const session = await auth();
  const permissions = (session?.user as { permissions?: string[] })?.permissions ?? [];
  const firstAllowed = getFirstAllowedBackofficeRoute(permissions);
  if (firstAllowed) {
    redirect(firstAllowed);
  }
  // User has no permitted backoffice route; show message instead of redirecting to dashboard (would loop)
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">No access</h1>
      <p className="text-muted-foreground">
        You don&apos;t have permission to access any section. Please contact your administrator.
      </p>
    </div>
  );
}
