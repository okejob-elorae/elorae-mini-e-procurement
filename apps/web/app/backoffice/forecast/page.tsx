import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { ForecastPageClient } from './ForecastPageClient';

export const dynamic = 'force-dynamic';

export default async function ForecastPage() {
  const session = await auth();
  if (!session) redirect('/login');
  if (!hasPermission(session.user.permissions, PERMISSIONS.FORECAST_VIEW)) {
    redirect('/backoffice/dashboard');
  }

  return <ForecastPageClient />;
}
